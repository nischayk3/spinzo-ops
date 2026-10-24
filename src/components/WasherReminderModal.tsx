import React, { useEffect, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { Sparkles, CheckCircle2, X, Clock, Droplets, RefreshCw } from 'lucide-react-native';
import { useWasherReminderStore } from '../store/washerReminderStore';
import { useOpsProcessStore } from '../store/opsProcessStore';
import { dramaticChime, stopAlarm } from '../utils/alerts';
import { triggerStageNudgeNotification, clearAssignmentNotifications } from '../utils/systemNotifications';
import { SpinzoOverlay } from 'spinzo-overlay';

export function WasherReminderModal() {
  const { activeReminder, dismissReminder, snoozeReminder } = useWasherReminderStore();
  const { markChemicalAdded, completeStep } = useOpsProcessStore();
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isDetergent = activeReminder?.milestone === 'detergent';
  const isSoftener = activeReminder?.milestone === 'softener';
  const isComplete = activeReminder?.milestone === 'complete';

  const title = isDetergent
    ? 'Add Detergent (13 Min)'
    : isSoftener
    ? 'Add Softener (21 Min)'
    : 'Washing Cycle Complete (35 Min)';

  const orderShortId = activeReminder
    ? (activeReminder.orderId.includes('__')
      ? activeReminder.orderId.split('__')[0].slice(-6).toUpperCase()
      : activeReminder.orderId.slice(-6).toUpperCase())
    : '';

  const description = isDetergent
    ? `Order #${orderShortId} has reached 13 minutes in the wash cycle. Please add detergent to Washer now.`
    : isSoftener
    ? `Order #${orderShortId} has reached 21 minutes (rinse cycle started). Please add fabric softener now.`
    : `Order #${orderShortId} wash cycle (35 mins) is done. Please unload the washer and transfer load to the dryer.`;

  const actionLabel = isDetergent
    ? 'Add Detergent Now'
    : isSoftener
    ? 'Add Softener Now'
    : 'Complete Washing & Unload';

  const snoozeLabel = isComplete ? 'Still running (+3m)' : 'Snooze (+2m)';
  const snoozeMins = isComplete ? 3 : 2;

  useEffect(() => {
    if (activeReminder) {
      dramaticChime(false);
      triggerStageNudgeNotification({
        orderId: activeReminder.orderId,
        orderShortId,
        title,
        message: description,
        step: 'getting_washed',
        phase: isComplete ? 'started' : 'accepted',
      });
      if (Platform.OS === 'android') {
        SpinzoOverlay.showOverlay({
          orderId: activeReminder.orderId,
          taskType: 'stage_nudge',
          customerName: title,
          address: description,
          stepName: actionLabel,
        });
      }
    } else {
      clearAssignmentNotifications();
      if (Platform.OS === 'android') {
        SpinzoOverlay.dismissOverlay();
      }
    }
    return () => {
      clearAssignmentNotifications();
      if (Platform.OS === 'android') {
        SpinzoOverlay.dismissOverlay();
      }
    };
  }, [activeReminder?.orderId, activeReminder?.milestone, title, description, actionLabel, orderShortId, isComplete]);

  if (!activeReminder) return null;

  const handleAction = async () => {
    stopAlarm();
    setBusy(true);
    setErrorMsg(null);
    try {
      if (isDetergent) {
        const res = await markChemicalAdded(activeReminder.orderId, activeReminder.processId, 'detergent');
        if (!res?.ok && res?.error && res.error !== 'already_added') {
          setErrorMsg(res.error || 'Failed to record detergent addition');
          return;
        }
      } else if (isSoftener) {
        const res = await markChemicalAdded(activeReminder.orderId, activeReminder.processId, 'softener');
        if (!res?.ok && res?.error && res.error !== 'already_added') {
          setErrorMsg(res.error || 'Failed to record softener addition');
          return;
        }
      } else if (isComplete) {
        const res = await completeStep(activeReminder.orderId, activeReminder.processId);
        if (!res?.ok && res?.error && !['already_completed', 'invalid_state'].includes(res.error)) {
          setErrorMsg(res.error || 'Failed to complete wash cycle');
          return;
        }
      }
      if (Platform.OS === 'android') {
        SpinzoOverlay.dismissOverlay();
      }
      dismissReminder();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Action failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleSnooze = () => {
    stopAlarm();
    clearAssignmentNotifications();
    if (Platform.OS === 'android') {
      SpinzoOverlay.dismissOverlay();
    }
    snoozeReminder(snoozeMins);
  };

  const handleDismiss = () => {
    stopAlarm();
    clearAssignmentNotifications();
    if (Platform.OS === 'android') {
      SpinzoOverlay.dismissOverlay();
    }
    dismissReminder();
  };

  const badgeBg = isDetergent ? 'bg-amber-100 text-amber-800' : isSoftener ? 'bg-purple-100 text-purple-800' : 'bg-green-100 text-green-800';

  return (
    <Modal visible={true} transparent={true} animationType="fade">
      <View className="flex-1 bg-black/65 items-center justify-center p-4">
        <View className="bg-bgSurface w-full max-w-sm rounded-3xl p-5 border border-bgSurfaceLight shadow-2xl">
          {/* Header */}
          <View className="flex-row items-center mb-3">
            <View
              className={`w-11 h-11 rounded-2xl items-center justify-center mr-3 ${
                isDetergent
                  ? 'bg-amber-500/20 border border-amber-500/30'
                  : isSoftener
                  ? 'bg-purple-500/20 border border-purple-500/30'
                  : 'bg-emerald-500/20 border border-emerald-500/30'
              }`}
            >
              {isDetergent ? (
                <Droplets size={22} color="#f59e0b" />
              ) : isSoftener ? (
                <Sparkles size={22} color="#a855f7" />
              ) : (
                <CheckCircle2 size={22} color="#22c55e" />
              )}
            </View>

            <View className="flex-1">
              <Text className="text-textPrimary font-black text-base">{title}</Text>
              <Text className="text-textMuted text-xs font-semibold">
                Order #{orderShortId} • {activeReminder.elapsedMinutes}m elapsed
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

          {/* Description */}
          <View className="bg-bgDark p-3.5 rounded-2xl border border-bgSurfaceLight/60 mb-4">
            <Text className="text-textSecondary text-sm leading-relaxed">{description}</Text>
          </View>

          {errorMsg ? (
            <View className="bg-danger/20 border border-danger/40 p-2.5 rounded-xl mb-3">
              <Text className="text-danger text-xs font-semibold">{errorMsg}</Text>
            </View>
          ) : null}

          {/* Action Buttons */}
          <View className="gap-2.5">
            <TouchableOpacity
              onPress={handleAction}
              disabled={busy}
              className={`h-12 rounded-xl flex-row items-center justify-center ${
                isDetergent
                  ? 'bg-amber-600'
                  : isSoftener
                  ? 'bg-purple-600'
                  : 'bg-emerald-600'
              }`}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  {isComplete ? (
                    <CheckCircle2 size={18} color="#fff" className="mr-2" />
                  ) : (
                    <Droplets size={18} color="#fff" className="mr-2" />
                  )}
                  <Text className="text-white font-black text-sm">{actionLabel}</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleSnooze}
              disabled={busy}
              className="h-11 rounded-xl bg-bgDark border border-bgSurfaceLight items-center justify-center"
            >
              <Text className="text-textSecondary font-semibold text-xs">{snoozeLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
