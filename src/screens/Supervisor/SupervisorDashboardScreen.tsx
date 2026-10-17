import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, TextInput, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { 
  Search, ChevronRight, Truck, Users, AlertTriangle, IndianRupee, Timer, X, Zap,
  Phone, Clock, ArrowRight, ShieldCheck, Flame, RefreshCw, CheckCircle2, PackageOpen, Tag,
  WashingMachine, Sparkles, Filter, Layers, ArrowUpRight
} from 'lucide-react-native';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { useAuthStore } from '../../store/authStore';
import { useStaffRosterStore, StaffMember } from '../../store/staffRosterStore';
import { useOpsProcessStore } from '../../store/opsProcessStore';
import { useStoreResourcesStore } from '../../store/storeResourcesStore';
import { dayRevenue, orderTotal, parseOrderTokens, matchOrderSearch, serviceSummary, isToday, timeAgo } from '../../utils/orderFeed';
import { announceSkippedOrder } from '../../utils/alerts';
import { stepLabel, currentStep, isDone } from '../../utils/opsProcess';
import { useResponsive } from '../../utils/useResponsive';
import { useNavigation } from '@react-navigation/native';
import { SupervisorRiderRouteModal } from '../../components/Supervisor/SupervisorRiderRouteModal';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import type { FeedOrder } from '../../utils/orderFeed';

const formatStaffName = (name?: string, fallback = 'Staff'): string => {
  if (!name) return fallback;
  return name.charAt(0).toUpperCase() + name.slice(1);
};

