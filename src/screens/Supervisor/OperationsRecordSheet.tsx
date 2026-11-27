import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { useOpsProcessStore } from '../../store/opsProcessStore';
import { useStaffRosterStore } from '../../store/staffRosterStore';
import { db, collection, getDocs, query, where } from '../../config/firebase';
import { useResponsive } from '../../utils/useResponsive';
import {
  REPORT_STAGE_KEYS,
  REPORT_STAGE_LABELS,
  IRONING_SERVICE_LABELS,
  IroningServiceBucket,
  StageMetricDoc,
  localISODate,
  dayStartMs,
  collectHelperStageEvents,
  buildHelperReport,
  buildRiderReport,
  resolveRiderName,
} from '../../utils/operationsReport';
import {
  Calendar,
  Users,
  Timer,
  X,
  Truck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Wrench,
  Bike,
  Shirt,
} from 'lucide-react-native';

const IRONING_BUCKETS: IroningServiceBucket[] = ['wash_iron', 'ironing', 'premium_laundry', 'other'];

const fmtDate = (dateStr: string) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const today = new Date();
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((todayMid.getTime() - dt.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
};

const rangeDates = (start: string, end: string): string[] => {
  const dates: string[] = [];
  const s = new Date(dayStartMs(start));
  const e = new Date(dayStartMs(end));
  while (s <= e) {
    dates.push(localISODate(s));
    s.setDate(s.getDate() + 1);
  }
  return dates;
};

type PresetKey = 'today' | 'yesterday' | '7d' | '30d' | 'month';

export function OperationsRecordSheet({ onClose }: { onClose?: () => void }) {
  const { orders, initialize: initOrders } = useOrderFeedStore();
  const processes = useOpsProcessStore(s => s.processes);
  const roster = useStaffRosterStore(s => s.roster);
  const { maxContainerStyle, isDesktop } = useResponsive();

  const todayStr = localISODate(new Date());
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);
  const [activePreset, setActivePreset] = useState<PresetKey | null>('today');
  const [selectedStaff, setSelectedStaff] = useState<string>('all');
  const [dataType, setDataType] = useState<'helper' | 'rider'>('helper');

  useEffect(() => {
    initOrders();
  }, [initOrders]);

  // Load full staff directory (riders + helpers — roster store only tracks ON-SHIFT staff)
  // plus task collections for accurate pickup/delivery rider attribution.
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  const [directoryHelpers, setDirectoryHelpers] = useState<string[]>([]);
  const [taskRiders, setTaskRiders] = useState<Record<string, { pickupUid?: string; deliveryUid?: string }>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [staffSnap, taskSnap, delSnap] = await Promise.all([
          getDocs(collection(db, 'ops_staff')),
          getDocs(collection(db, 'ops_tasks')),
          getDocs(collection(db, 'ops_delivery_tasks')),
        ]);
        if (cancelled) return;

        const riderNames: Record<string, string> = {};
        const helperSet = new Set<string>();
        staffSnap.forEach(d => {
          const data = d.data() as any;
          const name = typeof data.name === 'string' ? data.name.trim() : '';
          if (!name) return;
          if (data.role === 'rider') riderNames[d.id] = name;
          else if (data.role === 'helper' || data.role === 'iron') helperSet.add(name);
        });

        const byOrder: Record<string, { pickupUid?: string; deliveryUid?: string }> = {};
        taskSnap.forEach(d => {
          const assignee = (d.data() as any).assignee;
          if (!assignee) return;
          const orderId = (d.data() as any).orderId || d.id;
          byOrder[orderId] = { ...(byOrder[orderId] || {}), pickupUid: assignee };
        });
        delSnap.forEach(d => {
          const assignee = (d.data() as any).assignee;
          if (!assignee) return;
          const orderId = (d.data() as any).orderId || d.id;
          byOrder[orderId] = { ...(byOrder[orderId] || {}), deliveryUid: assignee };
        });

        setStaffNames(riderNames);
        setDirectoryHelpers(Array.from(helperSet));
        setTaskRiders(byOrder);
      } catch (err) {
        console.warn('[OperationsRecord] staff/task directory load failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load permanent per-load stage metrics from ops_stage_metrics for the selected date range
  const [stageMetrics, setStageMetrics] = useState<StageMetricDoc[]>([]);
  const [metricsLoading, setMetricsLoading] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    setMetricsLoading(true);
    (async () => {
      try {
        const q = query(
          collection(db, 'ops_stage_metrics'),
          where('dateKey', '>=', startDate),
          where('dateKey', '<=', endDate)
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        const docs: StageMetricDoc[] = [];
        snap.forEach(d => {
          const data = d.data() as any;
          docs.push({
            id: d.id,
            processId: data.processId || data.orderId || d.id,
            orderId: data.orderId || data.parentOrderId || d.id,
            parentOrderId: data.parentOrderId || data.orderId,
            step: data.step,
            serviceType: data.serviceType,
            serviceLabel: data.serviceLabel,
            garmentCount: typeof data.garmentCount === 'number' ? data.garmentCount : undefined,
            loadIndex: typeof data.loadIndex === 'number' ? data.loadIndex : undefined,
            loadCount: typeof data.loadCount === 'number' ? data.loadCount : undefined,
            assignee: data.assignee,
            assigneeName: data.assigneeName,
            startedAt: data.startedAt,
            acceptedAt: data.acceptedAt,
            completedAt: data.completedAt,
            startToCompleteMin: data.startToCompleteMin,
            acceptToCompleteMin: data.acceptToCompleteMin,
            durationMs: data.durationMs,
            dateKey: data.dateKey,
          });
        });
        setStageMetrics(docs);
      } catch (err) {
        console.warn('[OperationsRecord] ops_stage_metrics load failed:', err);
        if (!cancelled) setStageMetrics([]);
      } finally {
        if (!cancelled) setMetricsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [startDate, endDate]);

  const riderNameByUid = useMemo(() => {
    const map: Record<string, string> = { ...staffNames };
    roster.riders.forEach(r => { if (r.name) map[r.uid] = r.name; });
    return map;
  }, [staffNames, roster.riders]);

  // ====== DATE RANGE ======
  const [pickerOpen, setPickerOpen] = useState(false);
  const [anchorDate, setAnchorDate] = useState<string | null>(null);
  const [pickerMonth, setPickerMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });

  const shiftMonth = (delta: number) => {
    setPickerMonth(prev => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + delta);
      d.setDate(1);
      return d;
    });
  };

  const tapDay = (dateStr: string) => {
    if (!anchorDate) { setAnchorDate(dateStr); return; }
    if (dateStr < anchorDate) { setStartDate(dateStr); setEndDate(anchorDate); }
    else { setStartDate(anchorDate); setEndDate(dateStr); }
    setActivePreset(null);
    setAnchorDate(null);
  };

  const applyPreset = (preset: PresetKey) => {
    const now = new Date();
    const iso = localISODate;
    if (preset === 'today') { setStartDate(iso(now)); setEndDate(iso(now)); }
    else if (preset === 'yesterday') {
      const y = new Date(now); y.setDate(now.getDate() - 1);
      setStartDate(iso(y)); setEndDate(iso(y));
    } else if (preset === '7d') {
      const s = new Date(now); s.setDate(now.getDate() - 6);
      setStartDate(iso(s)); setEndDate(iso(now));
    } else if (preset === '30d') {
      const s = new Date(now); s.setDate(now.getDate() - 29);
      setStartDate(iso(s)); setEndDate(iso(now));
    } else {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      setStartDate(iso(s)); setEndDate(iso(now));
    }
    setActivePreset(preset);
    setAnchorDate(null);
    setPickerOpen(false);
  };

  const monthGrid = useMemo(() => {
    const year = pickerMonth.getFullYear();
    const month = pickerMonth.getMonth();
    const first = new Date(year, month, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (string | null)[] = Array(startPad).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const c = new Date(Date.UTC(year, month, d));
      cells.push(c.toISOString().split('T')[0]);
    }
    return cells;
  }, [pickerMonth]);

  const dates = useMemo(() => rangeDates(startDate, endDate), [startDate, endDate]);
  const rangeLabel = dates.length === 1
    ? fmtDate(startDate)
    : `${fmtDate(startDate)} — ${fmtDate(endDate)} · ${dates.length}d`;

  // ====== DEDUPLICATED HELPER & RIDER REPORTS ======
  const helperEvents = useMemo(
    () => collectHelperStageEvents({ stageMetrics, processes, orders, startDate, endDate }),
    [stageMetrics, processes, orders, startDate, endDate]
  );

  const helperReport = useMemo(
    () => buildHelperReport(helperEvents, selectedStaff, dates),
    [helperEvents, selectedStaff, dates]
  );

  const riderReport = useMemo(
    () =>
      buildRiderReport({
        orders,
        taskRiders,
        riderNameByUid,
        startDate,
        endDate,
        selectedStaff,
        dates,
      }),
    [orders, taskRiders, riderNameByUid, startDate, endDate, selectedStaff, dates]
  );

  // All staff filter pills (includes historical & off-shift staff)
  const allHelperNames = useMemo(() => {
    const names = new Set<string>();
    directoryHelpers.forEach(n => names.add(n));
    roster.helpers.forEach(h => { if (h.name) names.add(h.name); });
    helperEvents.forEach(ev => { if (ev.staffName && ev.staffName !== 'Unknown') names.add(ev.staffName); });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [directoryHelpers, roster.helpers, helperEvents]);

  const allRiderNames = useMemo(() => {
    const names = new Set<string>();
    roster.riders.forEach(r => { if (r.name) names.add(r.name); });
    Object.values(riderNameByUid).forEach(n => { if (n) names.add(n); });
    let hasUnassigned = false;
    orders.forEach(o => {
      const pickupName = resolveRiderName(o, 'pickup', taskRiders, riderNameByUid);
      const deliveryName = resolveRiderName(o, 'delivery', taskRiders, riderNameByUid);
      if (pickupName === 'Unassigned' && deliveryName === 'Unassigned') {
        if (o.pickedUpAt || o.deliveredAt || (o as any).pickupCompletedAt || (o as any).deliveryCompletedAt) {
          hasUnassigned = true;
        }
      }
    });
    const sorted = Array.from(names).sort((a, b) => a.localeCompare(b));
    if (hasUnassigned) sorted.push('Unassigned');
    return sorted;
  }, [roster.riders, orders, riderNameByUid, taskRiders]);

  const activeNames = dataType === 'helper' ? allHelperNames : allRiderNames;
  const activeWorkerCount = dataType === 'helper' ? helperReport.rows.length : riderReport.rows.length;

  const ironingStaffRows = useMemo(
    () =>
      helperReport.rows
        .filter(r => r.ironingTotalLoads > 0 || r.ironingTotalPieces > 0)
        .sort((a, b) => b.ironingTotalPieces - a.ironingTotalPieces || b.ironingTotalLoads - a.ironingTotalLoads),
    [helperReport.rows]
  );

  // ====== RENDER ======
  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} nestedScrollEnabled>
        <View style={maxContainerStyle}>

          {/* HEADER */}
          <View className="flex-row items-center justify-between mb-4">
            <View className="flex-row items-center">
              <View className="w-10 h-10 rounded-2xl bg-purple-100 items-center justify-center mr-3 border border-purple-200">
                <Timer size={20} color="#994bff" />
              </View>
              <View>
                <Text className="text-xl font-black text-gray-900">Operations Record</Text>
                <View className="flex-row items-center gap-2">
                  <Text className="text-gray-500 text-xs">
                    {dates.length} day{dates.length > 1 ? 's' : ''} · {activeWorkerCount} staff active
                  </Text>
                  {metricsLoading && dataType === 'helper' && (
                    <ActivityIndicator size="small" color="#994bff" />
                  )}
                </View>
              </View>
            </View>
            {onClose && (
              <TouchableOpacity onPress={onClose} className="w-9 h-9 rounded-full bg-white border border-gray-200 items-center justify-center">
                <X size={16} color="#64748b" />
              </TouchableOpacity>
            )}
          </View>

          {/* ROLE TOGGLE */}
          <View className="flex-row gap-2 mb-3">
            <TouchableOpacity
              onPress={() => { setDataType('helper'); setSelectedStaff('all'); }}
              className={`flex-1 py-2.5 rounded-xl flex-row items-center justify-center gap-2 border ${dataType === 'helper' ? 'bg-purple-50 border-purple-300' : 'bg-white border-gray-200'}`}
            >
              <Wrench size={16} color={dataType === 'helper' ? '#6b21a8' : '#94a3b8'} />
              <View>
                <Text className={`font-bold text-sm ${dataType === 'helper' ? 'text-purple-800' : 'text-gray-500'}`}>Helpers</Text>
                <Text className={`text-[10px] ${dataType === 'helper' ? 'text-purple-600' : 'text-gray-400'}`}>Stages & ironing pcs</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setDataType('rider'); setSelectedStaff('all'); }}
              className={`flex-1 py-2.5 rounded-xl flex-row items-center justify-center gap-2 border ${dataType === 'rider' ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200'}`}
            >
              <Bike size={16} color={dataType === 'rider' ? '#1e40af' : '#94a3b8'} />
              <View>
                <Text className={`font-bold text-sm ${dataType === 'rider' ? 'text-blue-800' : 'text-gray-500'}`}>Riders</Text>
                <Text className={`text-[10px] ${dataType === 'rider' ? 'text-blue-600' : 'text-gray-400'}`}>Pickup & delivery</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* DATE RANGE SELECTOR */}
          <View className="bg-white rounded-2xl p-4 mb-3 border border-gray-200">
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center gap-2">
                <Calendar size={16} color="#994bff" />
                <Text className="text-gray-900 font-bold text-sm">Date Range</Text>
              </View>
              <TouchableOpacity
                onPress={() => { setPickerOpen(v => !v); setAnchorDate(null); }}
                className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-50 border border-purple-200 active:bg-purple-100"
              >
                <Text className="text-[#994bff] font-bold text-xs">{rangeLabel}</Text>
                <ChevronRight size={13} color="#994bff" style={{ transform: [{ rotate: pickerOpen ? '90deg' : '0deg' }] }} />
              </TouchableOpacity>
            </View>

            {/* Presets */}
            <View className="flex-row flex-wrap gap-1.5 mb-1">
              {([
                ['today', 'Today'],
                ['yesterday', 'Yesterday'],
                ['7d', 'Last 7 days'],
                ['30d', 'Last 30 days'],
                ['month', 'This month'],
              ] as const).map(([key, label]) => {
                const isSelected = activePreset === key;
                return (
                  <TouchableOpacity
                    key={key}
                    onPress={() => applyPreset(key)}
                    className={`px-3 py-1.5 rounded-full border ${
                      isSelected ? 'bg-[#994bff] border-[#994bff]' : 'bg-gray-50 border-gray-200 active:bg-gray-100'
                    }`}
                  >
                    <Text className={`text-xs font-bold ${isSelected ? 'text-white' : 'text-gray-600'}`}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Calendar */}
            {pickerOpen && (
              <View className="border-t border-gray-100 pt-3 mt-2">
                <View className="flex-row items-center justify-between mb-3">
                  <TouchableOpacity onPress={() => shiftMonth(-1)} className="p-2 rounded-lg bg-gray-100 active:bg-gray-200">
                    <ChevronLeft size={16} color="#334155" />
                  </TouchableOpacity>
                  <Text className="text-sm font-black text-gray-900">
                    {pickerMonth.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                  </Text>
                  <TouchableOpacity
                    onPress={() => shiftMonth(1)}
                    disabled={pickerMonth >= new Date(new Date().getFullYear(), new Date().getMonth(), 1)}
                    className={`p-2 rounded-lg bg-gray-100 active:bg-gray-200 ${pickerMonth >= new Date(new Date().getFullYear(), new Date().getMonth(), 1) ? 'opacity-30' : ''}`}
                  >
                    <ChevronRight size={16} color="#334155" />
                  </TouchableOpacity>
                </View>

                <View className="flex-row mb-1">
                  {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                    <Text key={i} className="flex-1 text-center text-[10px] font-black text-gray-400">{d}</Text>
                  ))}
                </View>

                <View className="flex-row flex-wrap">
                  {monthGrid.map((dateStr, i) => {
                    if (!dateStr) return <View key={`pad-${i}`} style={{ width: `${100 / 7}%`, height: 36 }} />;
                    const isStart = dateStr === startDate;
                    const isEnd = dateStr === endDate;
                    const inRange = dateStr > startDate && dateStr < endDate;
                    const isFuture = dateStr > todayStr;
                    return (
                      <TouchableOpacity
                        key={dateStr}
                        disabled={isFuture}
                        onPress={() => tapDay(dateStr)}
                        style={{ width: `${100 / 7}%`, height: 36 }}
                        className="items-center justify-center"
                      >
                        <View className={`w-8 h-8 rounded-full items-center justify-center ${isStart || isEnd ? 'bg-[#994bff]' : inRange ? 'bg-purple-100' : ''} ${dateStr === anchorDate ? 'bg-purple-200' : ''}`}>
                          <Text className={`text-xs font-bold ${isStart || isEnd ? 'text-white' : isFuture ? 'text-gray-300' : inRange ? 'text-purple-800' : 'text-gray-700'}`}>
                            {Number(dateStr.split('-')[2])}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text className="text-gray-400 text-[11px] mt-2 text-center">
                  {anchorDate ? 'Tap an end date' : 'Tap a start date, then an end date'}
                </Text>
              </View>
            )}
          </View>

          {/* STAFF FILTER */}
          <View className="bg-white rounded-2xl p-4 mb-3 border border-gray-200">
            <View className="flex-row items-center gap-2 mb-2">
              <Users size={16} color="#994bff" />
              <Text className="text-gray-900 font-bold text-sm">
                {dataType === 'helper' ? 'Helpers' : 'Riders'}
              </Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-1.5">
                <TouchableOpacity
                  onPress={() => setSelectedStaff('all')}
                  className={`px-3 py-1.5 rounded-full border ${selectedStaff === 'all' ? 'bg-[#994bff] border-[#994bff]' : 'bg-gray-50 border-gray-200'}`}
                >
                  <Text className={`text-xs font-bold ${selectedStaff === 'all' ? 'text-white' : 'text-gray-600'}`}>All</Text>
                </TouchableOpacity>
                {activeNames.map(name => (
                  <TouchableOpacity
                    key={name}
                    onPress={() => setSelectedStaff(name)}
                    className={`px-3 py-1.5 rounded-full border ${selectedStaff === name ? 'bg-[#994bff] border-[#994bff]' : 'bg-gray-50 border-gray-200'}`}
                  >
                    <Text className={`text-xs font-bold ${selectedStaff === name ? 'text-white' : 'text-gray-600'}`}>{name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>

          {/* OVERVIEW STATS CARD */}
          {((dataType === 'helper' && helperReport.rows.length > 0) || (dataType === 'rider' && riderReport.overall)) && (
            <View className="bg-white rounded-2xl p-4 mb-3 border border-gray-200">
              <View className="flex-row items-center gap-2 mb-3">
                <TrendingUp size={16} color="#994bff" />
                <Text className="text-gray-900 font-bold text-sm">Overview</Text>
                <Text className="text-gray-400 text-xs ml-auto">{activeWorkerCount} staff · {dates.length}d</Text>
              </View>

              {dataType === 'helper' ? (
                <View className={`gap-2 ${isDesktop ? 'flex-row' : ''}`}>
                  {helperReport.overallStages.map(s => {
                    const isIron = s.key === 'getting_ironed';
                    return (
                      <View
                        key={s.key}
                        className={`${isDesktop ? 'flex-1' : ''} rounded-xl p-3 border items-center ${
                          isIron ? 'bg-purple-50/70 border-purple-200' : 'bg-gray-50 border-gray-100'
                        }`}
                      >
                        <Text className={`text-[10px] font-bold uppercase ${isIron ? 'text-purple-700' : 'text-gray-500'}`}>
                          {s.label}
                        </Text>
                        <Text
                          className={`text-lg font-black mt-0.5 ${
                            s.avg !== null && s.avg <= 20
                              ? 'text-emerald-700'
                              : s.avg !== null && s.avg <= 45
                              ? 'text-amber-700'
                              : s.avg !== null
                              ? 'text-rose-700'
                              : 'text-gray-400'
                          }`}
                        >
                          {s.avg !== null ? `${s.avg}m` : '—'}
                        </Text>
                        <Text className="text-gray-500 text-[10px] font-semibold">
                          {s.count} load{s.count === 1 ? '' : 's'}
                        </Text>
                        {isIron && s.pieces > 0 && (
                          <View className="mt-1 px-2 py-0.5 rounded-full bg-purple-100 border border-purple-200">
                            <Text className="text-[10px] font-black text-purple-800">
                              {s.hasEstimatedPieces ? '~' : ''}{s.pieces} pcs
                              {dates.length > 1 ? ` · ${helperReport.ironingSummary.avgPiecesPerDay}/d` : ''}
                            </Text>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              ) : riderReport.overall ? (
                <View className={`gap-3 ${isDesktop ? 'flex-row' : ''}`}>
                  <View className={`${isDesktop ? 'flex-1' : ''} bg-blue-50 rounded-xl p-3.5 border border-blue-200`}>
                    <View className="flex-row items-center justify-between mb-1">
                      <Text className="text-blue-800 text-[10px] font-black uppercase">Avg Pickup Time</Text>
                      <Truck size={14} color="#2563eb" />
                    </View>
                    <Text className="text-2xl font-black text-blue-900">
                      {riderReport.overall.pickupAvg !== null ? `${riderReport.overall.pickupAvg}m` : '—'}
                    </Text>
                    <Text className="text-blue-700 text-xs font-semibold mt-0.5">{riderReport.overall.pickupCount} pickups</Text>
                  </View>
                  <View className={`${isDesktop ? 'flex-1' : ''} bg-emerald-50 rounded-xl p-3.5 border border-emerald-200`}>
                    <View className="flex-row items-center justify-between mb-1">
                      <Text className="text-emerald-800 text-[10px] font-black uppercase">Avg Delivery Time</Text>
                      <CheckCircle2 size={14} color="#059669" />
                    </View>
                    <Text className="text-2xl font-black text-emerald-900">
                      {riderReport.overall.deliveryAvg !== null ? `${riderReport.overall.deliveryAvg}m` : '—'}
                    </Text>
                    <Text className="text-emerald-700 text-xs font-semibold mt-0.5">{riderReport.overall.deliveryCount} deliveries</Text>
                  </View>
                </View>
              ) : null}
            </View>
          )}

          {/* DATA TABLE */}
          <View className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            {activeWorkerCount === 0 ? (
              <View className="py-14 items-center">
                <Timer size={32} color="#cbd5e1" />
                <Text className="text-gray-400 font-medium mt-3 text-sm">
                  {metricsLoading && dataType === 'helper' ? 'Loading stage metrics…' : 'No data found for this period'}
                </Text>
                <Text className="text-gray-300 text-xs mt-1">
                  {dataType === 'helper'
                    ? 'Try a different date range or check if stages were completed'
                    : 'No rider pickup/delivery records in this range'}
                </Text>
              </View>
            ) : (
              <>
                {/* Table Header */}
                <View className="flex-row bg-gray-100/90 border-b border-gray-200 py-2.5 px-2.5 items-center">
                  <Text className="w-[92px] text-[10px] font-black text-gray-700 uppercase tracking-wider shrink-0">STAFF</Text>
                  {dataType === 'helper' ? (
                    REPORT_STAGE_KEYS.map(k => (
                      <Text key={k} className="flex-1 text-[10px] font-black text-gray-700 uppercase tracking-wider text-center">
                        {REPORT_STAGE_LABELS[k]}
                      </Text>
                    ))
                  ) : (
                    <>
                      <Text className="flex-1 text-[10px] font-black text-gray-700 uppercase tracking-wider text-center">AVG PICKUP</Text>
                      <Text className="flex-1 text-[10px] font-black text-gray-700 uppercase tracking-wider text-center">AVG DELIVERY</Text>
                    </>
                  )}
                </View>

                {/* Table Rows */}
                {dataType === 'helper'
                  ? helperReport.rows.map((row, idx) => (
                      <View
                        key={row.staffName}
                        className={`flex-row items-center border-b border-gray-100 py-3 px-2.5 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}`}
                      >
                        <View className="w-[92px] shrink-0 pr-1">
                          <Text className="text-gray-900 font-bold text-xs" numberOfLines={1}>{row.staffName}</Text>
                        </View>
                        {REPORT_STAGE_KEYS.map(k => {
                          const s = row.stages[k];
                          const isIron = k === 'getting_ironed';
                          return (
                            <View key={k} className="flex-1 items-center">
                              {s && s.completedCount > 0 ? (
                                <View className="items-center">
                                  <Text
                                    className={`font-black text-sm ${
                                      s.avgMinutes === null
                                        ? 'text-gray-500'
                                        : s.avgMinutes <= 20
                                        ? 'text-emerald-700'
                                        : s.avgMinutes <= 45
                                        ? 'text-amber-700'
                                        : 'text-rose-700'
                                    }`}
                                  >
                                    {s.avgMinutes !== null ? `${s.avgMinutes}m` : '—'}
                                  </Text>
                                  <Text className="text-[9px] text-gray-500 font-semibold">{s.completedCount}x</Text>
                                  {isIron && s.pieces > 0 && (
                                    <View className="mt-0.5 px-1.5 py-0.5 rounded bg-purple-100">
                                      <Text className="text-[9px] font-black text-purple-800">
                                        {s.hasEstimatedPieces ? '~' : ''}{s.pieces} pcs
                                      </Text>
                                    </View>
                                  )}
                                </View>
                              ) : (
                                <Text className="text-gray-300 text-xs">—</Text>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    ))
                  : riderReport.rows.map((row, idx) => (
                      <View
                        key={row.staffName}
                        className={`flex-row items-center border-b border-gray-100 py-3 px-2.5 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}`}
                      >
                        <View className="w-[92px] shrink-0 pr-1">
                          <Text className="text-gray-900 font-bold text-xs" numberOfLines={1}>{row.staffName}</Text>
                        </View>
                        <View className="flex-1 items-center">
                          {row.pickupCount > 0 ? (
                            <View className="items-center">
                              <View className="flex-row items-center gap-0.5">
                                <Truck size={10} color="#2563eb" />
                                <Text className="font-black text-sm text-blue-700">
                                  {row.pickupAvgMin !== null ? `${row.pickupAvgMin}m` : '—'}
                                </Text>
                              </View>
                              <Text className="text-[9px] text-gray-500 font-semibold">{row.pickupCount}x</Text>
                            </View>
                          ) : (
                            <Text className="text-gray-300 text-xs">—</Text>
                          )}
                        </View>
                        <View className="flex-1 items-center">
                          {row.deliveryCount > 0 ? (
                            <View className="items-center">
                              <View className="flex-row items-center gap-0.5">
                                <CheckCircle2 size={10} color="#059669" />
                                <Text className="font-black text-sm text-emerald-700">
                                  {row.deliveryAvgMin !== null ? `${row.deliveryAvgMin}m` : '—'}
                                </Text>
                              </View>
                              <Text className="text-[9px] text-gray-500 font-semibold">{row.deliveryCount}x</Text>
                            </View>
                          ) : (
                            <Text className="text-gray-300 text-xs">—</Text>
                          )}
                        </View>
                      </View>
                    ))}
              </>
            )}
          </View>

          {/* IRONING OUTPUT BREAKDOWN (Helpers) */}
          {dataType === 'helper' && helperReport.ironingSummary.totalLoads > 0 && (
            <View className="bg-white rounded-2xl p-4 mt-3 border border-purple-200">
              <View className="flex-row items-center justify-between mb-3">
                <View className="flex-row items-center gap-2">
                  <Shirt size={16} color="#7c3aed" />
                  <Text className="text-gray-900 font-bold text-sm">Ironing Pieces Breakdown</Text>
                </View>
                <View className="px-2.5 py-1 rounded-full bg-purple-100 border border-purple-200">
                  <Text className="text-purple-800 text-xs font-black">
                    {helperReport.ironingSummary.hasEstimatedPieces ? '~' : ''}
                    {helperReport.ironingSummary.totalPieces} pcs · {helperReport.ironingSummary.totalLoads} loads
                  </Text>
                </View>
              </View>

              {/* Service-level totals strip */}
              <View className="flex-row flex-wrap gap-1.5 mb-3">
                {IRONING_BUCKETS.map(bucket => {
                  const st = helperReport.ironingSummary.byService[bucket];
                  if (st.loads === 0) return null;
                  return (
                    <View key={bucket} className="px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200">
                      <Text className="text-[10px] font-bold text-gray-600">
                        {IRONING_SERVICE_LABELS[bucket]}:{' '}
                        <Text className="text-gray-900 font-black">{st.pieces} pcs</Text> ({st.loads}x)
                      </Text>
                    </View>
                  );
                })}
                {dates.length > 1 && (
                  <View className="px-2.5 py-1 rounded-lg bg-purple-50 border border-purple-200">
                    <Text className="text-[10px] font-bold text-purple-700">
                      Avg: <Text className="font-black">{helperReport.ironingSummary.avgPiecesPerDay} pcs/day</Text>
                    </Text>
                  </View>
                )}
              </View>

              {/* Per-staff ironing output cards */}
              <View className="gap-2">
                {ironingStaffRows.map(row => {
                  const perDay = dates.length > 1 ? Math.round(row.ironingTotalPieces / dates.length) : null;
                  return (
                    <View key={row.staffName} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                      <View className="flex-row items-center justify-between mb-1.5">
                        <View className="flex-row items-center gap-2">
                          <Text className="text-gray-900 font-black text-sm">{row.staffName}</Text>
                          {row.ironingAvgMin !== null && (
                            <Text className="text-[10px] font-semibold text-gray-500">· {row.ironingAvgMin}m avg</Text>
                          )}
                        </View>
                        <View className="flex-row items-center gap-1.5">
                          <Text className="text-purple-800 font-black text-sm">
                            {row.ironingHasEstimated ? '~' : ''}{row.ironingTotalPieces} pcs
                          </Text>
                          <Text className="text-gray-500 text-xs font-semibold">
                            ({row.ironingTotalLoads}x{perDay !== null ? ` · ${perDay}/d` : ''})
                          </Text>
                        </View>
                      </View>
                      <View className="flex-row flex-wrap gap-1.5">
                        {IRONING_BUCKETS.map(bucket => {
                          const st = row.ironingByService[bucket];
                          if (st.loads === 0) return null;
                          return (
                            <View key={bucket} className="px-2 py-0.5 rounded bg-white border border-gray-200">
                              <Text className="text-[10px] text-gray-600 font-semibold">
                                {IRONING_SERVICE_LABELS[bucket]}: <Text className="text-gray-900 font-bold">{st.pieces} pcs</Text> ({st.loads})
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  );
                })}
              </View>

              {helperReport.ironingSummary.hasEstimatedPieces && (
                <Text className="text-[10px] text-gray-400 mt-2">
                  ~ indicates historical delivered multi-load orders estimated pro-rata from combined order piece count. New completions record exact per-load pieces.
                </Text>
              )}

              {/* Day-by-day ironing breakdown (multi-day ranges) */}
              {dates.length > 1 && helperReport.ironingSummary.byDay.length > 0 && (
                <View className="mt-3 pt-3 border-t border-gray-100">
                  <Text className="text-gray-700 font-bold text-xs mb-2">Daily Ironing Pieces</Text>
                  <View className="gap-1.5">
                    {[...helperReport.ironingSummary.byDay].reverse().map(d => (
                      <View
                        key={d.date}
                        className="flex-row items-center justify-between bg-gray-50 rounded-xl px-3 py-2 border border-gray-100"
                      >
                        <Text className="text-gray-900 font-bold text-xs w-[84px]">{fmtDate(d.date)}</Text>
                        <View className="flex-1 flex-row flex-wrap justify-end gap-2">
                          {Object.entries(d.byStaff)
                            .sort((a, b) => b[1].pieces - a[1].pieces)
                            .map(([name, st]) => (
                              <Text key={name} className="text-[11px] text-gray-600 font-semibold">
                                {name}: <Text className="text-purple-800 font-black">{st.pieces}p</Text> ({st.loads}x)
                              </Text>
                            ))}
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Day-by-day breakdown (for riders) */}
          {dataType === 'rider' && riderReport.dayStats.some(d => d.pickupCount > 0 || d.deliveryCount > 0) && (
            <View className="bg-white rounded-2xl p-4 mt-3 border border-gray-200">
              <View className="flex-row items-center gap-2 mb-3">
                <Calendar size={16} color="#994bff" />
                <Text className="text-gray-900 font-bold text-sm">Daily Breakdown</Text>
                <View className="flex-row items-center gap-2 ml-auto">
                  <View className="flex-row items-center gap-1">
                    <Truck size={10} color="#3b82f6" />
                    <Text className="text-blue-600 text-[10px] font-bold">Pickups</Text>
                  </View>
                  <View className="flex-row items-center gap-1">
                    <CheckCircle2 size={10} color="#059669" />
                    <Text className="text-emerald-600 text-[10px] font-bold">Deliveries</Text>
                  </View>
                </View>
              </View>
              <View className="gap-1.5">
                {riderReport.dayStats.filter(d => d.pickupCount > 0 || d.deliveryCount > 0).map(d => (
                  <View key={d.date} className="flex-row items-center justify-between bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                    <Text className="text-gray-900 font-bold text-xs w-[80px]">{fmtDate(d.date)}</Text>
                    <View className="flex-row items-center gap-3">
                      <View className="flex-row items-center gap-1">
                        <Truck size={10} color="#3b82f6" />
                        <Text className="text-blue-700 font-bold text-xs">{d.pickupCount}</Text>
                        <Text className="text-blue-500 text-[10px]">{d.pickupAvgMin !== null ? `· ${d.pickupAvgMin}m avg` : ''}</Text>
                      </View>
                      <View className="flex-row items-center gap-1">
                        <CheckCircle2 size={10} color="#059669" />
                        <Text className="text-emerald-700 font-bold text-xs">{d.deliveryCount}</Text>
                        <Text className="text-emerald-500 text-[10px]">{d.deliveryAvgMin !== null ? `· ${d.deliveryAvgMin}m avg` : ''}</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
