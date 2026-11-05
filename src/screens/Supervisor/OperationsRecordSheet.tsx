import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { useOpsProcessStore } from '../../store/opsProcessStore';
import { useStaffRosterStore } from '../../store/staffRosterStore';
import { db, collection, getDocs, query, where } from '../../config/firebase';
import { isToday, timeAgo, getPickupInfo } from '../../utils/orderFeed';
import { useResponsive } from '../../utils/useResponsive';
import { Calendar, Users, Timer, X, Truck, CheckCircle2, ChevronLeft, ChevronRight, TrendingUp, Wrench, Bike } from 'lucide-react-native';

const STAGE_KEYS = ['tagging', 'getting_washed', 'getting_dried', 'getting_ironed', 'packaging'];
const STAGE_LABELS: Record<string, string> = {
  tagging: 'Tagging',
  getting_washed: 'Washing',
  getting_dried: 'Drying',
  getting_ironed: 'Ironing',
  packaging: 'Packaging',
};

interface StageAvg {
  avgMinutes: number | null;
  completedCount: number;
}

interface StaffTimingRow {
  staffName: string;
  stages: Record<string, StageAvg>;
  pickupAvgMin: number | null;
  pickupCount: number;
  deliveryAvgMin: number | null;
  deliveryCount: number;
}

interface DayStat {
  date: string;
  label: string;
  pickupCount: number;
  deliveryCount: number;
  pickupAvgMin: number | null;
  deliveryAvgMin: number | null;
}

const getMs = (t: any): number => {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.toDate === 'function') return t.toDate().getTime();
  if (t.seconds) return t.seconds * 1000;
  const p = new Date(t).getTime();
  return isNaN(p) ? 0 : p;
};

// Formats a Date as YYYY-MM-DD in local time (toISOString would shift by TZ)
const localISO = (d: Date): string => {
  const c = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return c.toISOString().split('T')[0];
};

const fmtDate = (dateStr: string) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const today = new Date();
  const diffDays = Math.round((today.getTime() - dt.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
};

// Parses a YYYY-MM-DD string as local midnight (new Date(str) would be UTC)
const dayStartMs = (dateStr: string): number => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};

const rangeDates = (start: string, end: string): string[] => {
  const dates: string[] = [];
  const s = new Date(dayStartMs(start));
  const e = new Date(dayStartMs(end));
  while (s <= e) {
    dates.push(localISO(s));
    s.setDate(s.getDate() + 1);
  }
  return dates;
};

