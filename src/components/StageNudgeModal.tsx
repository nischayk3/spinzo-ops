import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Modal, TouchableOpacity, ActivityIndicator, Platform, AppState } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Clock, Play, CheckCircle, X, ExternalLink } from 'lucide-react-native';
import { useOpsProcessStore } from '../store/opsProcessStore';
import { useOrderFeedStore } from '../store/orderFeedStore';
import { useAuthStore } from '../store/authStore';
import { useOpsStaffStore } from '../store/opsStaffStore';
import { useStaffRosterStore } from '../store/staffRosterStore';
import { getActiveStageNudge, ActiveStageNudge, recordLocalSnooze } from '../utils/stageNudges';
import { startVoiceAlertLoop, stopAlarm } from '../utils/alerts';
import { buildHindiVoicePrompt, extractCleanTokenNumber } from '../utils/voiceScripts';
import { triggerStageNudgeNotification, clearAssignmentNotifications } from '../utils/systemNotifications';
import { SpinzoOverlay } from 'spinzo-overlay';
import type { RootStackParamList } from '../navigation/RootNavigator';

export function StageNudgeModal() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const user = useAuthStore(s => s.user);
  const activeRole = useAuthStore(s => s.activeRole);
  const staffDoc = useOpsStaffStore(s => s.staffDoc);
  const rosterHelpers = useStaffRosterStore(s => s.roster.helpers);
  const orders = useOrderFeedStore(s => s.orders);
  const { processes, snoozeNudge, startStep, completeStep } = useOpsProcessStore();
  const [activeNudge, setActiveNudge] = useState<ActiveStageNudge | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const wasAlertingRef = useRef(false);
  const lastAlertedKeyRef = useRef<string>('');

  const isOnShift = staffDoc?.onShift === true;
  const isOnBreak = Boolean(
    staffDoc?.onBreak ||
    staffDoc?.attendanceStatus === 'lunch' ||
    staffDoc?.attendanceStatus === 'short_break'
  );

  // Poll for nudges every 10 seconds - Active working Helper and Iron specialist ONLY
  useEffect(() => {
    if (!user?.id || activeRole === 'supervisor' || activeRole === 'admin' || !isOnShift || isOnBreak) {
      setActiveNudge(null);
      return;
    }

    const check = () => {
      const workingHelperIds = new Set(
        rosterHelpers
          .filter(
            h =>
              (h.role === 'helper' || h.role === 'iron') &&
              h.onShift === true &&
              !h.onBreak &&
              h.attendanceStatus !== 'lunch' &&
              h.attendanceStatus !== 'short_break' &&
              h.attendanceStatus !== 'off'
          )
          .map(h => h.uid)
      );
      if (isOnShift && !isOnBreak && user.id) {
        workingHelperIds.add(user.id);
      }

      const nudge = getActiveStageNudge(processes, user.id, Date.now(), activeRole || undefined, {
        onShift: isOnShift,
        onBreak: isOnBreak,
        workingHelperIds,
      });
      setActiveNudge(nudge);
    };

    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, [processes, user?.id, activeRole, isOnShift, isOnBreak, rosterHelpers]);

  const matchedProcess = activeNudge
    ? (activeNudge.processId ? processes.find(p => p.id === activeNudge.processId) : undefined) ||
      processes.find(p => p.orderId === activeNudge.orderId)
    : undefined;
  const matchedOrder = activeNudge
    ? orders.find(o => o.id === activeNudge.orderId)
    : undefined;
  const rawToken = matchedProcess?.tokenNumber || matchedOrder?.tokenNumber;
  const cleanToken = extractCleanTokenNumber(rawToken, (matchedOrder as any)?.tokens);
  const voiceText = activeNudge
    ? buildHindiVoicePrompt({
        kind: 'nudge',
        step: activeNudge.step,
        phase: activeNudge.phase,
        tokenNumber: rawToken,
        tokensMap: (matchedOrder as any)?.tokens,
      })
    : '';

  const activeAlertKey = activeNudge && !busy
    ? `${activeNudge.processId || activeNudge.orderId}:${activeNudge.step}:${activeNudge.phase}`
    : '';

  // Alert triggers: Chime-then-Hindi-voice loop + background-only system notification & Android overlay
  useEffect(() => {
    if (activeNudge && !busy) {
      if (lastAlertedKeyRef.current === activeAlertKey) return;
      lastAlertedKeyRef.current = activeAlertKey;
      wasAlertingRef.current = true;
      startVoiceAlertLoop(voiceText);

      const isBackgrounded = AppState.currentState !== 'active';
      if (isBackgrounded) {
        triggerStageNudgeNotification({
          orderId: activeNudge.orderId,
          orderShortId: activeNudge.orderId.slice(-6).toUpperCase(),
          title: activeNudge.title,
          message: activeNudge.message,
          step: activeNudge.step,
          phase: activeNudge.phase,
        });
      }

      if (Platform.OS === 'android' && isBackgrounded) {
        SpinzoOverlay.showOverlay({
          orderId: activeNudge.orderId,
          taskType: 'stage_nudge',
          customerName: activeNudge.title,
          address: activeNudge.message,
          step: activeNudge.step,
          phase: activeNudge.phase,
          stepName: activeNudge.actionLabel,
          tokenNumber: cleanToken,
          voiceText,
        } as any);
      }
    } else if (!activeNudge) {
      lastAlertedKeyRef.current = '';
      if (wasAlertingRef.current) {
        wasAlertingRef.current = false;
        stopAlarm();
        clearAssignmentNotifications();
        if (Platform.OS === 'android') {
          SpinzoOverlay.dismissOverlay();
        }
      }
    }
  }, [activeAlertKey]);

  useEffect(() => {
    return () => {
      if (wasAlertingRef.current) {
        wasAlertingRef.current = false;
        lastAlertedKeyRef.current = '';
        stopAlarm();
        if (Platform.OS === 'android') {
          SpinzoOverlay.dismissOverlay();
        }
      }
    };
  }, []);

  if (!activeNudge) return null;

  const handleDismiss = () => {
    wasAlertingRef.current = false;
    lastAlertedKeyRef.current = '';
    stopAlarm();
    clearAssignmentNotifications();
    if (Platform.OS === 'android') {
      SpinzoOverlay.dismissOverlay();
    }
    const current = activeNudge;
    // Snooze BOTH locally AND on backend so the 1-min FCM cron doesn't immediately re-push!
    recordLocalSnooze(`${current.processId || current.orderId}_${current.step}_${current.phase}`);
    setActiveNudge(null);
    snoozeNudge(current.orderId, current.step as any, current.phase as any, current.processId).catch(() => {});
  };

  const handleSnooze = async () => {
    wasAlertingRef.current = false;
    lastAlertedKeyRef.current = '';
    stopAlarm();
    clearAssignmentNotifications();
    if (Platform.OS === 'android') {
      SpinzoOverlay.dismissOverlay();
    }
    const current = activeNudge;
    // Instantly record local snooze and dismiss the dialog so operations are 100% smooth
    recordLocalSnooze(`${current.processId || current.orderId}_${current.step}_${current.phase}`);
    setActiveNudge(null);

    try {
      await snoozeNudge(
        current.orderId,
        current.step as any,
        current.phase as any,
        current.processId
      );
    } catch (e: any) {
      console.warn('Background snooze failed:', e);
    }
  };

  const isHandsOn = activeNudge.phase === 'hands_on' || activeNudge.step === 'tagging' || activeNudge.step === 'packaging';

  const handleAction = async () => {
    const current = activeNudge;
    wasAlertingRef.current = false;
    stopAlarm();
    clearAssignmentNotifications();
    if (Platform.OS === 'android') {
      SpinzoOverlay.dismissOverlay();
    }
    setActionError(null);

    if (isHandsOn) {
      // Snooze BOTH locally AND on backend when opening the order so FCM doesn't interrupt while working!
      lastAlertedKeyRef.current = '';
      recordLocalSnooze(`${current.processId || current.orderId}_${current.step}_${current.phase}`);
      setActiveNudge(null);
      snoozeNudge(current.orderId, current.step as any, current.phase as any, current.processId).catch(() => {});
      navigation.navigate('OrderDetail', {
        orderId: current.orderId,
        processId: current.processId,
      });
      return;
    }

    setBusy(true);
    try {
      let res;
      if (current.phase === 'accepted') {
        res = await startStep(current.orderId, current.processId);
      } else {
        res = await completeStep(current.orderId, current.processId);
      }

      const alreadyDoneErrors = ['already_started', 'already_completed', 'already_progressed', 'invalid_state'];
      if (res?.ok || (res?.error && alreadyDoneErrors.includes(res.error))) {
        // Successfully transitioned or already transitioned by another action — locally snooze so 5s poller doesn't re-open before snapshot
        recordLocalSnooze(`${current.processId || current.orderId}_${current.step}_${current.phase}`);
        lastAlertedKeyRef.current = '';
        setActiveNudge(null);
        clearAssignmentNotifications();
        if (Platform.OS === 'android') {
          SpinzoOverlay.dismissOverlay();
        }
      } else {
        const errorMap: Record<string, string> = {
          machine_capacity_reached: 'All machines are currently running. Please wait for an active cycle to finish.',
          unauthorized: 'You are not assigned to this step.',
          not_found: 'Process record not found. Please refresh.',
          server_error: 'Server is synchronizing. Please tap again to retry.',
          internal: 'Connection glitch. Please tap again to retry.',
          invalid_input: 'Action could not be verified. Please tap again.',
        };
        setActionError(errorMap[res?.error] || res?.error || 'Action failed. Please try again.');
      }
    } catch (e: any) {
      setActionError('Connection error. Please check internet and tap again.');
    } finally {
      setBusy(false);
    }
  };

  const isComplete = activeNudge.phase === 'started';

  return (
    <Modal visible={true} transparent={true} animationType="fade">
      <View className="flex-1 bg-black/60 items-center justify-center p-4">
        <View className="bg-bgSurface w-full max-w-sm rounded-2xl p-5 border border-bgSurfaceLight shadow-2xl">
          {/* Header */}
          <View className="flex-row items-center mb-3">
            <View className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${isComplete ? 'bg-success/20' : 'bg-warning/20'}`}>
              {isComplete ? (
                <CheckCircle size={22} color="#22c55e" />
              ) : (
                <Clock size={22} color="#f59e0b" />
              )}
            </View>
            <View className="flex-1">
              <Text className="text-textPrimary font-bold text-lg">{activeNudge.title}</Text>
              <Text className="text-textMuted text-xs font-semibold">
                {cleanToken ? `Token #${cleanToken} • ` : ''}Order #{activeNudge.orderId.includes('__') ? activeNudge.orderId.split('__')[0].slice(-6).toUpperCase() : activeNudge.orderId.slice(-6).toUpperCase()} • {activeNudge.elapsedMinutes}m elapsed
              </Text>
            </View>
            <TouchableOpacity
              onPress={handleDismiss}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              className="p-1 rounded-full bg-bgDark border border-bgSurfaceLight/50"
            >
              <X size={16} color="#94a3b8" />
            </TouchableOpacity>
          </View>

          {/* Message */}
          <View className="bg-bgDark p-3.5 rounded-xl border border-bgSurfaceLight/60 mb-4">
            <Text className="text-textSecondary text-sm leading-relaxed">
              {activeNudge.message}
            </Text>
          </View>

          {actionError ? (
            <View className="bg-danger/20 border border-danger/40 p-2.5 rounded-lg mb-3">
              <Text className="text-danger text-xs font-semibold">{actionError}</Text>
            </View>
          ) : null}

          {/* Action Buttons */}
          <View className="gap-2.5">
            <TouchableOpacity
              onPress={handleAction}
              disabled={busy}
              className={`h-12 rounded-xl flex-row items-center justify-center ${isComplete ? 'bg-success' : 'bg-primary'}`}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  {isComplete ? (
                    <CheckCircle size={18} color="#fff" className="mr-2" />
                  ) : isHandsOn ? (
                    <ExternalLink size={18} color="#fff" className="mr-2" />
                  ) : (
                    <Play size={18} color="#fff" className="mr-2" />
                  )}
                  <Text className="text-white font-bold text-base">{activeNudge.actionLabel}</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleSnooze}
              disabled={busy}
              className="h-11 rounded-xl bg-bgDark border border-bgSurfaceLight items-center justify-center"
            >
              <Text className="text-textSecondary font-semibold text-sm">
                {activeNudge.snoozeLabel}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
