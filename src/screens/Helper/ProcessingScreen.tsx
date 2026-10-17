import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Inbox, Clock, Phone, MapPin, ChevronDown, User, AlertTriangle, Zap, Tag, Shirt } from 'lucide-react-native';
import { useAuthStore } from '../../store/authStore';
import { useOpsProcessStore } from '../../store/opsProcessStore';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { serviceSummary, FeedOrder, orderTotal } from '../../utils/orderFeed';
import { currentStep, isDone, myInProgress, stage, stepLabel, stepQueue, isMachineStep, OpsProcess } from '../../utils/opsProcess';
import { slaRemainingMinutes, slaTone, STAGE_SLA_MINUTES, SlaTone } from '../../utils/sla';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { WorkflowSteps } from '../../components/WorkflowSteps';
import { FloatingTaskCard } from '../../components/FloatingTaskCard';
import { AssignHelperModal } from '../../components/Supervisor/AssignHelperModal';
import { useStoreResourcesStore } from '../../store/storeResourcesStore';
import { useResponsive } from '../../utils/useResponsive';

type AppRole = 'helper' | 'iron' | 'supervisor' | 'admin';

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
  if (role === 'supervisor' || role === 'admin') return true;
  if (role === 'iron' || role === 'helper') return STAGE_ORDER.includes(step);
  return false;
};

const getTabsForRole = (role: AppRole) => {
  if (role === 'supervisor' || role === 'admin') return STAGE_ORDER;
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

const formatPickupTime = (order?: FeedOrder) => {
  const pAt = (order as any)?.pickedUpAt || (order as any)?.pickupCompletedAt || (order as any)?.createdAt;
  if (!pAt) return null;
  const ms = typeof pAt.toMillis === 'function' ? pAt.toMillis() : new Date(pAt).getTime();
  if (isNaN(ms) || ms <= 0) return null;
  const diffMin = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  const timeStr = new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffMin < 60) return `Picked: ${timeStr} (${diffMin}m ago)`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return `Picked: ${timeStr} (${h}h ${m}m ago)`;
};

