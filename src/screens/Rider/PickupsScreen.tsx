import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, FlatList, ActivityIndicator, Modal, TextInput, TouchableOpacity, Alert, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bike, Clock, Package, ChevronRight } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../../store/authStore';
import { useOpsStaffStore } from '../../store/opsStaffStore';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { isPending, pickupLabel, OpsTask } from '../../utils/opsTasks';
import { timeAgo, orderTotal, slotLabel, FeedOrder } from '../../utils/orderFeed';
import { verifyPickupOTP, verifyStoreOTP, updatePickupMeta } from '../../utils/opsPickup';
import { EditOrderModal } from '../../components/EditOrderModal';
import { RiderTaskCard } from '../../components/Rider/RiderTaskCard';
import { SmartRouteSheet } from '../../components/Rider/SmartRouteSheet';
import { buildSmartRoute, SmartRouteStop, extractLocality, safeShortId } from '../../utils/smartRoute';

// Proper state sync: a pickup task is only actionable while the ORDER is still waiting
// for pickup (placed/confirmed) or mid-handover (in_transit_to_store). Once the order
// reaches pickup_completed/processing/ready/out_for_delivery/delivered, the pickup is
// DONE — hide it regardless of the task doc's status. The order status is the source of truth.
const isPickupOrderLive = (status?: string): boolean =>
  status === 'placed' || status === 'confirmed' || status === 'in_transit_to_store';

