import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ActivityIndicator, Alert } from 'react-native';
import { BellRing, MapPin } from 'lucide-react-native';
import { useOpsStaffStore } from '../store/opsStaffStore';
import { acceptTask } from '../utils/opsPickup';
import { isPending, pickupLabel } from '../utils/opsTasks';
import { stopAlarm } from '../utils/alerts';

export function GlobalAssignmentModal() {
  const { myTasks, myDeliveries } = useOpsStaffStore();
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  // Find the first unaccepted active task
  const unacceptedPickup = myTasks.find(t => 
    (t.status === 'pending' || t.status === 'assigned') && !t.acceptedAt
  );

  const unacceptedDelivery = myDeliveries.find(t => 
    (t.status === 'pending' || t.status === 'assigned' || t.status === 'out_for_delivery') && !t.acceptedAt
  );
  
  const activeTask = unacceptedPickup || unacceptedDelivery;

  const isDelivery = Boolean(activeTask && 'deliveryAddress' in activeTask);
  const address = activeTask ? (isDelivery ? (activeTask as any).deliveryAddress : (activeTask as any).pickupAddress) : '';

  React.useEffect(() => {
    // If modal goes away (task accepted elsewhere, reassigned, or user clicked accept), stop the alarm.
    if (!activeTask) {
      stopAlarm();
    }
  }, [activeTask]);

  const handleAccept = async () => {
    if (!activeTask) return;
    setAcceptingId(activeTask.id);
    stopAlarm(); // Immediately silence the ringing
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
        <View className="bg-white rounded-3xl p-6 items-center shadow-2xl border-4 border-blue-500">
          <View className="w-20 h-20 rounded-full bg-blue-100 items-center justify-center mb-6 animate-pulse">
            <BellRing size={40} color="#3b82f6" />
          </View>

          <Text className="text-3xl font-black text-gray-900 mb-2 text-center">New Order Assigned!</Text>
          <Text className="text-lg text-gray-500 font-medium mb-6 text-center">
            {isDelivery ? 'Delivery' : 'Pickup'} • #{activeTask.orderId.slice(-6).toUpperCase()}
          </Text>

          <View className="w-full bg-gray-50 rounded-2xl p-5 mb-8 border border-gray-100">
            <View className="flex-row items-start mb-4">
              <MapPin size={20} color="#64748b" className="mr-3 mt-0.5" />
              <Text className="flex-1 text-gray-700 font-medium leading-relaxed">{address}</Text>
            </View>
            {!isDelivery && (
              <View className="bg-blue-50 self-start px-3 py-1.5 rounded-lg border border-blue-100">
                <Text className="text-blue-700 font-bold text-sm">
                  {pickupLabel(activeTask as any)}
                </Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            onPress={handleAccept}
            disabled={!!acceptingId}
            className="w-full h-16 bg-blue-600 rounded-2xl items-center justify-center flex-row shadow-lg shadow-blue-500/30"
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