export function SupervisorDashboardScreen() {
  const { orders, initialize } = useOrderFeedStore();
  const processes = useOpsProcessStore(s => s.processes);
  const user = useAuthStore(s => s.user);
  const { roster } = useStaffRosterStore();
  const resources = useStoreResourcesStore(s => s.resources);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { isWideDesktop, isDesktop, isTablet, maxContainerStyle } = useResponsive();

  const [searchQuery, setSearchQuery] = useState('');
  const [inboundFilter, setInboundFilter] = useState<'all' | 'urgent' | 'transit' | 'tagging'>('all');
  const [selectedRosterRider, setSelectedRosterRider] = useState<StaffMember | null>(null);

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Inbound queue = orders waiting for pickup or in transit or ready to tag
  const inbound = useMemo(() => {
    return orders
      .filter(o => (o.status === 'placed' || o.status === 'confirmed' || o.status === 'in_transit_to_store' || o.status === 'pickup_completed'))
      .sort((a, b) => {
        // Urgent first
        if (a.isUrgent && !b.isUrgent) return -1;
        if (!a.isUrgent && b.isUrgent) return 1;
        const aMs = (a.createdAt as any)?.toMillis ? (a.createdAt as any).toMillis() : new Date((a.createdAt as any) || Date.now()).getTime();
        const bMs = (b.createdAt as any)?.toMillis ? (b.createdAt as any).toMillis() : new Date((b.createdAt as any) || Date.now()).getTime();
        return bMs - aMs;
      });
  }, [orders]);

  // Deduplicated alerts for skipped orders
  useEffect(() => {
    if (user?.role === 'supervisor') {
      inbound.forEach(o => { 
        if (o.status === 'placed' || o.status === 'confirmed') { 
          announceSkippedOrder(o.id); 
        } 
      });
    }
  }, [inbound.length]);

  const stats = useMemo(() => dayRevenue(orders), [orders]);

  const urgentOrders = useMemo(() => {
    return orders.filter(o => o.isUrgent && o.status !== 'delivered' && o.status !== 'cancelled');
  }, [orders]);

  const processingOrdersCount = useMemo(() => {
    return orders.filter(o => o.status === 'processing').length;
  }, [orders]);

  const readyOrdersCount = useMemo(() => {
    return orders.filter(o => o.status === 'ready').length;
  }, [orders]);

  const outForDeliveryOrdersCount = useMemo(() => {
    return orders.filter(o => o.status === 'out_for_delivery').length;
  }, [orders]);

  const [searchResults, setSearchResults] = useState<any[]>([]);
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    setSearchResults(orders.filter(o => matchOrderSearch(o, searchQuery)).slice(0, 16));
  }, [searchQuery, orders]);

  const filteredInbound = useMemo(() => {
    if (inboundFilter === 'urgent') return inbound.filter(o => o.isUrgent);
    if (inboundFilter === 'transit') return inbound.filter(o => o.status === 'in_transit_to_store');
    if (inboundFilter === 'tagging') return inbound.filter(o => o.status === 'pickup_completed');
    return inbound;
  }, [inbound, inboundFilter]);

  // Helper token identifier: prefers Token # (e.g. T-65, T-17), falls back to order shortId (#ATIWMR)
  const getOrderTokenTag = (orderId: string, processToken?: string) => {
    const o = orders.find(ord => ord.id === orderId);
    const chips = parseOrderTokens(o?.tokens, o?.tokenNumber || processToken, o?.items);
    if (chips.length > 0) {
      return chips.map(c => `T-${c.token}`).join(', ');
    }
    if (processToken && String(processToken).trim()) {
      const clean = String(processToken).trim().toUpperCase();
      return clean.startsWith('T-') ? clean : `T-${clean}`;
    }
    return `#${orderId.slice(-6).toUpperCase()}`;
  };

  // Helper live task sync: checks processes for active stages assigned to helper
  const getHelperLiveTask = (h: StaffMember) => {
    // 1. Check currently active floor stage
    for (const p of processes) {
      if (isDone(p)) continue;
      const cur = currentStep(p);
      if (!cur) continue;
      const s = p.stages[cur];
      if (!s || s.completedAt) continue;

      const isMatch = (s.assignee && s.assignee === h.uid) ||
                      (s.assigneeName && h.name && s.assigneeName.trim().toLowerCase() === h.name.trim().toLowerCase()) ||
                      (h.phone && (s as any).assigneePhone === h.phone);

      if (isMatch) {
        return {
          step: cur,
          label: stepLabel(cur),
          orderId: p.orderId,
          shortId: p.orderId.slice(-6).toUpperCase(),
          tokenTag: getOrderTokenTag(p.orderId, p.tokenNumber),
        };
      }
    }

    // 2. Check any stage in incomplete process with helper assigned
    for (const p of processes) {
      if (isDone(p)) continue;
      for (const [stepKey, s] of Object.entries(p.stages || {})) {
        if (!s || s.completedAt) continue;
        const isMatch = (s.assignee && s.assignee === h.uid) ||
                        (s.assigneeName && h.name && s.assigneeName.trim().toLowerCase() === h.name.trim().toLowerCase()) ||
                        (h.phone && (s as any).assigneePhone === h.phone);
        if (isMatch) {
          return {
            step: stepKey,
            label: stepLabel(stepKey),
            orderId: p.orderId,
            shortId: p.orderId.slice(-6).toUpperCase(),
            tokenTag: getOrderTokenTag(p.orderId, p.tokenNumber),
          };
        }
      }
    }

    // 3. Fallback: ops_staff activeHelperTask
    if (h.activeHelperTask) {
      return {
        step: h.activeHelperTask.step,
        label: stepLabel(h.activeHelperTask.step),
        orderId: h.activeHelperTask.orderId,
        shortId: h.activeHelperTask.orderId ? h.activeHelperTask.orderId.slice(-6).toUpperCase() : '',
        tokenTag: getOrderTokenTag(h.activeHelperTask.orderId),
      };
    }

    return null;
  };

  // Pipeline breakdown: active workflow stages + true today's delivered count
  const pipeline = useMemo(() => {
    const activeCount = (status: string) => orders.filter(o => o.status === status).length;
    
    // Count ONLY orders delivered TODAY (not all historical orders)
    const deliveredTodayCount = orders.filter(o => {
      if (o.status !== 'delivered') return false;
      const t = (o as any).deliveredAt || (o as any).deliveryCompletedAt || (o as any).updatedAt || o.createdAt;
      return isToday(t);
    }).length;

    const stages = [
      { key: 'pickup_completed', label: 'Ready to tag', n: activeCount('pickup_completed'), color: 'bg-purple-100 text-purple-700', barColor: 'bg-purple-500' },
      { key: 'processing', label: 'Processing on Floor', n: activeCount('processing'), color: 'bg-blue-100 text-blue-700', barColor: 'bg-blue-500' },
      { key: 'ready', label: 'Ready for Dispatch', n: activeCount('ready'), color: 'bg-emerald-100 text-emerald-700', barColor: 'bg-emerald-500' },
      { key: 'out_for_delivery', label: 'Out for Delivery', n: activeCount('out_for_delivery'), color: 'bg-orange-100 text-orange-700', barColor: 'bg-orange-500' },
    ];

    const totalActive = stages.reduce((sum, s) => sum + s.n, 0);

    return {
      stages,
      totalActive,
      deliveredToday: deliveredTodayCount,
    };
  }, [orders]);

  // Stage timing benchmarks: completed averages + active running tasks & elapsed time
  const stageBenchmarks = useMemo(() => {
    const targetMap: Record<string, { label: string; target: number }> = {
      tagging: { label: 'Tagging', target: 10 },
      getting_washed: { label: 'Washing', target: 35 },
      getting_dried: { label: 'Drying', target: 35 },
      getting_ironed: { label: 'Ironing', target: 15 },
      packaging: { label: 'Packaging', target: 8 },
    };

    const dataMap: Record<string, {
      completedTotalMin: number;
      completedCount: number;
      runningCount: number;
      runningTotalMin: number;
    }> = {
      tagging: { completedTotalMin: 0, completedCount: 0, runningCount: 0, runningTotalMin: 0 },
      getting_washed: { completedTotalMin: 0, completedCount: 0, runningCount: 0, runningTotalMin: 0 },
      getting_dried: { completedTotalMin: 0, completedCount: 0, runningCount: 0, runningTotalMin: 0 },
      getting_ironed: { completedTotalMin: 0, completedCount: 0, runningCount: 0, runningTotalMin: 0 },
      packaging: { completedTotalMin: 0, completedCount: 0, runningCount: 0, runningTotalMin: 0 },
    };

    const getMs = (t: any): number => {
      if (!t) return 0;
      if (typeof t === 'number') return t;
      if (typeof t.toMillis === 'function') return t.toMillis();
      if (typeof t.toDate === 'function') return t.toDate().getTime();
      if (t.seconds) return t.seconds * 1000;
      if (typeof t.getTime === 'function') return t.getTime();
      const p = new Date(t).getTime();
      return isNaN(p) ? 0 : p;
    };

    processes.forEach(p => {
      const cur = currentStep(p);
      const done = isDone(p);

      Object.entries(p.stages || {}).forEach(([step, s]: [string, any]) => {
        if (!dataMap[step] || !s) return;

        // 1. Completed stage tracking
        if (s.completedAt) {
          let min: number | null = null;
          if (typeof s.acceptToCompleteMin === 'number' && s.acceptToCompleteMin > 0) {
            min = s.acceptToCompleteMin;
          } else if (typeof s.startToCompleteMin === 'number' && s.startToCompleteMin > 0) {
            min = s.startToCompleteMin;
          } else if (typeof s.durationMs === 'number' && s.durationMs > 0) {
            min = Math.round(s.durationMs / 60000);
          } else {
            const compMs = getMs(s.completedAt);
            const stMs = getMs(s.startedAt || s.acceptedAt || s.assignedAt);
            if (compMs > stMs && stMs > 0) {
              min = Math.round((compMs - stMs) / 60000);
            }
          }

          if (min !== null && min > 0 && min < 600) {
            dataMap[step].completedTotalMin += min;
            dataMap[step].completedCount += 1;
          }
        }

        // 2. Active running stage tracking
        if (!done && cur === step && !s.completedAt) {
          dataMap[step].runningCount += 1;
          const stMs = getMs(s.startedAt || s.acceptedAt || s.assignedAt || p.claimedAt);
          const elapsed = stMs > 0 ? Math.max(1, Math.round((Date.now() - stMs) / 60000)) : 1;
          if (elapsed < 600) {
            dataMap[step].runningTotalMin += elapsed;
          }
        }
      });
    });

    return Object.entries(targetMap).map(([key, config]) => {
      const d = dataMap[key];
      const completedAvg = d.completedCount > 0 ? Math.round(d.completedTotalMin / d.completedCount) : null;
      const runningAvg = d.runningCount > 0 && d.runningTotalMin > 0 ? Math.round(d.runningTotalMin / d.runningCount) : null;

      return {
        key,
        label: config.label,
        target: config.target,
        completedAvg,
        runningAvg,
        runningCount: d.runningCount,
        completedCount: d.completedCount,
      };
    });
  }, [processes]);

  const renderInboundCard = (o: FeedOrder) => {
    const chips = parseOrderTokens(o.tokens, o.tokenNumber, o.items);
    const garmentCount = o.garmentCount || (o as any).opsDetails?.garmentCount;
    const isUrgent = !!o.isUrgent;
    const servicesList = (o.items || []).map(i => i.serviceName || i.name).filter(Boolean);
    const isPaid = String(o.paymentStatus).toLowerCase() === 'paid';
    const timeLabel = timeAgo(o.createdAt);

    return (
      <TouchableOpacity
        key={o.id}
        onPress={() => navigation.navigate('OrderDetail', { orderId: o.id })}
        style={{ paddingHorizontal: 11, paddingVertical: 9, borderRadius: 13 }}
        className="bg-white mb-2 border border-slate-200/90 shadow-[0_1px_2px_rgba(0,0,0,0.03)] active:opacity-95"
      >
        {/* Row 1: ID, Tokens, Urgency, Status Pill */}
        <View className="flex-row items-center justify-between mb-1">
          <View className="flex-row items-center flex-wrap gap-1 flex-1 mr-2">
            <Text className="font-extrabold text-slate-900 text-xs tracking-tight">#{o.id.slice(-6).toUpperCase()}</Text>
            {chips.map((c, i) => (
              <View key={i} className="bg-amber-50 border border-amber-300 px-1 py-0.2 rounded">
                <Text className="text-amber-900 font-extrabold text-[9px]">T-{c.token}</Text>
              </View>
            ))}
            {isUrgent && (
              <View className="bg-rose-50 border border-rose-300 px-1.5 py-0.2 rounded flex-row items-center">
                <Zap size={8} color="#e11d48" className="mr-0.5" />
                <Text className="text-rose-700 font-black text-[8px] uppercase">URGENT</Text>
              </View>
            )}
          </View>

          <View className={`px-2 py-0.2 rounded-full border ${
            o.status === 'in_transit_to_store' ? 'bg-sky-50 border-sky-200' :
            o.status === 'pickup_completed' ? 'bg-purple-50 border-purple-200' :
            'bg-amber-50 border-amber-200'
          }`}>
            <Text className={`font-bold text-[9px] uppercase tracking-wider ${
              o.status === 'in_transit_to_store' ? 'text-sky-700' :
              o.status === 'pickup_completed' ? 'text-purple-700' :
              'text-amber-800'
            }`}>
              {o.status === 'in_transit_to_store' ? '🚚 In Transit' :
               o.status === 'pickup_completed' ? '📦 Ready to Tag' :
               o.status.replace(/_/g, ' ')}
            </Text>
          </View>
        </View>

        {/* Row 2: Customer, Phone, Created Time, Price, Payment Status */}
        <View className="flex-row items-center justify-between mb-1.5">
          <View className="flex-1 mr-2">
            <Text className="text-slate-900 font-bold text-xs" numberOfLines={1}>
              {o.customerName || 'Customer'}
            </Text>
            <View className="flex-row items-center gap-2 mt-0.5">
              {!!o.customerPhone && (
                <TouchableOpacity
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    Linking.openURL(`tel:${o.customerPhone}`);
                  }}
                  className="flex-row items-center self-start"
                >
                  <Phone size={9} color="#64748B" className="mr-0.5" />
                  <Text className="text-slate-500 font-medium text-[10px]">{o.customerPhone}</Text>
                </TouchableOpacity>
              )}
              {!!timeLabel && (
                <View className="flex-row items-center">
                  <Clock size={8} color="#94a3b8" className="mr-0.5" />
                  <Text className="text-slate-400 text-[10px]">{timeLabel}</Text>
                </View>
              )}
              {garmentCount ? (
                <Text className="text-purple-700 font-bold text-[10px]">👕 {garmentCount} pcs</Text>
              ) : null}
            </View>
          </View>

          <View className="items-end shrink-0">
            <Text className="text-slate-900 font-black text-xs">₹{orderTotal(o)}</Text>
            <View className={`px-1.5 py-0.2 rounded mt-0.5 border ${
              isPaid ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
            }`}>
              <Text className={`text-[8px] uppercase font-bold ${
                isPaid ? 'text-emerald-700' : 'text-amber-700'
              }`}>
                {isPaid ? 'Paid' : 'Pending'}
              </Text>
            </View>
          </View>
        </View>

        {/* Row 3: Services + Rider/Manage Status */}
        <View className="pt-1 border-t border-slate-100 flex-row items-center justify-between">
          <View className="flex-1 mr-2 flex-row items-center flex-wrap gap-1">
            {(() => {
              const assignedRider = o.riderId ? roster.riders.find(r => r.uid === o.riderId) : null;
              const rName = assignedRider?.name || (o as any).riderName;
              if (rName) {
                return (
                  <View className="bg-blue-50 border border-blue-200 px-1.5 py-0.2 rounded flex-row items-center">
                    <Truck size={8} color="#2563eb" className="mr-0.5" />
                    <Text className="text-blue-700 font-bold text-[9px]">{rName}</Text>
                  </View>
                );
              }
              if (o.status === 'placed' || o.status === 'confirmed') {
                return (
                  <View className="bg-amber-50 border border-amber-300 px-1.5 py-0.2 rounded flex-row items-center">
                    <AlertTriangle size={8} color="#d97706" className="mr-0.5" />
                    <Text className="text-amber-800 font-bold text-[9px]">Unassigned</Text>
                  </View>
                );
              }
              return null;
            })()}
            {servicesList.length > 0 ? (
              servicesList.slice(0, 2).map((s, idx) => (
                <View key={idx} className="bg-slate-100 px-1.5 py-0.2 rounded">
                  <Text className="text-slate-600 font-medium text-[9px]" numberOfLines={1}>{s}</Text>
                </View>
              ))
            ) : (
              <Text className="text-slate-400 text-[9px]" numberOfLines={1}>{serviceSummary(o)}</Text>
            )}
          </View>

          <View className="bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded flex-row items-center">
            <Text className="text-purple-700 font-bold text-[10px] mr-0.5">Manage</Text>
            <ChevronRight size={10} color="#7e22ce" />
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <ScrollView contentContainerStyle={{ padding: isDesktop ? 16 : 12, paddingBottom: isDesktop ? 24 : 100 }}>
        <View style={maxContainerStyle}>

          {/* Integrated Top Command Bar */}
          <View className={`flex-row items-center justify-between mb-3 ${isDesktop ? 'flex-row' : 'flex-col gap-2'}`}>
            {/* Left: Brand / Title */}
            <View className="flex-row items-center gap-2.5">
              <View>
                <View className="flex-row items-center gap-2">
                  <Text className="text-lg font-black text-slate-900 tracking-tight">Store Command Center</Text>
                  <View className="bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex-row items-center">
                    <View className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1" />
                    <Text className="text-emerald-700 font-extrabold text-[10px] uppercase">Autopilot Active</Text>
                  </View>
                </View>
                <Text className="text-slate-400 font-semibold text-[10px] tracking-wider uppercase mt-0.5">Supervisor Flight Deck</Text>
              </View>
            </View>

            {/* Center: Integrated Quick Search */}
            <View className={`flex-row items-center bg-white rounded-xl px-3 h-9 border border-slate-200/90 shadow-2xs ${isDesktop ? 'w-80' : 'w-full'}`}>
              <Search size={14} color="#94a3b8" />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search token, ID, customer, phone..."
                placeholderTextColor="#94a3b8"
                className="flex-1 h-full px-2 text-slate-900 font-medium text-xs"
                autoCapitalize="none"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')} className="p-0.5">
                  <X size={13} color="#94a3b8" />
                </TouchableOpacity>
              )}
            </View>

            {/* Right: Hardware Capacity Badges */}
            <View className="flex-row items-center gap-1.5 bg-white border border-slate-200/90 p-1 rounded-xl shadow-2xs">
              <View className="bg-purple-50 px-2 py-0.5 rounded-md">
                <Text className="text-purple-800 font-extrabold text-[11px]">🌀 {resources.washers} Washers</Text>
              </View>
              <View className="bg-blue-50 px-2 py-0.5 rounded-md">
                <Text className="text-blue-800 font-extrabold text-[11px]">💨 {resources.dryers} Dryers</Text>
              </View>
              <View className="bg-amber-50 px-2 py-0.5 rounded-md">
                <Text className="text-amber-800 font-extrabold text-[11px]">👔 {resources.ironingStations} Irons</Text>
              </View>
            </View>
          </View>

          {/* Search Results Dropdown */}
          {searchResults.length > 0 && (
            <View className="mb-4 bg-white rounded-2xl p-3 border border-slate-200 shadow-sm">
              <Text className="text-slate-900 font-bold text-xs mb-2">{searchResults.length} Match(es) Found</Text>
              <View className={isDesktop || isTablet ? "flex-row flex-wrap -mx-1" : ""}>
                {searchResults.map(o => (
                  <View key={o.id} className={isDesktop ? "w-1/3 px-1" : isTablet ? "w-1/2 px-1" : "w-full"}>
                    {renderInboundCard(o)}
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Command KPI Ribbon (4 Compact, High-Density Tiles) */}
          <View className={`mb-3.5 ${isDesktop ? 'flex-row gap-2.5' : isTablet ? 'flex-row flex-wrap gap-2' : 'flex-col gap-2'}`}>
            
            {/* Tile 1: Today's Revenue */}
            <View className={`${isDesktop ? 'flex-1' : isTablet ? 'w-[48%]' : 'w-full'} bg-[#0f172a] rounded-xl px-3.5 py-2.5 justify-between shadow-2xs border border-slate-800`}>
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center">
                  <IndianRupee color="#c084fc" size={13} className="mr-1" />
                  <Text className="text-slate-400 font-bold text-[10px] uppercase tracking-wider">Today's Revenue</Text>
                </View>
                <View className="bg-purple-500/20 px-1.5 py-0.2 rounded border border-purple-500/30">
                  <Text className="text-purple-300 font-bold text-[9px]">LIVE</Text>
                </View>
              </View>
              <View className="flex-row items-baseline justify-between mt-1">
                <Text className="text-xl font-black text-white tracking-tight">
                  ₹{stats.revenue.toLocaleString('en-IN')}
                </Text>
                <Text className="text-slate-400 text-[11px] font-medium">
                  {stats.orderCount} orders · ₹{stats.orderCount > 0 ? Math.round(stats.revenue / stats.orderCount) : 0} avg
                </Text>
              </View>
            </View>

            {/* Tile 2: Active Floor Load */}
            <View className={`${isDesktop ? 'flex-1' : isTablet ? 'w-[48%]' : 'w-full'} bg-white rounded-xl px-3.5 py-2.5 justify-between shadow-2xs border border-slate-200/90`}>
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center">
                  <WashingMachine color="#2563eb" size={13} className="mr-1" />
                  <Text className="text-slate-500 font-bold text-[10px] uppercase tracking-wider">Floor Load</Text>
                </View>
                <View className="bg-blue-50 px-1.5 py-0.2 rounded border border-blue-200/60">
                  <Text className="text-blue-700 font-bold text-[9px]">ACTIVE</Text>
                </View>
              </View>
              <View className="flex-row items-baseline justify-between mt-1">
                <Text className="text-xl font-black text-slate-900 tracking-tight">
                  {processingOrdersCount}
                </Text>
                <Text className="text-slate-500 text-[11px] font-medium">
                  {readyOrdersCount} ready · {outForDeliveryOrdersCount} delivering
                </Text>
              </View>
            </View>

            {/* Tile 3: Urgent Priority */}
            <View className={`${isDesktop ? 'flex-1' : isTablet ? 'w-[48%]' : 'w-full'} bg-white rounded-xl px-3.5 py-2.5 justify-between shadow-2xs border ${
              urgentOrders.length > 0 ? 'border-rose-300 bg-rose-50/30' : 'border-slate-200/90'
            }`}>
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center">
                  <Zap color={urgentOrders.length > 0 ? '#e11d48' : '#64748b'} size={13} className="mr-1" />
                  <Text className={`${urgentOrders.length > 0 ? 'text-rose-700' : 'text-slate-500'} font-bold text-[10px] uppercase tracking-wider`}>Urgent Priority</Text>
                </View>
                {urgentOrders.length > 0 ? (
                  <View className="bg-rose-500 px-1.5 py-0.2 rounded">
                    <Text className="text-white font-black text-[9px] uppercase">ACTION REQ</Text>
                  </View>
                ) : (
                  <View className="bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                    <Text className="text-emerald-700 font-bold text-[9px]">ON TRACK</Text>
                  </View>
                )}
              </View>
              <View className="flex-row items-baseline justify-between mt-1">
                <Text className={`text-xl font-black ${urgentOrders.length > 0 ? 'text-rose-600' : 'text-slate-900'} tracking-tight`}>
                  {urgentOrders.length}
                </Text>
                <Text className="text-slate-500 text-[11px] font-medium">
                  {inbound.length} orders in queue
                </Text>
              </View>
            </View>

            {/* Tile 4: Floor Staff Deployment */}
            <View className={`${isDesktop ? 'flex-1' : isTablet ? 'w-[48%]' : 'w-full'} bg-white rounded-xl px-3.5 py-2.5 justify-between shadow-2xs border border-slate-200/90`}>
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center">
                  <Users color="#9333ea" size={13} className="mr-1" />
                  <Text className="text-slate-500 font-bold text-[10px] uppercase tracking-wider">Floor Staff</Text>
                </View>
                <View className="bg-purple-50 px-1.5 py-0.2 rounded border border-purple-200/60">
                  <Text className="text-purple-700 font-bold text-[9px]">SHIFT ACTIVE</Text>
                </View>
              </View>
              <View className="flex-row items-baseline justify-between mt-1">
                <Text className="text-xl font-black text-slate-900 tracking-tight">
                  {roster.countHelpers + roster.countRiders}
                </Text>
                <Text className="text-slate-500 text-[11px] font-medium">
                  {roster.countHelpers} Helpers · {roster.countRiders} Rider
                </Text>
              </View>
            </View>

          </View>

          {/* Main Content Area: Responsive Split */}
          <View className={isDesktop ? "flex-row items-start gap-4" : "flex-col"}>

            {/* Left Column: Inbound & Floor Queue */}
            <View className={isDesktop ? "flex-1" : "w-full mb-4"}>
              
              {/* Section Header & Compact Filter Tabs */}
              <View className="flex-row items-center justify-between mb-2.5 flex-wrap gap-2">
                <View className="flex-row items-center">
                  <AlertTriangle color="#f97316" size={15} className="mr-1.5" />
                  <Text className="text-slate-900 font-extrabold text-sm">Inbound & Floor Queue ({inbound.length})</Text>
                </View>

                {/* Filter pills */}
                <View className="flex-row items-center gap-1">
                  <TouchableOpacity
                    onPress={() => setInboundFilter('all')}
                    className={`px-2.5 py-0.5 rounded-full border ${inboundFilter === 'all' ? 'bg-[#994bff] border-[#994bff]' : 'bg-white border-slate-200'}`}
                  >
                    <Text className={`font-bold text-[11px] ${inboundFilter === 'all' ? 'text-white' : 'text-slate-600'}`}>All</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setInboundFilter('urgent')}
                    className={`px-2.5 py-0.5 rounded-full border ${inboundFilter === 'urgent' ? 'bg-rose-500 border-rose-500' : 'bg-white border-slate-200'}`}
                  >
                    <Text className={`font-bold text-[11px] ${inboundFilter === 'urgent' ? 'text-white' : 'text-slate-600'}`}>⚡ Urgent</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setInboundFilter('tagging')}
                    className={`px-2.5 py-0.5 rounded-full border ${inboundFilter === 'tagging' ? 'bg-[#994bff] border-[#994bff]' : 'bg-white border-slate-200'}`}
                  >
                    <Text className={`font-bold text-[11px] ${inboundFilter === 'tagging' ? 'text-white' : 'text-slate-600'}`}>Tagging</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setInboundFilter('transit')}
                    className={`px-2.5 py-0.5 rounded-full border ${inboundFilter === 'transit' ? 'bg-[#994bff] border-[#994bff]' : 'bg-white border-slate-200'}`}
                  >
                    <Text className={`font-bold text-[11px] ${inboundFilter === 'transit' ? 'text-white' : 'text-slate-600'}`}>In Transit</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Cards Grid */}
              {filteredInbound.length === 0 ? (
                <View className="bg-white rounded-2xl p-6 border border-slate-200/80 items-center justify-center">
                  <PackageOpen size={32} color="#cbd5e1" />
                  <Text className="text-slate-400 font-semibold text-xs mt-2">No orders in this category</Text>
                </View>
              ) : (
                <View className={isDesktop || isTablet ? "flex-row flex-wrap -mx-1" : ""}>
                  {filteredInbound.map(o => (
                    <View key={o.id} className={isWideDesktop ? "w-1/3 px-1" : isDesktop || isTablet ? "w-1/2 px-1" : "w-full"}>
                      {renderInboundCard(o)}
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Right Column: Control & Operations Widgets */}
            <View className={isDesktop ? "w-[360px] shrink-0" : "w-full"}>

              {/* Widget 1: Live Order Pipeline (Workflow Distribution) */}
              <View className="bg-white rounded-2xl p-3.5 border border-slate-200/90 mb-3 shadow-2xs">
                <View className="flex-row items-center justify-between mb-2">
                  <View className="flex-row items-center">
                    <Layers size={14} color="#994bff" className="mr-1.5" />
                    <Text className="text-slate-900 font-extrabold text-xs">Live Order Pipeline</Text>
                  </View>
                  <Text className="text-slate-400 text-[11px] font-semibold">{pipeline.totalActive} active on floor</Text>
                </View>
                
                {/* Visual Pipeline Bar */}
                <View className="flex-row h-1.5 rounded-full overflow-hidden mb-2.5 bg-slate-100">
                  {pipeline.stages.map(p => {
                    const widthPct = pipeline.totalActive > 0 ? (p.n / pipeline.totalActive) * 100 : 0;
                    if (widthPct === 0) return null;
                    return (
                      <View key={p.key} style={{ width: `${widthPct}%` }} className={p.barColor} />
                    );
                  })}
                </View>

                {/* 2x2 Grid for compact stage counts */}
                <View className="flex-row flex-wrap -mx-1 gap-y-1.5">
                  {pipeline.stages.map((p) => (
                    <View key={p.key} className="w-1/2 px-1">
                      <View className="flex-row items-center justify-between bg-slate-50 px-2 py-1 rounded-lg border border-slate-100">
                        <View className="flex-row items-center">
                          <View className={`w-1.5 h-1.5 rounded-full mr-1.5 ${p.barColor}`} />
                          <Text className="text-slate-700 font-medium text-[10px]" numberOfLines={1}>{p.label}</Text>
                        </View>
                        <Text className="font-black text-xs text-slate-900 ml-1">{p.n}</Text>
                      </View>
                    </View>
                  ))}
                </View>

                {/* Delivered Today Metric */}
                <View className="flex-row items-center justify-between pt-1.5 mt-2 border-t border-slate-100">
                  <View className="flex-row items-center">
                    <CheckCircle2 size={12} color="#10b981" className="mr-1" />
                    <Text className="text-slate-600 font-semibold text-[11px]">Delivered Today</Text>
                  </View>
                  <View className="px-2 py-0.2 rounded bg-emerald-50 border border-emerald-200">
                    <Text className="font-extrabold text-[11px] text-emerald-800">{pipeline.deliveredToday}</Text>
                  </View>
                </View>
              </View>

              {/* Widget 2: Floor Roster Deployment */}
              <View className="bg-white rounded-2xl p-3.5 border border-slate-200/90 mb-3 shadow-2xs">
                <View className="flex-row items-center justify-between mb-2">
                  <View className="flex-row items-center">
                    <Users size={14} color="#994bff" className="mr-1.5" />
                    <Text className="text-slate-900 font-extrabold text-xs">Floor Roster Deployment</Text>
                  </View>
                  <Text className="text-slate-400 text-[11px] font-bold">{roster.helpers.length} active</Text>
                </View>
                <View className="gap-1.5">
                  {roster.helpers.map(h => {
                    const liveTask = getHelperLiveTask(h);
                    return (
                      <View key={h.uid} className="flex-row items-center justify-between bg-slate-50 px-2.5 py-1.5 rounded-xl border border-slate-100">
                        <View className="flex-row items-center">
                          <View className="w-6 h-6 rounded-full bg-purple-100 items-center justify-center mr-2 border border-purple-200">
                            <Text className="text-purple-800 font-black text-[10px]">{h.name ? h.name.charAt(0).toUpperCase() : 'H'}</Text>
                          </View>
                          <View>
                            <Text className="text-slate-900 font-bold text-[11px]">{formatStaffName(h.name, 'Helper')}</Text>
                            <Text className="text-slate-400 text-[9px]">{h.phone}</Text>
                          </View>
                        </View>
                        {liveTask ? (
                          <View className="bg-purple-100 border border-purple-200 px-2 py-0.5 rounded-md">
                            <Text className="text-purple-800 font-extrabold text-[9px] uppercase">
                              {liveTask.label} ({liveTask.tokenTag})
                            </Text>
                          </View>
                        ) : (
                          <View className="bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                            <Text className="text-emerald-700 font-bold text-[9px] uppercase">Available</Text>
                          </View>
                        )}
                      </View>
                    );
                  })}
                  {roster.riders.map(r => (
                    <TouchableOpacity
                      key={r.uid}
                      onPress={() => setSelectedRosterRider(r)}
                      activeOpacity={0.8}
                      className="flex-row items-center justify-between bg-slate-50 hover:bg-slate-100/80 px-2.5 py-1.5 rounded-xl border border-slate-100 cursor-pointer active:bg-slate-100"
                    >
                      <View className="flex-row items-center">
                        <View className="w-6 h-6 rounded-full bg-blue-100 items-center justify-center mr-2 border border-blue-200">
                          <Truck size={11} color="#1d4ed8" />
                        </View>
                        <View>
                          <Text className="text-slate-900 font-bold text-[11px]">{formatStaffName(r.name, 'Rider')}</Text>
                          <Text className="text-slate-400 text-[9px]">{r.phone}</Text>
                        </View>
                      </View>
                      <View className="flex-row items-center gap-1.5">
                        <View className="bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
                          <Text className="text-blue-700 font-bold text-[9px] uppercase">Smart Route</Text>
                        </View>
                        <ChevronRight size={11} color="#64748B" />
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Widget 3: Stage Timing Benchmarks (Compact 5-Stage Metrics) */}
              <View className="bg-white rounded-2xl p-3.5 border border-slate-200/90 mb-3 shadow-2xs">
                <View className="flex-row items-center justify-between mb-2">
                  <View className="flex-row items-center">
                    <Timer size={13} color="#994bff" className="mr-1.5" />
                    <Text className="text-slate-900 font-extrabold text-xs">Stage Timing Benchmarks</Text>
                  </View>
                  <Text className="text-slate-400 text-[10px] font-semibold">Live Avg</Text>
                </View>
                <View className="flex-row gap-1.5">
                  {stageBenchmarks.map(s => {
                    const displayVal = s.completedAvg !== null 
                      ? `${s.completedAvg}m` 
                      : s.runningAvg !== null 
                      ? `~${s.runningAvg}m` 
                      : '—';
                    
                    const valNumber = s.completedAvg ?? s.runningAvg;
                    const isAboveTarget = valNumber !== null && valNumber > s.target;
                    const isRunning = s.runningCount > 0;

                    return (
                      <View key={s.key} className={`flex-1 p-1.5 rounded-xl border items-center ${
                        isAboveTarget 
                          ? 'bg-amber-50/70 border-amber-200' 
                          : isRunning 
                          ? 'bg-purple-50/50 border-purple-200/80' 
                          : 'bg-slate-50 border-slate-100'
                      }`}>
                        <View className="flex-row items-center">
                          <Text className="text-slate-400 text-[9px] font-bold uppercase">{s.label}</Text>
                          {isRunning && (
                            <View className="w-1.5 h-1.5 rounded-full bg-purple-600 ml-0.5" />
                          )}
                        </View>

                        <Text className={`font-black text-xs mt-0.5 ${
                          isAboveTarget ? 'text-amber-800' : isRunning ? 'text-purple-900' : 'text-slate-900'
                        }`}>
                          {displayVal}
                        </Text>

                        {isRunning ? (
                          <Text className="text-purple-700 text-[8px] font-bold mt-0.5">
                            {s.runningCount} act
                          </Text>
                        ) : (
                          <Text className="text-slate-400 text-[8px] mt-0.5">{s.target}m tgt</Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>

              {/* Widget 4: Smart Autopilot Routing Rules Matrix */}
              <View className="bg-white rounded-2xl p-3 border border-slate-200/90 shadow-2xs">
                <View className="flex-row items-center justify-between mb-1.5">
                  <View className="flex-row items-center">
                    <Zap size={12} color="#994bff" className="mr-1" />
                    <Text className="text-slate-500 text-[10px] uppercase font-extrabold tracking-wider">Autopilot Routing Rules</Text>
                  </View>
                  <View className="bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded">
                    <Text className="text-emerald-700 font-bold text-[9px]">OPTIMAL</Text>
                  </View>
                </View>
                <View className="gap-1">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-slate-600 text-[10px] font-medium">Tagging & Packaging</Text>
                    <Text className="text-purple-700 font-bold text-[10px]">→ Abdul (Primary)</Text>
                  </View>
                  <View className="flex-row items-center justify-between">
                    <Text className="text-slate-600 text-[10px] font-medium">Ironing Station 1 & 2</Text>
                    <Text className="text-amber-800 font-bold text-[10px]">→ Samsul & Abdur</Text>
                  </View>
                </View>
              </View>

            </View>

          </View>

        </View>
      </ScrollView>

      <SupervisorRiderRouteModal
        visible={!!selectedRosterRider}
        rider={selectedRosterRider}
        orders={orders}
        onClose={() => setSelectedRosterRider(null)}
        onOpenOrder={(orderId) => navigation.navigate('OrderDetail', { orderId })}
      />
    </SafeAreaView>
  );
}