export function PickupsScreen() {
  const navigation = useNavigation<any>();
  const user = useAuthStore(state => state.user);
  const { myTasks, isLoading, initialize } = useOpsStaffStore();
  const myDeliveries = useOpsStaffStore(state => state.myDeliveries);
  const orders = useOrderFeedStore(state => state.orders);

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeStoreTaskId, setActiveStoreTaskId] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [verifying, setVerifying] = useState(false);
  const [editOrderId, setEditOrderId] = useState<string | null>(null);
  const [noteModalTask, setNoteModalTask] = useState<OpsTask | null>(null);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    if (user?.id) {
      initialize(user.id);
      useOrderFeedStore.getState().initialize();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = useMemo(() => {
    return myTasks.filter(t => {
      if (!isPending(t)) return false;
      const order = orders.find(o => o.id === t.orderId || o.id === t.id);
      if (!order) {
        if (!t.customerName && !t.pickupAddress && (!t.items || t.items.length === 0)) {
          return false;
        }
        return true;
      }
      if (order.status === 'cancelled') return false;
      if (order.status !== 'placed' && order.status !== 'confirmed' && order.status !== 'in_transit_to_store') return false;
      return true;
    });
  }, [myTasks, orders]);

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

  // Only count live deliveries (ready / out_for_delivery)
  const activeDeliveriesCount = useMemo(() => {
    return myDeliveries.filter(d => {
      if (d.status !== 'out_for_delivery' && d.status !== 'assigned') return false;
      const order = orders.find(o => o.id === d.orderId || o.id === d.id);
      if (orders.length > 0) {
        if (!order) return false;
        if (order.status === 'cancelled' || order.status === 'delivered') return false;
        if (order.status !== 'ready' && order.status !== 'out_for_delivery') return false;
      }
      return true;
    }).length;
  }, [myDeliveries, orders]);

  // Group and sort pickups by Smart Route stop sequence
  const actionable = useMemo(() => {
    const list = pending.filter(t => t.status === 'pending' || t.status === 'assigned');
    return list.sort((a, b) => {
      const stopA = stopMap.get(a.orderId || a.id);
      const stopB = stopMap.get(b.orderId || b.id);
      const numA = stopA?.stopNumber ?? 999;
      const numB = stopB?.stopNumber ?? 999;
      return numA - numB;
    });
  }, [pending, stopMap]);

  const inTransit = useMemo(() => {
    const list = pending.filter(t => t.status === 'in_transit_to_store');
    return list.sort((a, b) => {
      const stopA = stopMap.get(a.orderId || a.id);
      const stopB = stopMap.get(b.orderId || b.id);
      const numA = stopA?.stopNumber ?? 999;
      const numB = stopB?.stopNumber ?? 999;
      return numA - numB;
    });
  }, [pending, stopMap]);

  const getOrder = (task: OpsTask): FeedOrder | undefined =>
    orders.find(o => o.id === task.orderId || o.id === task.id);

  const activeTask = pending.find(t => t.id === activeTaskId || t.orderId === activeTaskId);
  const activeOrder = activeTask
    ? (orders.find(o => o.id === activeTask.orderId) || orders.find(o => o.id === activeTaskId))
    : orders.find(o => o.id === activeTaskId);

  // Extract all distinct services requiring tokens from the active order or task
  const servicesToTag = useMemo(() => {
    const activeItems = activeOrder?.items || activeTask?.items;
    if (!activeItems || activeItems.length === 0) {
      return [{ key: 'general', label: 'Order Bag / Token', details: 'All items' }];
    }
    const list: { key: string; label: string; details: string }[] = [];
    for (const item of activeItems) {
      const rawKey = item.serviceType || (item as any).serviceId;
      if (!rawKey) continue;
      let key = rawKey;
      if (rawKey === 'blanket_wash' && (item as any).blanketType) {
        key = `blanket_wash_${(item as any).blanketType}`;
      }

      const sid = String(key || rawKey || '').toLowerCase();
      const isWeightBased = sid.includes('wash_fold') || sid.includes('wash & fold') ||
                            sid.includes('wash_iron') || sid.includes('wash & iron') ||
                            sid.includes('premium_laundry') || sid.includes('premium laundry');

      if (isWeightBased) {
        const baseKey = sid.includes('wash_fold') || sid.includes('wash & fold') ? 'wash_fold' :
                        sid.includes('wash_iron') || sid.includes('wash & iron') ? 'wash_iron' :
                        'premium_laundry';

        if (list.some(s => s.key === baseKey || s.key.startsWith(`${baseKey}__L`))) {
          continue;
        }

        let label = item.serviceName || item.name || baseKey.replace(/_/g, ' ');
        label = label.replace(/\b\w/g, (c: string) => c.toUpperCase());

        const weight = Number(item.weight || (item.unit === 'kg' && item.quantity ? item.quantity : 5));
        const loadCount = Math.max(1, Math.ceil(weight / 8));

        if (loadCount === 1) {
          list.push({
            key: baseKey,
            label,
            details: `${weight} kg (1 bag)`,
          });
        } else {
          const perBag = (weight / loadCount).toFixed(1).replace(/\.0$/, '');
          for (let i = 1; i <= loadCount; i++) {
            list.push({
              key: `${baseKey}__L${i}`,
              label: `${label} (Bag ${i}/${loadCount})`,
              details: `~${perBag} kg · Max 8kg`,
            });
          }
        }
      } else {
        if (!list.some(s => s.key === key)) {
          let label = item.serviceName || item.name || key.replace(/_/g, ' ');
          label = label.replace(/\b\w/g, (c: string) => c.toUpperCase());
          let details = '';
          if (item.weight) {
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
    }
    return list.length > 0 ? list : [{ key: 'general', label: 'Order Bag / Token', details: 'All items' }];
  }, [activeOrder, activeTask]);

  const isOtpValid = otp.length === 4;
  const areTokensValid = servicesToTag.every(s => Boolean(tokens[s.key]?.trim()));
  const tokenValues = servicesToTag.map(s => tokens[s.key]?.trim()).filter(Boolean);
  const hasDuplicateTokens = new Set(tokenValues).size !== tokenValues.length;
  const canVerify = isOtpValid && areTokensValid && !hasDuplicateTokens && !verifying;

  const handleVerify = async () => {
    if (!activeTask || !canVerify || verifying) return;

    if (hasDuplicateTokens) {
      Alert.alert('Duplicate Tokens', 'Each bag must have a unique physical token number.');
      return;
    }

    const orderId = activeTask.orderId || activeTaskId!;
    setVerifying(true);
    try {
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


  if (isLoading && pending.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-bgDark items-center justify-center">
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text className="text-textSecondary mt-4 font-bold">Loading pickups…</Text>
      </SafeAreaView>
    );
  }

  const handleToggleUrgent = async (t: OpsTask) => {
    const order = getOrder(t);
    const currentUrgent = Boolean(t.isUrgent ?? order?.isUrgent);
    try {
      await updatePickupMeta(t.orderId, {
        isUrgent: !currentUrgent,
        userId: order?.userId,
      });
    } catch {
      Alert.alert('Error', 'Failed to update urgent status');
    }
  };

  const handleOpenNoteModal = (t: OpsTask) => {
    const order = getOrder(t);
    setNoteModalTask(t);
    setNoteText(t.pickupNote || order?.pickupNote || '');
  };

  const handleSaveNote = async () => {
    if (!noteModalTask) return;
    setSavingNote(true);
    try {
      const order = getOrder(noteModalTask);
      await updatePickupMeta(noteModalTask.orderId, {
        pickupNote: noteText.trim(),
        userId: order?.userId,
      });
      setNoteModalTask(null);
    } catch {
      Alert.alert('Error', 'Failed to save pickup note');
    } finally {
      setSavingNote(false);
    }
  };

  const renderCard = (t: OpsTask, isInTransit?: boolean) => {
    const order = getOrder(t);
    const stop = stopMap.get(t.orderId || t.id);
    const pickupSlotText = pickupLabel(t) !== '—'
      ? pickupLabel(t)
      : (order && slotLabel(order) !== '—' ? slotLabel(order) : undefined);

    const items = order?.items || t.items;
    const totalAmount = order ? orderTotal(order) : (typeof t.totalAmount === 'number' ? t.totalAmount : undefined);
    const paymentStatus = order?.paymentStatus || t.paymentStatus;
    const notes = order?.notes || t.notes;
    const rawAddr = t.pickupAddress || (order?.address?.formattedAddress || (typeof order?.address === 'string' ? order.address : undefined));
    const locality = isInTransit ? 'STORE DROP' : (stop?.locality || extractLocality(rawAddr));

    return (
      <RiderTaskCard
        type="pickup"
        orderNumber={safeShortId(t.orderId)}
        customerName={order?.customerName || t.customerName}
        customerPhone={order?.customerPhone || t.customerPhone}
        status={t.status}
        createdAt={order?.createdAt || t.createdAt}
        items={items}
        totalAmount={totalAmount}
        paymentStatus={paymentStatus}
        pickupAddress={rawAddr}
        pickupSlot={pickupSlotText}
        notes={notes}
        tokenNumber={t.tokenNumber || order?.tokenNumber}
        tokens={order?.tokens || (t as any).tokens}
        lat={order?.latitude || order?.address?.latitude || t.latitude}
        lng={order?.longitude || order?.address?.longitude || t.longitude}
        isUrgent={t.isUrgent ?? order?.isUrgent}
        pickupNote={t.pickupNote || order?.pickupNote}
        stopNumber={stop?.stopNumber}
        locality={locality}
        loadUnits={stop?.loadUnits}
        onToggleUrgent={() => handleToggleUrgent(t)}
        onEditPickupNote={() => handleOpenNoteModal(t)}
        onPrimary={
          isInTransit
            ? () => { setOtp(''); setActiveStoreTaskId(t.id); }
            : () => {
                setOtp('');
                const raw = order?.tokens || (t as any).tokens;
                const existingTokens = raw ? { ...raw } : (t.tokenNumber ? { general: t.tokenNumber } : {});
                for (const [k, v] of Object.entries(existingTokens)) {
                  if (typeof v === 'string' && v.includes(',')) {
                    v.split(',').map(p => p.trim()).filter(Boolean).forEach((tk, idx) => {
                      const lk = `${k}__L${idx + 1}`;
                      if (!existingTokens[lk]) existingTokens[lk] = tk;
                    });
                  }
                }
                setTokens(existingTokens);
                setActiveTaskId(t.id);
              }
        }
        primaryLabel={isInTransit ? 'Handover to Store' : 'Verify pickup OTP'}
        onEdit={
          !isInTransit && items && items.length > 0
            ? () => setEditOrderId(t.orderId)
            : undefined
        }
      />
    );
  };

  const [filterTab, setFilterTab] = useState<'route' | 'pickup' | 'in_bag'>('route');

  // Unified Smart Route sequence (Stop 1, Stop 2, Stop 3, Stop 4, Stop 5)
  const routeSorted = useMemo(() => {
    return [...pending].sort((a, b) => {
      const stopA = stopMap.get(a.orderId || a.id);
      const stopB = stopMap.get(b.orderId || b.id);
      const numA = stopA?.stopNumber ?? 999;
      const numB = stopB?.stopNumber ?? 999;
      return numA - numB;
    });
  }, [pending, stopMap]);

  return (
    <SafeAreaView className="flex-1 bg-slate-100">
      {/* Header */}
      <View className="px-4 pt-3 pb-2 flex-row items-center justify-between">
        <View>
          <Text className="text-xl font-black text-slate-950 tracking-tight">My Pickups</Text>
          <Text className="text-slate-500 text-[11px] font-bold mt-0.5">
            {pending.length} task{pending.length === 1 ? '' : 's'} on circuit • SpinZo BTM Hub
          </Text>
        </View>
        <View className="bg-emerald-100 border border-emerald-300 px-2.5 py-0.5 rounded-full flex-row items-center">
          <View className="w-1.5 h-1.5 rounded-full bg-emerald-600 mr-1.5" />
          <Text className="text-emerald-950 text-[11px] font-black">ON DUTY</Text>
        </View>
      </View>

      {/* Smart Route Mission Bar */}
      <SmartRouteSheet
        myTasks={myTasks}
        myDeliveries={myDeliveries}
        orders={orders}
        onSelectTask={(stop) => {
          if (stop.type === 'delivery') {
            navigation.navigate('Deliveries');
          } else {
            const task = pending.find(t => t.id === stop.taskId || t.orderId === stop.orderId);
            if (task) {
              if (task.status === 'in_transit_to_store') {
                setOtp('');
                setActiveStoreTaskId(task.id);
              } else {
                setOtp('');
                const targetOrder = getOrder(task);
                const raw = targetOrder?.tokens || (task as any).tokens;
                const existingTokens = raw ? { ...raw } : (task.tokenNumber ? { general: task.tokenNumber } : {});
                for (const [k, v] of Object.entries(existingTokens)) {
                  if (typeof v === 'string' && v.includes(',')) {
                    v.split(',').map(p => p.trim()).filter(Boolean).forEach((tk, idx) => {
                      const lk = `${k}__L${idx + 1}`;
                      if (!existingTokens[lk]) existingTokens[lk] = tk;
                    });
                  }
                }
                setTokens(existingTokens);
                setActiveTaskId(task.id);
              }
            }
          }
        }}
      />

      {/* Active Deliveries Quick Switcher (Sleek notification strip) */}
      {activeDeliveriesCount > 0 ? (
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => navigation.navigate('Deliveries')}
          className="mx-4 mb-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-xl flex-row items-center justify-between active:bg-blue-100"
        >
          <View className="flex-row items-center flex-1 mr-2">
            <View className="w-6 h-6 rounded-lg bg-blue-600 items-center justify-center mr-2">
              <Package size={13} color="#FFFFFF" />
            </View>
            <Text className="text-blue-950 font-black text-xs">
              {activeDeliveriesCount} Active Deliver{activeDeliveriesCount > 1 ? 'ies' : 'y'} ready for route
            </Text>
          </View>
          <View className="flex-row items-center">
            <Text className="text-blue-700 font-black text-xs mr-0.5">Switch</Text>
            <ChevronRight size={13} color="#1D4ED8" />
          </View>
        </TouchableOpacity>
      ) : null}

      {/* Modern Segmented Tabs */}
      <View className="flex-row bg-slate-100 p-1 rounded-xl mx-4 mb-2.5 border border-slate-200">
        <TouchableOpacity
          onPress={() => setFilterTab('route')}
          className={`flex-1 py-1.5 px-1 rounded-lg items-center justify-center ${
            filterTab === 'route' ? 'bg-white shadow-xs' : ''
          }`}
        >
          <Text
            className={`text-xs font-black ${
              filterTab === 'route' ? 'text-slate-950' : 'text-slate-500'
            }`}
          >
            ⚡ Route ({routeSorted.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setFilterTab('pickup')}
          className={`flex-1 py-1.5 px-1 rounded-lg items-center justify-center ${
            filterTab === 'pickup' ? 'bg-white shadow-xs' : ''
          }`}
        >
          <Text
            className={`text-xs font-black ${
              filterTab === 'pickup' ? 'text-slate-950' : 'text-slate-500'
            }`}
          >
            📦 Pick Up ({actionable.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setFilterTab('in_bag')}
          className={`flex-1 py-1.5 px-1 rounded-lg items-center justify-center ${
            filterTab === 'in_bag' ? 'bg-white shadow-xs' : ''
          }`}
        >
          <Text
            className={`text-xs font-black ${
              filterTab === 'in_bag' ? 'text-slate-950' : 'text-slate-500'
            }`}
          >
            🎒 In Bag ({inTransit.length})
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={pending.length ? [0] : []}
        keyExtractor={() => 'list'}
        renderItem={() => null}
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 28 }}
        ListEmptyComponent={
          <View className="items-center justify-center mt-20">
            <Bike size={36} color="#64748B" />
            <Text className="text-slate-800 text-lg font-bold mt-3">No pickups assigned yet</Text>
            <Text className="text-slate-500 text-center mt-2">Assigned pickups appear here instantly.</Text>
          </View>
        }
        ListHeaderComponent={
          <>
            {filterTab === 'route' && routeSorted.map(t => (
              <View key={t.id}>{renderCard(t, t.status === 'in_transit_to_store')}</View>
            ))}

            {filterTab === 'pickup' && (
              actionable.length > 0 ? (
                actionable.map(t => (
                  <View key={t.id}>{renderCard(t, false)}</View>
                ))
              ) : (
                <View className="py-12 items-center">
                  <Text className="text-slate-500 font-bold text-sm">All pickups collected! Drop them at the store.</Text>
                </View>
              )
            )}

            {filterTab === 'in_bag' && (
              inTransit.length > 0 ? (
                inTransit.map(t => (
                  <View key={t.id}>{renderCard(t, true)}</View>
                ))
              ) : (
                <View className="py-12 items-center">
                  <Text className="text-slate-500 font-bold text-sm">No collected bags in bag. Complete a pickup first.</Text>
                </View>
              )
            )}
          </>
        }
      />

      {/* Pickup OTP + Token Modal */}
      <Modal visible={activeTaskId !== null} transparent animationType="slide" onRequestClose={() => setActiveTaskId(null)}>
        <View className="flex-1 justify-center items-center bg-black/75 p-5">
          <View className="w-full max-h-[88%] bg-white rounded-3xl p-5 border-2 border-slate-300 shadow-2xl">
            {/* Header */}
            <View className="flex-row items-center justify-between mb-1 pb-2 border-b-2 border-slate-200">
              <View>
                <Text className="text-slate-950 text-xl font-black">Verify Pickup</Text>
                {activeTask?.orderId ? (
                  <Text className="text-slate-600 text-xs font-bold">Order #{safeShortId(activeTask.orderId)}</Text>
                ) : null}
              </View>
              <TouchableOpacity onPress={() => setActiveTaskId(null)} className="w-9 h-9 rounded-full bg-slate-100 border border-slate-300 items-center justify-center">
                <Text className="text-slate-950 text-base font-black">✕</Text>
              </TouchableOpacity>
            </View>
            <Text className="text-slate-600 text-xs mb-3 font-semibold">
              Enter customer 4-digit OTP and assign token numbers for bags.
            </Text>

            <ScrollView showsVerticalScrollIndicator={false} className="flex-grow-0">
              {/* Customer OTP */}
              <View className="mb-4 bg-slate-50 p-4 rounded-2xl border-2 border-slate-300">
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="text-slate-950 text-sm font-black">Customer OTP</Text>
                  <Text className="text-purple-700 text-xs font-black">4 Digits</Text>
                </View>
                <Text className="text-slate-600 text-xs mb-2.5 font-medium">Ask customer for their 4-digit verification OTP</Text>
                <TextInput
                  value={otp}
                  onChangeText={(t) => setOtp(t.replace(/[^0-9]/g, '').slice(0, 4))}
                  keyboardType="number-pad"
                  maxLength={4}
                  placeholder="••••"
                  placeholderTextColor="#94A3B8"
                  autoFocus
                  className="bg-white border-2 border-slate-400 rounded-2xl h-15 text-center text-3xl tracking-[0.4em] text-slate-950 font-black shadow-xs"
                />
              </View>

              {/* Token Inputs */}
              <View className="mb-2">
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="text-slate-950 text-sm font-black">Assign Bag Tokens</Text>
                  <Text className="text-amber-800 text-xs font-black">Tag on physical bag</Text>
                </View>
                <Text className="text-slate-600 text-xs mb-2.5 font-medium">Enter the physical token number attached to each service bag</Text>

                {servicesToTag.map((s) => (
                  <View key={s.key} className="mb-3 bg-slate-50 p-3.5 rounded-2xl border-2 border-slate-300">
                    <View className="flex-row items-center justify-between mb-1.5">
                      <Text className="text-slate-950 text-sm font-black">{s.label}</Text>
                      {s.details ? (
                        <View className="bg-blue-600 px-2 py-0.5 rounded shadow-xs">
                          <Text className="text-white text-xs font-black">{s.details}</Text>
                        </View>
                      ) : null}
                    </View>
                    <TextInput
                      value={tokens[s.key] || ''}
                      onChangeText={(v) => setTokens(prev => ({ ...prev, [s.key]: v }))}
                      placeholder={`Token number for ${s.label}`}
                      placeholderTextColor="#94A3B8"
                      keyboardType="default"
                      className="bg-white border-2 border-slate-300 rounded-xl h-12 px-3 text-slate-950 font-black text-base shadow-xs"
                    />
                  </View>
                ))}
              </View>
            </ScrollView>

            {/* Actions */}
            {verifying ? (
              <View className="mt-4 py-3"><ActivityIndicator size="small" color="#7C3AED" /></View>
            ) : (
              <View className="flex-row gap-3 mt-4 pt-3 border-t-2 border-slate-200">
                <TouchableOpacity onPress={() => setActiveTaskId(null)} className="flex-1 bg-slate-100 border border-slate-300 rounded-2xl h-13 items-center justify-center">
                  <Text className="text-slate-700 font-black text-sm">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleVerify}
                  disabled={!canVerify}
                  className={`flex-1 rounded-2xl h-13 items-center justify-center shadow-md ${canVerify ? 'bg-purple-600 active:bg-purple-700' : 'bg-slate-300'}`}
                >
                  <Text className={`font-black text-sm uppercase tracking-wide ${canVerify ? 'text-white' : 'text-slate-500'}`}>
                    {!isOtpValid ? 'Enter 4-Digit OTP' : !areTokensValid ? 'Enter All Tokens' : hasDuplicateTokens ? 'Duplicate Token Used' : 'Verify & Pickup'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Store Handover Modal */}
      <Modal visible={activeStoreTaskId !== null} transparent animationType="slide" onRequestClose={() => setActiveStoreTaskId(null)}>
        <View className="flex-1 justify-center items-center bg-black/75 p-6">
          <View className="w-full bg-white rounded-3xl p-5 border-2 border-slate-300 shadow-2xl">
            <Text className="text-slate-950 text-xl font-black mb-1">Store Handover</Text>
            <Text className="text-slate-600 text-xs mb-3 font-semibold">
              Enter the 4-digit store operator OTP to confirm delivery to SpinZo BTM Store.
            </Text>
            <TextInput
              value={otp}
              onChangeText={(t) => setOtp(t.replace(/[^0-9]/g, '').slice(0, 4))}
              keyboardType="number-pad"
              maxLength={4}
              placeholder="••••"
              placeholderTextColor="#94A3B8"
              autoFocus
              className="bg-slate-50 border-2 border-slate-400 rounded-2xl h-15 text-center text-3xl tracking-[0.4em] text-slate-950 font-black mb-4 shadow-xs"
            />
            {verifying ? (
              <View className="mt-4"><ActivityIndicator size="small" color="#059669" /></View>
            ) : (
              <View className="flex-row gap-3 mt-2">
                <TouchableOpacity onPress={() => setActiveStoreTaskId(null)} className="flex-1 bg-slate-100 border border-slate-300 rounded-2xl h-13 items-center justify-center">
                  <Text className="text-slate-700 font-black text-sm">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleVerifyStore}
                  disabled={otp.length !== 4}
                  className={`flex-1 rounded-2xl h-13 items-center justify-center shadow-md ${otp.length === 4 ? 'bg-emerald-600 active:bg-emerald-700' : 'bg-slate-300'}`}
                >
                  <Text className={`font-black text-sm uppercase tracking-wide ${otp.length === 4 ? 'text-white' : 'text-slate-500'}`}>
                    Confirm Handover
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <EditOrderModal visible={editOrderId !== null} onClose={() => setEditOrderId(null)} order={editOrder} />

      {/* Pickup Note Modal */}
      <Modal visible={noteModalTask !== null} transparent animationType="fade" onRequestClose={() => setNoteModalTask(null)}>
        <View className="flex-1 bg-black/75 items-center justify-center p-4">
          <View className="bg-white w-full max-w-sm rounded-3xl p-5 border-2 border-slate-300 shadow-2xl">
            <Text className="text-slate-950 font-black text-lg mb-1">Pickup Note</Text>
            <Text className="text-slate-600 text-xs font-semibold mb-3">
              Add any special request or observation for Order #{safeShortId(noteModalTask?.orderId)}
            </Text>
            <TextInput
              value={noteText}
              onChangeText={setNoteText}
              placeholder="e.g. Customer requested delicate handling, extra dirty shirts..."
              placeholderTextColor="#94A3B8"
              multiline
              numberOfLines={3}
              className="bg-slate-50 border-2 border-slate-300 rounded-2xl p-3.5 text-slate-950 text-sm font-semibold mb-4 min-h-[90px] shadow-xs"
            />
            <View className="flex-row gap-3">
              <TouchableOpacity
                onPress={() => setNoteModalTask(null)}
                className="flex-1 bg-slate-100 border border-slate-300 rounded-2xl h-12 items-center justify-center"
              >
                <Text className="text-slate-700 font-black text-sm">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSaveNote}
                disabled={savingNote}
                className="flex-1 bg-amber-500 active:bg-amber-600 rounded-2xl h-12 items-center justify-center shadow-md"
              >
                <Text className="text-slate-950 font-black text-sm uppercase">Save Note</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
