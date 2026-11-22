import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Modal, ActivityIndicator, Alert, Platform, AppState } from 'react-native';
import { BellRing, MapPin, Zap, Clock, X, User, Phone } from 'lucide-react-native';
import { useOpsStaffStore } from '../store/opsStaffStore';
import { acceptTask } from '../utils/opsPickup';
import { isPending, pickupLabel, formatRiderDateLabel, taskAlertKey } from '../utils/opsTasks';
import { formatDisplayPhone } from '../utils/orderFeed';
import { stopAlarm, dramaticChime } from '../utils/alerts';
import { triggerAssignmentNotification, clearAssignmentNotifications } from '../utils/systemNotifications';
import { SpinzoOverlay } from 'spinzo-overlay';

const safeShortId = (id?: string | null): string => {
  if (!id || typeof id !== 'string') return '------';
  return id.slice(-6).toUpperCase();
};

const safeAddress = (addr: any): string => {
  if (!addr) return 'Customer Address';
  if (typeof addr === 'string') return addr;
  return addr.formattedAddress || addr.address || addr.fullAddress || addr.line1 || 'Customer Address';
};

export function GlobalAssignmentModal() {
  const { staffDoc, myTasks, myDeliveries } = useOpsStaffStore();
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [locallyAcceptedIds, setLocallyAcceptedIds] = useState<Set<string>>(new Set());
  const wasAlertingRef = useRef(false);

  const isOffShift = !staffDoc || staffDoc.onShift !== true;
  const isOnBreak = Boolean(
    staffDoc?.onBreak ||
    staffDoc?.attendanceStatus === 'lunch' ||
    staffDoc?.attendanceStatus === 'short_break'
  );

  const unacceptedPickup = isOffShift
    ? undefined
    : myTasks.find(t => {
        const key = taskAlertKey(t, 'pickup');
        const isSupervisorOverride = Boolean(t.assignedBy && t.assignedBy !== 'system_auto');
        if (isOnBreak && !isSupervisorOverride) return false;
        return (
          (t.status === 'pending' || t.status === 'assigned') &&
          !t.acceptedAt &&
          !locallyAcceptedIds.has(key)
        );
      });

  const unacceptedDelivery = isOffShift
    ? undefined
    : myDeliveries.find(t => {
        const key = taskAlertKey(t, 'delivery');
        const isSupervisorOverride = Boolean(t.assignedBy && t.assignedBy !== 'system_auto');
        if (isOnBreak && !isSupervisorOverride) return false;
        return (
          (t.status === 'pending' || t.status === 'assigned' || t.status === 'out_for_delivery') &&
          !t.acceptedAt &&
          !locallyAcceptedIds.has(key)
        );
      });

  const activeTask = unacceptedPickup || unacceptedDelivery;

  const isDelivery = Boolean(activeTask && 'deliveryAddress' in activeTask);
  const activeTaskKey = activeTask
    ? taskAlertKey(activeTask, isDelivery ? 'delivery' : 'pickup')
    : '';
  const isInstant = !isDelivery && Boolean((activeTask as any)?.pickupSlot?.isInstant);
  const deliverySlotText = isDelivery && activeTask
    ? [
        formatRiderDateLabel((activeTask as any).deliveryDate),
        (activeTask as any).deliveryTime,
      ]
        .filter(Boolean)
        .join(' • ')
    : '';
  const slotText = activeTask
    ? isDelivery
      ? deliverySlotText
      : pickupLabel(activeTask as any)
    : '';

  const customerName = (activeTask as any)?.customerName || '';
  const customerPhone = (activeTask as any)?.customerPhone || '';
  const rawAddress = activeTask
    ? (isDelivery ? (activeTask as any).deliveryAddress : (activeTask as any).pickupAddress)
    : '';
  const address = safeAddress(rawAddress);
  const orderId = activeTask?.orderId || activeTask?.id || '';
  const shortId = safeShortId(orderId);

  useEffect(() => {
    if (activeTask && activeTaskKey && !acceptingId && !locallyAcceptedIds.has(activeTaskKey)) {
      wasAlertingRef.current = true;
      dramaticChime(true);
      triggerAssignmentNotification({
        orderId,
        orderShortId: shortId,
        taskType: isDelivery ? 'Delivery' : (isInstant ? 'Instant Pickup' : 'Pickup'),
        address,
        slotText,
        isInstant,
      });

      if (Platform.OS === 'android' && AppState.currentState !== 'active') {
        try {
          SpinzoOverlay.showOverlay({
            orderId,
            taskType: isDelivery ? 'delivery' : (isInstant ? 'instant_pickup' : 'pickup'),
            customerName: (activeTask as any)?.customerName || 'Customer',
            address,
            slot: slotText,
            isInstant: isInstant ? 'true' : 'false',
          });
        } catch (e) {
          console.warn('[GlobalAssignmentModal] SpinzoOverlay.showOverlay error:', e);
        }
      }
    } else if (!activeTask) {
      if (wasAlertingRef.current) {
        wasAlertingRef.current = false;
        stopAlarm();
        clearAssignmentNotifications();
        if (Platform.OS === 'android') {
          try {
            SpinzoOverlay.dismissOverlay();
          } catch {}
        }
      }
    }
    return () => {
      if (wasAlertingRef.current) {
        wasAlertingRef.current = false;
        stopAlarm();
        if (Platform.OS === 'android') {
          try {
            SpinzoOverlay.dismissOverlay();
          } catch {}
        }
      }
    };
  }, [activeTaskKey, acceptingId]);

  const handleAccept = async () => {
    if (!activeTask || !activeTaskKey) return;
    const taskId = activeTask.id;
    const targetOrderId = activeTask.orderId || taskId;

    // 1. Immediately silence alerts and native overlay
    wasAlertingRef.current = false;
    stopAlarm();
    clearAssignmentNotifications();
    if (Platform.OS === 'android') {
      try {
        SpinzoOverlay.dismissOverlay();
      } catch {}
    }

    // 2. Optimistically dismiss modal immediately so rider is never trapped
    setLocallyAcceptedIds(prev => new Set([...prev, activeTaskKey]));
    setAcceptingId(activeTaskKey);

    // 3. Dispatch backend call with both targetOrderId and taskId
    try {
      const res = await acceptTask(targetOrderId, isDelivery, taskId);
      if (!res.ok && res.error !== 'alreadyDone') {
        console.warn('[GlobalAssignmentModal] acceptTask warning:', res.error);
      }
    } catch (err: any) {
      console.warn('[GlobalAssignmentModal] acceptTask network error:', err);
    } finally {
      setAcceptingId(null);
    }
  };

  const handleDismiss = () => {
    wasAlertingRef.current = false;
    stopAlarm();
    clearAssignmentNotifications();
    if (Platform.OS === 'android') {
      try {
        SpinzoOverlay.dismissOverlay();
      } catch {}
    }
    if (activeTaskKey) {
      setLocallyAcceptedIds(prev => new Set([...prev, activeTaskKey]));
    }
  };

  if (!activeTask) return null;

  return (
    <Modal visible={true} animationType="fade" transparent>
      <View className="flex-1 bg-black/80 justify-center p-6">
        <View className="bg-bgSurface rounded-3xl p-6 items-center border border-bgSurfaceLight shadow-lg relative">
          <TouchableOpacity 
            onPress={handleDismiss}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-bgDark items-center justify-center border border-bgSurfaceLight active:opacity-75"
          >
            <X size={18} color="#94A3B8" />
          </TouchableOpacity>

          <View className={`w-20 h-20 rounded-full items-center justify-center mb-5 ${isInstant ? 'bg-amber-500/15' : 'bg-primary/15'}`}>
            {isInstant ? <Zap size={40} color="#f59e0b" /> : <BellRing size={40} color="#994BFF" />}
          </View>

          <Text className="text-3xl font-black text-textPrimary mb-2 text-center">
            {isInstant ? '⚡ Instant Pickup!' : 'New Order Assigned!'}
          </Text>
          <Text className="text-lg text-textSecondary font-medium mb-6 text-center">
            {isDelivery ? 'Delivery' : (isInstant ? 'Instant Pickup' : 'Pickup')} • #{shortId}
          </Text>

          <View className="w-full bg-bgDark rounded-2xl p-5 mb-6 border border-bgSurfaceLight">
            {(customerName || customerPhone) ? (
              <View className="mb-3 pb-3 border-b border-bgSurfaceLight">
                {customerName ? (
                  <View className="flex-row items-center mb-1">
                    <User size={16} color="#E2E8F0" className="mr-2.5" />
                    <Text className="text-textPrimary font-extrabold text-base flex-1" numberOfLines={1}>
                      {customerName}
                    </Text>
                  </View>
                ) : null}
                {customerPhone ? (
                  <View className="flex-row items-center">
                    <Phone size={15} color="#34D399" className="mr-2.5" />
                    <Text className="text-emerald-400 font-bold text-sm">
                      {formatDisplayPhone(customerPhone)}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            <View className="flex-row items-start mb-4">
              <MapPin size={20} color="#94A3B8" className="mr-3 mt-0.5" />
              <Text className="flex-1 text-textSecondary font-medium leading-relaxed">{address}</Text>
            </View>
            {!!slotText && slotText !== '—' && (
              <View className={`self-start px-3.5 py-2 rounded-xl border flex-row items-center gap-2 ${isInstant ? 'bg-amber-500/15 border-amber-500/40' : 'bg-primary/10 border-primary/20'}`}>
                {isInstant ? <Zap size={16} color="#f59e0b" /> : <Clock size={16} color="#994BFF" />}
                <Text className={`font-bold text-sm ${isInstant ? 'text-amber-400' : 'text-primary'}`}>
                  {slotText}
                </Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            onPress={handleAccept}
            disabled={!!acceptingId}
            className="w-full h-16 bg-primary rounded-2xl items-center justify-center flex-row active:opacity-90 shadow-md"
          >
            {acceptingId ? (
              <ActivityIndicator color="#fff" size="large" />
            ) : (
              <Text className="text-white text-xl font-black tracking-wide uppercase">Accept Order</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}