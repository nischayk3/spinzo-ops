import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Linking, TextInput, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Inbox, Clock, Phone, MapPin, User, AlertTriangle, Zap, Shirt, Check, Search, X, Hourglass } from 'lucide-react-native';
import { useAuthStore } from '../../store/authStore';
import { useOpsProcessStore } from '../../store/opsProcessStore';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { serviceSummary, FeedOrder, orderTotal } from '../../utils/orderFeed';
import { currentStep, isDone, myInProgress, stage, stepLabel, stepQueue, isMachineStep, OpsProcess } from '../../utils/opsProcess';
import { computeOrderUrgency, compareOrdersForOps, formatCompactDuration, toEpochMs } from '../../utils/orderUrgency';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { WorkflowSteps } from '../../components/WorkflowSteps';
import { FloatingTaskCard } from '../../components/FloatingTaskCard';
import { AssignHelperModal } from '../../components/Supervisor/AssignHelperModal';
import { useStoreResourcesStore } from '../../store/storeResourcesStore';
import { useHelperRulesStore } from '../../store/helperRulesStore';
import { isHelperAllowedForStage } from '../../utils/helperEligibility';
import { useResponsive } from '../../utils/useResponsive';
import { stopAlarm } from '../../utils/alerts';
import { clearAssignmentNotifications } from '../../utils/systemNotifications';
import { SpinzoOverlay } from 'spinzo-overlay';

const silenceActiveAlerts = () => {
  stopAlarm();
  clearAssignmentNotifications();
  if (Platform.OS === 'android') {
    try {
      SpinzoOverlay.dismissOverlay();
    } catch { /* non-fatal */ }
  }
};

type AppRole = 'helper' | 'iron' | 'supervisor' | 'admin';
type UrgencyFilter = 'all' | 'critical' | 'express' | 'aging24h';

const STAGE_ORDER = [
  'tagging',
  'getting_washed',
  'getting_dried',
  'getting_ironed',
  'packaging'
];
const KNOWN_STAGES = new Set(STAGE_ORDER);
const OTHER_KEY = '__other__';

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
  const diff = Math.max(0, Math.floor((Date.now() - startTimeMs) / 1000));
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  return <Text className="font-bold text-xs text-[#994bff]">{h.toString().padStart(2,'0')}:{m.toString().padStart(2,'0')}:{s.toString().padStart(2,'0')}</Text>;
};

