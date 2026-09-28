import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Package } from 'lucide-react-native';
import { useAuthStore } from '../../store/authStore';
import { useOpsStaffStore, DeliveryTask } from '../../store/opsStaffStore';
import { useOpsProcessStore } from '../../store/opsProcessStore';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { timeAgo, orderTotal, FeedOrder } from '../../utils/orderFeed';
import { DeliveryVerification } from '../../components/DeliveryVerification';
import { QRScanner } from '../../components/QRScanner';
import { RiderTaskCard } from '../../components/Rider/RiderTaskCard';

const HIDE_OLDER_THAN_MS = 24 * 60 * 60 * 1000; // deliveries older than 24h are hidden
const OVERDUE_MS = 4 * 60 * 60 * 1000; // >4h out_for_delivery = overdue

const toMs = (t: any): number => {
  if (!t) return 0;
  if (typeof t.toDate === 'function') return t.toDate().getTime();
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  if (typeof t.getTime === 'function') return t.getTime();
  return 0;
};

export function DeliveriesScreen() {
  const user = useAuthStore(state => state.user);
  const { myDeliveries, isLoading, initialize } = useOpsStaffStore();
  const orders = useOrderFeedStore(state => state.orders);

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [showPickupScanner, setShowPickupScanner] = useState<string | null>(null);

  useEffect(() => {
    if (user?.id) initialize(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeDeliveries = myDeliveries
    .filter(d => {
      if (d.status !== 'out_for_delivery' && d.status !== 'assigned') return false;
      const order = orders.find(o => o.id === d.orderId);
      if (order && order.status === 'cancelled') return false;
      // Hide dead deliveries older than 24h
      const created = toMs(d.createdAt);
      if (created && Date.now() - created > HIDE_OLDER_THAN_MS) return false;
      return true;
    })
    .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));

  const activeTask = activeTaskId ? myDeliveries.find(d => d.id === activeTaskId) : null;
  const orderFor = (t: DeliveryTask): FeedOrder | undefined => orders.find(o => o.id === t.orderId);
  const isOverdue = (t: DeliveryTask) =>
    t.status === 'out_for_delivery' && toMs(t.pickedUpAt || t.assignedAt) && Date.now() - toMs(t.pickedUpAt || t.assignedAt) > OVERDUE_MS;

  const handlePickupScan = async (taskId: string, _data: string) => {
    const task = myDeliveries.find(d => d.id === taskId);
    if (!task) return;
    setShowPickupScanner(null);
    try {
      const res = await useOpsProcessStore.getState().pickupDelivery(task.orderId);
      if (res.ok) {
        Alert.alert('Pickup verified', 'Order is now out for delivery.');
      } else {
        Alert.alert('Pickup failed', res.error || 'Could not verify pickup.');
      }
    } catch (e) {
      Alert.alert('Pickup failed', 'Could not verify pickup.');
    }
  };

  const handleVerifyDelivery = async ({ otp, proofUrl }: { otp: string; proofUrl: string | null }) => {
    if (!activeTaskId || otp.length !== 4) return false;
    const task = myDeliveries.find(d => d.id === activeTaskId);
    if (!task) return false;
    try {
      const res = await useOpsProcessStore.getState().verifyDeliveryOTP(task.orderId, task.userId, otp, proofUrl || undefined);
      if (res.ok) {
        setActiveTaskId(null);
        Alert.alert('Delivery verified', 'Order marked as delivered.');
        return true;
      } else {
        const msg =
          res.error === 'invalid_otp' ? 'Incorrect OTP. Please try again.'
          : res.error === 'invalid_state' ? 'This order is no longer out for delivery.'
          : res.error === 'unauthorized' ? 'You are not authorized for this delivery.'
          : 'Could not verify delivery. Please try again.';
        Alert.alert('Verification failed', msg);
        return false;
      }
    } catch {
      Alert.alert('Verification failed', 'Could not verify delivery. Please try again.');
      return false;
    }
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
        <Text className="text-2xl font-bold text-textPrimary">Deliveries</Text>
        <Text className="text-textSecondary">
          {activeDeliveries.length} active delivery{activeDeliveries.length === 1 ? '' : 'ies'}
        </Text>
      </View>

      <FlatList
        data={activeDeliveries.length ? [0] : []}
        keyExtractor={() => 'list'}
        renderItem={() => null}
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={
          <View className="items-center justify-center mt-20">
            <Package size={36} color="#64748B" />
            <Text className="text-textSecondary text-lg font-bold mt-3">No deliveries assigned yet</Text>
            <Text className="text-textMuted text-center mt-2">Assigned deliveries appear here instantly.</Text>
          </View>
        }
        ListHeaderComponent={
          <>
            {activeDeliveries.map(t => {
              const order = orderFor(t);
              const overdue = isOverdue(t);
              return (
                <View key={t.id}>
                  {overdue ? (
                    <View className="bg-red-500/15 border border-red-500/40 rounded-lg px-3 py-1.5 mb-2 items-center">
                      <Text className="text-red-400 text-xs font-bold">OVERDUE — pending delivery</Text>
                    </View>
                  ) : null}
                  <RiderTaskCard
                    type="delivery"
                    orderNumber={t.orderId.slice(-6).toUpperCase()}
                    customerName={t.customerName || order?.customerName}
                    customerPhone={t.customerPhone || order?.customerPhone}
                    status={t.status}
                    createdAt={t.createdAt || order?.createdAt}
                    items={order?.items || t.items}
                    totalAmount={order ? orderTotal(order) : t.totalAmount}
                    paymentStatus={order?.paymentStatus}
                    deliveryAddress={t.deliveryAddress}
                    deliveryDate={t.deliveryDate}
                    deliveryTime={t.deliveryTime}
                    notes={order?.notes}
                    tokenNumber={t.tokenNumber || order?.tokenNumber}
                    tokens={t.tokens || order?.tokens}
                    lat={order?.latitude}
                    lng={order?.longitude}
                    bundleCount={t.bundleCount}
                    onPrimary={() => t.status === 'assigned' ? setShowPickupScanner(t.id) : setActiveTaskId(t.id)}
                    primaryLabel={t.status === 'assigned' ? 'Verify Pickup' : 'Deliver'}
                  />
                </View>
              );
            })}
          </>
        }
      />

      <DeliveryVerification
        visible={activeTaskId !== null}
        onClose={() => setActiveTaskId(null)}
        orderId={activeTask?.orderId || ''}
        expectedBundles={activeTask?.bundleCount || 1}
        expectedLabels={activeTask?.bundleLabels || []}
        onVerifyDelivery={handleVerifyDelivery}
      />

      {showPickupScanner && (
        <QRScanner
          visible={true}
          actionType="Bundle Scan"
          onClose={() => setShowPickupScanner(null)}
          onScan={(data) => handlePickupScan(showPickupScanner, data)}
        />
      )}
    </SafeAreaView>
  );
}