function SupervisorFeed() {
  const user = useAuthStore(s => s.user);
  const authRole = useAuthStore(s => s.activeRole) as AppRole;
  
  // We no longer have local sub-role selection for helpers.
  // The role is simply their activeRole.
  const role = authRole || 'helper';
  
  const { processes, isLoading, error, initialize, startStep, completeStep } = useOpsProcessStore();
  const resources = useStoreResourcesStore(s => s.resources);
  const { orders, initialize: initializeFeed } = useOrderFeedStore();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { isDesktop, isTablet, maxContainerStyle } = useResponsive();

  const [assignModalData, setAssignModalData] = useState<{
    visible: boolean;
    processId: string;
    stepName?: string;
    orderId: string;
    userId: string;
  } | null>(null);

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

  const validProcesses = useMemo(() => {
    return processes.filter(p => {
      const o = orderById.get(p.orderId);
      return o?.status !== 'cancelled';
    });
  }, [processes, orderById]);

  const counts = useMemo(() => {
    const c: Record<string, { pending: number; mine: number; inProgressOther: number }> = {};
    for (const step of STAGE_ORDER) c[step] = { pending: 0, mine: 0, inProgressOther: 0 };
    c[OTHER_KEY] = { pending: 0, mine: 0, inProgressOther: 0 };
    for (const p of validProcesses) {
      const bucket = bucketOf(p);
      if (!bucket) continue;
      if (myInProgress(p, user?.id || '')) {
        c[bucket].mine += 1;
      } else {
        const cur = currentStep(p);
        if (cur && canStartStage(role, cur)) {
          const s = p.stages[cur];
          const isMachine = isMachineStep(cur);
          const isRunning = isMachine ? (!!s?.startedAt && !s?.completedAt) : (!!s?.assignee && !s?.completedAt);
          if (isRunning) {
            c[bucket].inProgressOther += 1;
          } else if (stepQueue(p, cur)) {
            c[bucket].pending += 1;
          }
        }
      }
    }
    c.tagging.pending += claimableOrders.length;
    return c;
  }, [validProcesses, claimableOrders, role, user?.id]);

  const pendingItems = useMemo<QueueItem[]>(() => {
    const items: QueueItem[] = [];
    if (selected === 'tagging') {
      for (const o of claimableOrders) items.push({ key: `o-${o.id}`, orderId: o.id });
    }
    for (const p of validProcesses) {
      if (bucketOf(p) !== selected) continue;
      const cur = currentStep(p);
      if (!cur) continue;
      const s = p.stages[cur];
      const isMachine = isMachineStep(cur);
      const isRunning = isMachine ? (!!s?.startedAt && !s?.completedAt) : (!!s?.assignee && !s?.completedAt);
      if (isRunning || myInProgress(p, user?.id || '') || !canStartStage(role, cur)) continue;
      if (!stepQueue(p, cur)) continue;
      items.push({ key: p.id, orderId: p.orderId, process: p });
    }
    return items;
  }, [selected, validProcesses, claimableOrders, role, user?.id]);

  const myItems = useMemo<QueueItem[]>(() => {
    const items: QueueItem[] = [];
    for (const p of validProcesses) {
      if (bucketOf(p) !== selected) continue;
      if (!myInProgress(p, user?.id || '')) continue;
      items.push({ key: p.id, orderId: p.orderId, process: p });
    }
    return items;
  }, [selected, validProcesses, user?.id]);
  
  const inProgressByOthers = useMemo<QueueItem[]>(() => {
    const items: QueueItem[] = [];
    if (role === 'helper') return items; // Helpers only see their own tasks
    for (const p of validProcesses) {
      if (bucketOf(p) !== selected) continue;
      const cur = currentStep(p);
      if (!cur) continue;
      const s = p.stages[cur];
      const isMachine = isMachineStep(cur);
      const isRunning = isMachine ? (!!s?.startedAt && !s?.completedAt) : (!!s?.assignee && !s?.completedAt);
      if (isRunning && !myInProgress(p, user?.id || '')) {
        items.push({ key: p.id, orderId: p.orderId, process: p });
      }
    }
    return items;
  }, [selected, validProcesses, role, user?.id]);

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

  const handleItemPress = (item: QueueItem) => {
    navigation.navigate('OrderDetail', { orderId: item.orderId, processId: item.process?.id });
  };

  const renderCard = (item: QueueItem) => {
    const order = orderById.get(item.orderId);
    const pickupTimeStr = formatPickupTime(order);
    const p = item.process;
    const cur = p ? currentStep(p) : null;
    const curStage = p && cur ? stage(p, cur) : undefined;
    const done = p ? isDone(p) : false;
    const isMachine = cur ? isMachineStep(cur) : false;
    const isStarted = isMachine ? !!curStage?.startedAt : !!curStage?.assignee;
    const startMs = curStage?.startedAt ? (typeof (curStage.startedAt as any).toMillis === 'function' ? (curStage.startedAt as any).toMillis() : new Date((curStage.startedAt as any) || Date.now()).getTime()) : 0;
    const isCycleDone = isMachine && !!curStage?.startedAt && startMs > 0 && (Date.now() - startMs) >= 1800000; // >= 30 mins

    const isAcceptedWaitingStart = isMachine && !!curStage?.acceptedAt && !curStage?.startedAt;
    const acceptMs = curStage?.acceptedAt ? (typeof (curStage.acceptedAt as any).toMillis === 'function' ? (curStage.acceptedAt as any).toMillis() : new Date((curStage.acceptedAt as any) || Date.now()).getTime()) : 0;
    const elapsedAcceptMin = acceptMs > 0 ? Math.floor((Date.now() - acceptMs) / 60000) : 0;
    const isOverdueAccepted = isAcceptedWaitingStart && elapsedAcceptMin >= 2;

    const sla = cur && curStage?.startedAt ? STAGE_SLA_MINUTES[cur] : undefined;
    const remaining = sla != null ? slaRemainingMinutes(curStage?.startedAt, sla) : undefined;
    const tone = sla != null && remaining != null ? slaTone(remaining, sla, done) : 'muted';
    const badge = p ? (
      done ? 'Complete' :
      isCycleDone ? 'Ready to Unload' :
      isOverdueAccepted ? `⚠️ Not Started (${elapsedAcceptMin}m)` :
      (isMachine && !curStage?.startedAt) ? 'Queued' :
      stepLabel(cur || '')
    ) : 'Ready to tag';
    
    const isMine = p && myInProgress(p, user?.id || '');
    
    // Find index of current step for workflow dots
    const stepArr = p?.steps || [];
    const currentIndex = cur ? stepArr.indexOf(cur) : (done ? stepArr.length : 0);

    const matchingItems = p ? (order?.items?.filter(i => i.serviceType === p.serviceType) || []) : (order?.items || []);
    const qty = matchingItems.reduce((sum, i) => sum + (i.quantity || 0), 0);
    const isUrgent = !!order?.isUrgent;
    const stationLabel = (() => {
      if (cur === 'getting_washed') return curStage?.startedAt ? '🌀 In Washer' : '🧺 Washer Queue';
      if (cur === 'getting_dried') return curStage?.startedAt ? '💨 In Dryer' : '🧺 Dryer Queue';
      if (cur === 'getting_ironed') return '👔 Iron';
      return null;
    })();

    return (
      <TouchableOpacity
        key={item.key}
        onPress={() => handleItemPress(item)}
        className="bg-bgSurface rounded-3xl p-5 mb-3 border border-bgSurfaceLight active:opacity-90 shadow-xs"
      >
        <View className="flex-row justify-between mb-2">
          <View className="flex-1 mr-2">
            <View className="flex-row items-center flex-wrap gap-y-1 gap-x-2 mb-1">
              <Text className="text-gray-900 font-bold text-lg shrink-1" numberOfLines={1}>
                #{order?.shortId?.toUpperCase() || item.orderId.substring(0,6).toUpperCase()}{p && p.siblingCount && p.siblingCount > 1 ? `-${p.serviceType?.toUpperCase().substring(0,2)}` : ''}
              </Text>
              {isUrgent && (
                <View className="bg-red-500/15 border border-red-500/40 px-2 py-0.5 rounded-full flex-row items-center">
                  <Zap size={10} color="#ef4444" className="mr-0.5" />
                  <Text className="text-red-600 font-black text-[10px] uppercase">URGENT</Text>
                </View>
              )}
              {!!p?.serviceLabel && (
                <View className="bg-blue-100 px-2 py-0.5 rounded border border-blue-200">
                  <Text className="text-blue-800 font-bold text-xs">{p.serviceLabel}</Text>
                </View>
              )}
              {(() => {
                const sToken = p?.tokenNumber || (p?.serviceType && order?.tokens?.[p.serviceType]) || order?.tokenNumber;
                if (!sToken) return null;
                return (
                  <View className="bg-amber-500/15 px-2 py-0.5 rounded border border-amber-500/30">
                    <Text className="text-warning font-bold text-xs">T-{sToken}</Text>
                  </View>
                );
              })()}
              {!!stationLabel && (
                <View className="bg-purple-100 px-2 py-0.5 rounded border border-purple-200">
                  <Text className="text-purple-800 font-bold text-xs">{stationLabel}</Text>
                </View>
              )}
            </View>
            {p && <WorkflowSteps steps={stepArr} currentIndex={currentIndex} />}
          </View>
          <View className="items-end justify-start shrink-0">
            <View className={`px-2 py-1 rounded-md ${
              done ? 'bg-green-500/15' :
              isCycleDone ? 'bg-emerald-500/20 border border-emerald-500/40' :
              isOverdueAccepted ? 'bg-rose-500/20 border border-rose-500/50' :
              (isMachine && !curStage?.startedAt) ? 'bg-amber-500/15 border border-amber-500/30' :
              'bg-primary/10'
            }`}>
              <Text className={`text-xs font-bold ${
                done ? 'text-green-700' :
                isCycleDone ? 'text-emerald-700' :
                isOverdueAccepted ? 'text-rose-700' :
                (isMachine && !curStage?.startedAt) ? 'text-amber-800' :
                'text-primary'
              }`}>{badge}</Text>
            </View>
          </View>
        </View>

        <View className="flex-row items-center justify-between mb-3 border-b border-bgSurfaceLight pb-3">
          <View className="flex-1">
            <Text className="text-textPrimary font-medium text-base mb-1">{order?.customerName || 'Unknown Customer'}</Text>
            {!!order?.customerPhone && (
              <TouchableOpacity
                onPress={(e) => {
                  e?.stopPropagation?.();
                  Linking.openURL(`tel:${order.customerPhone}`);
                }}
                className="flex-row items-center self-start py-0.5"
                style={{ alignSelf: 'flex-start' }}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Phone size={12} color="#94A3B8" className="mr-1" />
                <Text className="text-textSecondary text-xs">{order.customerPhone}</Text>
              </TouchableOpacity>
            )}
            <View className="flex-row items-center mt-1 flex-wrap gap-y-1">
              {qty > 0 && <Text className="text-textSecondary text-xs mr-2">{qty} units (kgs/pcs)</Text>}
              {!!p?.garments?.count && <Text className="text-primary font-bold text-xs bg-primary/10 px-1.5 py-0.5 rounded mr-2">{p.garments.count} garments</Text>}
              {!!pickupTimeStr && (
                <View className="flex-row items-center mr-2 bg-gray-100 px-1.5 py-0.5 rounded">
                  <Clock size={11} color="#64748B" className="mr-1" />
                  <Text className="text-gray-600 text-xs font-medium">{pickupTimeStr}</Text>
                </View>
              )}
            </View>

            {/* Assigned Helper Chip / Alert */}
            {/* Assigned Helper Chip / Alert & Machine Chip */}
            <View className="flex-row items-center flex-wrap">
              {curStage?.assignee ? (
                <TouchableOpacity
                  disabled={role !== 'supervisor' && role !== 'admin'}
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    if (p) {
                      setAssignModalData({
                        visible: true,
                        processId: p.id,
                        stepName: cur ? stepLabel(cur) : undefined,
                        orderId: item.orderId,
                        userId: order?.userId || '',
                      });
                    }
                  }}
                  className="flex-row items-center bg-[#994bff]/10 px-2.5 py-1 rounded-full self-start mt-2 border border-[#994bff]/25 active:opacity-70"
                >
                  <User size={12} color="#994bff" className="mr-1.5" />
                  <Text className="text-[#994bff] font-bold text-xs">
                    Assigned: {curStage.assigneeName ? (curStage.assigneeName.charAt(0).toUpperCase() + curStage.assigneeName.slice(1)) : 'Staff'}
                    {(role === 'supervisor' || role === 'admin') ? ' • Reassign' : ''}
                  </Text>
                </TouchableOpacity>
              ) : p ? (
                <TouchableOpacity
                  disabled={role !== 'supervisor' && role !== 'admin'}
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    setAssignModalData({
                      visible: true,
                      processId: p.id,
                      stepName: cur ? stepLabel(cur) : undefined,
                      orderId: item.orderId,
                      userId: order?.userId || '',
                    });
                  }}
                  className="flex-row items-center bg-amber-500/15 px-2.5 py-1 rounded-full self-start mt-2 border border-amber-500/30 active:opacity-70"
                >
                  <AlertTriangle size={12} color="#d97706" className="mr-1.5" />
                  <Text className="text-amber-800 font-bold text-xs">
                    ⚠️ Unassigned {(role === 'supervisor' || role === 'admin') ? '• Tap to assign' : ''}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  disabled={role !== 'supervisor' && role !== 'admin'}
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    setAssignModalData({
                      visible: true,
                      processId: item.orderId,
                      stepName: 'Tagging',
                      orderId: item.orderId,
                      userId: order?.userId || '',
                    });
                  }}
                  className="flex-row items-center bg-purple-50 px-2.5 py-1 rounded-full self-start mt-2 border border-purple-200 active:opacity-70"
                >
                  <AlertTriangle size={12} color="#994bff" className="mr-1.5" />
                  <Text className="text-[#994bff] font-bold text-xs">
                    New Inbound • Ready for Tagging {(role === 'supervisor' || role === 'admin') ? '• Tap to assign' : ''}
                  </Text>
                </TouchableOpacity>
              )}
              {!!curStage?.machineName && (
                <View className="flex-row items-center bg-teal-500/10 px-2.5 py-1 rounded-full self-start mt-2 ml-2 border border-teal-500/30">
                  <Text className="text-teal-700 font-bold text-xs">
                    {curStage.machineName.includes('Washer') ? '🫧 ' : curStage.machineName.includes('Dryer') ? '💨 ' : '👔 '}
                    {curStage.machineName}
                  </Text>
                </View>
              )}
            </View>
          </View>
          <View className="items-end">
            <Text className="text-textPrimary font-medium">{p ? p.serviceLabel : (order ? serviceSummary(order) : '—')}</Text>
            {!!order && orderTotal(order) > 0 && <Text className="text-textSecondary text-xs">₹{orderTotal(order)}</Text>}
          </View>
        </View>

        <View className="flex-row items-center justify-between">
          <View className="flex-1 mr-2">
            {(order?.deliverySlot || order?.deliveryDate) ? (
              <View className="flex-row items-center mb-1.5 bg-blue-50/80 border border-blue-200/60 px-2 py-0.5 rounded-md self-start">
                <MapPin size={11} color="#2563eb" className="mr-1" />
                <Text className="text-blue-800 font-semibold text-xs">
                  Target: {order?.deliveryDate || ''} {order?.deliverySlot || order?.deliveryTime || ''}
                </Text>
              </View>
            ) : null}
            
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
          {isMine && startMs > 0 && (
            <View className="bg-primary/10 px-3 py-2 rounded-xl flex-row items-center gap-2">
              <View className="w-2 h-2 rounded-full bg-error" />
              <LiveTimer startTimeMs={startMs} />
            </View>
          )}
          {!isMine && cur === 'tagging' && (
             <View className="bg-primary px-4 py-2.5 rounded-xl">
               <Text className="text-white font-bold text-xs">Start Tagging</Text>
             </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  if (isLoading && processes.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-bgDark items-center justify-center">
        <ActivityIndicator size="large" color="#994bff" />
        <Text className="text-textSecondary mt-4 font-bold">Loading queue…</Text>
      </SafeAreaView>
    );
  }

  const roleName = role === 'helper' ? 'Helper' : role === 'iron' ? 'Iron' : 'Supervisor';

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top']}>
      {/* Header */}
      <View className="px-6 pt-4 pb-2 bg-white border-b border-gray-100 z-50">
        <View style={maxContainerStyle} className="flex-row items-center justify-between">
          <Text className="text-2xl font-bold text-gray-900">Orders</Text>
          <View className="bg-[#994bff]/10 px-3 py-1.5 rounded-full">
            <Text className="text-[#994bff] font-bold text-xs">{roleName}</Text>
          </View>
        </View>
      </View>

      {/* Tabs */}
      <View className="bg-white pb-3 pt-3">
        <View style={maxContainerStyle}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="px-6">
            <View className="flex-row">
              {tabs.map(step => {
                const c = counts[step] || { pending: 0, mine: 0, inProgressOther: 0 };
                const bubbleCount = role === 'helper' ? c.mine : (c.pending + c.mine + c.inProgressOther);
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
                    {bubbleCount > 0 && (
                      <View className={`ml-2 px-1.5 py-0.5 rounded-md ${isSel ? 'bg-white/20' : 'bg-gray-200'}`}>
                        <Text className={`text-[10px] font-bold ${isSel ? 'text-white' : 'text-gray-500'}`}>
                          {bubbleCount}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        </View>
      </View>

      {/* List */}
      <ScrollView className="flex-1 px-4 pt-4" contentContainerStyle={{ paddingBottom: 100 }}>
        <View style={maxContainerStyle}>
          {myItems.length > 0 && (
            <View className="mb-5">
              <Text className="text-[#994bff] font-black text-xs mb-3 tracking-widest uppercase pl-1">
                My Assigned Tasks ({myItems.length})
              </Text>
              <View className={isDesktop || isTablet ? "flex-row flex-wrap -mx-2" : ""}>
                {myItems.map(item => (
                  <View key={item.key} className={isDesktop ? "w-1/2 px-2" : isTablet ? "w-1/2 px-2" : "w-full"}>
                    {renderCard(item)}
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Section 1: Running in Machines (for washing & drying) or Hands-on In Progress (for other tabs) */}
          {role !== 'helper' && inProgressByOthers.length > 0 && (
            <View className="mb-5">
              <View className="flex-row items-center justify-between mb-3 px-1">
                <Text className="text-emerald-600 font-black text-xs tracking-widest uppercase">
                  {selected === 'washing' ? `🌀 In Washer (${inProgressByOthers.length} / ${resources.washers} Active)` :
                   selected === 'drying' ? `💨 In Dryer (${inProgressByOthers.length} / ${resources.dryers} Active)` :
                   `In Progress on Floor (${inProgressByOthers.length})`}
                </Text>
                {selected === 'washing' && inProgressByOthers.length >= resources.washers && (
                  <View className="bg-amber-100 border border-amber-200 px-2 py-0.5 rounded">
                    <Text className="text-amber-800 font-bold text-[10px] uppercase">All Washers Full</Text>
                  </View>
                )}
              </View>
              <View className={isDesktop || isTablet ? "flex-row flex-wrap -mx-2" : ""}>
                {inProgressByOthers.map(item => (
                  <View key={item.key} className={isDesktop ? "w-1/2 px-2" : isTablet ? "w-1/2 px-2" : "w-full"}>
                    {renderCard(item)}
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Section 2: Queued Outside Machines / Pending Work */}
          {role !== 'helper' && pendingItems.length > 0 && (
            <View className="mb-5">
              <View className="flex-row items-center justify-between mb-3 px-1">
                <Text className="text-amber-600 font-black text-xs tracking-widest uppercase">
                  {selected === 'washing' ? `🧺 Queued for Washer (${pendingItems.length} Waiting Outside)` :
                   selected === 'drying' ? `🧺 Queued for Dryer (${pendingItems.length} Waiting Outside)` :
                   `Pending Floor Work (${pendingItems.length})`}
                </Text>
                {selected === 'washing' && (
                  <Text className="text-slate-400 text-xs font-semibold">
                    Staged in queue · will start when washer opens
                  </Text>
                )}
              </View>
              <View className={isDesktop || isTablet ? "flex-row flex-wrap -mx-2" : ""}>
                {pendingItems.map(item => (
                  <View key={item.key} className={isDesktop ? "w-1/2 px-2" : isTablet ? "w-1/2 px-2" : "w-full"}>
                    {renderCard(item)}
                  </View>
                ))}
              </View>
            </View>
          )}

          {(role === 'helper' ? myItems.length === 0 : (pendingItems.length === 0 && myItems.length === 0 && inProgressByOthers.length === 0)) && (
            <View className="items-center justify-center mt-20 px-6 opacity-60">
              <Inbox size={48} color="#94A3B8" />
              <Text className="text-gray-400 text-lg font-bold mt-4">All Caught Up</Text>
              <Text className="text-gray-400 text-center mt-2 text-sm">
                {role === 'helper' ? 'You have no assigned tasks right now.' : `No orders waiting for ${tabLabel(selected)} right now.`}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      {!!error && (
        <View className="absolute top-32 left-4 right-4 bg-red-50 border border-red-200 rounded-xl p-3 shadow-sm z-40">
          <Text className="text-red-600 text-xs font-bold">{error}</Text>
        </View>
      )}

      {assignModalData?.visible && (
        <AssignHelperModal
          visible={assignModalData.visible}
          onClose={() => setAssignModalData(null)}
          processId={assignModalData.processId}
          stepName={assignModalData.stepName}
          onAssign={async (helperId) => {
            const o = orderById.get(assignModalData.orderId);
            const p = validProcesses.find(x => x.id === assignModalData.processId || x.orderId === assignModalData.orderId);
            if (p) {
              await useOpsProcessStore.getState().assignStepToHelper(
                assignModalData.orderId,
                p.id,
                assignModalData.userId,
                helperId
              );
            } else {
              await useOpsProcessStore.getState().claim(
                assignModalData.orderId,
                o?.tokenNumber,
                assignModalData.userId,
                o?.vendorId,
                helperId
              );
            }
            setAssignModalData(null);
          }}
          onUnassign={async () => {
            await useOpsProcessStore.getState().unassignStep(
              assignModalData.orderId,
              assignModalData.processId,
              assignModalData.userId,
              true
            );
            setAssignModalData(null);
          }}
        />
      )}
    </SafeAreaView>
  );
}

export function ProcessingScreen() {
  const authRole = useAuthStore(s => s.activeRole) as AppRole;
  const { processes, completeStep } = useOpsProcessStore();
  const user = useAuthStore(s => s.user);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  // Compute all active floating machine processes for this staff member
  const activeFloatingProcesses = useMemo(() => {
    return processes.filter(pr => {
      const cur = currentStep(pr);
      return (cur === 'getting_washed' || cur === 'getting_dried') && myInProgress(pr, user?.id || '');
    });
  }, [processes, user?.id]);

  const handleFloatingComplete = async (targetOrderId?: string) => {
    const targetId = targetOrderId || activeFloatingProcesses[0]?.orderId;
    if (targetId) {
      await completeStep(targetId);
    }
  };

  const handlePressCard = (orderId: string, processId?: string) => {
    navigation.navigate('OrderDetail', { orderId, processId });
  };

  return (
    <View className="flex-1">
      <SupervisorFeed />
      {/* Floating Task Card rendered at wrapper level so it always persists */}
      <FloatingTaskCard
        processes={activeFloatingProcesses}
        onComplete={handleFloatingComplete}
        onPressCard={handlePressCard}
      />
    </View>
  );
}