const formatWeightKg = (kg: number): string => {
  const rounded = Math.round(kg * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded} kg` : `${rounded.toFixed(1)} kg`;
};

const getLoadTelemetry = (order?: FeedOrder, p?: OpsProcess): string | null => {
  const matchingItems = p
    ? (order?.items?.filter(i => i.serviceType === p.serviceType) || [])
    : (order?.items || []);

  let totalWeight = 0;
  let itemClothesCount = 0;
  let fallbackQty = 0;

  for (const item of matchingItems) {
    if (typeof item.weight === 'number' && item.weight > 0) {
      totalWeight += item.weight;
    } else if (typeof item.unit === 'string' && /kg/i.test(item.unit) && typeof item.quantity === 'number' && item.quantity > 0) {
      totalWeight += item.quantity;
    }
    if (typeof item.clothesCount === 'number' && item.clothesCount > 0) {
      itemClothesCount += item.clothesCount;
    }
    if (typeof item.quantity === 'number' && item.quantity > 0) {
      fallbackQty += item.quantity;
    }
  }

  const garmentsCount =
    (p?.garments?.count && p.garments.count > 0 ? p.garments.count : 0) ||
    (itemClothesCount > 0 ? itemClothesCount : 0) ||
    (order?.garmentCount && order.garmentCount > 0 ? order.garmentCount : 0) ||
    (order?.opsDetails?.garmentCount && order.opsDetails.garmentCount > 0 ? order.opsDetails.garmentCount : 0);

  let bundles = 0;
  if (p?.stages) {
    for (const st of Object.values(p.stages)) {
      const b = st?.qualityProof?.bundles;
      if (typeof b === 'number' && b > bundles) bundles = b;
    }
  }

  const parts: string[] = [];
  if (totalWeight > 0) parts.push(formatWeightKg(totalWeight));
  if (garmentsCount > 0) parts.push(`${garmentsCount} pcs`);
  else if (totalWeight === 0 && fallbackQty > 0) parts.push(`${fallbackQty} units`);
  if (bundles > 0) parts.push(`${bundles} ${bundles === 1 ? 'bdl' : 'bdls'}`);

  return parts.length > 0 ? parts.join(' · ') : null;
};

const getStageEnteredMs = (p?: OpsProcess, cur?: string | null): number | null => {
  if (!p || !cur) return null;
  const curStage = stage(p, cur);
  const stepArr = p.steps || [];
  const idx = stepArr.indexOf(cur);
  const prevStep = idx > 0 ? stepArr[idx - 1] : null;
  const prevCompletedMs = prevStep ? toEpochMs(p.stages?.[prevStep]?.completedAt) : null;

  return (
    toEpochMs(curStage?.queuedAt) ??
    prevCompletedMs ??
    toEpochMs(curStage?.startedAt) ??
    toEpochMs(curStage?.assignedAt) ??
    toEpochMs(p.claimedAt)
  );
};

function SupervisorFeed() {
  const user = useAuthStore(s => s.user);
  const authRole = useAuthStore(s => s.activeRole) as AppRole;
  
  // We no longer have local sub-role selection for helpers.
  // The role is simply their activeRole.
  const role = authRole || 'helper';
  
  const { processes, isLoading, error, initialize, startStep, completeStep, drainWaitingOpsQueues } = useOpsProcessStore();
  const resources = useStoreResourcesStore(s => s.resources);
  const helperRules = useHelperRulesStore(s => s.rules);
  const subscribeHelperRules = useHelperRulesStore(s => s.subscribe);
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
  const [searchQuery, setSearchQuery] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>('all');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Make sure selected is valid for current role
    if (!tabs.includes(selected)) {
      setSelected(tabs[0] || 'tagging');
    }
  }, [role, tabs, selected]);

  useEffect(() => {
    initializeFeed();
    subscribeHelperRules();
    if (user?.id) initialize(user.id);
  }, [initialize, initializeFeed, subscribeHelperRules, user?.id]);

  const canAccessStage = (step: string): boolean => {
    if (!canStartStage(role, step)) return false;
    if (role === 'supervisor' || role === 'admin') return true;
    return isHelperAllowedForStage(user?.phone, step, helperRules);
  };

  const orderById = useMemo(() => {
    const m = new Map<string, FeedOrder>();
    for (const o of orders) m.set(o.id, o);
    return m;
  }, [orders]);

  const claimableOrders = useMemo(() => {
    if (!canAccessStage('tagging')) return [];
    const claimed = new Set(processes.map(p => p.orderId));
    return orders.filter(o => o.status === 'pickup_completed' && !claimed.has(o.id));
  }, [orders, processes, role, user?.phone, helperRules]);

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
        if (cur && canAccessStage(cur)) {
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
  }, [validProcesses, claimableOrders, role, user?.id, user?.phone, helperRules]);

  const sortQueueByOps = (list: QueueItem[]): QueueItem[] =>
    [...list].sort((a, b) =>
      compareOrdersForOps(orderById.get(a.orderId), orderById.get(b.orderId), 'ops_fifo', nowMs)
    );

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
      if (isRunning || myInProgress(p, user?.id || '') || !canAccessStage(cur)) continue;
      if (!stepQueue(p, cur)) continue;
      items.push({ key: p.id, orderId: p.orderId, process: p });
    }
    return sortQueueByOps(items);
  }, [selected, validProcesses, claimableOrders, role, user?.id, user?.phone, helperRules, orderById, nowMs]);

  const myItems = useMemo<QueueItem[]>(() => {
    const items: QueueItem[] = [];
    for (const p of validProcesses) {
      if (bucketOf(p) !== selected) continue;
      if (!myInProgress(p, user?.id || '')) continue;
      items.push({ key: p.id, orderId: p.orderId, process: p });
    }
    return sortQueueByOps(items);
  }, [selected, validProcesses, user?.id, orderById, nowMs]);

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
    return sortQueueByOps(items);
  }, [selected, validProcesses, role, user?.id, orderById, nowMs]);

  const stageUrgencyCounts = useMemo(() => {
    const visible = role === 'helper' ? myItems : [...myItems, ...inProgressByOthers, ...pendingItems];
    let critical = 0;
    let express = 0;
    let aging24h = 0;
    for (const item of visible) {
      const urg = computeOrderUrgency(orderById.get(item.orderId), nowMs);
      if (urg.isStalled48h || urg.isOverdue) critical += 1;
      if (urg.isExpress) express += 1;
      if (urg.isAging24h) aging24h += 1;
    }
    return { all: visible.length, critical, express, aging24h };
  }, [role, myItems, inProgressByOthers, pendingItems, orderById, nowMs]);

  const matchesFilters = (item: QueueItem): boolean => {
    const order = orderById.get(item.orderId);
    const p = item.process;

    if (urgencyFilter !== 'all') {
      const urg = computeOrderUrgency(order, nowMs);
      if (urgencyFilter === 'critical' && !(urg.isStalled48h || urg.isOverdue)) return false;
      if (urgencyFilter === 'express' && !urg.isExpress) return false;
      if (urgencyFilter === 'aging24h' && !urg.isAging24h) return false;
    }

    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;

    const cur = p ? currentStep(p) : null;
    const curStage = p && cur ? stage(p, cur) : undefined;
    const tokens = [
      order?.shortId,
      item.orderId,
      p?.tokenNumber,
      order?.tokenNumber,
      ...(order?.tokens ? Object.values(order.tokens) : []),
      order?.customerName,
      order?.customerPhone,
      order?.phone,
      curStage?.assigneeName,
      curStage?.machineName,
      p?.serviceLabel,
    ];
    return tokens.some(v => typeof v === 'string' && v.toLowerCase().includes(q));
  };

  const filteredMyItems = useMemo(() => myItems.filter(matchesFilters), [myItems, searchQuery, urgencyFilter, orderById, nowMs]);
  const filteredInProgress = useMemo(() => inProgressByOthers.filter(matchesFilters), [inProgressByOthers, searchQuery, urgencyFilter, orderById, nowMs]);
  const filteredPending = useMemo(() => pendingItems.filter(matchesFilters), [pendingItems, searchQuery, urgencyFilter, orderById, nowMs]);
  const hasActiveFilter = searchQuery.trim().length > 0 || urgencyFilter !== 'all';

  // Floating task state
  const activeFloatingProcess = useMemo(() => {
    return processes.find(p => {
      const cur = currentStep(p);
      return (cur === 'getting_washed' || cur === 'getting_dried') && myInProgress(p, user?.id || '');
    });
  }, [processes, user?.id]);

  const handleFloatingComplete = async () => {
    if (activeFloatingProcess) {
      silenceActiveAlerts();
      await completeStep(activeFloatingProcess.orderId);
    }
  };

  const [drainingQueues, setDrainingQueues] = useState(false);
  const hasUnassignedPending = useMemo(() => {
    return pendingItems.some(i => {
      const p = i.process;
      if (!p) return false;
      const cur = currentStep(p);
      if (!cur) return false;
      return !p.stages?.[cur]?.assignee;
    });
  }, [pendingItems]);

  const handleAutoDrain = async () => {
    if (drainingQueues) return;
    setDrainingQueues(true);
    try {
      const stageMap: Record<string, string> = {
        washing: 'getting_washed',
        drying: 'getting_dried',
        ironing: 'getting_ironed',
        packaging: 'packaging',
        tagging: 'tagging',
      };
      const targetStage = stageMap[selected] || selected;
      await drainWaitingOpsQueues(targetStage, true);
    } catch (e) {
      console.warn('Auto drain queues failed:', e);
    } finally {
      setDrainingQueues(false);
    }
  };

  const handleItemPress = (item: QueueItem) => {
    navigation.navigate('OrderDetail', { orderId: item.orderId, processId: item.process?.id });
  };

  const renderCard = (item: QueueItem) => {
    const order = orderById.get(item.orderId);
    const urgency = computeOrderUrgency(order, nowMs);
    const p = item.process;
    const cur = p ? currentStep(p) : null;
    const curStage = p && cur ? stage(p, cur) : undefined;
    const done = p ? isDone(p) : false;
    const isMachine = cur ? isMachineStep(cur) : false;
    const startMs = toEpochMs(curStage?.startedAt) ?? 0;
    const isCycleDone = isMachine && !!curStage?.startedAt && startMs > 0 && (nowMs - startMs) >= 1_800_000; // >= 30 mins

    const isMine = p && myInProgress(p, user?.id || '');
    const stepArr = p?.steps || [];
    const currentIndex = cur ? stepArr.indexOf(cur) : (done ? stepArr.length : 0);

    const serviceText = p?.serviceLabel || (order ? serviceSummary(order) : '');
    const sToken = p?.tokenNumber || (p?.serviceType && order?.tokens?.[p.serviceType]) || order?.tokenNumber;
    const loadTelemetry = getLoadTelemetry(order, p);

    const stageEnteredMs = getStageEnteredMs(p, cur);
    const stageDwellMs = stageEnteredMs !== null ? Math.max(0, nowMs - stageEnteredMs) : 0;
    const showStageDwell = !!cur && !done && stageDwellMs >= 3_600_000;

    const isCritical = urgency.isStalled48h || urgency.isOverdue;
    const isExpressOnly = !isCritical && urgency.isExpress;
    const isAgingOnly = !isCritical && !isExpressOnly && urgency.isAging24h;

    const cardBorderClass = isCritical
      ? 'border border-red-400 bg-white'
      : isExpressOnly
      ? 'border border-orange-400 bg-white'
      : isAgingOnly
      ? 'border border-amber-300 bg-white'
      : 'border border-gray-200/80 bg-white';

    const slaPillStyle = (() => {
      if (isCritical) {
        return {
          wrap: 'bg-red-600 border border-red-700',
          text: 'text-white',
          label: urgency.isStalled48h ? '48h+ STALLED' : urgency.slaLabel,
        };
      }
      if (urgency.remainingMs !== null && (urgency.isExpress || urgency.remainingMs <= 4 * 3_600_000)) {
        return {
          wrap: 'bg-amber-50 border border-amber-300',
          text: 'text-amber-800',
          label: urgency.slaLabel,
        };
      }
      if (urgency.remainingMs !== null) {
        return {
          wrap: 'bg-emerald-50 border border-emerald-200',
          text: 'text-emerald-700',
          label: urgency.slaLabel,
        };
      }
      return null;
    })();

    const targetSlotText = [order?.deliveryDate, order?.deliverySlot || order?.deliveryTime]
      .filter(Boolean)
      .join(' ')
      .trim();

    const pickupNote = (p as any)?.pickupNote || order?.pickupNote;

    return (
      <TouchableOpacity
        key={item.key}
        onPress={() => handleItemPress(item)}
        className={`rounded-2xl mb-2.5 overflow-hidden ${cardBorderClass} shadow-xs active:opacity-90`}
      >
        {/* Slim Top Priority Banner */}
        {isCritical ? (
          <View className="bg-red-600 px-3 py-1 flex-row items-center justify-between">
            <View className="flex-row items-center">
              <AlertTriangle size={11} color="#ffffff" />
              <Text className="text-white font-black text-[10px] uppercase tracking-wider ml-1">
                {urgency.isStalled48h ? '48H+ STALLED — PRIORITIZE' : 'SLA OVERDUE — PRIORITIZE'}
              </Text>
            </View>
            {urgency.isExpress && (
              <Text className="text-red-100 font-extrabold text-[9px] uppercase">EXPRESS</Text>
            )}
          </View>
        ) : isExpressOnly ? (
          <View className="bg-orange-500 px-3 py-1 flex-row items-center justify-between">
            <View className="flex-row items-center">
              <Zap size={11} color="#ffffff" />
              <Text className="text-white font-black text-[10px] uppercase tracking-wider ml-1">
                EXPRESS 6–8H
              </Text>
            </View>
            <Text className="text-orange-100 font-extrabold text-[9px] uppercase">PROCESS FIRST</Text>
          </View>
        ) : null}

        <View className="p-3">
          {/* Row 1: Order ID, Token, Service (once), Price */}
          <View className="flex-row items-start justify-between gap-2">
            <View className="flex-1 flex-row items-center flex-wrap gap-1">
              <Text className="text-gray-900 font-extrabold text-sm" numberOfLines={1}>
                #{order?.shortId?.toUpperCase() || item.orderId.substring(0, 6).toUpperCase()}
                {p && p.siblingCount && p.siblingCount > 1
                  ? `-${p.serviceType?.toUpperCase().substring(0, 2)}${p.loadCount && p.loadCount > 1 ? `-L${p.loadIndex || 1}` : ''}`
                  : ''}
              </Text>
              {!!sToken && (
                <View className="bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                  <Text className="text-amber-800 font-bold text-[11px]">T-{sToken}</Text>
                </View>
              )}
              {!!serviceText && (
                <View className="bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                  <Text className="text-blue-700 font-bold text-[11px]" numberOfLines={1}>{serviceText}</Text>
                </View>
              )}
              {isCycleDone && (
                <View className="bg-emerald-500 px-1.5 py-0.5 rounded flex-row items-center gap-0.5">
                  <Check size={10} color="#ffffff" />
                  <Text className="text-white font-extrabold text-[10px] uppercase">Ready</Text>
                </View>
              )}
            </View>
            <Text className="text-gray-900 font-extrabold text-sm shrink-0">
              ₹{order ? orderTotal(order) : '—'}
            </Text>
          </View>

          {/* Compact Workflow Progress */}
          {p && (
            <View className="mt-1.5">
              <WorkflowSteps steps={stepArr} currentIndex={currentIndex} />
            </View>
          )}

          {/* Row 2: Customer + Phone & Delivery SLA Pill */}
          <View className="flex-row items-center justify-between gap-2 mt-2">
            <View className="flex-1 min-w-0">
              <Text className="text-gray-900 font-bold text-sm" numberOfLines={1}>
                {order?.customerName || 'Unknown Customer'}
              </Text>
              {!!order?.customerPhone && (
                <TouchableOpacity
                  onPress={() => Linking.openURL(`tel:${order.customerPhone}`)}
                  className="flex-row items-center self-start mt-0.5"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Phone size={11} color="#64748B" />
                  <Text className="text-gray-500 text-[11px] ml-1">{order.customerPhone}</Text>
                </TouchableOpacity>
              )}
            </View>

            {slaPillStyle && (
              <View className={`px-2 py-0.5 rounded-full shrink-0 ${slaPillStyle.wrap}`}>
                <Text className={`font-extrabold text-[11px] ${slaPillStyle.text}`}>
                  {slaPillStyle.label}
                </Text>
              </View>
            )}
          </View>

          {/* Row 3: Turnaround, Load & Dwell Telemetry */}
          <View className="flex-row items-center flex-wrap gap-1.5 mt-2">
            {urgency.pickedUpMs !== null && (
              <View className="flex-row items-center bg-gray-100 px-2 py-0.5 rounded-md">
                <Clock size={10} color="#64748B" />
                <Text className="text-gray-700 text-[11px] font-medium ml-1">
                  Picked: {urgency.pickedUpShort} · {urgency.ageLabel}
                </Text>
              </View>
            )}

            {!!loadTelemetry && (
              <View className="flex-row items-center bg-purple-50 border border-purple-200/80 px-2 py-0.5 rounded-md">
                <Shirt size={10} color="#7e22ce" />
                <Text className="text-purple-800 font-bold text-[11px] ml-1">{loadTelemetry}</Text>
              </View>
            )}

            {showStageDwell && cur && (
              <View className="flex-row items-center bg-amber-50 border border-amber-200/80 px-2 py-0.5 rounded-md">
                <Hourglass size={10} color="#b45309" />
                <Text className="text-amber-800 font-semibold text-[11px] ml-1">
                  In {stepLabel(cur)} · {formatCompactDuration(stageDwellMs)}
                </Text>
              </View>
            )}

            {!!targetSlotText && (
              <View className="flex-row items-center bg-blue-50/80 border border-blue-200/60 px-2 py-0.5 rounded-md">
                <MapPin size={10} color="#2563eb" />
                <Text className="text-blue-800 font-semibold text-[11px] ml-1" numberOfLines={1}>
                  {targetSlotText}
                </Text>
              </View>
            )}
          </View>

          {Boolean(pickupNote) && (
            <View className="bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mt-1.5">
              <Text className="text-amber-900 text-[11px]" numberOfLines={2}>
                <Text className="font-bold">Note: </Text>{pickupNote}
              </Text>
            </View>
          )}

          {/* Row 4: Footer — Assignee/Machine Chips & Action CTA */}
          <View className="flex-row items-center justify-between gap-2 mt-2.5 pt-2 border-t border-gray-100">
            <View className="flex-1 flex-row items-center flex-wrap gap-1.5">
              {curStage?.assignee ? (
                <TouchableOpacity
                  disabled={role !== 'supervisor' && role !== 'admin'}
                  onPress={() => {
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
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  className="flex-row items-center bg-[#994bff]/10 px-2 py-1 rounded-full border border-[#994bff]/25 active:opacity-70"
                >
                  <User size={11} color="#994bff" />
                  <Text className="text-[#994bff] font-bold text-[11px] ml-1">
                    {curStage.assigneeName ? (curStage.assigneeName.charAt(0).toUpperCase() + curStage.assigneeName.slice(1)) : 'Staff'}
                    {(role === 'supervisor' || role === 'admin') ? ' · Reassign' : ''}
                  </Text>
                </TouchableOpacity>
              ) : p ? (
                <TouchableOpacity
                  disabled={role !== 'supervisor' && role !== 'admin'}
                  onPress={() => {
                    setAssignModalData({
                      visible: true,
                      processId: p.id,
                      stepName: cur ? stepLabel(cur) : undefined,
                      orderId: item.orderId,
                      userId: order?.userId || '',
                    });
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  className="flex-row items-center bg-slate-100 px-2 py-1 rounded-full border border-slate-200 active:opacity-70"
                >
                  <Clock size={11} color="#64748B" />
                  <Text className="text-slate-600 font-bold text-[11px] ml-1">
                    {isMachine ? 'Waiting Machine' : 'Unassigned'}{(role === 'supervisor' || role === 'admin') ? ' · Assign' : ''}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  disabled={role !== 'supervisor' && role !== 'admin'}
                  onPress={() => {
                    setAssignModalData({
                      visible: true,
                      processId: item.orderId,
                      stepName: 'Tagging',
                      orderId: item.orderId,
                      userId: order?.userId || '',
                    });
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  className="flex-row items-center bg-purple-50 px-2 py-1 rounded-full border border-purple-200 active:opacity-70"
                >
                  <AlertTriangle size={11} color="#994bff" />
                  <Text className="text-[#994bff] font-bold text-[11px] ml-1">
                    New Inbound{(role === 'supervisor' || role === 'admin') ? ' · Assign' : ''}
                  </Text>
                </TouchableOpacity>
              )}

              {!!curStage?.machineName && (!isMachine || !!curStage?.startedAt) && (
                <View className="flex-row items-center bg-teal-50 px-2 py-1 rounded-full border border-teal-200">
                  <Text className="text-teal-700 font-bold text-[11px]">
                    {curStage.machineName.includes('Washer') ? '🫧 ' : curStage.machineName.includes('Dryer') ? '💨 ' : '👔 '}
                    {curStage.machineName}
                  </Text>
                </View>
              )}
            </View>

            {/* Right Action / Live Clock */}
            <View className="shrink-0">
              {isCycleDone ? (
                <TouchableOpacity
                  onPress={() => handleItemPress(item)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  className="bg-emerald-500 px-3 py-1.5 rounded-xl flex-row items-center gap-1 active:opacity-80 shadow-xs"
                >
                  <Check size={13} color="#ffffff" />
                  <Text className="text-white font-extrabold text-xs">Unload</Text>
                </TouchableOpacity>
              ) : isMine && startMs > 0 ? (
                <View className="bg-[#994bff]/10 border border-[#994bff]/20 px-2.5 py-1 rounded-xl flex-row items-center gap-1.5">
                  <View className="w-2 h-2 rounded-full bg-red-500" />
                  <LiveTimer startTimeMs={startMs} />
                </View>
              ) : !isMine && (cur === 'tagging' || !p) ? (
                <TouchableOpacity
                  onPress={() => handleItemPress(item)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  className="bg-[#994bff] px-3 py-1.5 rounded-xl active:opacity-80"
                >
                  <Text className="text-white font-bold text-xs">Start Tagging</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
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
  const headerTitle = role === 'supervisor' || role === 'admin' ? 'Floor Board' : 'My Floor Tasks';
  const cardColClass = isDesktop ? 'w-1/3 px-1.5' : isTablet ? 'w-1/2 px-1.5' : 'w-full';
  const gridRowClass = isDesktop || isTablet ? 'flex-row flex-wrap -mx-1.5' : '';
  const totalFilteredCount =
    role === 'helper'
      ? filteredMyItems.length
      : filteredMyItems.length + filteredInProgress.length + filteredPending.length;

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top']}>
      {/* Header */}
      <View className="px-6 pt-3.5 pb-2 bg-white border-b border-gray-100 z-50">
        <View style={maxContainerStyle} className="flex-row items-center justify-between">
          <Text className="text-xl font-extrabold text-gray-900">{headerTitle}</Text>
          <View className="bg-[#994bff]/10 px-3 py-1 rounded-full">
            <Text className="text-[#994bff] font-bold text-xs">{roleName}</Text>
          </View>
        </View>
      </View>

      {/* Stage Tabs */}
      <View className="bg-white pt-2.5 pb-2 border-b border-gray-100">
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
                    className={`mr-2.5 px-3.5 py-2 rounded-xl flex-row items-center ${isSel ? 'bg-[#994bff]' : 'bg-gray-100'}`}
                  >
                    <Text className={`text-sm font-bold ${isSel ? 'text-white' : 'text-gray-600'}`}>
                      {tabLabel(step)}
                    </Text>
                    {bubbleCount > 0 && (
                      <View className={`ml-2 px-1.5 py-0.5 rounded-md ${isSel ? 'bg-white/20' : 'bg-gray-200'}`}>
                        <Text className={`text-[10px] font-bold ${isSel ? 'text-white' : 'text-gray-600'}`}>
                          {bubbleCount}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          {/* Compact Search + Urgency Filter Strip */}
          <View className="px-6 pt-2.5 pb-0.5 flex-row flex-wrap items-center gap-2">
            <View className={`flex-row items-center bg-gray-100 border border-gray-200/80 rounded-xl px-2.5 py-1.5 ${isDesktop || isTablet ? 'w-72' : 'w-full'}`}>
              <Search size={14} color="#64748B" />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search #, token, customer, phone, staff…"
                placeholderTextColor="#94A3B8"
                className="flex-1 text-xs text-gray-900 ml-2 py-0.5"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity
                  onPress={() => setSearchQuery('')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <X size={14} color="#64748B" />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-1">
              <View className="flex-row items-center gap-1.5">
                <TouchableOpacity
                  onPress={() => setUrgencyFilter('all')}
                  className={`px-2.5 py-1.5 rounded-full border ${
                    urgencyFilter === 'all'
                      ? 'bg-gray-900 border-gray-900'
                      : 'bg-white border-gray-200'
                  }`}
                >
                  <Text className={`text-xs font-bold ${urgencyFilter === 'all' ? 'text-white' : 'text-gray-600'}`}>
                    All ({stageUrgencyCounts.all})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setUrgencyFilter(urgencyFilter === 'critical' ? 'all' : 'critical')}
                  className={`px-2.5 py-1.5 rounded-full border ${
                    urgencyFilter === 'critical'
                      ? 'bg-red-600 border-red-600'
                      : stageUrgencyCounts.critical > 0
                      ? 'bg-red-50 border-red-300'
                      : 'bg-white border-gray-200'
                  }`}
                >
                  <Text
                    className={`text-xs font-bold ${
                      urgencyFilter === 'critical'
                        ? 'text-white'
                        : stageUrgencyCounts.critical > 0
                        ? 'text-red-700'
                        : 'text-gray-400'
                    }`}
                  >
                    Critical/48h+ ({stageUrgencyCounts.critical})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setUrgencyFilter(urgencyFilter === 'express' ? 'all' : 'express')}
                  className={`px-2.5 py-1.5 rounded-full border ${
                    urgencyFilter === 'express'
                      ? 'bg-orange-500 border-orange-500'
                      : stageUrgencyCounts.express > 0
                      ? 'bg-orange-50 border-orange-300'
                      : 'bg-white border-gray-200'
                  }`}
                >
                  <Text
                    className={`text-xs font-bold ${
                      urgencyFilter === 'express'
                        ? 'text-white'
                        : stageUrgencyCounts.express > 0
                        ? 'text-orange-700'
                        : 'text-gray-400'
                    }`}
                  >
                    Express ({stageUrgencyCounts.express})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setUrgencyFilter(urgencyFilter === 'aging24h' ? 'all' : 'aging24h')}
                  className={`px-2.5 py-1.5 rounded-full border ${
                    urgencyFilter === 'aging24h'
                      ? 'bg-amber-500 border-amber-500'
                      : stageUrgencyCounts.aging24h > 0
                      ? 'bg-amber-50 border-amber-300'
                      : 'bg-white border-gray-200'
                  }`}
                >
                  <Text
                    className={`text-xs font-bold ${
                      urgencyFilter === 'aging24h'
                        ? 'text-white'
                        : stageUrgencyCounts.aging24h > 0
                        ? 'text-amber-800'
                        : 'text-gray-400'
                    }`}
                  >
                    Aging 24h+ ({stageUrgencyCounts.aging24h})
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </View>

      {/* List */}
      <ScrollView className="flex-1 px-4 pt-3.5" contentContainerStyle={{ paddingBottom: 170 }}>
        <View style={maxContainerStyle}>
          {filteredMyItems.length > 0 && (
            <View className="mb-4">
              <Text className="text-[#994bff] font-black text-xs mb-2.5 tracking-widest uppercase pl-1">
                My Assigned Tasks ({filteredMyItems.length})
              </Text>
              <View className={gridRowClass}>
                {filteredMyItems.map(item => (
                  <View key={item.key} className={cardColClass}>
                    {renderCard(item)}
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Section 1: Running in Machines (for getting_washed & getting_dried) or Hands-on In Progress */}
          {role !== 'helper' && filteredInProgress.length > 0 && (
            <View className="mb-4">
              <View className="flex-row items-center justify-between mb-2.5 px-1">
                <Text className="text-emerald-600 font-black text-xs tracking-widest uppercase">
                  {selected === 'getting_washed'
                    ? `🌀 In Washer (${inProgressByOthers.length}/${resources.washers} Active)`
                    : selected === 'getting_dried'
                    ? `💨 In Dryer (${inProgressByOthers.length}/${resources.dryers} Active)`
                    : `In Progress on Floor (${filteredInProgress.length})`}
                </Text>
                {selected === 'getting_washed' && inProgressByOthers.length >= resources.washers && (
                  <View className="bg-amber-100 border border-amber-200 px-2 py-0.5 rounded">
                    <Text className="text-amber-800 font-bold text-[10px] uppercase">All Washers Full</Text>
                  </View>
                )}
                {selected === 'getting_dried' && inProgressByOthers.length >= resources.dryers && (
                  <View className="bg-amber-100 border border-amber-200 px-2 py-0.5 rounded">
                    <Text className="text-amber-800 font-bold text-[10px] uppercase">All Dryers Full</Text>
                  </View>
                )}
              </View>
              <View className={gridRowClass}>
                {filteredInProgress.map(item => (
                  <View key={item.key} className={cardColClass}>
                    {renderCard(item)}
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Section 2: Queued Outside Machines / Pending Work */}
          {role !== 'helper' && filteredPending.length > 0 && (
            <View className="mb-4">
              <View className="flex-row items-center justify-between mb-2.5 px-1">
                <Text className="text-amber-600 font-black text-xs tracking-widest uppercase">
                  {selected === 'getting_washed'
                    ? `🧺 Queued for Washer (${filteredPending.length} Waiting)`
                    : selected === 'getting_dried'
                    ? `🧺 Queued for Dryer (${filteredPending.length} Waiting)`
                    : `Pending Floor Work (${filteredPending.length})`}
                </Text>
                {hasUnassignedPending && (role === 'supervisor' || role === 'admin') ? (
                  <TouchableOpacity
                    onPress={handleAutoDrain}
                    disabled={drainingQueues}
                    className="flex-row items-center bg-[#994bff]/10 border border-[#994bff]/30 px-3 py-1 rounded-full active:opacity-75"
                  >
                    {drainingQueues ? (
                      <ActivityIndicator size="small" color="#994bff" className="mr-1" />
                    ) : (
                      <Zap size={12} color="#994bff" className="mr-1" />
                    )}
                    <Text className="text-[#994bff] font-bold text-xs">
                      {drainingQueues ? 'Assigning…' : '⚡ Auto-Assign'}
                    </Text>
                  </TouchableOpacity>
                ) : selected === 'getting_washed' ? (
                  <Text className="text-slate-400 text-xs font-semibold">
                    Staged in queue · starts when washer opens
                  </Text>
                ) : selected === 'getting_dried' ? (
                  <Text className="text-slate-400 text-xs font-semibold">
                    Staged in queue · starts when dryer opens
                  </Text>
                ) : null}
              </View>
              <View className={gridRowClass}>
                {filteredPending.map(item => (
                  <View key={item.key} className={cardColClass}>
                    {renderCard(item)}
                  </View>
                ))}
              </View>
            </View>
          )}

          {totalFilteredCount === 0 && (
            <View className="items-center justify-center mt-16 px-6 opacity-75">
              <Inbox size={44} color="#94A3B8" />
              <Text className="text-gray-500 text-base font-bold mt-3">
                {hasActiveFilter ? 'No Matching Orders' : 'All Caught Up'}
              </Text>
              <Text className="text-gray-400 text-center mt-1.5 text-sm">
                {hasActiveFilter
                  ? 'Try adjusting your search or urgency filter.'
                  : role === 'helper'
                  ? 'You have no assigned tasks right now.'
                  : `No orders waiting for ${tabLabel(selected)} right now.`}
              </Text>
              {hasActiveFilter && (
                <TouchableOpacity
                  onPress={() => {
                    setSearchQuery('');
                    setUrgencyFilter('all');
                  }}
                  className="mt-3 bg-[#994bff]/10 border border-[#994bff]/30 px-4 py-1.5 rounded-full"
                >
                  <Text className="text-[#994bff] font-bold text-xs">Clear Filters</Text>
                </TouchableOpacity>
              )}
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
      silenceActiveAlerts();
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
