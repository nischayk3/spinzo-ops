import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, Modal, TextInput, TouchableOpacity, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bike, Clock } from 'lucide-react-native';
import { useAuthStore } from '../../store/authStore';
import { useOpsStaffStore } from '../../store/opsStaffStore';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { isPending, pickupLabel, OpsTask } from '../../utils/opsTasks';
import { timeAgo, orderTotal, FeedOrder } from '../../utils/orderFeed';
import { verifyPickupOTP, verifyStoreOTP } from '../../utils/opsPickup';
import { EditOrderModal } from '../../components/EditOrderModal';
import { RiderTaskCard } from '../../components/Rider/RiderTaskCard';

// Proper state sync: a pickup task is only actionable while the ORDER is still waiting
// for pickup (placed/confirmed) or mid-handover (in_transit_to_store). Once the order
// reaches pickup_completed/processing/ready/out_for_delivery/delivered, the pickup is
// DONE — hide it regardless of the task doc's status. The order status is the source of truth.
const isPickupOrderLive = (status?: string): boolean =>
  status === 'placed' || status === 'confirmed' || status === 'in_transit_to_store';

export function PickupsScreen() {
  const user = useAuthStore(state => state.user);
  const { myTasks, isLoading, initialize } = useOpsStaffStore();
  const orders = useOrderFeedStore(state => state.orders);

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeStoreTaskId, setActiveStoreTaskId] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [verifying, setVerifying] = useState(false);
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
    const order = orders.find(o => o.id === t.orderId);
    if (!order) return true;
    // STATE SYNC: hide pickups for orders that have already progressed past
    // pickup. The order status is the source of truth — if the order is already
    // in pickup_completed/processing/ready/out_for_delivery/delivered, the pickup
    // task is stale regardless of what the ops_tasks doc says.
    if (order.status === 'cancelled') return false;
    if (order.status !== 'placed' && order.status !== 'confirmed' && order.status !== 'in_transit_to_store') return false;
    return true;
  });

  const getOrder = (task: OpsTask): FeedOrder | undefined => orders.find(o => o.id === task.orderId);

  const handleVerify = async () => {
    if (!activeTaskId || otp.length !== 4 || verifying) return;

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

  // Group pickups: actionable (pending/assigned), then in-transit (on the way to store)
  const actionable = pending.filter(t => t.status === 'pending' || t.status === 'assigned');
  const inTransit = pending.filter(t => t.status === 'in_transit_to_store');

  if (isLoading && pending.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-bgDark items-center justify-center">
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text className="text-textSecondary mt-4 font-bold">Loading pickups…</Text>
      </SafeAreaView>
    );
  }

  const renderCard = (t: OpsTask, isInTransit?: boolean) => {
    const order = getOrder(t);
    return (
      <RiderTaskCard
        type="pickup"
        orderNumber={t.orderId.slice(-6).toUpperCase()}
        customerName={order?.customerName || t.customerName}
        customerPhone={order?.customerPhone}
        status={t.status}
        createdAt={order?.createdAt || t.createdAt}
        items={order?.items}
        totalAmount={order ? orderTotal(order) : undefined}
        paymentStatus={order?.paymentStatus}
        pickupAddress={t.pickupAddress}
        pickupSlot={pickupLabel(t) !== '—' ? pickupLabel(t) : undefined}
        notes={order?.notes}
        tokenNumber={t.tokenNumber || order?.tokenNumber}
        lat={order?.latitude}
        lng={order?.longitude}
        onPrimary={
          isInTransit
            ? () => { setOtp(''); setActiveStoreTaskId(t.id); }
            : () => { setOtp(''); setTokens({}); setActiveTaskId(t.id); }
        }
        primaryLabel={isInTransit ? 'Handover to Store' : 'Verify pickup OTP'}
        onEdit={
          !isInTransit && order && order.items && order.items.length > 0
            ? () => setEditOrderId(t.orderId)
            : undefined
        }
      />
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-bgDark">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-2xl font-bold text-textPrimary">My Pickups</Text>
        <Text className="text-textSecondary">
          {pending.length} pending pickup{pending.length === 1 ? '' : 's'}
        </Text>
      </View>

      <FlatList
        data={pending.length ? [0] : []}
        keyExtractor={() => 'list'}
        renderItem={() => null}
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={
          <View className="items-center justify-center mt-20">
            <Bike size={36} color="#64748B" />
            <Text className="text-textSecondary text-lg font-bold mt-3">No pickups assigned yet</Text>
            <Text className="text-textMuted text-center mt-2">Assigned pickups appear here instantly.</Text>
          </View>
        }
        ListHeaderComponent={
          <>
            {inTransit.length > 0 ? (
              <View className="mt-2 mb-1">
                <Text className="text-xs font-bold text-textMuted uppercase tracking-wider mb-2">On the way to store ({inTransit.length})</Text>
                {inTransit.map(t => (
                  <View key={t.id}>{renderCard(t, true)}</View>
                ))}
              </View>
            ) : null}
            {actionable.length > 0 ? (
              <View className="mt-2 mb-1">
                <Text className="text-xs font-bold text-textMuted uppercase tracking-wider mb-2">To pick up ({actionable.length})</Text>
                {actionable.map(t => (
                  <View key={t.id}>{renderCard(t)}</View>
                ))}
              </View>
            ) : null}
          </>
        }
      />

      {/* Pickup OTP + Token Modal */}
      <Modal visible={activeTaskId !== null} transparent animationType="slide" onRequestClose={() => setActiveTaskId(null)}>
        <View className="flex-1 justify-center items-center bg-black/60 p-6">
          <View className="w-full bg-bgSurface rounded-2xl p-5 border border-bgSurfaceLight">
            <Text className="text-textPrimary text-lg font-bold mb-1">Verify Pickup</Text>
            <Text className="text-textSecondary text-sm mb-4">Enter the OTP and assign a token number.</Text>

            {(() => {
              const activeOrder = orders.find(o => o.id === activeTaskId);
              let services: string[] = [];
              if (activeOrder?.items) {
                for (const item of activeOrder.items) {
                  let key = item.serviceType;
                  if (key === 'blanket_wash' && (item as any).blanketType) {
                    key = `blanket_wash_${(item as any).blanketType}`;
                  }
                  if (key && !services.includes(key)) services.push(key);
                }
              }
              return services;
            })().map(s => (
              <View key={s} className="mb-3">
                <Text className="text-textSecondary text-sm mb-1 font-medium">{s.replace(/_/g, ' ').toUpperCase()}</Text>
                <TextInput
                  value={tokens[s] || ''}
                  onChangeText={(v) => setTokens(prev => ({ ...prev, [s]: v }))}
                  placeholder={`Token number for ${s}`}
                  placeholderTextColor="#94A3B8"
                  keyboardType="default"
                  className="bg-bgDark border border-bgSurfaceLight rounded-lg h-11 px-3 text-textPrimary"
                />
              </View>
            ))}

            {verifying ? (
              <View className="mt-4"><ActivityIndicator size="small" color="#3B82F6" /></View>
            ) : (
              <View className="flex-row gap-3 mt-4">
                <TouchableOpacity onPress={() => setActiveTaskId(null)} className="flex-1 bg-bgSurfaceLight rounded-xl h-12 items-center justify-center">
                  <Text className="text-textSecondary font-bold">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleVerify} disabled={otp.length !== 4} className="flex-1 bg-primary rounded-xl h-12 items-center justify-center">
                  <Text className={`font-bold ${otp.length !== 4 ? 'text-textMuted' : 'text-white'}`}>Verify</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Store Handover Modal */}
      <Modal visible={activeStoreTaskId !== null} transparent animationType="slide" onRequestClose={() => setActiveStoreTaskId(null)}>
        <View className="flex-1 justify-center items-center bg-black/60 p-6">
          <View className="w-full bg-bgSurface rounded-2xl p-5 border border-bgSurfaceLight">
            <Text className="text-textPrimary text-lg font-bold mb-4">Store Handover</Text>
            <TextInput
              value={otp}
              onChangeText={(t) => setOtp(t.replace(/[^0-9]/g, '').slice(0, 4))}
              keyboardType="number-pad"
              maxLength={4}
              placeholder="••••"
              placeholderTextColor="#94A3B8"
              autoFocus
              className="bg-bgDark border border-bgSurfaceLight rounded-xl h-14 text-center text-2xl tracking-[0.5em] text-textPrimary font-bold"
            />
            {verifying ? (
              <View className="mt-4"><ActivityIndicator size="small" color="#9333ea" /></View>
            ) : (
              <View className="flex-row gap-3 mt-4">
                <TouchableOpacity onPress={() => setActiveStoreTaskId(null)} className="flex-1 bg-bgSurfaceLight rounded-xl h-12 items-center justify-center">
                  <Text className="text-textSecondary font-bold">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleVerifyStore} disabled={otp.length !== 4} className="flex-1 bg-purple-600 rounded-xl h-12 items-center justify-center">
                  <Text className="text-white font-bold">Verify</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <EditOrderModal visible={editOrderId !== null} onClose={() => setEditOrderId(null)} order={editOrder} />
    </SafeAreaView>
  );
}
