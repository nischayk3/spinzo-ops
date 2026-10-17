import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, FlatList, ActivityIndicator, Alert, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Package, Bike, ChevronRight } from 'lucide-react-native';
import { useAuthStore } from '../../store/authStore';
import { useOpsStaffStore, DeliveryTask } from '../../store/opsStaffStore';
import { useOpsProcessStore } from '../../store/opsProcessStore';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { isPending } from '../../utils/opsTasks';
import { timeAgo, orderTotal, FeedOrder } from '../../utils/orderFeed';
import { DeliveryVerification } from '../../components/DeliveryVerification';
import { QRScanner } from '../../components/QRScanner';
import { RiderTaskCard } from '../../components/Rider/RiderTaskCard';
import { SmartRouteSheet } from '../../components/Rider/SmartRouteSheet';
import { buildSmartRoute, SmartRouteStop, extractLocality, safeShortId } from '../../utils/smartRoute';

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
  const navigation = useNavigation<any>();
  const user = useAuthStore(state => state.user);
  const { myDeliveries, myTasks, isLoading, initialize } = useOpsStaffStore();
  const orders = useOrderFeedStore(state => state.orders);

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [showPickupScanner, setShowPickupScanner] = useState<string | null>(null);

  useEffect(() => {
    if (user?.id) {
      initialize(user.id);
      useOrderFeedStore.getState().initialize();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Compute live smart route sequence
  const smartRouteStops = useMemo(() => {
    return buildSmartRoute({
      myTasks,
      myDeliveries,
      orders,
    });
  }, [myTasks, myDeliveries, orders]);

  const stopMap = useMemo(() => {
    const map = new Map<string, SmartRouteStop>();
    smartRouteStops.forEach(s => {
      if (s.orderId) map.set(s.orderId, s);
      if (s.taskId) map.set(s.taskId, s);
    });
    return map;
  }, [smartRouteStops]);

  // Count live pickups to show quick switch banner if needed
  const livePickupsCount = useMemo(() => {
    return myTasks.filter(t => {
      if (!isPending(t)) return false;
      const order = orders.find(o => o.id === t.orderId || o.id === t.id);
      if (orders.length > 0) {
        if (!order) return false;
        if (order.status === 'cancelled') return false;
        if (order.status !== 'placed' && order.status !== 'confirmed' && order.status !== 'in_transit_to_store') return false;
      }
      return true;
    }).length;
  }, [myTasks, orders]);

  const activeDeliveries = useMemo(() => {
    const list = myDeliveries.filter(d => {
      if (d.status !== 'out_for_delivery' && d.status !== 'assigned') return false;
      const order = orders.find(o => o.id === d.orderId);
      if (orders.length > 0) {
        if (!order) return false;
        if (order.status === 'cancelled' || order.status === 'delivered') return false;
        if (order.status !== 'ready' && order.status !== 'out_for_delivery') return false;
      }
      return true;
    });

    return list.sort((a, b) => {
      const stopA = stopMap.get(a.orderId || a.id);
      const stopB = stopMap.get(b.orderId || b.id);
      const numA = stopA?.stopNumber ?? 999;
      const numB = stopB?.stopNumber ?? 999;
      if (numA !== numB) return numA - numB;
      return toMs(b.assignedAt || b.createdAt) - toMs(a.assignedAt || a.createdAt);
    });
  }, [myDeliveries, orders, stopMap]);

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
          res.error === 'payment_required' ? 'PAYMENT REQUIRED: This order has not been paid yet. Ask the customer to pay in the SpinZo app before completing delivery.'
          : res.error === 'invalid_otp' ? 'Incorrect OTP. Please try again.'
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
      {/* Header */}
      <View className="px-4 pt-4 pb-2.5 flex-row items-center justify-between">
        <View>
          <Text className="text-2xl font-black text-slate-950 tracking-tight">Deliveries</Text>
          <Text className="text-slate-600 text-xs font-bold mt-0.5">
            {activeDeliveries.length} active delivery tasks • SpinZo BTM Hub
          </Text>
        </View>
        <View className="bg-emerald-100 border border-emerald-400 px-3 py-1 rounded-full flex-row items-center">
          <View className="w-2 h-2 rounded-full bg-emerald-600 mr-1.5" />
          <Text className="text-emerald-950 text-xs font-black">ON DUTY</Text>
        </View>
      </View>

      <SmartRouteSheet
        myTasks={myTasks}
        myDeliveries={myDeliveries}
        orders={orders}
        onSelectTask={(stop) => {
          if (stop.type === 'pickup') {
            navigation.navigate('Pickups');
          } else {
            const task = activeDeliveries.find(d => d.id === stop.taskId || d.orderId === stop.orderId);
            if (task) {
              if (task.status === 'assigned') {
                setShowPickupScanner(task.id);
              } else {
                setActiveTaskId(task.id);
              }
            }
          }
        }}
      />

      {livePickupsCount > 0 ? (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => navigation.navigate('Pickups')}
          className="mx-4 mb-3.5 px-4 py-3 bg-purple-600 rounded-2xl flex-row items-center justify-between shadow-md shadow-purple-500/25"
        >
          <View className="flex-row items-center flex-1 mr-2">
            <View className="w-8 h-8 rounded-xl bg-white/20 items-center justify-center mr-2.5">
              <Bike size={16} color="#FFFFFF" />
            </View>
            <View>
              <Text className="text-white font-black text-xs uppercase tracking-wide">
                {livePickupsCount} Pending Pickup{livePickupsCount > 1 ? 's' : ''}
              </Text>
              <Text className="text-purple-100 text-[11px] font-bold">
                Assigned on your current route
              </Text>
            </View>
          </View>
          <View className="flex-row items-center bg-white px-3 py-1.5 rounded-xl shadow-xs">
            <Text className="text-purple-700 font-black text-xs mr-1">Switch</Text>
            <ChevronRight size={13} color="#7C3AED" />
          </View>
        </TouchableOpacity>
      ) : null}

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
              const stop = stopMap.get(t.orderId || t.id);
              const rawAddr = t.deliveryAddress || (order?.address?.formattedAddress || (typeof order?.address === 'string' ? order.address : undefined));
              const locality = stop?.locality || extractLocality(rawAddr);

              return (
                <View key={t.id}>
                  {overdue ? (
                    <View className="bg-red-500/15 border border-red-500/40 rounded-lg px-3 py-1.5 mb-2 items-center">
                      <Text className="text-red-400 text-xs font-bold">OVERDUE — pending delivery</Text>
                    </View>
                  ) : null}
                  {(() => {
                    const total = order ? orderTotal(order) : (t.totalAmount || 0);
                    const isPaid = (order?.paymentStatus || "").toLowerCase() === "paid";
                    const isCredit = order?.paymentMode === "credit";
                    if (total > 0 && !isPaid && !isCredit) {
                      return (
                        <View className="bg-amber-500/15 border border-amber-500/40 rounded-lg px-3 py-1.5 mb-2 flex-row items-center justify-between">
                          <Text className="text-amber-400 text-xs font-bold">⚠️ UNPAID: ₹{total}</Text>
                          <Text className="text-amber-300 text-xs">Customer must pay in app</Text>
                        </View>
                      );
                    }
                    return null;
                  })()}
                  <RiderTaskCard
                    type="delivery"
                    orderNumber={safeShortId(t.orderId)}
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
                    stopNumber={stop?.stopNumber}
                    locality={locality}
                    loadUnits={stop?.loadUnits}
                    onPrimary={() => {
                      if (t.status === "assigned") {
                        setShowPickupScanner(t.id);
                      } else {
                        const total = order ? orderTotal(order) : (t.totalAmount || 0);
                        const isPaid = (order?.paymentStatus || "").toLowerCase() === "paid";
                        const isCredit = order?.paymentMode === "credit";
                        if (total > 0 && !isPaid && !isCredit) {
                          Alert.alert(
                            `Payment Pending (₹${total})`,
                            "This order has not been marked paid yet. Ask the customer to pay in their SpinZo app before completing delivery.",
                            [
                              { text: "Cancel", style: "cancel" },
                              { text: "Enter Delivery OTP", onPress: () => setActiveTaskId(t.id) }
                            ]
                          );
                        } else {
                          setActiveTaskId(t.id);
                        }
                      }
                    }}
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
