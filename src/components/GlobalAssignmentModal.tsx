import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ActivityIndicator, Alert, Platform } from 'react-native';
import { BellRing, MapPin, Zap, Clock } from 'lucide-react-native';
import { useOpsStaffStore } from '../store/opsStaffStore';
import { useOrderFeedStore } from '../store/orderFeedStore';
import { acceptTask } from '../utils/opsPickup';
import { isPending, pickupLabel } from '../utils/opsTasks';
import { slotLabel } from '../utils/orderFeed';
import { stopAlarm, dramaticChime } from '../utils/alerts';
import { triggerAssignmentNotification, clearAssignmentNotifications } from '../utils/systemNotifications';
import { SpinzoOverlay } from 'spinzo-overlay';

export function GlobalAssignmentModal() {
  const { myTasks, myDeliveries } = useOpsStaffStore();
  const orders = useOrderFeedStore(state => state.orders);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  // Only alert for pickup tasks whose ORDER is still awaiting pickup
  // (placed/confirmed/in_transit_to_store). The order status is the source of truth;
  // a task for an order that's already pickup_completed/processing/ready is stale.
  const isOrderAwaitingPickup = (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return true;
    return order.status === 'placed' || order.status === 'confirmed' || order.status === 'in_transit_to_store';
  };

  const unacceptedPickup = myTasks.find(t =>
    (t.status === 'pending' || t.status === 'assigned') && !t.acceptedAt && isOrderAwaitingPickup(t.orderId)
  );

  const unacceptedDelivery = myDeliveries.find(t =>
    (t.status === 'pending' || t.status === 'assigned' || t.status === 'out_for_delivery') && !t.acceptedAt
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

  const address = activeTask
    ? (isDelivery ? (activeTask as any).deliveryAddress : (activeTask as any).pickupAddress)
    : '';

  React.useEffect(() => {
    if (activeTask && !acceptingId) {
      dramaticChime();
      triggerAssignmentNotification({
        orderId: activeTask.orderId,
        orderShortId: activeTask.orderId.slice(-6).toUpperCase(),
        taskType: isDelivery ? 'Delivery' : (isInstant ? 'Instant Pickup' : 'Pickup'),
        address,
        slotText,
        isInstant,
      });

      if (Platform.OS === 'android') {
        SpinzoOverlay.showOverlay({
          orderId: activeTask.orderId,
          taskType: isDelivery ? 'delivery' : (isInstant ? 'instant_pickup' : 'pickup'),
          customerName: matchedOrder?.customerName || '',
          address: address || 'Customer Address',
          slot: slotText,
          isInstant: isInstant ? 'true' : 'false',
        });
      }
    } else if (!activeTask) {
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
  }, [activeTask?.id]);

  const handleAccept = async () => {
    if (!activeTask) return;
    setAcceptingId(activeTask.id);
    stopAlarm();
    clearAssignmentNotifications();
    if (Platform.OS === 'android') {
      SpinzoOverlay.dismissOverlay();
    }
    try {
      const res = await acceptTask(activeTask.id, isDelivery);
      if (!res.ok) {
        Alert.alert('Unable to Accept', res.error || 'Failed to accept task');
      }
    } catch (err: any) {
      console.warn("Failed to accept task:", err);
      Alert.alert('Error', err?.message || 'Network error while accepting task');
    } finally {
      setAcceptingId(null);
    }
  };

  if (!activeTask) return null;

  return (
    <Modal visible={true} animationType="fade" transparent>
      <View className="flex-1 bg-black/80 justify-center p-6">
        <View className="bg-bgSurface rounded-3xl p-6 items-center border border-bgSurfaceLight shadow-lg">
          <View className={`w-20 h-20 rounded-full items-center justify-center mb-6 ${isInstant ? 'bg-amber-500/15' : 'bg-primary/15'}`}>
            {isInstant ? <Zap size={40} color="#f59e0b" /> : <BellRing size={40} color="#994BFF" />}
          </View>

          <Text className="text-3xl font-black text-textPrimary mb-2 text-center">
            {isInstant ? '⚡ Instant Pickup!' : 'New Order Assigned!'}
          </Text>
          <Text className="text-lg text-textSecondary font-medium mb-6 text-center">
            {isDelivery ? 'Delivery' : (isInstant ? 'Instant Pickup' : 'Pickup')} • #{activeTask.orderId.slice(-6).toUpperCase()}
          </Text>

          <View className="w-full bg-bgDark rounded-2xl p-5 mb-8 border border-bgSurfaceLight">
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
            className="w-full h-16 bg-primary rounded-2xl items-center justify-center flex-row"
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