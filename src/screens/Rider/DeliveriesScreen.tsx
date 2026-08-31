import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, Modal, TextInput, TouchableOpacity, Alert, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Package, Clock, MapPin, ShieldCheck, Phone, Navigation } from 'lucide-react-native';
import { useAuthStore } from '../../store/authStore';
import { useOpsStaffStore, DeliveryTask } from '../../store/opsStaffStore';
import { useOpsProcessStore } from '../../store/opsProcessStore';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { timeAgo } from '../../utils/orderFeed';

export function DeliveriesScreen() {
  const user = useAuthStore(state => state.user);
  const { myDeliveries, isLoading, initialize } = useOpsStaffStore();

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (user?.id) initialize(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only show active delivery tasks (out_for_delivery)
  const activeDeliveries = myDeliveries.filter(d => d.status === 'out_for_delivery');

  const handleVerifyDelivery = async () => {
    if (!activeTaskId || otp.length !== 4 || verifying) return;
    const task = myDeliveries.find(d => d.id === activeTaskId);
    if (!task) return;

    setVerifying(true);
    try {
      const res = await useOpsProcessStore.getState().verifyDeliveryOTP(task.orderId, task.userId, otp);
      if (res.ok) {
        setActiveTaskId(null);
        setOtp('');
        Alert.alert('Delivery verified', 'Order marked as delivered.');
      } else {
        const msg =
          res.error === 'invalid_otp' ? 'Incorrect OTP. Please try again.'
          : res.error === 'invalid_state' ? 'This order is no longer out for delivery.'
          : res.error === 'unauthorized' ? 'You are not authorized for this delivery.'
          : 'Could not verify delivery. Please try again.';
        Alert.alert('Verification failed', msg);
      }
    } catch {
      Alert.alert('Verification failed', 'Could not verify delivery. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const openDirections = (task: DeliveryTask) => {
    const addr = task.deliveryAddress || '';
    if (!addr) {
      Alert.alert('No Address', 'No delivery address available for this order.');
      return;
    }
    const url = Platform.OS === 'ios'
      ? `maps:0,0?q=${encodeURIComponent(addr)}`
      : `geo:0,0?q=${encodeURIComponent(addr)}`;
    Linking.openURL(url).catch(() =>
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`)
    );
  };

  if (isLoading && activeDeliveries.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-bgDark items-center justify-center">
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text className="text-textSecondary mt-4 font-bold">Loading deliveries…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bgDark">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-2xl font-bold text-textPrimary">My Deliveries</Text>
        <Text className="text-textSecondary">
          {activeDeliveries.length} active deliver{activeDeliveries.length === 1 ? 'y' : 'ies'}
        </Text>
      </View>
      <FlatList
        data={activeDeliveries}
        keyExtractor={t => t.id}
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={
          <View className="items-center justify-center mt-20">
            <Package size={36} color="#64748B" />
            <Text className="text-textSecondary text-lg font-bold mt-3">No deliveries assigned yet</Text>
            <Text className="text-textMuted text-center mt-2">Assigned deliveries appear here instantly.</Text>
          </View>
        }
        renderItem={({ item }) => {
          return (
            <View className="bg-bgSurface rounded-xl p-4 mb-3 border border-bgSurfaceLight">
              <View className="flex-row items-center justify-between mb-2">
                <View>
                  <Text className="text-textPrimary font-bold text-lg">
                    #{item.orderId.slice(-6).toUpperCase()}
                  </Text>
                  {item.customerName ? (
                    <Text className="text-textSecondary text-sm">{item.customerName}</Text>
                  ) : null}
                </View>
                {item.createdAt ? (
                  <View className="flex-row items-center gap-1">
                    <Clock size={14} color="#94a3b8" />
                    <Text className="text-textMuted text-xs">{timeAgo(item.createdAt)}</Text>
                  </View>
                ) : null}
              </View>

              {/* Delivery Address */}
              {item.deliveryAddress ? (
                <View className="flex-row items-start gap-2 mb-3 bg-bgDark p-3 rounded-lg">
                  <View className="w-8 h-8 rounded-full bg-bgSurfaceLight items-center justify-center mr-1">
                    <MapPin size={14} color="#3B82F6" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-textSecondary text-sm leading-tight mb-2">{item.deliveryAddress}</Text>
                    <TouchableOpacity 
                      onPress={() => {
                        // Assuming delivery task uses same lat/long structure if available on order
                        const order = useOrderFeedStore.getState().orders.find(o => o.id === item.orderId);
                        let addr = item.deliveryAddress || '';
                        if (order?.address?.latitude && order?.address?.longitude) {
                          addr = `${order.address.latitude},${order.address.longitude}`;
                        }
                        const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`;
                        Linking.openURL(url).catch(() => console.log('Could not open map URL:', url));
                      }}
                      className="flex-row items-center"
                    >
                      <Navigation size={12} color="#3B82F6" className="mr-1" />
                      <Text className="text-info text-xs font-bold">Get Directions</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}

              {/* Delivery Slot */}
              {item.deliveryDate && item.deliveryTime ? (
                <View className="flex-row items-center gap-2 mb-3 bg-green-500/10 p-2 rounded-lg">
                  <Clock size={14} color="#22c55e" />
                  <Text className="text-green-400 text-sm font-medium">
                    Slot: {item.deliveryDate}, {item.deliveryTime}
                  </Text>
                </View>
              ) : null}

              {/* Customer Phone */}
              {item.customerPhone ? (
                <TouchableOpacity
                  onPress={() => Linking.openURL(`tel:${item.customerPhone}`)}
                  className="flex-row items-center gap-2 mb-3"
                >
                  <Phone size={14} color="#94a3b8" />
                  <Text className="text-info text-sm">{item.customerPhone}</Text>
                </TouchableOpacity>
              ) : null}

              {/* Action Buttons */}
              <View className="flex-row gap-2">
                <TouchableOpacity
                  onPress={() => openDirections(item)}
                  className="flex-1 bg-blue-500/15 border border-blue-500/40 rounded-lg h-11 items-center justify-center flex-row"
                >
                  <Navigation size={16} color="#3B82F6" />
                  <Text className="text-info font-bold ml-2">Directions</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { setOtp(''); setActiveTaskId(item.id); }}
                  className="flex-1 bg-green-500/15 border border-green-500/40 rounded-lg h-11 items-center justify-center flex-row"
                >
                  <ShieldCheck size={16} color="#22c55e" />
                  <Text className="text-green-400 font-bold ml-2">Verify OTP</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
      />

      {/* OTP Verification Modal */}
      <Modal
        visible={activeTaskId !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setActiveTaskId(null)}
      >
        <View className="flex-1 justify-center items-center bg-black/60 p-6">
          <View className="w-full bg-bgSurface rounded-2xl p-5 border border-bgSurfaceLight">
            <Text className="text-textPrimary text-lg font-bold mb-1">Verify Delivery</Text>
            <Text className="text-textSecondary text-sm mb-4">Enter the 4-digit OTP the customer shared.</Text>

            <TextInput
              value={otp}
              onChangeText={(t) => setOtp(t.replace(/[^0-9]/g, '').slice(0, 4))}
              keyboardType="number-pad"
              maxLength={4}
              placeholder="••••"
              placeholderTextColor="#64748B"
              autoFocus
              className="bg-bgDark border border-bgSurfaceLight rounded-xl h-14 text-center text-2xl tracking-[0.5em] text-textPrimary font-bold"
            />

            {verifying ? (
              <View className="mt-4">
                <ActivityIndicator size="small" color="#22c55e" />
              </View>
            ) : (
              <View className="flex-row gap-3 mt-4">
                <TouchableOpacity
                  onPress={() => setActiveTaskId(null)}
                  className="flex-1 bg-bgSurfaceLight rounded-xl h-12 items-center justify-center"
                >
                  <Text className="text-textSecondary font-bold">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleVerifyDelivery}
                  disabled={otp.length !== 4}
                  className="flex-1 bg-green-500 rounded-xl h-12 items-center justify-center"
                >
                  <Text className="text-white font-bold">Verify</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
