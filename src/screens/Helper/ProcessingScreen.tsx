import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Inbox, Clock, Phone, MapPin, ChevronDown } from 'lucide-react-native';
import { useAuthStore } from '../../store/authStore';
import { useOpsProcessStore } from '../../store/opsProcessStore';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { serviceSummary, FeedOrder } from '../../utils/orderFeed';
import { currentStep, isDone, myInProgress, stage, stepLabel, stepQueue, OpsProcess } from '../../utils/opsProcess';
import { slaRemainingMinutes, slaTone, STAGE_SLA_MINUTES, SlaTone } from '../../utils/sla';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { WorkflowSteps } from '../../components/WorkflowSteps';
import { FloatingTaskCard } from '../../components/FloatingTaskCard';

type AppRole = 'helper' | 'iron' | 'supervisor';

const IRON_TABS = ['getting_ironed'];

const STAGE_ORDER = [
  'tagging',
  'getting_washed',
  'getting_dried',
  'getting_ironed',
  'packaging'
];
const KNOWN_STAGES = new Set(STAGE_ORDER);
const OTHER_KEY = '__other__';

const HELPER_TABS = STAGE_ORDER.filter(s => s !== 'getting_ironed');

export const canStartStage = (role: AppRole, step: string): boolean => {
  if (role === 'supervisor') return true;
  if (role === 'iron' || role === 'helper') return STAGE_ORDER.includes(step);
  return false;
};

const getTabsForRole = (role: AppRole) => {
  if (role === 'supervisor') return STAGE_ORDER;
  if (role === 'iron' || role === 'helper') return STAGE_ORDER;
  return [];
};

const tabLabel = (step: string): string => (step === OTHER_KEY ? 'Other' : stepLabel(step));

const TONE_CLASS: Record<SlaTone, string> = {
  muted: 'text-gray-400',
  ok: 'text-[#10b981]',
  warning: 'text-orange-500',
  error: 'text-red-500',
};

interface QueueItem {
  key: string;
  orderId: string;
  process?: OpsProcess;
}

const LiveTimer = ({ startTimeMs }: { startTimeMs: number }) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);
  const diff = Math.floor((Date.now() - startTimeMs) / 1000);
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  return <Text className="font-bold text-[#994bff]">{h.toString().padStart(2,'0')}:{m.toString().padStart(2,'0')}:{s.toString().padStart(2,'0')}</Text>;
};

const UrgencyCountdown = ({ createdAt }: { createdAt: any }) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);
  
  const createdMs = typeof createdAt?.toMillis === 'function' ? createdAt.toMillis() : new Date(createdAt).getTime();
  const diffSecs = 60 - Math.floor((Date.now() - createdMs) / 1000);
  
  if (diffSecs <= 0) return <Text className="text-red-500 font-bold text-xs">Overdue!</Text>;
  return <Text className="text-orange-500 font-bold text-xs">{diffSecs}s urgency</Text>;
};

