import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Inbox, Clock } from 'lucide-react-native';
import { useAuthStore } from '../../store/authStore';
import { useOpsProcessStore } from '../../store/opsProcessStore';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { serviceSummary, FeedOrder } from '../../utils/orderFeed';
import { currentStep, isDone, myInProgress, stage, stepLabel, stepQueue, OpsProcess } from '../../utils/opsProcess';
import { slaRemainingMinutes, slaTone, STAGE_SLA_MINUTES, SlaTone } from '../../utils/sla';
import type { RootStackParamList } from '../../navigation/RootNavigator';

// Order in which stage tabs appear. Mirrors the ops pipeline (prestain is skipped
// for ironing-only orders, but the tab row always shows the full pipeline).
const STAGE_ORDER = [
  'tagging',
  'prestain',
  'getting_washed',
  'getting_dried',
  'getting_folded',
  'getting_ironed',
];
const KNOWN_STAGES = new Set(STAGE_ORDER);

// Fallback bucket for a process whose current step isn't in STAGE_ORDER, so it
// never silently vanishes from the counts/queues.
const OTHER_KEY = '__other__';

// Mirrors the server's stageRoleGate: helpers take everything except ironing;
// only iron-role staff (and supervisors) take ironing. The UI uses this to keep
// a stage from showing as claimable when the caller can't start it.
const canStartStage = (role: string | null | undefined, step: string): boolean => {
  if (role === 'supervisor') return true;
  if (role === 'iron') return step === 'getting_ironed';
  return step !== 'getting_ironed';
};

const tabLabel = (step: string): string => (step === OTHER_KEY ? 'Other' : stepLabel(step));

const TONE_CLASS: Record<SlaTone, string> = {
  muted: 'text-textMuted',
  ok: 'text-primary',
  warning: 'text-warning',
  error: 'text-error',
};

interface QueueItem {
  key: string;
  orderId: string;
  process?: OpsProcess;
}

