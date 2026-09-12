import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, Modal, TextInput, TouchableOpacity, Alert, Platform, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bike, Clock, MapPin, ShieldCheck, Phone, Navigation, Edit3 } from 'lucide-react-native';
import { useAuthStore } from '../../store/authStore';
import { useOpsStaffStore } from '../../store/opsStaffStore';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { isPending, pickupLabel } from '../../utils/opsTasks';
import { timeAgo } from '../../utils/orderFeed';
import { verifyPickupOTP, verifyStoreOTP } from '../../utils/opsPickup';
import { EditOrderModal } from '../../components/EditOrderModal';

export function PickupsScreen() {
  const user = useAuthStore(state => state.user);
  const { myTasks, isLoading, initialize } = useOpsStaffStore();
  const orders = useOrderFeedStore(state => state.orders);

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null); // which task's OTP modal is open
  const [activeStoreTaskId, setActiveStoreTaskId] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [verifying, setVerifying] = useState(false);

  // Edit Order state
  const [editOrderId, setEditOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (user?.id) {
      initialize(user.id);
      useOrderFeedStore.getState().initialize();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = myTasks.filter(t => {
    if (!isPending(t)) return false;
    // Cross-check: if the corresponding order is cancelled, hide this task
    const order = orders.find(o => o.id === t.orderId);
    if (order && order.status === 'cancelled') return false;
    return true;
  });

  const handleVerify = async () => {
    if (!activeTaskId || otp.length !== 4 || verifying) return;
    
    // Check if all distinct services have a token assigned
    const order = orders.find(o => o.id === activeTaskId);
    const services = Array.from(new Set(order?.items?.map(it => it.serviceType).filter(Boolean))) as string[];
    const requiredServiceCount = services.length > 0 ? services.length : 1;
    
    if (Object.keys(tokens).length < requiredServiceCount || Object.values(tokens).some(t => !t.trim())) {
      Alert.alert('Token Required', 'Please assign a token number for all services before verifying.');
      return;
    }

    const orderId = activeTaskId;
    setVerifying(true);
    try {
      const res = await verifyPickupOTP(orderId, otp, undefined, tokens);
      if (res.ok) {
        setActiveTaskId(null);
        setOtp('');
        setTokens({});
        // The task flips to picked_up via the onSnapshot subscription and auto-removes.
        Alert.alert('Pickup verified', `Order marked as picked up.`);
      } else {
        const msg =
          res.error === 'invalid_otp' ? 'Incorrect OTP. Please try again.'
          : res.error === 'invalid_state' ? 'This order is no longer awaiting pickup.'
          : res.error === 'unauthorized' ? 'You are not assigned to this pickup.'
          : res.error === 'locked' ? 'Too many incorrect attempts. Contact the supervisor.'
          : 'Could not verify pickup. Please try again.';
        Alert.alert('Verification failed', msg);
      }
    } catch {
      // verifyPickupOTP never throws today, but guard against a sync throw so the
      // modal isn't stuck with no error surface.
      Alert.alert('Verification failed', 'Could not verify pickup. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const handleVerifyStore = async () => {
    if (!activeStoreTaskId || otp.length !== 4 || verifying) return;
    const orderId = activeStoreTaskId;
    setVerifying(true);
    try {
      const res = await verifyStoreOTP(orderId, otp);
      if (res.ok) {
        setActiveStoreTaskId(null);
        setOtp('');
        Alert.alert('Store Handover verified', 'Order dropped to store.');
      } else {
        const msg =
          res.error === 'invalid_otp' ? 'Incorrect OTP. Please try again.'
          : res.error === 'invalid_state' ? 'This order is not ready for handover.'
          : res.error === 'locked' ? 'Too many incorrect attempts. Contact the supervisor.'
          : 'Could not verify handover. Please try again.';
        Alert.alert('Verification failed', msg);
      }
    } catch {
      Alert.alert('Verification failed', 'Could not verify handover. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const editOrder = editOrderId ? orders.find(o => o.id === editOrderId) : null;

  if (isLoading && pending.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-bgDark items-center justify-center">
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text className="text-textSecondary mt-4 font-bold">Loading pickups…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bgDark">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-2xl font-bold text-textPrimary">My Pickups</Text>
        <Text className="text-textSecondary">
          {pending.length} pending pickup{pending.length === 1 ? '' : 's'}
        </Text>
      </View>
      <FlatList
        data={pending}
        keyExtractor={t => t.id}
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={
          <View className="items-center justify-center mt-20">
            <Bike size={36} color="#64748B" />
            <Text className="text-textSecondary text-lg font-bold mt-3">No pickups assigned yet</Text>
            <Text className="text-textMuted text-center mt-2">Assigned pickups appear here instantly.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const order = orders.find(o => o.id === item.orderId);
          const canEdit = item.status !== 'picked_up' && item.status !== 'in_transit_to_store';
          
          return (
            <View className="bg-bgSurface rounded-xl p-4 mb-3 border border-bgSurfaceLight">
              <View className="flex-row items-center justify-between mb-2">
                <View>
                  <Text className="text-textPrimary font-bold text-lg">
                    #{item.orderId.slice(-6).toUpperCase()}
                  </Text>
                  {order?.customerName && (
                    <Text className="text-textSecondary text-sm">{order.customerName}</Text>
                  )}
                </View>
                {item.createdAt ? (
                  <View className="flex-row items-center">
                    <Clock size={13} color="#94A3B8" />
                    <Text className="text-textMuted text-xs ml-1">{timeAgo(item.createdAt)}</Text>
                  </View>
                ) : null}
              </View>

              {/* Enhanced Actionable Details */}
              <View className="bg-bgDark p-3 rounded-lg mb-3">
                {item.pickupAddress ? (
                  <View className="flex-row items-start mb-3">
                    <View className="w-8 h-8 rounded-full bg-bgSurfaceLight items-center justify-center mr-3">
                      <MapPin size={14} color="#3B82F6" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-textSecondary text-sm leading-tight mb-2">{item.pickupAddress}</Text>
                      <TouchableOpacity 
                        onPress={() => {
                          let addr = item.pickupAddress || '';
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

                {order?.customerPhone ? (
                  <View className="flex-row items-center border-t border-bgSurfaceLight pt-3">
                    <View className="w-8 h-8 rounded-full bg-bgSurfaceLight items-center justify-center mr-3">
                      <Phone size={14} color="#3B82F6" />
                    </View>
                    <TouchableOpacity 
                      className="flex-1"
                      onPress={() => Linking.openURL(`tel:${order.customerPhone}`)}
                    >
                      <Text className="text-textPrimary font-medium">{order.customerPhone}</Text>
                      <Text className="text-textMuted text-xs">Tap to call</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {/* Additional Order Details for Rider */}
                {order && (
                  <View className="mt-3 pt-3 border-t border-bgSurfaceLight">
                    <Text className="text-xs font-bold text-textMuted uppercase mb-2">Order Details</Text>
                    {order.items && order.items.length > 0 ? (
                      <View className="mb-2">
                        {order.items.map((it: any, idx: number) => (
                          <Text key={idx} className="text-textSecondary text-sm mb-0.5">
                            • {it.quantity}x {it.name || it.serviceType}
                          </Text>
                        ))}
                      </View>
                    ) : (
                      <Text className="text-textSecondary text-sm mb-2 italic">Items not specified</Text>
                    )}
                    
                    {(order.totalAmount || order.paymentStatus) && (
                      <View className="flex-row items-center justify-between mt-1 mb-1">
                        {order.totalAmount ? (
                          <Text className="text-textPrimary font-bold">₹{order.totalAmount}</Text>
                        ) : <View />}
                        {order.paymentStatus ? (
                          <View className="bg-bgSurfaceLight px-2 py-0.5 rounded">
                            <Text className="text-textSecondary text-xs uppercase font-bold">{order.paymentStatus}</Text>
                          </View>
                        ) : null}
                      </View>
                    )}

                    {order.notes ? (
                      <Text className="text-info text-xs mt-2 p-2 bg-info/10 rounded-md">
                        <Text className="font-bold">Note:</Text> {order.notes}
                      </Text>
                    ) : null}
                  </View>
                )}
              </View>

              <View className="flex-row items-center justify-between mb-3">
                <View className="bg-bgDark px-2 py-1 rounded-md self-start">
                  <Text className="text-primary text-xs font-bold">{pickupLabel(item)}</Text>
                </View>
                {item.tokenNumber ? (
                  <Text className="text-textMuted text-xs font-medium">Token #{item.tokenNumber}</Text>
                ) : null}
              </View>

              {/* Action Buttons */}
              {item.status === 'in_transit_to_store' ? (
                <TouchableOpacity
                  onPress={() => { setOtp(''); setActiveStoreTaskId(item.id); }}
                  className="bg-purple-100 border border-purple-200 rounded-lg h-11 items-center justify-center flex-row"
                >
                  <MapPin size={18} color="#7e22ce" className="mr-2" />
                  <Text className="text-purple-700 font-bold">Handover to Store</Text>
                </TouchableOpacity>
              ) : (
                <View className="gap-2">
                  {/* Edit Order Button — only before pickup verified */}
                  {canEdit && order && order.items && order.items.length > 0 && (
                    <TouchableOpacity
                      onPress={() => setEditOrderId(item.orderId)}
                      className="bg-amber-50 border border-amber-200 rounded-lg h-11 items-center justify-center flex-row"
                    >
                      <Edit3 size={16} color="#d97706" />
                      <Text className="text-amber-700 font-bold ml-2">Edit Order (Weight/Qty)</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    onPress={() => { setOtp(''); setTokens({}); setActiveTaskId(item.id); }}
                    className="bg-info/15 border border-info/40 rounded-lg h-11 items-center justify-center flex-row"
                  >
                    <ShieldCheck size={18} color="#3B82F6" className="mr-2" />
                    <Text className="text-info font-bold">Verify pickup OTP</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        }}
      />

      {/* Pickup OTP + Token Modal */}
      <Modal
        visible={activeTaskId !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setActiveTaskId(null)}
      >
        <View className="flex-1 justify-center items-center bg-black/60 p-6">
          <View className="w-full bg-bgSurface rounded-2xl p-5 border border-bgSurfaceLight">
            <Text className="text-textPrimary text-lg font-bold mb-1">Verify Pickup</Text>
            <Text className="text-textSecondary text-sm mb-4">Enter the OTP and assign a token number.</Text>

            {/* Token Inputs */}
            {(() => {
              const activeOrder = orders.find(o => o.id === activeTaskId);
              let services: string[] = [];
              if (activeOrder?.items) {
                for (const item of activeOrder.items) {
                  let key = item.serviceType;
                  if (key === 'blanket_wash' && item.blanketType) {
                    key = `blanket_wash_${item.blanketType}`;
                  }
                  if (key && !services.includes(key)) {
                    services.push(key);
                  }
                }
              }
              
              if (services.length === 0) {
                // Fallback for older orders without serviceType
                return (
                  <>
                    <Text className="text-textMuted text-xs font-bold uppercase mb-1">Token Number</Text>
                    <TextInput
                      value={tokens['default'] || ''}
                      onChangeText={(t) => setTokens(prev => ({ ...prev, default: t }))}
                      placeholder="e.g. 1, 2, 3..."
                      placeholderTextColor="#94A3B8"
                      className="bg-bgDark border border-bgSurfaceLight rounded-xl h-12 px-4 text-textPrimary font-bold text-base mb-4"
                    />
                  </>
                );
              }

              return services.map(service => (
                <View key={service} className="mb-4">
                  <Text className="text-textMuted text-xs font-bold uppercase mb-1">Token for {service.replace(/_/g, ' ')}</Text>
                  <TextInput
                    value={tokens[service] || ''}
                    onChangeText={(t) => setTokens(prev => ({ ...prev, [service]: t }))}
                    placeholder={`e.g. ${service.slice(0, 2).toUpperCase()}-123`}
                    placeholderTextColor="#94A3B8"
                    className="bg-bgDark border border-bgSurfaceLight rounded-xl h-12 px-4 text-textPrimary font-bold text-base"
                  />
                </View>
              ));
            })()}

            {/* OTP Input */}
            <Text className="text-textMuted text-xs font-bold uppercase mb-1">Customer OTP</Text>
            <TextInput
              value={otp}
              onChangeText={(t) => setOtp(t.replace(/[^0-9]/g, '').slice(0, 4))}
              keyboardType="number-pad"
              maxLength={4}
              placeholder="••••"
              placeholderTextColor="#64748B"
              className="bg-bgDark border border-bgSurfaceLight rounded-xl h-14 text-center text-2xl tracking-[0.5em] text-textPrimary font-bold"
            />

            {verifying ? (
              <View className="mt-4">
                <ActivityIndicator size="small" color="#3B82F6" />
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
                  onPress={handleVerify}
                  disabled={otp.length !== 4 || Object.keys(tokens).length === 0}
                  className={`flex-1 rounded-xl h-12 items-center justify-center ${otp.length !== 4 || Object.keys(tokens).length === 0 ? 'bg-gray-300' : 'bg-primary'}`}
                >
                  <Text className="text-white font-bold">Verify</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
      
      {/* Store Handover OTP Modal */}
      <Modal
        visible={activeStoreTaskId !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setActiveStoreTaskId(null)}
      >
        <View className="flex-1 justify-center items-center bg-black/60 p-6">
          <View className="w-full bg-bgSurface rounded-2xl p-5 border border-bgSurfaceLight">
            <Text className="text-textPrimary text-lg font-bold mb-1">Store Handover</Text>
            <Text className="text-textSecondary text-sm mb-4">Enter the 4-digit Store OTP from the Supervisor.</Text>

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
                <ActivityIndicator size="small" color="#9333ea" />
              </View>
            ) : (
              <View className="flex-row gap-3 mt-4">
                <TouchableOpacity
                  onPress={() => setActiveStoreTaskId(null)}
                  className="flex-1 bg-bgSurfaceLight rounded-xl h-12 items-center justify-center"
                >
                  <Text className="text-textSecondary font-bold">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleVerifyStore}
                  disabled={otp.length !== 4}
                  className="flex-1 bg-purple-600 rounded-xl h-12 items-center justify-center"
                >
                  <Text className="text-white font-bold">Verify</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Edit Order Modal */}
      <EditOrderModal
        visible={editOrderId !== null}
        onClose={() => setEditOrderId(null)}
        order={editOrder}
      />
    </SafeAreaView>
  );
}
