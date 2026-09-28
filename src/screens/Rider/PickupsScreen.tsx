import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, FlatList, ActivityIndicator, Modal, TextInput, TouchableOpacity, Alert, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bike, Clock } from 'lucide-react-native';
import { useAuthStore } from '../../store/authStore';
import { useOpsStaffStore } from '../../store/opsStaffStore';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { isPending, pickupLabel, OpsTask } from '../../utils/opsTasks';
import { timeAgo, orderTotal, slotLabel, FeedOrder } from '../../utils/orderFeed';
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
    const order = orders.find(o => o.id === t.orderId || o.id === t.id);
    if (!order) return true;
    if (order.status === 'cancelled') return false;
    if (order.status !== 'placed' && order.status !== 'confirmed' && order.status !== 'in_transit_to_store') return false;
    return true;
  });

  const getOrder = (task: OpsTask): FeedOrder | undefined =>
    orders.find(o => o.id === task.orderId || o.id === task.id);

  const activeTask = pending.find(t => t.id === activeTaskId || t.orderId === activeTaskId);
  const activeOrder = activeTask
    ? (orders.find(o => o.id === activeTask.orderId) || orders.find(o => o.id === activeTaskId))
    : orders.find(o => o.id === activeTaskId);

  // Extract all distinct services requiring tokens from the active order
  const servicesToTag = useMemo(() => {
    if (!activeOrder?.items || activeOrder.items.length === 0) {
      return [{ key: 'general', label: 'Order Bag / Token', details: 'All items' }];
    }
    const list: { key: string; label: string; details: string }[] = [];
    for (const item of activeOrder.items) {
      const rawKey = item.serviceType || (item as any).serviceId;
      if (!rawKey) continue;
      let key = rawKey;
      if (rawKey === 'blanket_wash' && (item as any).blanketType) {
        key = `blanket_wash_${(item as any).blanketType}`;
      }
      if (!list.some(s => s.key === key)) {
        let label = item.serviceName || item.name || key.replace(/_/g, ' ');
        label = label.replace(/\b\w/g, (c: string) => c.toUpperCase());
        let details = '';
        const sid = String(key || rawKey || '').toLowerCase();
        if (sid.includes('wash_fold') || sid.includes('wash & fold') || sid.includes('wash_iron') || sid.includes('wash & iron')) {
          const weight = item.weight || (item.unit === 'kg' && item.quantity ? item.quantity : 5);
          details = `${weight} kg`;
          if (sid.includes('wash_fold') && Boolean(item.ironingEnabled) && (item.ironingCount || 0) > 0) {
            details += ` (+${item.ironingCount} ironed)`;
          }
        } else if (item.weight) {
          details = `${item.weight} kg`;
        } else if (item.ironingCount) {
          details = `${item.ironingCount} pcs`;
        } else if (item.clothesCount) {
          details = `${item.clothesCount} pcs`;
        } else if (item.singleBlanketCount || item.doubleBlanketCount) {
          details = [
            item.singleBlanketCount ? `${item.singleBlanketCount} Single` : '',
            item.doubleBlanketCount ? `${item.doubleBlanketCount} Double` : '',
          ].filter(Boolean).join(', ');
        } else if (item.quantity) {
          details = `${item.quantity} ${item.unit || 'items'}`;
        }
        list.push({ key, label, details });
      }
    }
    return list.length > 0 ? list : [{ key: 'general', label: 'Order Bag / Token', details: 'All items' }];
  }, [activeOrder]);

  const isOtpValid = otp.length === 4;
  const areTokensValid = servicesToTag.every(s => Boolean(tokens[s.key]?.trim()));
  const canVerify = isOtpValid && areTokensValid && !verifying;

  const handleVerify = async () => {
    if (!activeTask || !canVerify || verifying) return;

    const orderId = activeTask.orderId || activeTaskId!;
    setVerifying(true);
    try {
      const tokenValues = servicesToTag.map(s => tokens[s.key]?.trim()).filter(Boolean);
      const allTokensString = tokenValues.join(', ');
      const res = await verifyPickupOTP(orderId, otp, allTokensString || tokenValues[0] || '', tokens);
      if (res.ok) {
        setActiveTaskId(null);
        setOtp('');
        setTokens({});
        Alert.alert('Pickup verified', 'Order marked as picked up and on the way to store.');
      } else {
        const msg =
          res.error === 'invalid_otp' ? 'Incorrect Customer OTP. Please ask the customer to check their SMS/app.'
          : res.error === 'invalid_state' ? 'This order is no longer awaiting pickup.'
          : res.error === 'unauthorized' ? 'You are not assigned to this pickup.'
          : res.error === 'locked' ? 'Too many incorrect attempts. Contact the supervisor.'
          : `Verification failed: ${res.error || 'Please try again.'}`;
        Alert.alert('Verification failed', msg);
      }
    } catch (err: any) {
      Alert.alert('Verification failed', err?.message || 'Could not verify pickup. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const handleVerifyStore = async () => {
    if (!activeStoreTaskId || otp.length !== 4 || verifying) return;
    const targetTask = pending.find(t => t.id === activeStoreTaskId || t.orderId === activeStoreTaskId);
    const orderId = targetTask?.orderId || activeStoreTaskId;
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
    const pickupSlotText = pickupLabel(t) !== '—'
      ? pickupLabel(t)
      : (order && slotLabel(order) !== '—' ? slotLabel(order) : undefined);

    return (
      <RiderTaskCard
        type="pickup"
        orderNumber={t.orderId.slice(-6).toUpperCase()}
        customerName={order?.customerName || t.customerName}
        customerPhone={order?.customerPhone || t.customerPhone}
        status={t.status}
        createdAt={order?.createdAt || t.createdAt}
        items={order?.items}
        totalAmount={order ? orderTotal(order) : undefined}
        paymentStatus={order?.paymentStatus}
        pickupAddress={t.pickupAddress || (order?.address?.formattedAddress || (typeof order?.address === 'string' ? order.address : undefined))}
        pickupSlot={pickupSlotText}
        notes={order?.notes}
        tokenNumber={t.tokenNumber || order?.tokenNumber}
        tokens={order?.tokens || (t as any).tokens}
        lat={order?.latitude || order?.address?.latitude}
        lng={order?.longitude || order?.address?.longitude}
        onPrimary={
          isInTransit
            ? () => { setOtp(''); setActiveStoreTaskId(t.id); }
            : () => {
                setOtp('');
                const existingTokens = order?.tokens || (t as any).tokens || (t.tokenNumber ? { general: t.tokenNumber } : {});
                setTokens(existingTokens);
                setActiveTaskId(t.id);
              }
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
        <View className="flex-1 justify-center items-center bg-black/70 p-5">
          <View className="w-full max-h-[88%] bg-bgSurface rounded-2xl p-5 border border-bgSurfaceLight shadow-2xl">
            {/* Header */}
            <View className="flex-row items-center justify-between mb-1">
              <View>
                <Text className="text-textPrimary text-xl font-bold">Verify Pickup</Text>
                {activeTask?.orderId ? (
                  <Text className="text-textSecondary text-xs">Order #{activeTask.orderId.slice(-6).toUpperCase()}</Text>
                ) : null}
              </View>
              <TouchableOpacity onPress={() => setActiveTaskId(null)} className="w-8 h-8 rounded-full bg-bgDark items-center justify-center">
                <Text className="text-textMuted text-base font-bold">✕</Text>
              </TouchableOpacity>
            </View>
            <Text className="text-textMuted text-xs mb-3">
              Enter customer 4-digit OTP and assign token numbers for bags.
            </Text>

            <ScrollView showsVerticalScrollIndicator={false} className="flex-grow-0">
              {/* Customer OTP */}
              <View className="mb-4 bg-bgDark/80 p-3.5 rounded-xl border border-bgSurfaceLight">
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="text-textPrimary text-sm font-bold">Customer OTP</Text>
                  <Text className="text-info text-xs font-semibold">4 Digits</Text>
                </View>
                <Text className="text-textMuted text-xs mb-2">Ask the customer for their pickup verification OTP</Text>
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
              </View>

              {/* Token Inputs */}
              <View className="mb-2">
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="text-textPrimary text-sm font-bold">Assign Bag Tokens</Text>
                  <Text className="text-textMuted text-xs font-medium">Tag on physical bag</Text>
                </View>
                <Text className="text-textMuted text-xs mb-2">Enter the physical token number attached to each service bag</Text>

                {servicesToTag.map((s) => (
                  <View key={s.key} className="mb-3 bg-bgDark/60 p-3 rounded-xl border border-bgSurfaceLight">
                    <View className="flex-row items-center justify-between mb-1.5">
                      <Text className="text-textPrimary text-sm font-bold">{s.label}</Text>
                      {s.details ? (
                        <View className="bg-primary/10 border border-primary/30 px-2 py-0.5 rounded">
                          <Text className="text-primary text-xs font-bold">{s.details}</Text>
                        </View>
                      ) : null}
                    </View>
                    <TextInput
                      value={tokens[s.key] || ''}
                      onChangeText={(v) => setTokens(prev => ({ ...prev, [s.key]: v }))}
                      placeholder={`Token number for ${s.label}`}
                      placeholderTextColor="#64748B"
                      keyboardType="default"
                      className="bg-bgDark border border-bgSurfaceLight rounded-lg h-11 px-3 text-textPrimary font-bold text-base"
                    />
                  </View>
                ))}
              </View>
            </ScrollView>

            {/* Actions */}
            {verifying ? (
              <View className="mt-4 py-3"><ActivityIndicator size="small" color="#22c55e" /></View>
            ) : (
              <View className="flex-row gap-3 mt-4 pt-3 border-t border-bgSurfaceLight/60">
                <TouchableOpacity onPress={() => setActiveTaskId(null)} className="flex-1 bg-bgSurfaceLight rounded-xl h-12 items-center justify-center">
                  <Text className="text-textSecondary font-bold">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleVerify}
                  disabled={!canVerify}
                  className={`flex-1 rounded-xl h-12 items-center justify-center ${canVerify ? 'bg-primary' : 'bg-primary/30 border border-primary/20'}`}
                >
                  <Text className={`font-bold ${canVerify ? 'text-white' : 'text-textMuted'}`}>
                    {!isOtpValid ? 'Enter 4-Digit OTP' : !areTokensValid ? 'Enter All Tokens' : 'Verify & Pickup'}
                  </Text>
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