export function ProcessingScreen() {
  const user = useAuthStore(s => s.user);
  const authRole = useAuthStore(s => s.activeRole) as AppRole;
  
  // We no longer have local sub-role selection for helpers.
  // The role is simply their activeRole.
  const role = authRole || 'helper';
  
  const { processes, isLoading, error, initialize, startStep, completeStep } = useOpsProcessStore();
  const { orders, initialize: initializeFeed } = useOrderFeedStore();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const tabs = getTabsForRole(role);
  const [selected, setSelected] = useState(tabs[0] || 'tagging');

  useEffect(() => {
    // Make sure selected is valid for current role
    if (!tabs.includes(selected)) {
      setSelected(tabs[0] || 'tagging');
    }
  }, [role, tabs, selected]);

  useEffect(() => {
    initializeFeed();
    if (user?.id) initialize(user.id);
  }, [initialize, initializeFeed, user?.id]);

  const orderById = useMemo(() => {
    const m = new Map<string, FeedOrder>();
    for (const o of orders) m.set(o.id, o);
    return m;
  }, [orders]);

  const claimableOrders = useMemo(() => {
    if (!canStartStage(role, 'tagging')) return [];
    const claimed = new Set(processes.map(p => p.orderId));
    return orders.filter(o => o.status === 'pickup_completed' && !claimed.has(o.id));
  }, [orders, processes, role]);

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
      if (cur && stepQueue(p, cur) && !myInProgress(p, user?.id || '') && canStartStage(role, cur)) {
        c[bucket].pending += 1;
      }
    }
    c.tagging.pending += claimableOrders.length;
    return c;
  }, [processes, claimableOrders, role, user?.id]);

  const pendingItems = useMemo<QueueItem[]>(() => {
    const items: QueueItem[] = [];
    if (selected === 'tagging') {
      for (const o of claimableOrders) items.push({ key: `o-${o.id}`, orderId: o.id });
    }
    for (const p of processes) {
      if (bucketOf(p) !== selected) continue;
      const cur = currentStep(p);
      if (!cur) continue;
      if (!stepQueue(p, cur) || myInProgress(p, user?.id || '') || !canStartStage(role, cur)) continue;
      items.push({ key: p.id, orderId: p.orderId, process: p });
    }
    return items;
  }, [selected, processes, claimableOrders, role, user?.id]);

  const myItems = useMemo<QueueItem[]>(() => {
    const items: QueueItem[] = [];
    for (const p of processes) {
      if (bucketOf(p) !== selected) continue;
      if (!myInProgress(p, user?.id || '')) continue;
      items.push({ key: p.id, orderId: p.orderId, process: p });
    }
    return items;
  }, [selected, processes, user?.id]);
  
  // Floating task state
  const activeFloatingProcess = useMemo(() => {
    return processes.find(p => {
      const cur = currentStep(p);
      return (cur === 'getting_washed' || cur === 'getting_dried') && myInProgress(p, user?.id || '');
    });
  }, [processes, user?.id]);

  const handleFloatingComplete = async () => {
    if (activeFloatingProcess) {
      await completeStep(activeFloatingProcess.orderId);
    }
  };

  const renderCard = (item: QueueItem) => {
    const order = orderById.get(item.orderId);
    const p = item.process;
    const cur = p ? currentStep(p) : null;
    const curStage = p && cur ? stage(p, cur) : undefined;
    const done = p ? isDone(p) : false;
    const sla = cur && curStage?.startedAt ? STAGE_SLA_MINUTES[cur] : undefined;
    const remaining = sla != null ? slaRemainingMinutes(curStage?.startedAt, sla) : undefined;
    const tone = sla != null && remaining != null ? slaTone(remaining, sla, done) : 'muted';
    const badge = p ? (done ? 'Complete' : stepLabel(cur || '')) : 'Ready to tag';
    
    const isMine = p && myInProgress(p, user?.id || '');
    const startTimeMs = curStage?.startedAt ? (typeof (curStage.startedAt as any).toMillis === 'function' ? (curStage.startedAt as any).toMillis() : new Date((curStage.startedAt as any) || Date.now()).getTime()) : 0;
    
    // Find index of current step for workflow dots
    const stepArr = p?.steps || [];
    const currentIndex = cur ? stepArr.indexOf(cur) : (done ? stepArr.length : 0);

    return (
      <TouchableOpacity
        key={item.key}
        onPress={() => navigation.navigate('OrderDetail', { orderId: item.orderId })}
        className="bg-white rounded-3xl p-5 mb-4 shadow-sm border border-gray-100"
      >
        <View className="flex-row items-center justify-between mb-2">
          <View className="flex-row items-center gap-2">
            <Text className="text-gray-900 font-bold text-lg">#{item.orderId.toUpperCase()}</Text>
            {!!p?.tokenNumber && (
              <View className="bg-amber-100 px-2 py-0.5 rounded border border-amber-200">
                <Text className="text-amber-800 font-bold text-xs">T-{p.tokenNumber}</Text>
              </View>
            )}
            {p && <WorkflowSteps steps={stepArr} currentIndex={currentIndex} />}
          </View>
          <View className={`px-2 py-1 rounded-md ${done ? 'bg-green-100' : 'bg-[#994bff]/10'}`}>
            <Text className={`text-xs font-bold ${done ? 'text-green-700' : 'text-[#994bff]'}`}>{badge}</Text>
          </View>
        </View>

        <View className="flex-row items-center justify-between mb-3 border-b border-gray-100 pb-3">
          <View className="flex-1">
            <Text className="text-gray-900 font-medium text-base mb-1">{order?.customerName || 'Unknown Customer'}</Text>
            {!!order?.phone && (
              <TouchableOpacity onPress={() => Linking.openURL(`tel:${order.phone}`)} className="flex-row items-center">
                <Phone size={12} color="#64748B" className="mr-1" />
                <Text className="text-gray-500 text-xs">{order.phone}</Text>
              </TouchableOpacity>
            )}
          </View>
          <View className="items-end">
            <Text className="text-gray-900 font-medium">{order ? serviceSummary(order) : '—'}</Text>
            {order?.totalAmount && <Text className="text-gray-500 text-xs">₹{order.totalAmount}</Text>}
          </View>
        </View>

        <View className="flex-row items-center justify-between">
          <View>
            {!!order?.deliverySlot && (
              <View className="flex-row items-center mb-1">
                <MapPin size={12} color="#64748B" className="mr-1" />
                <Text className="text-gray-500 text-xs">Delivery: {order.deliverySlot}</Text>
              </View>
            )}
            
            {/* Tagging SLA / Urgency */}
            {!p && order?.createdAt && <UrgencyCountdown createdAt={order.createdAt} />}
            
            {/* Process SLAs */}
            {sla != null && remaining != null && (
              <View className="flex-row items-center">
                <Clock size={12} color={tone === 'error' ? '#ef4444' : '#94A3B8'} className="mr-1" />
                <Text className={`text-xs font-bold ${TONE_CLASS[tone]}`}>
                  {done ? 'Complete' : `${Math.ceil(remaining)}m left in SLA`}
                </Text>
              </View>
            )}
          </View>
          
          {/* Actions / Timers */}
          {isMine && startTimeMs > 0 && (
            <View className="bg-purple-50 px-3 py-2 rounded-xl flex-row items-center gap-2">
              <View className="w-2 h-2 rounded-full bg-red-500" />
              <LiveTimer startTimeMs={startTimeMs} />
            </View>
          )}
          {!isMine && cur === 'tagging' && (
             <View className="bg-[#994bff] px-3 py-2 rounded-xl">
               <Text className="text-white font-bold text-xs">Start Tagging</Text>
             </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  if (isLoading && processes.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#994bff" />
        <Text className="text-gray-500 mt-4 font-bold">Loading queue…</Text>
      </SafeAreaView>
    );
  }

  const roleName = role === 'helper' ? 'Helper' : role === 'iron' ? 'Iron' : 'Supervisor';

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top']}>
      {/* Header */}
      <View className="px-6 pt-4 pb-2 bg-white border-b border-gray-100 z-50">
        <View className="flex-row items-center justify-between">
          <Text className="text-2xl font-bold text-gray-900">Orders</Text>
          <View className="bg-[#994bff]/10 px-3 py-1.5 rounded-full">
            <Text className="text-[#994bff] font-bold text-xs">{roleName}</Text>
          </View>
        </View>
      </View>

      {/* Tabs */}
      <View className="bg-white pb-3 pt-3">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="px-6">
          <View className="flex-row">
            {tabs.map(step => {
              const c = counts[step] || { pending: 0, mine: 0 };
              const isSel = step === selected;
              return (
                <TouchableOpacity
                  key={step}
                  onPress={() => setSelected(step)}
                  className={`mr-3 px-4 py-2.5 rounded-2xl flex-row items-center ${isSel ? 'bg-[#994bff]' : 'bg-gray-100'}`}
                >
                  <Text className={`text-sm font-bold ${isSel ? 'text-white' : 'text-gray-600'}`}>
                    {tabLabel(step)}
                  </Text>
                  {(c.pending + c.mine) > 0 && (
                    <View className={`ml-2 px-1.5 py-0.5 rounded-md ${isSel ? 'bg-white/20' : 'bg-gray-200'}`}>
                      <Text className={`text-[10px] font-bold ${isSel ? 'text-white' : 'text-gray-500'}`}>
                        {c.pending + c.mine}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      </View>

      {/* List */}
      <ScrollView className="flex-1 px-4 pt-4" contentContainerStyle={{ paddingBottom: 100 }}>
        {myItems.length > 0 && (
          <View className="mb-4">
            <Text className="text-[#994bff] font-bold text-xs mb-3 tracking-widest uppercase pl-2">My Current Work</Text>
            {myItems.map(renderCard)}
          </View>
        )}

        {pendingItems.length > 0 && (
          <View className="mb-4">
            <Text className="text-gray-400 font-bold text-xs mb-3 tracking-widest uppercase pl-2">Pending</Text>
            {pendingItems.map(renderCard)}
          </View>
        )}

        {pendingItems.length === 0 && myItems.length === 0 && (
          <View className="items-center justify-center mt-20 px-6 opacity-60">
            <Inbox size={48} color="#94A3B8" />
            <Text className="text-gray-400 text-lg font-bold mt-4">All Caught Up</Text>
            <Text className="text-gray-400 text-center mt-2 text-sm">
              No orders waiting for {tabLabel(selected)} right now.
            </Text>
          </View>
        )}
      </ScrollView>

      {!!error && (
        <View className="absolute top-32 left-4 right-4 bg-red-50 border border-red-200 rounded-xl p-3 shadow-sm z-40">
          <Text className="text-red-600 text-xs font-bold">{error}</Text>
        </View>
      )}

      {/* Floating Task Card for active washing/drying */}
      <FloatingTaskCard process={activeFloatingProcess || null} onComplete={handleFloatingComplete} />
    </SafeAreaView>
  );
}
