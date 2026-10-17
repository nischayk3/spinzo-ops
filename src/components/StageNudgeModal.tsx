import React, { useState, useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { Clock, Play, CheckCircle, X } from 'lucide-react-native';
import { useOpsProcessStore } from '../store/opsProcessStore';
import { useAuthStore } from '../store/authStore';
import { getActiveStageNudge, ActiveStageNudge, recordLocalSnooze } from '../utils/stageNudges';
import { dramaticChime, stopAlarm } from '../utils/alerts';
import { triggerStageNudgeNotification, clearAssignmentNotifications } from '../utils/systemNotifications';
import { SpinzoOverlay } from 'spinzo-overlay';

export function StageNudgeModal() {
  const user = useAuthStore(s => s.user);
  const activeRole = useAuthStore(s => s.activeRole);
  const { processes, snoozeNudge, startStep, completeStep } = useOpsProcessStore();
  const [activeNudge, setActiveNudge] = useState<ActiveStageNudge | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Poll for nudges every 10 seconds
  useEffect(() => {
    if (!user?.id) {
      setActiveNudge(null);
      return;
    }

    const check = () => {
      const nudge = getActiveStageNudge(processes, user.id, Date.now(), activeRole || undefined);
      setActiveNudge(nudge);
    };

    check();
    const interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, [processes, user?.id, activeRole]);

  // Alert triggers: Alarm sound + system heads-up notification + Android over-the-app overlay
  useEffect(() => {
    if (activeNudge && !busy) {
      dramaticChime();
      triggerStageNudgeNotification({
        orderId: activeNudge.orderId,
        orderShortId: activeNudge.orderId.slice(-6).toUpperCase(),
        title: activeNudge.title,
        message: activeNudge.message,
        step: activeNudge.step,
        phase: activeNudge.phase,
      });

      if (Platform.OS === 'android') {
        SpinzoOverlay.showOverlay({
          orderId: activeNudge.orderId,
          taskType: 'stage_nudge',
          customerName: activeNudge.title,
          address: activeNudge.message,
          stepName: activeNudge.actionLabel,
        });
      }
    } else if (!activeNudge) {
      stopAlarm();
      clearAssignmentNotifications();
      if (Platform.OS === 'android') {
        SpinzoOverlay.dismissOverlay();
      }
    }
    return () => {
      stopAlarm();
      if (Platform.OS === 'android') {
        SpinzoOverlay.dismissOverlay();
      }
    };
  }, [activeNudge?.orderId, activeNudge?.phase, busy]);

  if (!activeNudge) return null;

  const handleDismiss = () => {
    stopAlarm();
    clearAssignmentNotifications();
    if (Platform.OS === 'android') {
      SpinzoOverlay.dismissOverlay();
    }
    // Snooze locally for 2 minutes on explicit X dismiss so user isn't immediately blocked
    recordLocalSnooze(`${activeNudge.processId || activeNudge.orderId}_${activeNudge.step}_${activeNudge.phase}`);
    setActiveNudge(null);
  };

  const handleSnooze = async () => {
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
        current.step,
        current.phase,
        current.processId
      );
    } catch (e: any) {
      console.warn('Background snooze failed:', e);
    }
  };

  const handleAction = async () => {
    stopAlarm();
    setBusy(true);
    setActionError(null);
    try {
      let res;
      if (activeNudge.phase === 'accepted') {
        res = await startStep(activeNudge.orderId, activeNudge.processId);
      } else {
        res = await completeStep(activeNudge.orderId, activeNudge.processId);
      }

      const alreadyDoneErrors = ['already_started', 'already_completed', 'already_progressed', 'invalid_state'];
      if (res?.ok || (res?.error && alreadyDoneErrors.includes(res.error))) {
        // Successfully transitioned or already transitioned by another action
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
                Order #{activeNudge.orderId.includes('__') ? activeNudge.orderId.split('__')[0].slice(-6).toUpperCase() : activeNudge.orderId.slice(-6).toUpperCase()} • {activeNudge.elapsedMinutes}m elapsed
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
