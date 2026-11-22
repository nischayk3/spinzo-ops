import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Modal, ActivityIndicator, Alert, Platform, AppState } from 'react-native';
import { BellRing, CheckCircle2, MapPin, Package, Hash, User, Layers, X, WashingMachine } from 'lucide-react-native';
import { useOpsStaffStore } from '../store/opsStaffStore';
import { useOrderFeedStore } from '../store/orderFeedStore';
import { useOpsProcessStore } from '../store/opsProcessStore';
import { useAuthStore } from '../store/authStore';
import { getTopEligibleTask } from '../utils/helperEligibility';
import { useStoreResourcesStore } from '../store/storeResourcesStore';
import { useHelperRulesStore } from '../store/helperRulesStore';
import { stopAlarm, dramaticChime } from '../utils/alerts';
import { stepLabel, currentStep, isMachineStep, isHelperDoingHandsOn } from '../utils/opsProcess';
import { serviceSummary, orderTotal } from '../utils/orderFeed';
import { doc, runTransaction } from '../config/firebase';
import { db } from '../config/firebase';
import { triggerAssignmentNotification, clearAssignmentNotifications } from '../utils/systemNotifications';
import { SpinzoOverlay } from 'spinzo-overlay';

export function HelperAssignmentModal() {
  const { staffDoc, clearActiveHelperTask } = useOpsStaffStore();
  const { processes, claim, acceptStep, isLoading: isProcessesLoading } = useOpsProcessStore();
  const { orders, isLoading: isOrdersLoading } = useOrderFeedStore();
  const authRole = useAuthStore(s => s.activeRole);
  const resources = useStoreResourcesStore(s => s.resources);
  const helperRules = useHelperRulesStore(s => s.rules);
  const subscribeHelperRules = useHelperRulesStore(s => s.subscribe);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [localSnoozeMap, setLocalSnoozeMap] = useState<Record<string, number>>({});
  const wasAlertingRef = useRef(false);

  const effectiveRole = authRole || staffDoc?.role || 'helper';

  useEffect(() => {
    if (effectiveRole === 'helper' || effectiveRole === 'iron') {
      subscribeHelperRules();
    }
  }, [effectiveRole, subscribeHelperRules]);

  const isOnBreak = Boolean(
    staffDoc?.onBreak ||
    staffDoc?.attendanceStatus === 'lunch' ||
    staffDoc?.attendanceStatus === 'short_break'
  );
  const candidateTask = staffDoc
    ? getTopEligibleTask(
        processes,
        orders,
        staffDoc.uid,
        effectiveRole,
        staffDoc.activeHelperTask || null,
        resources,
        staffDoc.onShift === true,
        staffDoc.phone,
        isOnBreak,
        helperRules
      )
    : null;

  const candidateSnoozeKey = candidateTask
    ? `${candidateTask.steps[candidateTask.currentIndex] || candidateTask.status}:${candidateTask.id}`
    : '';
  // Check if this task was recently dismissed/snoozed by the user
  const isSnoozed = candidateSnoozeKey
    ? Boolean(localSnoozeMap[candidateSnoozeKey] && Date.now() < (localSnoozeMap[candidateSnoozeKey] + 5 * 60 * 1000))
    : false;
  const activeTask = isSnoozed ? null : candidateTask;

  const order = activeTask ? orders.find(o => o.id === activeTask.orderId) : undefined;
  const curStep = activeTask ? (activeTask.steps[activeTask.currentIndex] || activeTask.status) : '';
  const isHandsOn = staffDoc ? isHelperDoingHandsOn(processes, staffDoc.uid) : false;
  const isMachineMicroTask = activeTask ? isMachineStep(curStep) : false;
  const showAsBanner = isHandsOn && isMachineMicroTask;

  useEffect(() => {
    if (activeTask && !acceptingId) {
      wasAlertingRef.current = true;
      // Loop alarm sound until helper accepts (continuous siren)
      if (!showAsBanner) {
        dramaticChime(true);
      }
      const addr = order?.address?.formattedAddress || (order as any)?.pickupAddress || (order as any)?.deliveryAddress || '';
      triggerAssignmentNotification({
        orderId: activeTask.orderId,
        orderShortId: activeTask.orderId.slice(-6).toUpperCase(),
        taskType: curStep ? `${stepLabel(curStep)} Stage` : 'Process Stage',
        address: addr,
        isInstant: Boolean(order?.pickupDetails?.isInstant),
      });

      if (Platform.OS === 'android' && !showAsBanner && AppState.currentState !== 'active') {
        SpinzoOverlay.showOverlay({
          orderId: activeTask.orderId || activeTask.id,
          taskType: 'helper_step',
          customerName: order?.customerName || '',
          address: addr || 'Store Operations',
          stepName: curStep ? stepLabel(curStep) : '',
        });
      }
    } else {
      if (wasAlertingRef.current) {
        wasAlertingRef.current = false;
        stopAlarm();
        clearAssignmentNotifications();
        if (Platform.OS === 'android') {
          SpinzoOverlay.dismissOverlay();
        }
      }
    }
    return () => {
      if (wasAlertingRef.current) {
        wasAlertingRef.current = false;
        stopAlarm();
        if (Platform.OS === 'android') {
          SpinzoOverlay.dismissOverlay();
        }
      }
    };
  }, [activeTask?.id, curStep, acceptingId, showAsBanner]);

  // Auto-clear active task if the order was cancelled, completed, or deleted
  useEffect(() => {
    if (!staffDoc?.activeHelperTask) return;
    if (isOrdersLoading || isProcessesLoading) return;

    const { orderId, step } = staffDoc.activeHelperTask;
    const p = processes.find(x => x.orderId === orderId);
    const o = orders.find(x => x.id === orderId);

    const isCancelled = p?.status === 'cancelled' || o?.status === 'cancelled';
    const isZombie = !o;
    const isStepFinished = Boolean(
      p && (
        p.stages?.[step]?.completedAt ||
        p.status === 'done' ||
        (currentStep(p) && currentStep(p) !== step && p.stages?.[step]?.completedAt)
      )
    );

    if (isCancelled || isZombie || isStepFinished) {
      clearActiveHelperTask();
    }
  }, [staffDoc?.activeHelperTask, processes, orders, isOrdersLoading, isProcessesLoading, clearActiveHelperTask]);

  const handleDismiss = () => {
    wasAlertingRef.current = false;
    stopAlarm();
    clearAssignmentNotifications();
    if (Platform.OS === 'android') {
      SpinzoOverlay.dismissOverlay();
    }
    if (activeTask) {
      const key = `${curStep}:${activeTask.id}`;
      setLocalSnoozeMap(prev => ({ ...prev, [key]: Date.now() }));
    }
  };

  const handleAccept = async () => {
    if (!activeTask || !staffDoc) return;
    wasAlertingRef.current = false;
    setAcceptingId(activeTask.id);
    stopAlarm();
    clearAssignmentNotifications();
    if (Platform.OS === 'android') {
      SpinzoOverlay.dismissOverlay();
    }

    try {
      const orderTargetId = activeTask.orderId || activeTask.id;
      const targetUserId = activeTask.userId || order?.userId;
      const targetVendorId = activeTask.vendorId || order?.vendorId;
      const token = activeTask.tokenNumber || order?.tokenNumber || '';

      if (curStep === 'tagging' && Object.keys(activeTask.stages || {}).length === 0) {
        const res = await claim(orderTargetId, token, targetUserId, targetVendorId);
        if (!res.ok) throw new Error(res.error || 'Failed to claim tagging task.');

        const staffRef = doc(db, 'ops_staff', staffDoc.uid);
        await runTransaction(db, async (tx) => {
          tx.update(staffRef, {
            activeHelperTask: {
              orderId: orderTargetId,
              step: 'tagging'
            }
          });
        });
        return;
      }

      const res = await acceptStep(orderTargetId, activeTask.id !== orderTargetId ? activeTask.id : undefined, targetUserId, targetVendorId);
      if (!res.ok) throw new Error(res.error || 'Failed to claim task.');

      // If helper is busy with hands-on work (e.g. tagging), DO NOT overwrite activeHelperTask!
      // This protects their active hands-on progress while allowing 60s machine loading.
      if (!isHandsOn) {
        const staffRef = doc(db, 'ops_staff', staffDoc.uid);
        await runTransaction(db, async (tx) => {
          tx.update(staffRef, {
            activeHelperTask: {
              orderId: orderTargetId,
              step: curStep
            }
          });
        });
      }

    } catch (err: any) {
      console.warn("Failed to claim task:", err);
      Alert.alert('Task Unavailable', err?.message || 'Someone else might have claimed it.');
    } finally {
      setAcceptingId(null);
    }
  };

  if (!activeTask) return null;

  const token = activeTask.tokenNumber || order?.tokenNumber;
  const orderShort = (activeTask.orderId || '').slice(-6).toUpperCase();
  const items = order?.items || [];
  const qty = items.reduce((sum, i: any) => sum + (i.quantity || 0), 0);
  const serviceLabel = activeTask.serviceLabel || (order ? serviceSummary(order) : '');

  // 1. NON-BLOCKING TOP BANNER: Rendered when helper is actively doing hands-on work (tagging/ironing/packaging)
  // Ensures screen is NEVER hijacked or locked while scanning tags or working!
  if (showAsBanner) {
    const machineName = activeTask.stages?.[curStep]?.machineName || (curStep === 'getting_washed' ? 'Washer' : 'Dryer');
    return (
      <View className="absolute top-12 left-4 right-4 bg-gray-900/95 border-2 border-purple-500/50 rounded-2xl p-3.5 shadow-2xl z-50 flex-row items-center justify-between">
        <View className="flex-row items-center flex-1 mr-3">
          <View className="w-10 h-10 rounded-full bg-purple-500/20 items-center justify-center mr-2.5">
            <WashingMachine size={20} color="#c084fc" />
          </View>
          <View className="flex-1">
            <Text className="text-white font-bold text-sm">
              {machineName} Ready to Load
            </Text>
            <Text className="text-gray-300 text-xs">
              Order #{orderShort} • 60s micro-task
            </Text>
          </View>
        </View>
        <View className="flex-row items-center gap-2">
          <TouchableOpacity onPress={handleDismiss} className="px-2.5 py-1.5 rounded-lg bg-gray-800">
            <Text className="text-gray-400 text-xs font-semibold">Later</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleAccept} disabled={!!acceptingId} className="px-3.5 py-1.5 rounded-lg bg-primary">
            {acceptingId ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text className="text-white text-xs font-bold">Start Now</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // 2. FULL MODAL: Rendered when helper is completely free
  return (
    <Modal visible={true} animationType="fade" transparent onRequestClose={handleDismiss}>
      <View className="flex-1 bg-black/80 justify-center p-4">
        <View className="bg-bgSurface rounded-3xl border border-bgSurfaceLight shadow-lg max-h-[88%]">
          {/* Header */}
          <View className="items-center pt-5 px-4 pb-3.5 border-b border-bgSurfaceLight relative">
            <TouchableOpacity
              onPress={handleDismiss}
              className="absolute top-3.5 right-3.5 w-8 h-8 rounded-full bg-bgSurfaceLight items-center justify-center z-10"
            >
              <X size={16} color="#9ca3af" />
            </TouchableOpacity>

            <View className="w-12 h-12 rounded-full bg-primary/15 items-center justify-center mb-2">
              <BellRing size={22} color="#994BFF" />
            </View>
            <Text className="text-xl font-black text-textPrimary text-center">New Task Available</Text>

            <View className="flex-row flex-wrap items-center justify-center gap-1.5 mt-2">
              <View className="px-2.5 py-0.5 rounded-full bg-primary/10 border border-primary/25">
                <Text className="text-primary font-black uppercase tracking-wider text-xs">{stepLabel(curStep)}</Text>
              </View>

              {activeTask.isPushedToMe && (
                <View className="bg-purple-500 rounded-full px-2.5 py-0.5">
                  <Text className="text-white font-bold text-[11px] uppercase tracking-wider">Assigned by Supervisor</Text>
                </View>
              )}

              {order?.isUrgent && (
                <View className="bg-red-500/20 border border-red-500/50 rounded-full px-2.5 py-0.5 flex-row items-center">
                  <Text className="text-red-400 font-black text-[11px] uppercase tracking-wider">⚡ Urgent</Text>
                </View>
              )}
            </View>
          </View>

          {/* Order identity — order number + token (truck #) so two helpers never mix up orders */}
          <View className="px-4 py-3.5">
            {order?.pickupNote ? (
              <View className="bg-amber-500/15 border border-amber-500/40 rounded-xl p-2.5 mb-3">
                <Text className="text-amber-400 text-[11px] font-bold uppercase mb-0.5">Rider Pickup Note</Text>
                <Text className="text-amber-200 text-xs font-medium">{order.pickupNote}</Text>
              </View>
            ) : null}
            {token ? (
              <View className="flex-row items-center justify-between bg-primary/10 border border-primary/20 rounded-2xl px-3.5 py-2.5 mb-3">
                <View className="flex-row items-center">
                  <Hash size={17} color="#994BFF" className="mr-1.5" />
                  <Text className="text-textSecondary text-xs font-semibold">Token / Bundle</Text>
                </View>
                <Text className="text-primary font-black text-2xl">#{token}</Text>
              </View>
            ) : null}

            <View className="flex-row items-center mb-2.5">
              <View className="w-8 h-8 rounded-full bg-bgSurfaceLight items-center justify-center mr-2.5">
                <Package size={15} color="#3B82F6" />
              </View>
              <View className="flex-1">
                <Text className="text-textMuted text-[11px] font-bold uppercase tracking-wide">Order</Text>
                <Text className="text-textPrimary font-bold text-base">#{orderShort}</Text>
              </View>
            </View>

            {order?.customerName ? (
              <View className="flex-row items-center mb-2.5">
                <View className="w-8 h-8 rounded-full bg-bgSurfaceLight items-center justify-center mr-2.5">
                  <User size={15} color="#10b981" />
                </View>
                <View className="flex-1">
                  <Text className="text-textMuted text-[11px] font-bold uppercase tracking-wide">Customer</Text>
                  <Text className="text-textPrimary font-bold text-sm" numberOfLines={1}>{order.customerName}</Text>
                </View>
              </View>
            ) : null}

            {serviceLabel || qty > 0 ? (
              <View className="flex-row items-center mb-2.5">
                <View className="w-8 h-8 rounded-full bg-bgSurfaceLight items-center justify-center mr-2.5">
                  <Layers size={15} color="#f59e0b" />
                </View>
                <View className="flex-1">
                  <Text className="text-textMuted text-[11px] font-bold uppercase tracking-wide">Service</Text>
                  <Text className="text-textPrimary font-medium text-sm">{serviceLabel || '—'}{qty > 0 ? ` · ${qty} units` : ''}</Text>
                </View>
              </View>
            ) : null}

            {order?.totalAmount ? (
              <View className="flex-row items-center">
                <View className="w-8 h-8 rounded-full bg-bgSurfaceLight items-center justify-center mr-2.5">
                  <Text className="text-textMuted text-xs font-bold">₹</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-textMuted text-[11px] font-bold uppercase tracking-wide">Order Value</Text>
                  <Text className="text-textPrimary font-bold text-sm">₹{orderTotal(order)}</Text>
                </View>
              </View>
            ) : null}
          </View>

          {/* Action Buttons */}
          <View className="px-4 pb-4 pt-1.5 flex-row items-center gap-2.5">
            <TouchableOpacity
              onPress={handleDismiss}
              className="flex-1 h-12 bg-bgSurfaceLight rounded-2xl items-center justify-center border border-bgSurfaceLight"
            >
              <Text className="text-textSecondary text-sm font-bold">Later</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleAccept}
              disabled={!!acceptingId}
              className="flex-2 h-12 bg-primary rounded-2xl items-center justify-center flex-row px-4"
            >
              {acceptingId ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <CheckCircle2 color="white" size={18} className="mr-1.5" />
                  <Text className="text-white text-sm font-black tracking-wide uppercase">Accept Task</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