export function ProcessingScreen() {
  const user = useAuthStore(s => s.user);
  const activeRole = useAuthStore(s => s.activeRole);
  const { processes, isLoading, error, initialize } = useOpsProcessStore();
  const { orders, initialize: initializeFeed } = useOrderFeedStore();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [selected, setSelected] = useState('tagging');

  useEffect(() => {
    initializeFeed();
    if (user?.id) initialize(user.id);
  }, [initialize, initializeFeed, user?.id]);

  const orderById = useMemo(() => {
    const m = new Map<string, FeedOrder>();
    for (const o of orders) m.set(o.id, o);
    return m;
  }, [orders]);

  // pickup_completed orders with no ops_process yet — the helper's entry point
  // to claim new work (claiming starts the tagging stage in OrderDetail).
  const claimableOrders = useMemo(() => {
    if (!canStartStage(activeRole, 'tagging')) return [];
    const claimed = new Set(processes.map(p => p.orderId));
    return orders.filter(o => o.status === 'pickup_completed' && !claimed.has(o.id));
  }, [orders, processes, activeRole]);

  // Which tab bucket a process belongs to. Unknown current steps fall through to
  // an "Other" bucket so they never silently disappear.
  const bucketOf = (p: OpsProcess): string | null => {
    const cur = currentStep(p);
    if (!cur) return null;
    return KNOWN_STAGES.has(cur) ? cur : OTHER_KEY;
  };

  const counts = useMemo(() => {
    const c: Record<string, { pending: number; mine: number }> = {};
    for (const step of STAGE_ORDER) c[step] = { pending: 0, mine: 0 };
    c[OTHER_KEY] = { pending: 0, mine: 0 };
    for (const p of processes) {
      const bucket = bucketOf(p);
      if (!bucket) continue;
      if (myInProgress(p, user?.id || '')) c[bucket].mine += 1;
      const cur = currentStep(p);
      if (cur && stepQueue(p, cur) && !myInProgress(p, user?.id || '') && canStartStage(activeRole, cur)) {
        c[bucket].pending += 1;
      }
    }
    c.tagging.pending += claimableOrders.length;
    return c;
  }, [processes, claimableOrders, activeRole, user?.id]);

  const pendingItems = useMemo<QueueItem[]>(() => {
    const items: QueueItem[] = [];
    if (selected === 'tagging') {
      for (const o of claimableOrders) items.push({ key: `o-${o.id}`, orderId: o.id });
    }
    for (const p of processes) {
      if (bucketOf(p) !== selected) continue;
      const cur = currentStep(p);
      if (!cur) continue;
      // Pending is other people's unclaimed work — never my own current step.
      if (!stepQueue(p, cur) || myInProgress(p, user?.id || '') || !canStartStage(activeRole, cur)) continue;
      items.push({ key: p.id, orderId: p.orderId, process: p });
    }
    return items;
  }, [selected, processes, claimableOrders, activeRole, user?.id]);

  const myItems = useMemo<QueueItem[]>(() => {
    const items: QueueItem[] = [];
    for (const p of processes) {
      if (bucketOf(p) !== selected) continue;
      // "Mine" is scoped to the CURRENT step: myInProgress already catches
      // claimed-but-paused current-step work.
      if (!myInProgress(p, user?.id || '')) continue;
      items.push({ key: p.id, orderId: p.orderId, process: p });
    }
    return items;
  }, [selected, processes, user?.id]);

  const renderCard = (item: QueueItem) => {
    const order = orderById.get(item.orderId);
    const p = item.process;
    const cur = p ? currentStep(p) : null;
    const curStage = p && cur ? stage(p, cur) : undefined;
    const done = p ? isDone(p) : false;
    const sla = cur && curStage?.startedAt ? STAGE_SLA_MINUTES[cur] : undefined;
    const remaining = sla != null ? slaRemainingMinutes(curStage?.startedAt, sla) : undefined;
    const tone = sla != null && remaining != null ? slaTone(remaining, sla, done) : 'muted';
    const badge = p ? (done ? 'Complete' : stepLabel(cur || '')) : 'Ready to process';
    const badgeClass = p ? (done ? 'text-primary' : 'text-info') : 'text-primary';

    return (
      <TouchableOpacity
        key={item.key}
        onPress={() => navigation.navigate('OrderDetail', { orderId: item.orderId })}
        className="bg-bgSurface rounded-xl p-4 mb-3 border border-bgSurfaceLight"
      >
        <View className="flex-row items-center justify-between mb-1">
          <Text className="text-textPrimary font-bold text-lg">#{item.orderId.slice(-6).toUpperCase()}</Text>
          <Text className={`text-xs font-bold ${badgeClass}`}>{badge}</Text>
        </View>
        <Text className="text-textSecondary text-sm mb-1">{order?.customerName || 'Unknown customer'}</Text>
        <Text className="text-textMuted text-xs mb-3">{order ? serviceSummary(order) : '—'}</Text>
        {sla != null && remaining != null && (
          <View className="flex-row items-center">
            <Clock size={13} color="#94A3B8" className="mr-1" />
            <Text className={`text-xs font-bold ${TONE_CLASS[tone]}`}>
              {done ? 'Complete' : `${Math.ceil(remaining)}m left in SLA`}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  if (isLoading && processes.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-bgDark items-center justify-center">
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text className="text-textSecondary mt-4 font-bold">Loading processing…</Text>
      </SafeAreaView>
    );
  }

  const tabs = [...STAGE_ORDER];
  if ((counts[OTHER_KEY]?.pending || 0) + (counts[OTHER_KEY]?.mine || 0) > 0) tabs.push(OTHER_KEY);
  const selectedLabel = tabLabel(selected);

  return (
    <SafeAreaView className="flex-1 bg-bgDark">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-2xl font-bold text-textPrimary">Processing</Text>
        <Text className="text-textSecondary">
          {selectedLabel} queue · {pendingItems.length} pending · {myItems.length} yours
        </Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="px-4 mb-3">
        <View className="flex-row">
          {tabs.map(step => {
            const c = counts[step] || { pending: 0, mine: 0 };
            const isSel = step === selected;
            return (
              <TouchableOpacity
                key={step}
                onPress={() => setSelected(step)}
                className={`mr-2 px-3 py-2 rounded-full border ${isSel ? 'bg-primary border-primary' : 'bg-bgSurface border-bgSurfaceLight'}`}
              >
                <Text className={`text-xs font-bold ${isSel ? 'text-bgDark' : 'text-textSecondary'}`}>
                  {tabLabel(step)}
                </Text>
                <Text className={`text-xs ${isSel ? 'text-bgDark/70' : 'text-textMuted'}`}>
                  {c.pending + c.mine}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 24 }}>
        {pendingItems.length > 0 && (
          <View className="mb-1">
            <Text className="text-textSecondary font-bold text-xs mb-2 tracking-wide">PENDING</Text>
            {pendingItems.map(renderCard)}
          </View>
        )}

        {myItems.length > 0 && (
          <View className="mb-1">
            <Text className="text-textSecondary font-bold text-xs mb-2 mt-2 tracking-wide">MY WORK</Text>
            {myItems.map(renderCard)}
          </View>
        )}

        {pendingItems.length === 0 && myItems.length === 0 && (
          <View className="items-center justify-center mt-24 px-6">
            <Inbox size={36} color="#64748B" />
            <Text className="text-textSecondary text-lg font-bold mt-3">Nothing here</Text>
            <Text className="text-textMuted text-center mt-2">
              {selected === 'tagging'
                ? 'No orders waiting to be tagged right now.'
                : selected === OTHER_KEY
                  ? 'No other-stage work right now.'
                  : `No ${selectedLabel} work right now.`}
            </Text>
          </View>
        )}
      </ScrollView>

      {error && (
        <View className="mx-4 mb-4 bg-error/15 border border-error/40 rounded-lg p-3">
          <Text className="text-error text-xs font-bold">{error}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}