export function OperationsRecordSheet({ onClose }: { onClose?: () => void }) {
  const { orders, initialize: initOrders } = useOrderFeedStore();
  const processes = useOpsProcessStore(s => s.processes);
  const roster = useStaffRosterStore(s => s.roster);
  const { maxContainerStyle, isDesktop } = useResponsive();

  const todayStr = localISO(new Date());
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);
  const [selectedStaff, setSelectedStaff] = useState<string>('all');
  const [dataType, setDataType] = useState<'helper' | 'rider'>('helper');
  const [tab, setTab] = useState<'overview' | 'staff'>('overview');

  // Initialize stores that may not have been initialized
  useEffect(() => {
    initOrders();
  }, [initOrders]);

  // Rider attribution is unreliable on the order doc itself: `riderId` is written only on
  // MANUAL assignment, while auto-dispatched pickups record the rider solely as
  // `ops_tasks/{orderId}.assignee`. Deliveries likewise live in `ops_delivery_tasks`.
  // So we load a full staff directory (the roster store only tracks ON-SHIFT staff, which
  // is useless for historical analysis) plus the task collections to join back to orders.
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  const [taskRiders, setTaskRiders] = useState<Record<string, { pickupUid?: string; deliveryUid?: string }>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [staffSnap, taskSnap, delSnap] = await Promise.all([
          getDocs(query(collection(db, 'ops_staff'), where('role', '==', 'rider'))),
          getDocs(collection(db, 'ops_tasks')),
          getDocs(collection(db, 'ops_delivery_tasks')),
        ]);
        if (cancelled) return;

        const names: Record<string, string> = {};
        staffSnap.forEach(d => {
          const name = (d.data() as any).name;
          if (name) names[d.id] = name;
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

        setStaffNames(names);
        setTaskRiders(byOrder);
      } catch (err) {
        console.warn('[OperationsRecord] rider directory load failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // uid -> display name, merging the full directory with the live roster.
  const riderNameByUid = useMemo(() => {
    const map: Record<string, string> = { ...staffNames };
    roster.riders.forEach(r => { if (r.name) map[r.uid] = r.name; });
    return map;
  }, [staffNames, roster.riders]);

  // Resolves the rider responsible for a leg of the order. Order-doc `riderId` is only set on
  // manual assignment, so fall back to the task collections (which record every dispatch),
  // then to any legacy `riderName` field.
  const riderNameFor = (o: any, leg: 'pickup' | 'delivery'): string => {
    const taskInfo = taskRiders[o.id] || taskRiders[(o as any).orderId] || {};
    const uid = leg === 'pickup'
      ? (o.riderId || taskInfo.pickupUid)
      : ((o as any).deliveryRiderId || o.riderId || taskInfo.deliveryUid || taskInfo.pickupUid);
    const resolved = uid ? riderNameByUid[uid] : undefined;
    return resolved || (o as any).riderName || 'Unassigned';
  };

  // All staff names from data
  const allHelperNames = useMemo(() => {
    const names = new Set<string>();
    roster.helpers.forEach(h => { if (h.name) names.add(h.name); });
    if (dataType === 'helper') {
      processes.forEach(p => {
        Object.values(p.stages || {}).forEach((s: any) => {
          if (s.assigneeName) names.add(s.assigneeName);
        });
      });
    }
    return Array.from(names).sort();
  }, [roster.helpers, processes, dataType]);

  const allRiderNames = useMemo(() => {
    const names = new Set<string>();
    roster.riders.forEach(r => { if (r.name) names.add(r.name); });
    Object.values(riderNameByUid).forEach(n => { if (n) names.add(n); });
    let hasUnassigned = false;
    orders.forEach(o => {
      const pickupName = riderNameFor(o, 'pickup');
      const deliveryName = riderNameFor(o, 'delivery');
      if (pickupName === 'Unassigned' && deliveryName === 'Unassigned') {
        if (o.pickedUpAt || o.deliveredAt || (o as any).pickupCompletedAt || (o as any).deliveryCompletedAt) {
          hasUnassigned = true;
        }
      }
    });
    const sorted = Array.from(names).sort();
    if (hasUnassigned) sorted.push('Unassigned');
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster.riders, orders, riderNameByUid, taskRiders]);

  const activeNames = dataType === 'helper' ? allHelperNames : allRiderNames;

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
    setAnchorDate(null);
  };

  const applyPreset = (preset: 'today' | 'yesterday' | '7d' | '30d' | 'month') => {
    const now = new Date();
    const iso = localISO;
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

  // ====== COMPUTE TIMING DATA ======
  // Source 1: ops_process stage records (live processes)
  // Source 2: order stageTimings from feed (completed orders)
  const timingRows = useMemo((): StaffTimingRow[] => {
    const startTs = dayStartMs(startDate);
    const endTs = dayStartMs(endDate) + 86400000;

    if (dataType === 'helper') {
      const staffMap = new Map<string, Record<string, { total: number; count: number }>>();

      // Helper 1: From ops_process live data
      processes.forEach(p => {
        Object.entries(p.stages || {}).forEach(([rawStep, s]: [string, any]) => {
          if (!s || !s.completedAt || !s.assigneeName) return;
          const step = rawStep === 'drying' ? 'getting_dried' : (rawStep === 'ironing' ? 'getting_ironed' : rawStep);
          if (!STAGE_KEYS.includes(step)) return;
          const compMs = getMs(s.completedAt);
          if (compMs < startTs || compMs >= endTs) return;
          const min = getStageDuration(s);
          if (min === null) return;
          const name = s.assigneeName;
          if (selectedStaff !== 'all' && name !== selectedStaff) return;
          if (!staffMap.has(name)) staffMap.set(name, {});
          const staff = staffMap.get(name)!;
          if (!staff[step]) staff[step] = { total: 0, count: 0 };
          staff[step].total += min;
          staff[step].count += 1;
        });
      });

      // Helper 2: From order stageTimings (completed orders in feed)
      orders.forEach(o => {
        const timings = (o as any).stageTimings;
        if (!timings || typeof timings !== 'object') return;
        Object.entries(timings).forEach(([rawStep, s]: [string, any]) => {
          if (!s || !s.completedAt) return;
          const step = rawStep === 'drying' ? 'getting_dried' : (rawStep === 'ironing' ? 'getting_ironed' : rawStep);
          if (!STAGE_KEYS.includes(step)) return;
          const compMs = getMs(s.completedAt);
          if (compMs < startTs || compMs >= endTs) return;

          const min = getStageDuration(s);
          if (min === null) return;

          const name = s.assigneeName || (s as any).assigneeName || (s as any).assignee || 'Unknown';
          if (selectedStaff !== 'all' && name !== selectedStaff) return;
          if (!staffMap.has(name)) staffMap.set(name, {});
          const staff = staffMap.get(name)!;
          if (!staff[step]) staff[step] = { total: 0, count: 0 };
          staff[step].total += min;
          staff[step].count += 1;
        });
      });

      return Array.from(staffMap.entries()).map(([staffName, stages]) => {
        const stageData: Record<string, StageAvg> = {};
        STAGE_KEYS.forEach(k => {
          const d = stages[k];
          stageData[k] = d && d.count > 0
            ? { avgMinutes: Math.round(d.total / d.count), completedCount: d.count }
            : { avgMinutes: null, completedCount: 0 };
        });
        return { staffName, stages: stageData, pickupAvgMin: null, pickupCount: 0, deliveryAvgMin: null, deliveryCount: 0 };
      }).sort((a, b) => {
        const sum = (r: StaffTimingRow) => STAGE_KEYS.reduce((s, k) => s + (r.stages[k]?.completedCount || 0), 0);
        return sum(b) - sum(a);
      });
    } else {
      // Rider data
      const riderMap = new Map<string, { pickupTotal: number; pickupCount: number; deliveryTotal: number; deliveryCount: number }>();

      const addRow = (name: string, kind: 'pickup' | 'delivery', min: number) => {
        if (!riderMap.has(name)) riderMap.set(name, { pickupTotal: 0, pickupCount: 0, deliveryTotal: 0, deliveryCount: 0 });
        const rec = riderMap.get(name)!;
        if (kind === 'pickup') { rec.pickupTotal += min; rec.pickupCount += 1; }
        else { rec.deliveryTotal += min; rec.deliveryCount += 1; }
      };

      orders.forEach(o => {
        // Resolve each leg independently — the pickup rider and the delivery rider
        // are frequently different people and are tracked separately.
        const pickupRider = riderNameFor(o, 'pickup');
        const deliveryRider = riderNameFor(o, 'delivery');

        // Pickup: createdAt -> pickedUpAt, bucketed by when the pickup happened
        const pickTs = o.pickedUpAt || (o as any).pickupCompletedAt;
        if (pickTs) {
          const pickMs = getMs(pickTs);
          const oMs = getMs(o.createdAt);
          if (pickMs >= startTs && pickMs < endTs && pickMs > oMs) {
            if (selectedStaff === 'all' || pickupRider === selectedStaff) {
              const min = Math.round((pickMs - oMs) / 60000);
              if (min > 0 && min < 600) addRow(pickupRider, 'pickup', min);
            }
          }
        }

        // Delivery: ready/out-for-delivery -> deliveredAt, bucketed by delivery time
        const delTs = o.deliveredAt || (o as any).deliveryCompletedAt;
        if (delTs) {
          const delMs = getMs(delTs);
          if (delMs >= startTs && delMs < endTs) {
            const refMs = getMs(o.outForDeliveryAt || o.readyAt || o.createdAt);
            if (delMs > refMs) {
              if (selectedStaff === 'all' || deliveryRider === selectedStaff) {
                const min = Math.round((delMs - refMs) / 60000);
                if (min > 0 && min < 600) addRow(deliveryRider, 'delivery', min);
              }
            }
          }
        }
      });

      return Array.from(riderMap.entries()).map(([staffName, d]) => ({
        staffName,
        stages: {},
        pickupAvgMin: d.pickupCount > 0 ? Math.round(d.pickupTotal / d.pickupCount) : null,
        pickupCount: d.pickupCount,
        deliveryAvgMin: d.deliveryCount > 0 ? Math.round(d.deliveryTotal / d.deliveryCount) : null,
        deliveryCount: d.deliveryCount,
      })).sort((a, b) => (b.pickupCount + b.deliveryCount) - (a.pickupCount + a.deliveryCount));
    }
  }, [processes, orders, startDate, endDate, selectedStaff, dataType, riderNameByUid, taskRiders]);

  // Day-by-day overview stats
  const dayStats = useMemo((): DayStat[] => {
    if (dataType === 'helper') return [];
    return dates.map(dateStr => {
      const dStart = dayStartMs(dateStr);
      const dEnd = dStart + 86400000;

      let pickupCount = 0, deliveryCount = 0;
      let pickupTotal = 0, deliveryTotal = 0;

      orders.forEach(o => {
        const pickR = riderNameFor(o, 'pickup');
        const delR = riderNameFor(o, 'delivery');

        const pickTs = o.pickedUpAt || (o as any).pickupCompletedAt;
        if (pickTs) {
          const pickMs = getMs(pickTs);
          if (pickMs >= dStart && pickMs < dEnd) {
            if (selectedStaff === 'all' || pickR === selectedStaff) {
              pickupCount++;
              const oMs = getMs(o.createdAt);
              if (oMs > 0 && pickMs > oMs) {
                const min = Math.round((pickMs - oMs) / 60000);
                if (min > 0 && min < 600) pickupTotal += min;
              }
            }
          }
        }
        const delTs = o.deliveredAt || (o as any).deliveryCompletedAt;
        if (delTs) {
          const delMs = getMs(delTs);
          if (delMs >= dStart && delMs < dEnd) {
            if (selectedStaff === 'all' || delR === selectedStaff) {
              deliveryCount++;
              const refMs = getMs(o.outForDeliveryAt || o.readyAt || o.createdAt);
              if (refMs > 0 && delMs > refMs) {
                const min = Math.round((delMs - refMs) / 60000);
                if (min > 0 && min < 600) deliveryTotal += min;
              }
            }
          }
        }
      });

      return {
        date: dateStr,
        label: fmtDate(dateStr),
        pickupCount,
        deliveryCount,
        pickupAvgMin: pickupCount > 0 && pickupTotal > 0 ? Math.round(pickupTotal / pickupCount) : null,
        deliveryAvgMin: deliveryCount > 0 && deliveryTotal > 0 ? Math.round(deliveryTotal / deliveryCount) : null,
      };
    });
  }, [orders, dates, dataType, selectedStaff]);

  // Overall averages across all matching data
  const overallStats = useMemo(() => {
    if (timingRows.length === 0) return null;

    if (dataType === 'helper') {
      const totals: Record<string, { total: number; count: number }> = {};
      STAGE_KEYS.forEach(k => { totals[k] = { total: 0, count: 0 }; });

      timingRows.forEach(row => {
        STAGE_KEYS.forEach(k => {
          const s = row.stages[k];
          if (s?.avgMinutes && s.completedCount > 0) {
            totals[k].total += s.avgMinutes * s.completedCount;
            totals[k].count += s.completedCount;
          }
        });
      });

      return {
        stages: STAGE_KEYS.map(k => ({
          key: k,
          label: STAGE_LABELS[k],
          avg: totals[k].count > 0 ? Math.round(totals[k].total / totals[k].count) : null,
          count: totals[k].count,
        })),
        pickupAvg: null,
        deliveryAvg: null,
        totalWorkers: timingRows.length,
      };
    }

    const pickupCount = timingRows.reduce((s, r) => s + r.pickupCount, 0);
    const deliveryCount = timingRows.reduce((s, r) => s + r.deliveryCount, 0);
    const pickupTotal = timingRows.reduce((s, r) => s + (r.pickupAvgMin || 0) * r.pickupCount, 0);
    const deliveryTotal = timingRows.reduce((s, r) => s + (r.deliveryAvgMin || 0) * r.deliveryCount, 0);
    const pickupAvg = pickupCount > 0 && pickupTotal > 0 ? Math.round(pickupTotal / pickupCount) : null;
    const deliveryAvg = deliveryCount > 0 && deliveryTotal > 0 ? Math.round(deliveryTotal / deliveryCount) : null;

    return {
      stages: [],
      pickupAvg,
      deliveryAvg,
      totalWorkers: timingRows.length,
      pickupCount,
      deliveryCount,
    };
  }, [timingRows, dataType]);

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
                <Text className="text-gray-500 text-xs">
                  {dates.length} day{dates.length > 1 ? 's' : ''} · {timingRows.length} staff active
                </Text>
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
                <Text className={`text-[10px] ${dataType === 'helper' ? 'text-purple-600' : 'text-gray-400'}`}>Stage timing</Text>
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
            <View className="flex-row flex-wrap gap-1.5 mb-3">
              {([
                ['today', 'Today'],
                ['yesterday', 'Yesterday'],
                ['7d', 'Last 7 days'],
                ['30d', 'Last 30 days'],
                ['month', 'This month'],
              ] as const).map(([key, label]) => (
                <TouchableOpacity
                  key={key}
                  onPress={() => applyPreset(key)}
                  className="px-3 py-1.5 rounded-full border bg-gray-50 border-gray-200 active:bg-gray-100"
                >
                  <Text className="text-xs font-bold text-gray-600">{label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Calendar */}
            {pickerOpen && (
              <View className="border-t border-gray-100 pt-3">
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
          {overallStats && (
            <View className="bg-white rounded-2xl p-4 mb-3 border border-gray-200">
              <View className="flex-row items-center gap-2 mb-3">
                <TrendingUp size={16} color="#994bff" />
                <Text className="text-gray-900 font-bold text-sm">Overview</Text>
                <Text className="text-gray-400 text-xs ml-auto">{timingRows.length} staff · {dates.length} days</Text>
              </View>

              {dataType === 'helper' ? (
                <View className={`gap-2 ${isDesktop ? 'flex-row' : ''}`}>
                  {overallStats.stages.map(s => (
                    <View key={s.key} className={`${isDesktop ? 'flex-1' : ''} bg-gray-50 rounded-xl p-3 border border-gray-100 items-center`}>
                      <Text className="text-gray-500 text-[10px] font-bold uppercase">{s.label}</Text>
                      <Text className={`text-lg font-black mt-0.5 ${s.avg !== null && s.avg <= 20 ? 'text-emerald-700' : s.avg !== null && s.avg <= 40 ? 'text-amber-700' : 'text-gray-400'}`}>
                        {s.avg !== null ? `${s.avg}m` : '—'}
                      </Text>
                      <Text className="text-gray-400 text-[9px]">{s.count} orders</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <View className={`gap-3 ${isDesktop ? 'flex-row' : ''}`}>
                  <View className={`${isDesktop ? 'flex-1' : ''} bg-blue-50 rounded-xl p-3.5 border border-blue-200`}>
                    <View className="flex-row items-center justify-between mb-1">
                      <Text className="text-blue-800 text-[10px] font-black uppercase">Avg Pickup Time</Text>
                      <Truck size={14} color="#2563eb" />
                    </View>
                    <Text className="text-2xl font-black text-blue-900">
                      {overallStats.pickupAvg !== null ? `${overallStats.pickupAvg}m` : '—'}
                    </Text>
                    <Text className="text-blue-700 text-xs font-semibold mt-0.5">{overallStats.pickupCount} pickups</Text>
                  </View>
                  <View className={`${isDesktop ? 'flex-1' : ''} bg-emerald-50 rounded-xl p-3.5 border border-emerald-200`}>
                    <View className="flex-row items-center justify-between mb-1">
                      <Text className="text-emerald-800 text-[10px] font-black uppercase">Avg Delivery Time</Text>
                      <CheckCircle2 size={14} color="#059669" />
                    </View>
                    <Text className="text-2xl font-black text-emerald-900">
                      {overallStats.deliveryAvg !== null ? `${overallStats.deliveryAvg}m` : '—'}
                    </Text>
                    <Text className="text-emerald-700 text-xs font-semibold mt-0.5">{overallStats.deliveryCount} deliveries</Text>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* DATA TABLE */}
          <View className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            {timingRows.length === 0 ? (
              <View className="py-14 items-center">
                <Timer size={32} color="#cbd5e1" />
                <Text className="text-gray-400 font-medium mt-3 text-sm">No data found for this period</Text>
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
                  <Text className="w-[100px] text-[10px] font-black text-gray-700 uppercase tracking-wider shrink-0">STAFF</Text>
                  {dataType === 'helper' ? (
                    STAGE_KEYS.map(k => (
                      <Text key={k} className="flex-1 text-[10px] font-black text-gray-700 uppercase tracking-wider text-center">{STAGE_LABELS[k]}</Text>
                    ))
                  ) : (
                    <>
                      <Text className="flex-1 text-[10px] font-black text-gray-700 uppercase tracking-wider text-center">AVG PICKUP</Text>
                      <Text className="flex-1 text-[10px] font-black text-gray-700 uppercase tracking-wider text-center">AVG DELIVERY</Text>
                    </>
                  )}
                </View>

                {/* Table Rows */}
                {timingRows.map((row, idx) => (
                  <View key={row.staffName} className={`flex-row items-center border-b border-gray-100 py-3 px-2.5 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}`}>
                    <View className="w-[100px] shrink-0 pr-1">
                      <Text className="text-gray-900 font-bold text-xs" numberOfLines={1}>{row.staffName}</Text>
                    </View>
                    {dataType === 'helper' ? (
                      STAGE_KEYS.map(k => {
                        const s = row.stages[k];
                        return (
                          <View key={k} className="flex-1 items-center">
                            {s?.avgMinutes ? (
                              <View className="items-center">
                                <Text className={`font-black text-sm ${s.avgMinutes <= 15 ? 'text-emerald-700' : s.avgMinutes <= 35 ? 'text-amber-700' : 'text-rose-700'}`}>
                                  {s.avgMinutes}m
                                </Text>
                                <Text className="text-[9px] text-gray-400">{s.completedCount}x</Text>
                              </View>
                            ) : (
                              <Text className="text-gray-300 text-xs">—</Text>
                            )}
                          </View>
                        );
                      })
                    ) : (
                      <>
                        <View className="flex-1 items-center">
                          {row.pickupAvgMin ? (
                            <View className="items-center">
                              <View className="flex-row items-center gap-0.5">
                                <Truck size={10} color="#2563eb" />
                                <Text className="font-black text-sm text-blue-700">{row.pickupAvgMin}m</Text>
                              </View>
                              <Text className="text-[9px] text-gray-400">{row.pickupCount}x</Text>
                            </View>
                          ) : (
                            <Text className="text-gray-300 text-xs">—</Text>
                          )}
                        </View>
                        <View className="flex-1 items-center">
                          {row.deliveryAvgMin ? (
                            <View className="items-center">
                              <View className="flex-row items-center gap-0.5">
                                <CheckCircle2 size={10} color="#059669" />
                                <Text className="font-black text-sm text-emerald-700">{row.deliveryAvgMin}m</Text>
                              </View>
                              <Text className="text-[9px] text-gray-400">{row.deliveryCount}x</Text>
                            </View>
                          ) : (
                            <Text className="text-gray-300 text-xs">—</Text>
                          )}
                        </View>
                      </>
                    )}
                  </View>
                ))}
              </>
            )}
          </View>

          {/* Day-by-day breakdown (for riders) */}
          {dataType === 'rider' && dayStats.some(d => d.pickupCount > 0 || d.deliveryCount > 0) && (
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
                {dayStats.filter(d => d.pickupCount > 0 || d.deliveryCount > 0).map(d => (
                  <View key={d.date} className="flex-row items-center justify-between bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                    <Text className="text-gray-900 font-bold text-xs w-[80px]">{d.label}</Text>
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

// Shared duration helper
function getStageDuration(s: any): number | null {
  if (typeof s.startToCompleteMin === 'number' && s.startToCompleteMin > 0) return s.startToCompleteMin;
  if (typeof s.acceptToCompleteMin === 'number' && s.acceptToCompleteMin > 0) return s.acceptToCompleteMin;
  if (typeof s.durationMs === 'number' && s.durationMs > 0) return Math.round(s.durationMs / 60000);
  if (s.completedAt && (s.startedAt || s.acceptedAt)) {
    const cMs = getMs(s.completedAt);
    const stMs = getMs(s.startedAt || s.acceptedAt);
    if (cMs > stMs && stMs > 0) {
      const min = Math.round((cMs - stMs) / 60000);
      if (min > 0 && min < 600) return min;
    }
  }
  return null;
}