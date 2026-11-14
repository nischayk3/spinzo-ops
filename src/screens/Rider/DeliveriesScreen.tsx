import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, FlatList, ActivityIndicator, Alert, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Package, Bike, ChevronRight } from 'lucide-react-native';
import { useAuthStore } from '../../store/authStore';
import { useOpsStaffStore, DeliveryTask } from '../../store/opsStaffStore';
import { useOpsProcessStore } from '../../store/opsProcessStore';
import { isPending } from '../../utils/opsTasks';
import { timeAgo, isExpressOrder } from '../../utils/orderFeed';
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
  const activeRole = useAuthStore(state => state.activeRole);
  const myDeliveries = useOpsStaffStore(s => s.myDeliveries);
  const myTasks = useOpsStaffStore(s => s.myTasks);
  const isLoading = useOpsStaffStore(s => s.isLoading);
  const initialize = useOpsStaffStore(s => s.initialize);

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [showPickupScanner, setShowPickupScanner] = useState<string | null>(null);

  useEffect(() => {
    if (user?.id) {
      initialize(user.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Compute live smart route sequence
  const smartRouteStops = useMemo(() => {
    return buildSmartRoute({
      myTasks,
      myDeliveries,
    });
  }, [myTasks, myDeliveries]);

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
      if (t.orderStatus && t.orderStatus !== 'placed' && t.orderStatus !== 'confirmed' && t.orderStatus !== 'in_transit_to_store') return false;
      return true;
    }).length;
  }, [myTasks]);

  const activeDeliveries = useMemo(() => {
    const todayStr = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().split('T')[0];
    const list = myDeliveries.filter(d => {
      if (d.status !== 'out_for_delivery' && d.status !== 'assigned') return false;
      if (d.orderStatus) {
        if (d.orderStatus === 'cancelled' || d.orderStatus === 'delivered') return false;
        if (d.orderStatus !== 'ready' && d.orderStatus !== 'out_for_delivery') return false;
      }
      if (d.deliveryDate && d.deliveryDate > todayStr && d.status !== 'out_for_delivery') return false;
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
  }, [myDeliveries, stopMap]);

  const activeTask = activeTaskId ? myDeliveries.find(d => d.id === activeTaskId) : null;
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

  const handleVerifyDelivery = async ({ otp, proofUrl, allowUnpaidDelivery }: { otp: string; proofUrl: string | null; allowUnpaidDelivery?: boolean }) => {
    if (!activeTaskId || otp.length !== 4) return false;
    const task = myDeliveries.find(d => d.id === activeTaskId);
    if (!task) return false;
    const isSupervisor = activeRole === 'supervisor' || activeRole === 'admin';
    try {
      const res = await useOpsProcessStore.getState().verifyDeliveryOTP(
        task.orderId,
        task.userId,
        otp,
        proofUrl || undefined,
        allowUnpaidDelivery ?? isSupervisor
      );
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
    <SafeAreaView className="flex-1 bg-slate-100">
      {/* Header */}
      <View className="px-4 pt-3 pb-2 flex-row items-center justify-between">
        <View>
          <Text className="text-xl font-black text-slate-950 tracking-tight">Deliveries</Text>
          <Text className="text-slate-500 text-[11px] font-bold mt-0.5">
            {activeDeliveries.length} active delivery task{activeDeliveries.length === 1 ? '' : 's'} • SpinZo BTM Hub
          </Text>
        </View>
        <View className="bg-emerald-100 border border-emerald-300 px-2.5 py-0.5 rounded-full flex-row items-center">
          <View className="w-1.5 h-1.5 rounded-full bg-emerald-600 mr-1.5" />
          <Text className="text-emerald-950 text-[11px] font-black">ON DUTY</Text>
        </View>
      </View>

      <SmartRouteSheet
        myTasks={myTasks}
        myDeliveries={myDeliveries}
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

      {/* Pending Pickups Quick Switcher (Sleek notification strip) */}
      {livePickupsCount > 0 ? (
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => navigation.navigate('Pickups')}
          className="mx-4 mb-2 px-3 py-1.5 bg-purple-50 border border-purple-200 rounded-xl flex-row items-center justify-between active:bg-purple-100"
        >
          <View className="flex-row items-center flex-1 mr-2">
            <View className="w-6 h-6 rounded-lg bg-purple-600 items-center justify-center mr-2">
              <Bike size={13} color="#FFFFFF" />
            </View>
            <Text className="text-purple-950 font-black text-xs">
              {livePickupsCount} Pending Pickup{livePickupsCount > 1 ? 's' : ''} assigned on circuit
            </Text>
          </View>
          <View className="flex-row items-center">
            <Text className="text-purple-700 font-black text-xs mr-0.5">Switch</Text>
            <ChevronRight size={13} color="#7C3AED" />
          </View>
        </TouchableOpacity>
      ) : null}

      <FlatList
        data={activeDeliveries}
        keyExtractor={(item) => item.id}
        renderItem={({ item: t }) => {
          const overdue = isOverdue(t);
          const stop = stopMap.get(t.orderId || t.id);
          const rawAddr = t.deliveryAddress;
          const locality = stop?.locality || extractLocality(rawAddr);
          const total = typeof t.totalAmount === 'number' ? t.totalAmount : 0;
          const isPaid = (t.paymentStatus || "").toLowerCase() === "paid";
          const unpaidAmt = total > 0 && !isPaid ? total : undefined;

          return (
            <RiderTaskCard
              key={t.id}
              type="delivery"
              orderNumber={safeShortId(t.orderId)}
              customerName={t.customerName}
              customerPhone={t.customerPhone}
              status={t.status}
              createdAt={t.createdAt}
              assignedAt={t.assignedAt}
              items={t.items}
              totalAmount={total}
              paymentStatus={t.paymentStatus || undefined}
              paymentMode={t.paymentMode}
              deliveryAddress={t.deliveryAddress}
              deliveryDate={t.deliveryDate}
              deliveryTime={t.deliveryTime}
              notes={t.notes}
              tokenNumber={t.tokenNumber}
              tokens={t.tokens}
              lat={t.latitude}
              lng={t.longitude}
              bundleCount={t.bundleCount}
              bundleLabels={t.bundleLabels}
              stopNumber={stop?.stopNumber}
              locality={locality}
              loadUnits={stop?.loadUnits}
              isUrgent={Boolean(t.isUrgent)}
              isExpress={Boolean(t.isExpress || isExpressOrder(t))}
              pickupNote={t.pickupNote}
              isOverdue={Boolean(overdue)}
              unpaidAmount={unpaidAmt}
              onPrimary={() => {
                if (t.status === "assigned") {
                  setShowPickupScanner(t.id);
                } else {
                  setActiveTaskId(t.id);
                }
              }}
              primaryLabel={t.status === 'assigned' ? '🏬 Scan Store Handover' : '🔐 Verify Delivery OTP (4-Digit)'}
            />
          );
        }}
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 28 }}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={5}
        removeClippedSubviews={Platform.OS === 'android'}
        ListEmptyComponent={
          <View className="items-center justify-center mt-20">
            <Package size={36} color="#64748B" />
            <Text className="text-textSecondary text-lg font-bold mt-3">No deliveries assigned yet</Text>
            <Text className="text-textMuted text-center mt-2">Assigned deliveries appear here instantly.</Text>
          </View>
        }
      />

      <DeliveryVerification
        visible={activeTaskId !== null}
        onClose={() => setActiveTaskId(null)}
        orderId={activeTask?.orderId || ''}
        expectedBundles={activeTask?.bundleCount || 1}
        expectedLabels={activeTask?.bundleLabels || []}
        onVerifyDelivery={handleVerifyDelivery}
        totalAmount={activeTask?.totalAmount || 0}
        paymentStatus={activeTask?.paymentStatus || undefined}
        paymentMode={activeTask?.paymentMode || undefined}
        customerName={activeTask?.customerName || undefined}
        isSupervisor={activeRole === 'supervisor' || activeRole === 'admin'}
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
