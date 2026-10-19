import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, ActivityIndicator, Alert, Platform } from 'react-native';
import { BellRing, CheckCircle2, MapPin, Package, Hash, User, Layers, X, WashingMachine } from 'lucide-react-native';
import { useOpsStaffStore } from '../store/opsStaffStore';
import { useOrderFeedStore } from '../store/orderFeedStore';
import { useOpsProcessStore } from '../store/opsProcessStore';
import { useAuthStore } from '../store/authStore';
import { getTopEligibleTask } from '../utils/helperEligibility';
import { useStoreResourcesStore } from '../store/storeResourcesStore';
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
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [localSnoozeMap, setLocalSnoozeMap] = useState<Record<string, number>>({});

  const effectiveRole = authRole || staffDoc?.role || 'helper';
  const candidateTask = staffDoc ? getTopEligibleTask(processes, orders, staffDoc.uid, effectiveRole, staffDoc.activeHelperTask || null, resources, staffDoc.onShift === true, staffDoc.phone) : null;

  // Check if this task was recently dismissed/snoozed by the user
  const isSnoozed = candidateTask ? Boolean(localSnoozeMap[candidateTask.orderId || candidateTask.id] && Date.now() < (localSnoozeMap[candidateTask.orderId || candidateTask.id] + 5 * 60 * 1000)) : false;
  const activeTask = isSnoozed ? null : candidateTask;

  const order = activeTask ? orders.find(o => o.id === activeTask.orderId) : undefined;
  const curStep = activeTask ? (activeTask.steps[activeTask.currentIndex] || activeTask.status) : '';
  const isHandsOn = staffDoc ? isHelperDoingHandsOn(processes, staffDoc.uid) : false;
  const isMachineMicroTask = activeTask ? isMachineStep(curStep) : false;
  const showAsBanner = isHandsOn && isMachineMicroTask;

  useEffect(() => {
    if (activeTask && !acceptingId) {
      // Only play sound if helper is free (never ring loud alarm if helper is busy with hands-on garments)
      if (!showAsBanner) {
        dramaticChime(false);
      }
      const addr = order?.address?.formattedAddress || (order as any)?.pickupAddress || (order as any)?.deliveryAddress || '';
      triggerAssignmentNotification({
        orderId: activeTask.orderId,
        orderShortId: activeTask.orderId.slice(-6).toUpperCase(),
        taskType: curStep ? `${stepLabel(curStep)} Stage` : 'Process Stage',
        address: addr,
        isInstant: Boolean(order?.pickupDetails?.isInstant),
      });

      if (Platform.OS === 'android' && !showAsBanner) {
        SpinzoOverlay.showOverlay({
          orderId: activeTask.orderId || activeTask.id,
          taskType: 'helper_step',
          customerName: order?.customerName || '',
          address: addr || 'Store Operations',
          stepName: curStep ? stepLabel(curStep) : '',
        });
      }
    } else {
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
  }, [activeTask?.id, acceptingId, showAsBanner]);

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
    stopAlarm();
    clearAssignmentNotifications();
    if (Platform.OS === 'android') {
      SpinzoOverlay.dismissOverlay();
    }
    if (activeTask) {
      const key = activeTask.orderId || activeTask.id;
      setLocalSnoozeMap(prev => ({ ...prev, [key]: Date.now() }));
    }
  };

  const handleAccept = async () => {
    if (!activeTask || !staffDoc) return;
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
      <View className="flex-1 bg-black/80 justify-center p-5">
        <View className="bg-bgSurface rounded-3xl border border-bgSurfaceLight shadow-lg max-h-[88%]">
          {/* Header */}
          <View className="items-center pt-6 px-5 pb-4 border-b border-bgSurfaceLight relative">
            <TouchableOpacity 
              onPress={handleDismiss}
              className="absolute top-4 right-4 w-9 h-9 rounded-full bg-bgSurfaceLight items-center justify-center z-10"
            >
              <X size={18} color="#9ca3af" />
            </TouchableOpacity>

            <View className="w-16 h-16 rounded-full bg-primary/15 items-center justify-center mb-3">
              <BellRing size={28} color="#994BFF" />
            </View>
            <Text className="text-2xl font-black text-textPrimary text-center">New Task Available</Text>
            
            {activeTask.isPushedToMe && (
              <View className="mt-2 bg-purple-500 rounded-full px-3 py-1">
                <Text className="text-white font-bold text-xs uppercase tracking-widest">Assigned by Supervisor</Text>
              </View>
            )}

            {order?.isUrgent && (
              <View className="mt-2 bg-red-500/20 border border-red-500/50 rounded-full px-3 py-1 flex-row items-center">
                <Text className="text-red-400 font-black text-xs uppercase tracking-widest">⚡ URGENT ORDER</Text>
              </View>
            )}

            <View className="mt-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
              <Text className="text-primary font-black uppercase tracking-widest text-sm">{stepLabel(curStep)}</Text>
            </View>
          </View>

          {/* Order identity — order number + token (truck #) so two helpers never mix up orders */}
          <View className="px-5 py-4">
            {order?.pickupNote ? (
              <View className="bg-amber-500/15 border border-amber-500/40 rounded-xl p-3 mb-4">
                <Text className="text-amber-400 text-xs font-bold uppercase mb-0.5">Rider Pickup Note</Text>
                <Text className="text-amber-200 text-sm font-medium">{order.pickupNote}</Text>
              </View>
            ) : null}
            {token ? (
              <View className="flex-row items-center justify-between bg-primary/10 border border-primary/20 rounded-2xl p-4 mb-4">
                <View className="flex-row items-center">
                  <Hash size={20} color="#994BFF" className="mr-2" />
                  <Text className="text-textSecondary text-sm font-semibold">Token / Bundle</Text>
                </View>
                <Text className="text-primary font-black text-3xl">#{token}</Text>
              </View>
            ) : null}

            <View className="flex-row items-start mb-3">
              <View className="w-9 h-9 rounded-full bg-bgSurfaceLight items-center justify-center mr-3">
                <Package size={16} color="#3B82F6" />
              </View>
              <View className="flex-1">
                <Text className="text-textMuted text-xs font-bold uppercase tracking-wide">Order</Text>
                <Text className="text-textPrimary font-bold text-lg">#{orderShort}</Text>
              </View>
            </View>

            {order?.customerName ? (
              <View className="flex-row items-start mb-3">
                <View className="w-9 h-9 rounded-full bg-bgSurfaceLight items-center justify-center mr-3">
                  <User size={16} color="#10b981" />
                </View>
                <View className="flex-1">
                  <Text className="text-textMuted text-xs font-bold uppercase tracking-wide">Customer</Text>
                  <Text className="text-textPrimary font-bold text-base">{order.customerName}</Text>
                </View>
              </View>
            ) : null}

            {serviceLabel || qty > 0 ? (
              <View className="flex-row items-start mb-3">
                <View className="w-9 h-9 rounded-full bg-bgSurfaceLight items-center justify-center mr-3">
                  <Layers size={16} color="#f59e0b" />
                </View>
                <View className="flex-1">
                  <Text className="text-textMuted text-xs font-bold uppercase tracking-wide">Service</Text>
                  <Text className="text-textPrimary font-medium text-base">{serviceLabel || '—'}{qty > 0 ? ` · ${qty} units` : ''}</Text>
                </View>
              </View>
            ) : null}

            {order?.totalAmount ? (
              <View className="flex-row items-start">
                <View className="w-9 h-9 rounded-full bg-bgSurfaceLight items-center justify-center mr-3">
                  <Text className="text-textMuted text-xs font-bold">₹</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-textMuted text-xs font-bold uppercase tracking-wide">Order Value</Text>
                  <Text className="text-textPrimary font-bold text-base">₹{orderTotal(order)}</Text>
                </View>
              </View>
            ) : null}
          </View>

          {/* Action Buttons */}
          <View className="px-5 pb-6 pt-2 flex-row items-center gap-3">
            <TouchableOpacity
              onPress={handleDismiss}
              className="flex-1 h-14 bg-bgSurfaceLight rounded-2xl items-center justify-center border border-bgSurfaceLight"
            >
              <Text className="text-textSecondary text-base font-bold">Later</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleAccept}
              disabled={!!acceptingId}
              className="flex-2 h-14 bg-primary rounded-2xl items-center justify-center flex-row px-5"
            >
              {acceptingId ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <CheckCircle2 color="white" size={20} className="mr-2" />
                  <Text className="text-white text-base font-black tracking-wide uppercase">Accept Task</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
