import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, ActivityIndicator, Alert, Platform } from 'react-native';
import { BellRing, MapPin, Zap, Clock, X } from 'lucide-react-native';
import { useOpsStaffStore } from '../store/opsStaffStore';
import { useOrderFeedStore } from '../store/orderFeedStore';
import { acceptTask } from '../utils/opsPickup';
import { isPending, pickupLabel } from '../utils/opsTasks';
import { slotLabel } from '../utils/orderFeed';
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
  const { myTasks, myDeliveries } = useOpsStaffStore();
  const orders = useOrderFeedStore(state => state.orders);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [locallyAcceptedIds, setLocallyAcceptedIds] = useState<Set<string>>(new Set());

  // Only alert for pickup tasks whose ORDER is still awaiting pickup
  const isOrderAwaitingPickup = (orderId?: string) => {
    if (!orderId) return true;
    const order = orders.find(o => o.id === orderId);
    if (!order) return true;
    return order.status === 'placed' || order.status === 'confirmed' || order.status === 'in_transit_to_store';
  };

  const unacceptedPickup = myTasks.find(t =>
    (t.status === 'pending' || t.status === 'assigned') &&
    !t.acceptedAt &&
    !locallyAcceptedIds.has(t.id) &&
    !locallyAcceptedIds.has(t.orderId) &&
    isOrderAwaitingPickup(t.orderId)
  );

  const unacceptedDelivery = myDeliveries.find(t =>
    (t.status === 'pending' || t.status === 'assigned' || t.status === 'out_for_delivery') &&
    !t.acceptedAt &&
    !locallyAcceptedIds.has(t.id) &&
    !locallyAcceptedIds.has(t.orderId)
  );

  const activeTask = unacceptedPickup || unacceptedDelivery;

  const isDelivery = Boolean(activeTask && 'deliveryAddress' in activeTask);
  const matchedOrder = activeTask ? orders.find(o => o.id === activeTask.orderId) : undefined;
  const isInstant = !isDelivery && Boolean(
    (activeTask as any)?.pickupSlot?.isInstant || matchedOrder?.pickupDetails?.isInstant
  );
  const slotText = !isDelivery && activeTask
    ? (matchedOrder ? slotLabel(matchedOrder) : pickupLabel(activeTask as any))
    : '';

  const rawAddress = activeTask
    ? (isDelivery ? (activeTask as any).deliveryAddress : (activeTask as any).pickupAddress)
    : '';
  const address = safeAddress(rawAddress);
  const orderId = activeTask?.orderId || activeTask?.id || '';
  const shortId = safeShortId(orderId);

  useEffect(() => {
    if (activeTask && !acceptingId && !locallyAcceptedIds.has(activeTask.id)) {
      dramaticChime();
      triggerAssignmentNotification({
        orderId,
        orderShortId: shortId,
        taskType: isDelivery ? 'Delivery' : (isInstant ? 'Instant Pickup' : 'Pickup'),
        address,
        slotText,
        isInstant,
      });

      if (Platform.OS === 'android') {
        try {
          SpinzoOverlay.showOverlay({
            orderId,
            taskType: isDelivery ? 'delivery' : (isInstant ? 'instant_pickup' : 'pickup'),
            customerName: matchedOrder?.customerName || '',
            address,
            slot: slotText,
            isInstant: isInstant ? 'true' : 'false',
          });
        } catch (e) {
          console.warn('[GlobalAssignmentModal] SpinzoOverlay.showOverlay error:', e);
        }
      }
    } else if (!activeTask) {
      stopAlarm();
      clearAssignmentNotifications();
      if (Platform.OS === 'android') {
        try {
          SpinzoOverlay.dismissOverlay();
        } catch {}
      }
    }
    return () => {
      stopAlarm();
      if (Platform.OS === 'android') {
        try {
          SpinzoOverlay.dismissOverlay();
        } catch {}
      }
    };
  }, [activeTask?.id]);

  const handleAccept = async () => {
    if (!activeTask) return;
    const taskId = activeTask.id;
    const targetOrderId = activeTask.orderId || taskId;

    // 1. Immediately silence alerts and native overlay
    stopAlarm();
    clearAssignmentNotifications();
    if (Platform.OS === 'android') {
      try {
        SpinzoOverlay.dismissOverlay();
      } catch {}
    }

    // 2. Optimistically dismiss modal immediately so rider is never trapped
    setLocallyAcceptedIds(prev => new Set([...prev, taskId, targetOrderId]));
    setAcceptingId(taskId);

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
    stopAlarm();
    clearAssignmentNotifications();
    if (Platform.OS === 'android') {
      try {
        SpinzoOverlay.dismissOverlay();
      } catch {}
    }
    if (activeTask) {
      setLocallyAcceptedIds(prev => new Set([...prev, activeTask.id, activeTask.orderId]));
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
            <View className="flex-row items-start mb-4">
              <MapPin size={20} color="#94A3B8" className="mr-3 mt-0.5" />
              <Text className="flex-1 text-textSecondary font-medium leading-relaxed">{address}</Text>
            </View>
            {!isDelivery && !!slotText && (
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