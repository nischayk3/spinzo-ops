import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, TouchableOpacity, TextInput, Linking, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, ChevronRight, Phone, MapPin, PackageOpen, Package, Layers, Zap, Clock, Calendar, CheckCircle2, Truck, AlertTriangle, Video, UserPlus } from 'lucide-react-native';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { useStaffRosterStore } from '../../store/staffRosterStore';
import { useOpsProcessStore } from '../../store/opsProcessStore';
import { useAuthStore } from '../../store/authStore';
import { ACTIVE_STATUSES, FeedOrder, serviceSummary, orderTotal, parseOrderTokens, matchOrderSearch, getPickupInfo, timeAgo, formatDateTime, isToday, isWithinDeliverySlot, getDeliveryTargetTimestamp, isExpressOrder } from '../../utils/orderFeed';
import { computeOrderUrgency, compareOrdersForOps, type OrderUrgencyInfo } from '../../utils/orderUrgency';
import { stepLabel, currentStep, isDone, type OpsProcess } from '../../utils/opsProcess';
import { aggregateMultiLoadOrder } from '../../utils/multiLoad';
import { AssignHelperModal } from '../../components/Supervisor/AssignHelperModal';
import { AssignRiderModal } from '../../components/Supervisor/AssignRiderModal';
import { useResponsive } from '../../utils/useResponsive';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/RootNavigator';

