import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ActivityIndicator, Alert } from 'react-native';
import { BellRing, MapPin } from 'lucide-react-native';
import { useOpsStaffStore } from '../store/opsStaffStore';
import { useOrderFeedStore } from '../store/orderFeedStore';
import { acceptTask } from '../utils/opsPickup';
import { isPending, pickupLabel } from '../utils/opsTasks';
import { stopAlarm, dramaticChime } from '../utils/alerts';

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
  const address = activeTask
    ? (isDelivery ? (activeTask as any).deliveryAddress : (activeTask as any).pickupAddress)
    : '';

  React.useEffect(() => {
    if (activeTask && !acceptingId) {
      dramaticChime();
    } else if (!activeTask) {
      stopAlarm();
    }
    return () => { stopAlarm(); };
  }, [activeTask?.id]);

  const handleAccept = async () => {
    if (!activeTask) return;
    setAcceptingId(activeTask.id);
    stopAlarm();
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
          <View className="w-20 h-20 rounded-full bg-primary/15 items-center justify-center mb-6">
            <BellRing size={40} color="#994BFF" />
          </View>

          <Text className="text-3xl font-black text-textPrimary mb-2 text-center">New Order Assigned!</Text>
          <Text className="text-lg text-textSecondary font-medium mb-6 text-center">
            {isDelivery ? 'Delivery' : 'Pickup'} • #{activeTask.orderId.slice(-6).toUpperCase()}
          </Text>

          <View className="w-full bg-bgDark rounded-2xl p-5 mb-8 border border-bgSurfaceLight">
            <View className="flex-row items-start mb-4">
              <MapPin size={20} color="#94A3B8" className="mr-3 mt-0.5" />
              <Text className="flex-1 text-textSecondary font-medium leading-relaxed">{address}</Text>
            </View>
            {!isDelivery && (
              <View className="bg-primary/10 self-start px-3 py-1.5 rounded-lg border border-primary/20">
                <Text className="text-primary font-bold text-sm">
                  {pickupLabel(activeTask as any)}
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