const STATUS_LABEL: Record<string, string> = {
  placed: 'New',
  confirmed: 'Confirmed',
  in_transit_to_store: 'In Transit',
  pickup_completed: 'At Store',
  processing: 'Processing',
  ready: 'Ready',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

// We include 'all' plus specific categories for the horizontal tabs
const FILTER_TABS = ['All', 'Action Required', 'Processing', 'Ready', 'Out for Delivery', 'Delivered', 'Cancelled'];

type QuickUrgencyFilter = 'none' | 'delayed' | 'express' | 'aging24h';

export function FloorBoardScreen() {
  const { orders, isLoading, initialize } = useOrderFeedStore();
  const roster = useStaffRosterStore(s => s.roster);
  const processes = useOpsProcessStore(s => s.processes);
  const user = useAuthStore(s => s.user);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { isDesktop, isTablet, maxContainerStyle } = useResponsive();

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const [activeTab, setActiveTab] = useState('All');
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [quickFilter, setQuickFilter] = useState<QuickUrgencyFilter>('none');

  // Assign modals state
  const [showAssignHelperModal, setShowAssignHelperModal] = useState(false);
  const [showAssignRiderModal, setShowAssignRiderModal] = useState(false);
  const [assignModalOrderId, setAssignModalOrderId] = useState('');
  const [assignModalProcessId, setAssignModalProcessId] = useState('');
  const [assignModalUserId, setAssignModalUserId] = useState('');
  const [assignModalIsDelivery, setAssignModalIsDelivery] = useState(false);
  const [assignModalStepName, setAssignModalStepName] = useState('');

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Group all ops_process docs by parent orderId for O(1) multi-load & damage lookup
  const processesByOrderId = useMemo(() => {
    const map = new Map<string, OpsProcess[]>();
    for (const proc of processes) {
      const parentId =
        proc.orderId ||
        (typeof proc.id === 'string' && proc.id.includes('__') ? proc.id.split('__')[0] : proc.id);
      if (!parentId) continue;
      const list = map.get(parentId);
      if (list) list.push(proc);
      else map.set(parentId, [proc]);
    }
    return map;
  }, [processes]);

  // Get active process for an order, if any
  const getOrderProcess = (orderId: string) =>
    (processesByOrderId.get(orderId) || []).find(p => !isDone(p));

  // Count unique pre-existing damage reports across order and all its ops_process docs
  const getDamageReportCount = (order: FeedOrder, orderProcs: OpsProcess[]): number => {
    const sources: any[][] = [];
    const orderReports = (order as any).damageReports;
    const opsDetailReports = (order as any).opsDetails?.damageReports;
    if (Array.isArray(orderReports) && orderReports.length > 0) sources.push(orderReports);
    if (Array.isArray(opsDetailReports) && opsDetailReports.length > 0) sources.push(opsDetailReports);
    for (const proc of orderProcs) {
      const procReports = (proc as any).damageReports;
      if (Array.isArray(procReports) && procReports.length > 0) sources.push(procReports);
    }
    if (sources.length === 0) return 0;

    const seen = new Set<string>();
    let count = 0;
    for (const list of sources) {
      list.forEach((r, idx) => {
        if (!r || typeof r !== 'object') {
          count += 1;
          return;
        }
        const key =
          r.id ||
          `${r.reportedAt ?? ''}|${r.reportedBy ?? ''}|${r.note ?? ''}|${Array.isArray(r.photos) ? r.photos.join(',') : ''}|${Array.isArray(r.videos) ? r.videos.join(',') : ''}`;
        const dedupeKey = key.replace(/\|/g, '') ? key : `anon-${idx}`;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          count += 1;
        }
      });
    }
    return count;
  };

  const openAssignHelper = (orderId: string, processId: string, userId: string, stepName: string) => {
    setAssignModalOrderId(orderId);
    setAssignModalProcessId(processId);
    setAssignModalUserId(userId);
    setAssignModalStepName(stepName);
    setShowAssignHelperModal(true);
  };

  const openAssignRider = (orderId: string, userId: string, isDelivery: boolean) => {
    setAssignModalOrderId(orderId);
    setAssignModalUserId(userId);
    setAssignModalIsDelivery(isDelivery);
    setShowAssignRiderModal(true);
  };

  const handleAssignHelper = async (helperId: string) => {
    const res = await useOpsProcessStore.getState().assignStepToHelper(
      assignModalOrderId, assignModalProcessId, assignModalUserId, helperId
    );
    if (!res.ok) {
      console.warn('assignStepToHelper failed:', res.error);
    }
  };

  const handleAssignRider = async (riderId: string) => {
    const res = await useOpsProcessStore.getState().assignTaskToRider(
      assignModalOrderId, assignModalUserId, riderId, assignModalIsDelivery
    );
    if (!res.ok) {
      console.warn('assignTaskToRider failed:', res.error);
    }
  };

  const parseTimeMs = (ts: any): number => {
    if (!ts) return 0;
    if (typeof ts === 'number') return ts;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    const p = new Date(ts).getTime();
    return isNaN(p) ? 0 : p;
  };

  // Last / most recent delivered order for quick access
  const lastDeliveredOrder = useMemo(() => {
    const delivered = orders.filter(o => o.status === 'delivered');
    if (delivered.length === 0) return null;
    return [...delivered].sort((a, b) => {
      const tA = parseTimeMs(a.deliveredAt || (a as any).deliveryCompletedAt || a.updatedAt || a.createdAt);
      const tB = parseTimeMs(b.deliveredAt || (b as any).deliveryCompletedAt || b.updatedAt || b.createdAt);
      return tB - tA;
    })[0];
  }, [orders]);

  // Precompute urgency telemetry for all active (non-delivered, non-cancelled) orders
  const urgencyByOrderId = useMemo(() => {
    const map = new Map<string, OrderUrgencyInfo>();
    for (const o of orders) {
      const s = String(o.status).toLowerCase();
      if (s === 'delivered' || s === 'cancelled') continue;
      map.set(o.id, computeOrderUrgency(o, nowMs));
    }
    return map;
  }, [orders, nowMs]);

  // Aging / urgency quick-filter counts across active orders
  const agingSummary = useMemo(() => {
    let delayed = 0;
    let express = 0;
    let aging24h = 0;
    for (const u of urgencyByOrderId.values()) {
      if (u.isStalled48h || u.isOverdue) delayed += 1;
      if (u.isExpress) express += 1;
      if (u.isAging24h) aging24h += 1;
    }
    return { delayed, express, aging24h };
  }, [urgencyByOrderId]);

  // Derived filtered orders
  const filteredOrders = useMemo(() => {
    let result = orders;

    // Exclude cancelled. In All view, include active orders plus recent delivered orders from today
    if (!debouncedSearch.trim() && activeTab !== 'Delivered' && activeTab !== 'Cancelled') {
      result = result.filter(o => {
        if (o.status === 'cancelled') return false;
        if (o.status === 'delivered') {
          return isToday(o.deliveredAt || (o as any).deliveryCompletedAt || o.updatedAt || o.createdAt);
        }
        return true;
      });
    }

    // Apply Express / Urgent filter
    if (urgentOnly) {
      result = result.filter(o => o.isUrgent || isExpressOrder(o));
    }

    // Apply Aging / Urgency quick filter pill (active orders only)
    if (quickFilter !== 'none' && activeTab !== 'Delivered' && activeTab !== 'Cancelled') {
      result = result.filter(o => {
        const u = urgencyByOrderId.get(o.id);
        if (!u) return false;
        if (quickFilter === 'delayed') return u.isStalled48h || u.isOverdue;
        if (quickFilter === 'express') return u.isExpress || Boolean(o.isUrgent);
        if (quickFilter === 'aging24h') return u.isAging24h;
        return true;
      });
    }

    // Apply Search
    if (debouncedSearch.trim()) {
      result = result.filter(o => matchOrderSearch(o, debouncedSearch));
    }

    // Apply Tab Filter & Ops-Aware Time/Priority Sorting
    const tabKey = activeTab.toLowerCase();
    const isTerminal = (o: FeedOrder) => {
      const s = String(o.status).toLowerCase();
      return s === 'delivered' || s === 'cancelled';
    };

    if (activeTab === 'Action Required') {
      result = result
        .filter(o => ['placed', 'confirmed', 'in_transit_to_store', 'pickup_completed'].includes(String(o.status).toLowerCase()))
        .sort((a, b) => compareOrdersForOps(a, b, 'pickup_schedule', nowMs));
    } else if (activeTab === 'Processing') {
      result = result
        .filter(o => String(o.status).toLowerCase() === 'processing')
        .sort((a, b) => compareOrdersForOps(a, b, 'ops_fifo', nowMs));
    } else if (activeTab === 'Ready') {
      result = result
        .filter(o => String(o.status).toLowerCase() === 'ready')
        .sort((a, b) => compareOrdersForOps(a, b, 'delivery_schedule', nowMs));
    } else if (activeTab === 'Out for Delivery') {
      result = result
        .filter(o => String(o.status).toLowerCase() === 'out_for_delivery')
        .sort((a, b) => compareOrdersForOps(a, b, 'delivery_schedule', nowMs));
    } else if (activeTab === 'Delivered') {
      result = result
        .filter(o => String(o.status).toLowerCase() === 'delivered')
        .sort((a, b) => {
          const tA = parseTimeMs(a.deliveredAt || (a as any).deliveryCompletedAt || a.updatedAt || a.createdAt);
          const tB = parseTimeMs(b.deliveredAt || (b as any).deliveryCompletedAt || b.updatedAt || b.createdAt);
          return tB - tA;
        });
    } else if (activeTab === 'Cancelled') {
      result = result.filter(o => String(o.status).toLowerCase() === 'cancelled');
    } else if (['placed', 'confirmed', 'action_required', 'scheduled', 'tomorrow'].includes(tabKey)) {
      result = [...result].sort((a, b) => compareOrdersForOps(a, b, 'pickup_schedule', nowMs));
    } else {
      // In-Store Ops / All view: active orders sorted via ops_fifo (48h+ stalled & overdue at top), terminal orders below
      result = [...result].sort((a, b) => {
        const aTerm = isTerminal(a);
        const bTerm = isTerminal(b);
        if (aTerm !== bTerm) return aTerm ? 1 : -1;
        if (aTerm && bTerm) {
          const tA = parseTimeMs(a.deliveredAt || (a as any).deliveryCompletedAt || a.updatedAt || a.createdAt);
          const tB = parseTimeMs(b.deliveredAt || (b as any).deliveryCompletedAt || b.updatedAt || b.createdAt);
          return tB - tA;
        }
        return compareOrdersForOps(a, b, 'ops_fifo', nowMs);
      });
    }

    return result;
  }, [orders, debouncedSearch, activeTab, urgentOnly, quickFilter, urgencyByOrderId, nowMs]);

  if (isLoading && orders.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 items-center justify-center">
        <ActivityIndicator size="large" color="#994bff" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View style={maxContainerStyle} className="flex-1">
        {/* Header */}
        <View className="px-6 pt-4 pb-2 flex-row items-center justify-between flex-wrap gap-2">
          <View>
            <Text className="text-2xl font-black text-gray-900">Orders Database</Text>
            <Text className="text-gray-500 text-sm mt-0.5">Manage and track all store orders ({filteredOrders.length} showing)</Text>
          </View>

          {/* Express / Urgent Filter Toggle */}
          <TouchableOpacity
            onPress={() => setUrgentOnly(!urgentOnly)}
            className={`px-3 py-1.5 rounded-full border flex-row items-center ${
              urgentOnly ? 'bg-orange-600 border-orange-600' : 'bg-orange-50 border-orange-300'
            }`}
          >
            <Zap size={14} color={urgentOnly ? '#fff' : '#ea580c'} className="mr-1" />
            <Text className={`font-bold text-xs ${urgentOnly ? 'text-white' : 'text-orange-800'}`}>
              Express / Urgent
            </Text>
          </TouchableOpacity>
        </View>

        {/* Search Bar */}
        <View className="px-6 mb-3">
          <View className="flex-row items-center bg-white rounded-2xl px-4 h-12 border border-gray-200 shadow-xs">
            <Search size={18} color="#94a3b8" />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search by Token #, Order ID, Phone, Customer..."
              placeholderTextColor="#94a3b8"
              className="flex-1 h-full px-3 text-gray-900 font-medium text-sm"
              autoCapitalize="none"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} className="p-1">
                <Text className="text-gray-400 font-bold text-xs">Clear</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Filter Tabs */}
        <View className="mb-2.5">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, gap: 8 }}>
            {FILTER_TABS.map(tab => {
              const isActive = activeTab === tab;
              return (
                <TouchableOpacity
                  key={tab}
                  onPress={() => setActiveTab(tab)}
                  className={`px-4 py-2 rounded-full border ${isActive ? 'bg-[#994bff] border-[#994bff]' : 'bg-white border-gray-200'}`}
                >
                  <Text className={`font-bold text-xs ${isActive ? 'text-white' : 'text-gray-600'}`}>{tab}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Aging / Urgency Quick-Filter Summary Strip */}
        {activeTab !== 'Delivered' && activeTab !== 'Cancelled' &&
          (agingSummary.delayed > 0 || agingSummary.express > 0 || agingSummary.aging24h > 0) && (
          <View className="mb-2.5">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, gap: 6 }}>
              {agingSummary.delayed > 0 && (
                <TouchableOpacity
                  onPress={() => setQuickFilter(prev => prev === 'delayed' ? 'none' : 'delayed')}
                  className={`px-2.5 py-1 rounded-full border flex-row items-center ${
                    quickFilter === 'delayed'
                      ? 'bg-red-600 border-red-600'
                      : 'bg-red-50 border-red-200'
                  }`}
                >
                  <Text className={`text-[11px] font-extrabold ${
                    quickFilter === 'delayed' ? 'text-white' : 'text-red-700'
                  }`}>
                    🔴 {agingSummary.delayed} Overdue/48h+
                  </Text>
                </TouchableOpacity>
              )}
              {agingSummary.express > 0 && (
                <TouchableOpacity
                  onPress={() => setQuickFilter(prev => prev === 'express' ? 'none' : 'express')}
                  className={`px-2.5 py-1 rounded-full border flex-row items-center ${
                    quickFilter === 'express'
                      ? 'bg-orange-600 border-orange-600'
                      : 'bg-orange-50 border-orange-200'
                  }`}
                >
                  <Text className={`text-[11px] font-extrabold ${
                    quickFilter === 'express' ? 'text-white' : 'text-orange-800'
                  }`}>
                    ⚡ {agingSummary.express} Express
                  </Text>
                </TouchableOpacity>
              )}
              {agingSummary.aging24h > 0 && (
                <TouchableOpacity
                  onPress={() => setQuickFilter(prev => prev === 'aging24h' ? 'none' : 'aging24h')}
                  className={`px-2.5 py-1 rounded-full border flex-row items-center ${
                    quickFilter === 'aging24h'
                      ? 'bg-amber-600 border-amber-600'
                      : 'bg-amber-50 border-amber-200'
                  }`}
                >
                  <Text className={`text-[11px] font-extrabold ${
                    quickFilter === 'aging24h' ? 'text-white' : 'text-amber-800'
                  }`}>
                    ⏳ {agingSummary.aging24h} {'>'}24h
                  </Text>
                </TouchableOpacity>
              )}
              {quickFilter !== 'none' && (
                <TouchableOpacity
                  onPress={() => setQuickFilter('none')}
                  className="px-2.5 py-1 rounded-full border bg-gray-100 border-gray-300 flex-row items-center"
                >
                  <Text className="text-[11px] font-bold text-gray-600">Clear</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        )}

        {/* Quick Last Delivered Order Banner */}
        {lastDeliveredOrder && activeTab === 'All' && !searchQuery.trim() && (
          <TouchableOpacity
            onPress={() => navigation.navigate('OrderDetail', { orderId: lastDeliveredOrder.id })}
            className="mx-6 mb-3.5 bg-emerald-50 border border-emerald-300 rounded-2xl p-3 flex-row items-center justify-between shadow-2xs active:bg-emerald-100/70"
          >
            <View className="flex-row items-center flex-1 mr-2">
              <View className="w-8 h-8 rounded-full bg-emerald-600 items-center justify-center mr-2.5">
                <CheckCircle2 size={16} color="#ffffff" />
              </View>
              <View className="flex-1">
                <View className="flex-row items-center gap-1.5 flex-wrap">
                  <Text className="text-emerald-950 font-black text-xs uppercase tracking-wider">Recent Delivered:</Text>
                  <Text className="text-emerald-900 font-black text-xs">
                    #{lastDeliveredOrder.id.slice(-6).toUpperCase()}
                  </Text>
                  <Text className="text-emerald-700 text-xs font-semibold" numberOfLines={1}>
                    • {lastDeliveredOrder.customerName || 'Customer'}
                  </Text>
                </View>
                <Text className="text-emerald-700 text-[11px] font-medium mt-0.5">
                  {lastDeliveredOrder.deliveredAt ? `Delivered ${timeAgo(lastDeliveredOrder.deliveredAt)}` : 'Delivered recently'} • Rider: {lastDeliveredOrder.riderName || 'Hrithik'}
                </Text>
              </View>
            </View>
            <View className="bg-emerald-600 px-3 py-1 rounded-xl">
              <Text className="text-white text-[10px] font-black uppercase tracking-wider">View</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Orders List / 2-Column Desktop Grid */}
        <FlatList
          key={isDesktop ? 'desktop-grid' : 'mobile-list'}
          data={filteredOrders}
          keyExtractor={o => o.id}
          numColumns={isDesktop ? 2 : 1}
          className="flex-1 px-4"
          contentContainerStyle={{ paddingBottom: 32 }}
          ListEmptyComponent={
            <View className="items-center justify-center py-20">
              <PackageOpen size={48} color="#cbd5e1" />
              <Text className="text-gray-400 font-medium mt-4">No orders found.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const statusColor =
              item.status === 'ready' ? 'bg-green-100 text-green-700' :
              item.status === 'out_for_delivery' ? 'bg-orange-100 text-orange-700' :
              item.status === 'processing' ? 'bg-blue-100 text-blue-700' :
              item.status === 'pickup_completed' ? 'bg-purple-100 text-purple-700' :
              'bg-gray-100 text-gray-700';

            const tokenChips = parseOrderTokens(item.tokens, item.tokenNumber, item.items);
            const orderProcs = processesByOrderId.get(item.id) || [];
            const aggregated = aggregateMultiLoadOrder(item, orderProcs);
            const garmentCount = aggregated.totalGarments;
            const bundleCount = aggregated.totalBundles;
            const hasVideoProof =
              aggregated.videos.length > 0 ||
              Boolean((item as any).packagingProof?.videoUrl || (item as any).opsDetails?.packagingProof?.videoUrl);
            const damageReportCount = getDamageReportCount(item, orderProcs);
            const isExpress = isExpressOrder(item);
            const isActiveOrder = item.status !== 'delivered' && item.status !== 'cancelled';
            const urgency = isActiveOrder ? (urgencyByOrderId.get(item.id) ?? computeOrderUrgency(item, nowMs)) : null;
            const isDelayed = Boolean(urgency && (urgency.isStalled48h || urgency.isOverdue));

            const slaPillStyle = !urgency
              ? null
              : urgency.isStalled48h || urgency.isOverdue
                ? { container: 'bg-red-100 border-red-300', text: 'text-red-700' }
                : urgency.severity === 'high' || urgency.severity === 'medium'
                  ? { container: 'bg-amber-100 border-amber-300', text: 'text-amber-800' }
                  : { container: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' };

            const cardBorderClass = isDelayed
              ? isExpress
                ? 'bg-red-50/20 border-2 border-red-400'
                : 'bg-red-50/20 border border-red-300 border-l-4 border-l-red-500'
              : isExpress
                ? 'bg-orange-50/30 border-2 border-orange-500'
                : 'bg-white border border-gray-200/90';

            return (
              <TouchableOpacity
                onPress={() => navigation.navigate('OrderDetail', { orderId: item.id })}
                className={`rounded-2xl mb-2 overflow-hidden shadow-xs active:opacity-90 ${cardBorderClass} ${isDesktop ? 'flex-1 m-1.5' : ''}`}
              >
                {isExpress && (
                  <View className={`${isDelayed ? 'bg-red-600' : 'bg-orange-600'} px-3 py-1 flex-row items-center justify-between`}>
                    <View className="flex-row items-center gap-1">
                      <Zap size={11} color="#ffffff" />
                      <Text className="text-white font-black text-[10px] uppercase tracking-wider">
                        EXPRESS ORDER • 6–8H URGENT SLA
                      </Text>
                    </View>
                    <Text className={`${isDelayed ? 'text-red-100' : 'text-orange-100'} font-extrabold text-[9px] uppercase`}>
                      {urgency?.isStalled48h ? '48H+ STALLED' : urgency?.isOverdue ? 'OVERDUE' : 'CATER IMMEDIATELY'}
                    </Text>
                  </View>
                )}

                <View className="p-3">
                {/* Header: ID, Tokens, Multi-Load, Damage, Urgency, Status */}
                <View className="flex-row items-center justify-between mb-1.5">
                  <View className="flex-row items-center flex-wrap gap-1.5 flex-1 mr-2">
                    <Text className="text-gray-900 font-black text-[15px] tracking-tight">
                      #{item.id.slice(-6).toUpperCase()}
                    </Text>
                    {isExpress && (
                      <View className="bg-orange-100 border border-orange-400 px-1.5 py-0.5 rounded-full flex-row items-center gap-0.5">
                        <Zap size={10} color="#c2410c" />
                        <Text className="text-orange-800 text-[10px] font-black uppercase">EXPRESS 6-8H</Text>
                      </View>
                    )}
                    {item.isUrgent && !isExpress && (
                      <View className="bg-red-500/15 border border-red-500/40 px-1.5 py-0.5 rounded-full flex-row items-center gap-0.5">
                        <Zap size={10} color="#ef4444" />
                        <Text className="text-red-600 text-[10px] font-black uppercase">URGENT</Text>
                      </View>
                    )}
                    {aggregated.isMultiLoad && (
                      <View className="bg-indigo-100 border border-indigo-300 px-1.5 py-0.5 rounded-md flex-row items-center gap-1">
                        <Layers size={10} color="#4338ca" />
                        <Text className="text-indigo-800 font-extrabold text-[10px] uppercase">
                          {aggregated.loadCount} Loads
                        </Text>
                      </View>
                    )}
                    {damageReportCount > 0 && (
                      <View className="bg-rose-100 border border-rose-300 px-1.5 py-0.5 rounded-md flex-row items-center gap-1">
                        <AlertTriangle size={10} color="#be123c" />
                        <Text className="text-rose-800 font-extrabold text-[10px] uppercase">
                          {damageReportCount > 1 ? `Damage (${damageReportCount})` : 'Damage'}
                        </Text>
                      </View>
                    )}
                    {tokenChips.map((c, i) => (
                      <View key={i} className="bg-amber-100 border border-amber-300 px-1.5 py-0.5 rounded-md flex-row items-center">
                        <Text className="text-amber-900 font-extrabold text-[10px]">T-{c.token}</Text>
                      </View>
                    ))}
                    {hasVideoProof && (
                      <View className="bg-purple-100 border border-purple-300 px-1.5 py-0.5 rounded-md flex-row items-center gap-0.5">
                        <Video size={9} color="#7e22ce" />
                        <Text className="text-purple-800 font-extrabold text-[10px]">
                          {aggregated.videos.length > 1 ? `VIDEO (${aggregated.videos.length})` : 'VIDEO'}
                        </Text>
                      </View>
                    )}
                    {['placed', 'confirmed'].includes(item.status) && (() => {
                      const pInfo = getPickupInfo(item);
                      return (
                        <View className={`px-2 py-0.5 rounded-full border flex-row items-center gap-0.5 ${
                          pInfo.isInstant ? 'bg-amber-100/90 border-amber-300' : 'bg-blue-50 border-blue-200'
                        }`}>
                          {pInfo.isInstant ? (
                            <Zap size={9} color="#b45309" />
                          ) : (
                            <Calendar size={9} color="#1d4ed8" />
                          )}
                          <Text className={`text-[10px] font-black uppercase ${
                            pInfo.isInstant ? 'text-amber-900' : 'text-blue-900'
                          }`}>
                            {pInfo.isInstant ? 'Instant' : (pInfo.dateLabel || 'Scheduled')}
                          </Text>
                        </View>
                      );
                    })()}
                  </View>

                  <View className="flex-row items-center shrink-0">
                    <View className={`px-2 py-0.5 rounded-full mr-1.5 ${statusColor.split(' ')[0]}`}>
                      <Text className={`text-[11px] font-bold ${statusColor.split(' ')[1]}`}>
                        {STATUS_LABEL[item.status] || item.status}
                      </Text>
                    </View>
                    <ChevronRight size={16} color="#94a3b8" />
                  </View>
                </View>

                {/* Pickup & SLA Telemetry Row (Active Orders) */}
                {urgency && (
                  <View className={`flex-row items-center justify-between flex-wrap gap-1.5 mb-1.5 rounded-lg px-2 py-1 border ${
                    isDelayed ? 'bg-red-50/80 border-red-200' : 'bg-gray-50/90 border-gray-100'
                  }`}>
                    <View className="flex-row items-center gap-1 flex-1 min-w-0">
                      <Clock size={10} color={isDelayed ? '#dc2626' : '#64748b'} />
                      <Text
                        className={`text-[11px] font-semibold ${isDelayed ? 'text-red-700' : 'text-gray-600'}`}
                        numberOfLines={1}
                      >
                        {urgency.isActualPickup ? 'Picked' : 'Placed'}: {urgency.pickedUpShort}
                        {urgency.pickedUpMs !== null ? ` (${urgency.ageLabel})` : ''}
                      </Text>
                    </View>
                    {urgency.slaLabel !== '—' && slaPillStyle && (
                      <View className={`px-1.5 py-0.5 rounded-md border ${slaPillStyle.container}`}>
                        <Text className={`text-[10px] font-black uppercase ${slaPillStyle.text}`}>
                          {urgency.isStalled48h ? '48h+ STALLED' : urgency.slaLabel}
                        </Text>
                      </View>
                    )}
                  </View>
                )}

                {/* Customer, Phone, Total & Payment */}
                <View className="flex-row items-start justify-between mb-1.5">
                  <View className="flex-1 mr-4">
                    <Text className="text-gray-900 font-bold text-sm mb-0.5" numberOfLines={1}>
                      {item.customerName || 'Unknown Customer'}
                    </Text>
                    {item.customerPhone ? (
                      <TouchableOpacity
                        onPress={(e) => {
                          e?.stopPropagation?.();
                          Linking.openURL(`tel:${item.customerPhone}`);
                        }}
                        className="flex-row items-center self-start py-0.5 gap-1"
                      >
                        <Phone size={11} color="#994bff" />
                        <Text className="text-primary font-semibold text-xs">{item.customerPhone}</Text>
                      </TouchableOpacity>
                    ) : null}
                    {item.address?.formattedAddress ? (
                      <View className="flex-row items-start mt-0.5">
                        <MapPin size={11} color="#94a3b8" className="mt-0.5 shrink-0" />
                        <Text className="text-gray-500 text-xs ml-1 flex-1" numberOfLines={1}>{item.address.formattedAddress}</Text>
                      </View>
                    ) : null}
                  </View>

                  <View className="items-end shrink-0">
                    <Text className="text-gray-900 font-black text-base">
                      {orderTotal(item) > 0 ? `₹${orderTotal(item)}` : '—'}
                    </Text>
                    <Text className="text-gray-400 text-[10px] font-bold uppercase mt-0.5">
                      {item.paymentStatus || 'Pending'}
                    </Text>
                  </View>
                </View>

                {/* Service & Stage Ribbon */}
                <View className="bg-gray-50 rounded-xl p-2.5 flex-row justify-between items-center border border-gray-100 mb-1.5">
                  <View className="flex-1 mr-2">
                    <Text className="text-gray-400 text-[10px] uppercase tracking-wider font-extrabold">Services</Text>
                    <Text className="text-gray-800 font-semibold text-xs mt-0.5" numberOfLines={1}>
                      {serviceSummary(item)}
                    </Text>
                    {((garmentCount !== null && garmentCount > 0) || (bundleCount !== null && bundleCount > 0)) && (
                      <View className="flex-row items-center flex-wrap gap-1.5 mt-1">
                        {garmentCount !== null && garmentCount > 0 && (
                          <View className="bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded flex-row items-center">
                            <Text className="text-primary text-[10px] font-extrabold">
                              👕 {garmentCount} {garmentCount === 1 ? 'Garment' : 'Garments'}
                            </Text>
                          </View>
                        )}
                        {bundleCount !== null && bundleCount > 0 && (
                          <View className="bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded flex-row items-center gap-0.5">
                            <Package size={10} color="#475569" />
                            <Text className="text-slate-700 text-[10px] font-extrabold">
                              {bundleCount} {bundleCount === 1 ? 'Bundle' : 'Bundles'}
                            </Text>
                          </View>
                        )}
                      </View>
                    )}
                  </View>

                  {item.status === 'processing' && item.processingStep && (() => {
                    const proc = getOrderProcess(item.id);
                    const cur = proc ? currentStep(proc) : null;
                    const curStg = cur && proc?.stages?.[cur] ? (proc.stages[cur] as any) : null;
                    const assigneeName: string | undefined = curStg?.assigneeName;
                    return (
                      <View className="items-end">
                        <Text className="text-gray-400 text-[10px] uppercase tracking-wider font-extrabold">Floor Step</Text>
                        <View className="flex-row items-center gap-1 mt-0.5">
                          <View className="bg-blue-100 px-2 py-0.5 rounded">
                            <Text className="text-blue-800 font-bold text-xs">
                              {stepLabel(item.processingStep)}
                            </Text>
                          </View>
                        </View>
                        {assigneeName && proc && cur ? (
                          <TouchableOpacity
                            onPress={() => openAssignHelper(item.id, proc.id, item.userId, cur)}
                            className="flex-row items-center gap-1 mt-1 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded active:bg-purple-100"
                          >
                            <UserPlus size={10} color="#994bff" />
                            <Text className="text-purple-800 font-bold text-[10px]">{assigneeName}</Text>
                          </TouchableOpacity>
                        ) : proc && cur ? (
                          <TouchableOpacity
                            onPress={() => openAssignHelper(item.id, proc.id, item.userId, cur)}
                            className="flex-row items-center gap-1 mt-1 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded active:bg-amber-100"
                          >
                            <UserPlus size={10} color="#d97706" />
                            <Text className="text-amber-800 font-bold text-[10px]">Assign Helper</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    );
                  })()}

                  {['placed', 'confirmed', 'in_transit_to_store'].includes(item.status) && (() => {
                    const pInfo = getPickupInfo(item);
                    return (
                      <View className="items-end">
                        <View className="flex-row items-center gap-1">
                          {pInfo.isInstant ? (
                            <Zap size={9} color="#b45309" />
                          ) : (
                            <Calendar size={9} color="#1d4ed8" />
                          )}
                          <Text className={`text-[10px] uppercase tracking-wider font-extrabold ${
                            pInfo.isInstant ? 'text-amber-800' : 'text-blue-800'
                          }`}>
                            {pInfo.isInstant ? 'Instant Pickup' : 'Pickup Slot'}
                          </Text>
                        </View>
                        <Text className={`font-bold text-xs mt-0.5 ${
                          pInfo.isInstant ? 'text-amber-700' : 'text-blue-700'
                        }`}>
                          {pInfo.isInstant
                            ? (pInfo.timeLabel || 'Within 30–45m')
                            : `${pInfo.dateLabel ? `${pInfo.dateLabel}, ` : ''}${pInfo.timeLabel || 'Scheduled'}`}
                        </Text>
                      </View>
                    );
                  })()}

                  {(item.status === 'ready' || item.status === 'out_for_delivery') && (() => {
                    const riderUid = (item as any).deliveryRiderId || item.riderId;
                    const rObj = riderUid ? roster.riders.find(r => r.uid === riderUid) : null;
                    const riderName = (item as any).deliveryRiderName || rObj?.name || (item as any).riderName;
                    const isReady = item.status === 'ready';
                    const inSlot = isWithinDeliverySlot(item);
                    const deliveryTimeStr = item.deliveryDate
                      ? `${item.deliveryDate}${item.deliveryTime ? `, ${item.deliveryTime}` : ''}`
                      : null;

                    return (
                      <View className="items-end gap-1">
                        {/* Ready timestamp */}
                        {isReady && item.readyAt && (
                          <View className="flex-row items-center">
                            <Clock size={10} color="#059669" className="mr-0.5" />
                            <Text className="text-emerald-700 font-bold text-[10px]">
                              Ready {timeAgo(item.readyAt)}
                            </Text>
                          </View>
                        )}

                        {/* Highlighted Delivery Slot — most prominent info */}
                        {deliveryTimeStr ? (
                          <View className={`px-2 py-1 rounded-lg border flex-row items-center ${
                            inSlot
                              ? 'bg-emerald-100 border-emerald-400 shadow-xs'
                              : 'bg-blue-50 border-blue-200'
                          }`}>
                            <Calendar size={9} color={inSlot ? '#059669' : '#1d4ed8'} className="mr-1" />
                            <Text className={`font-extrabold text-[11px] ${
                              inSlot ? 'text-emerald-900' : 'text-blue-900'
                            }`}>
                              {inSlot ? '🔔 ' : ''}{deliveryTimeStr}
                            </Text>
                          </View>
                        ) : (
                          <View className="bg-amber-50 border border-amber-300 px-2 py-0.5 rounded">
                            <Text className="text-amber-800 font-bold text-[10px]">Awaiting Slot</Text>
                          </View>
                        )}

                        {/* Delivery Rider Assignment - tappable for reassign */}
                        {riderName ? (
                          <TouchableOpacity
                            onPress={() => openAssignRider(item.id, item.userId, true)}
                            className="bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded flex-row items-center active:bg-blue-100"
                          >
                            <Truck size={9} color="#1d4ed8" className="mr-0.5" />
                            <Text className="text-blue-800 font-extrabold text-[10px]">{riderName}</Text>
                          </TouchableOpacity>
                        ) : isReady ? (
                          <TouchableOpacity
                            onPress={() => openAssignRider(item.id, item.userId, true)}
                            className="bg-amber-50 border border-amber-300 px-1.5 py-0.5 rounded flex-row items-center active:bg-amber-100"
                          >
                            <UserPlus size={9} color="#d97706" className="mr-0.5" />
                            <Text className="text-amber-800 font-extrabold text-[10px]">Assign Rider</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    );
                  })()}

                  {item.status === 'delivered' && (() => {
                    const riderUid = (item as any).deliveryRiderId || item.riderId;
                    const rObj = riderUid ? roster.riders.find(r => r.uid === riderUid) : null;
                    const riderName = (item as any).deliveryRiderName || rObj?.name || (item as any).riderName;
                    const delTime = formatDateTime(item.deliveredAt || (item as any).deliveryCompletedAt || (item as any).updatedAt);

                    return (
                      <View className="items-end gap-1">
                        <View className="bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded flex-row items-center">
                          <CheckCircle2 size={10} color="#059669" className="mr-1" />
                          <Text className="text-emerald-900 font-black text-[10px]">DELIVERED</Text>
                        </View>
                        {delTime ? (
                          <Text className="text-emerald-700 font-bold text-[10px]">{delTime}</Text>
                        ) : null}
                        {riderName ? (
                          <View className="flex-row items-center">
                            <Truck size={9} color="#475569" className="mr-1" />
                            <Text className="text-gray-600 font-semibold text-[10px]">{riderName}</Text>
                          </View>
                        ) : null}
                      </View>
                    );
                  })()}
                </View>

                {/* Pickup / Staff Footer */}
                {(item.pickupNote || (item as any).opsMeta?.pickupNote) ? (
                  <View className="bg-amber-50 border border-amber-300 rounded-xl p-2 mt-1.5">
                    <Text className="text-amber-800 text-xs">
                      <Text className="font-bold">📝 Note: </Text>{item.pickupNote || (item as any).opsMeta?.pickupNote}
                    </Text>
                  </View>
                ) : null}
                </View>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      <AssignHelperModal
        visible={showAssignHelperModal}
        onClose={() => setShowAssignHelperModal(false)}
        onAssign={handleAssignHelper}
        processId={assignModalProcessId}
        stepName={assignModalStepName}
      />
      <AssignRiderModal
        visible={showAssignRiderModal}
        onClose={() => setShowAssignRiderModal(false)}
        onAssign={handleAssignRider}
        orderId={assignModalOrderId}
        isDelivery={assignModalIsDelivery}
      />
    </SafeAreaView>
  );
}
