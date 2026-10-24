import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { ClipboardList, Users, IndianRupee, Clock, Calendar, ChevronLeft, ChevronRight, AlertCircle, CheckCircle2 } from 'lucide-react-native';
import { db } from '../../config/firebase';
import { collection, onSnapshot, doc, getDoc, query, Unsubscribe } from '../../config/firebase';
import { ShiftDoc } from '../../store/attendanceStore';
import { useStaffRosterStore } from '../../store/staffRosterStore';

interface StaffDocData {
  uid: string;
  name?: string;
  role?: string;
  phone?: string;
  fee?: number;
  dailyFee?: number;
  onShift?: boolean;
}

interface TargetStaffConfig {
  key: string;
  displayName: string;
  role: 'helper' | 'rider';
  roleDisplay: string;
  defaultFee: number;
  phoneHint: string;
  match: (staff: StaffDocData) => boolean;
}

// Strictly configured 5 active floor staff members requested by operations:
// samsul, abdur, abdul, hrithik, and admin rider (9108558714)
const TARGET_STAFF: TargetStaffConfig[] = [
  {
    key: 'abdul',
    displayName: 'Abdul',
    role: 'helper',
    roleDisplay: 'HELPER',
    defaultFee: 650,
    phoneHint: '1761',
    match: (s) => {
      const name = (s.name || '').toLowerCase();
      const phone = (s.phone || '').trim();
      return name.includes('abdul') || phone.endsWith('1761');
    },
  },
  {
    key: 'abdur',
    displayName: 'Abdur',
    role: 'helper',
    roleDisplay: 'HELPER (IRON)',
    defaultFee: 650,
    phoneHint: '5832',
    match: (s) => {
      const name = (s.name || '').toLowerCase();
      const phone = (s.phone || '').trim();
      return name.includes('abdur') || phone.endsWith('5832');
    },
  },
  {
    key: 'samsul',
    displayName: 'Samsul',
    role: 'helper',
    roleDisplay: 'HELPER (IRON)',
    defaultFee: 650,
    phoneHint: '8237',
    match: (s) => {
      const name = (s.name || '').toLowerCase();
      const phone = (s.phone || '').trim();
      return name.includes('samsul') || phone.endsWith('8237');
    },
  },
  {
    key: 'hrithik',
    displayName: 'Hrithik',
    role: 'rider',
    roleDisplay: 'RIDER',
    defaultFee: 800,
    phoneHint: '3208',
    match: (s) => {
      const name = (s.name || '').toLowerCase();
      const phone = (s.phone || '').trim();
      return name.includes('hrithik') || phone.endsWith('3208');
    },
  },
  {
    key: 'admin_rider',
    displayName: 'Admin Rider',
    role: 'rider',
    roleDisplay: 'RIDER',
    defaultFee: 800,
    phoneHint: '8714',
    match: (s) => {
      const phone = (s.phone || '').trim();
      return phone === '9108558714' || phone.endsWith('8714');
    },
  },
];

const getTodayStr = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const formatTime = (ts: any): string => {
  if (!ts) return '—';
  const ms = typeof ts === 'number' ? ts : typeof ts.toMillis === 'function' ? ts.toMillis() : ts.seconds ? ts.seconds * 1000 : new Date(ts).getTime();
  if (!ms || isNaN(ms)) return '—';
  const d = new Date(ms);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
};

// Generate list of last 7 dates
const generatePastDates = (): string[] => {
  const dates: string[] = [];
  const base = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return dates;
};

const formatDatePillLabel = (dateStr: string): string => {
  const today = getTodayStr();
  if (dateStr === today) return 'Today';
  const yDate = new Date();
  yDate.setDate(yDate.getDate() - 1);
  const yStr = `${yDate.getFullYear()}-${String(yDate.getMonth() + 1).padStart(2, '0')}-${String(yDate.getDate()).padStart(2, '0')}`;
  if (dateStr === yStr) return 'Yesterday';

  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
};

const formatFullDateHeader = (dateStr: string): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};

export function StaffAttendanceTable() {
  const roster = useStaffRosterStore(s => s.roster);
  const [staffDocs, setStaffDocs] = useState<StaffDocData[]>([]);
  const [shiftsMap, setShiftsMap] = useState<Record<string, ShiftDoc>>({});
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>(getTodayStr());

  const todayStr = getTodayStr();
  const isTodaySelected = selectedDate === todayStr;
  const pastDates = useMemo(() => generatePastDates(), []);

  // 1. Listen to ops_staff collection to capture all registered documents
  useEffect(() => {
    let unsubStaff: Unsubscribe | null = null;
    try {
      const q = query(collection(db, 'ops_staff'));
      unsubStaff = onSnapshot(
        q,
        (snap) => {
          const list: StaffDocData[] = [];
          snap.forEach((docSnap) => {
            const data = docSnap.data() as StaffDocData;
            list.push({ ...data, uid: docSnap.id });
          });
          setStaffDocs(list);
          setLoading(false);
        },
        (err) => {
          console.warn('[StaffAttendanceTable] ops_staff listener error:', err);
          setLoading(false);
        }
      );
    } catch (e) {
      console.warn('[StaffAttendanceTable] listener setup error:', e);
      setLoading(false);
    }
    return () => unsubStaff?.();
  }, []);

  // 2. Fetch/Listen to shift documents for the 5 target staff on the selectedDate
  useEffect(() => {
    let active = true;
    const shiftUnsubs: Record<string, Unsubscribe> = {};

    const loadShiftsForDate = async () => {
      // Find all matching UIDs across Firestore for each target staff member
      const newShifts: Record<string, ShiftDoc> = {};

      for (const target of TARGET_STAFF) {
        // Collect all doc UIDs matching this target staff member
        const matchingDocs = staffDocs.filter(d => target.match(d));
        // Also check active roster
        const rosterMatches = [
          ...roster.helpers.filter(h => target.match(h)),
          ...roster.riders.filter(r => target.match(r)),
        ];
        const allUids = Array.from(new Set([...matchingDocs.map(d => d.uid), ...rosterMatches.map(r => r.uid)]));

        if (allUids.length === 0) continue;

        if (isTodaySelected) {
          // Real-time listener for today
          allUids.forEach((uid) => {
            const shiftRef = doc(db, `ops_attendance/${uid}/shifts`, selectedDate);
            shiftUnsubs[uid] = onSnapshot(
              shiftRef,
              (sSnap) => {
                if (sSnap.exists() && active) {
                  const sData = sSnap.data() as ShiftDoc;
                  // If this shift doc has loginAt or status !== 'off', prioritize it
                  setShiftsMap(prev => {
                    const existing = prev[target.key];
                    if (!existing || sData.loginAt || sData.status === 'working') {
                      return { ...prev, [target.key]: sData };
                    }
                    return prev;
                  });
                }
              },
              () => {}
            );
          });
        } else {
          // One-shot fetch for past date records
          for (const uid of allUids) {
            try {
              const shiftRef = doc(db, `ops_attendance/${uid}/shifts`, selectedDate);
              const sSnap = await getDoc(shiftRef);
              if (sSnap.exists()) {
                const sData = sSnap.data() as ShiftDoc;
                if (!newShifts[target.key] || sData.loginAt) {
                  newShifts[target.key] = sData;
                }
              }
            } catch (err) {
              // ignore
            }
          }
        }
      }

      if (!isTodaySelected && active) {
        setShiftsMap(newShifts);
      }
    };

    loadShiftsForDate();

    return () => {
      active = false;
      Object.values(shiftUnsubs).forEach(u => u());
    };
  }, [staffDocs, roster, selectedDate, isTodaySelected]);

  // Handle day step navigation
  const handleStepDay = (step: -1 | 1) => {
    const idx = pastDates.indexOf(selectedDate);
    if (step === -1 && idx < pastDates.length - 1) {
      setSelectedDate(pastDates[idx + 1]);
    } else if (step === 1 && idx > 0) {
      setSelectedDate(pastDates[idx - 1]);
    }
  };

  // Compile row data strictly for the 5 staff members
  const rows = TARGET_STAFF.map((target) => {
    // Find if staff has an active matching doc in ops_staff or roster
    const matchingDocs = staffDocs.filter(d => target.match(d));
    const activeDoc = matchingDocs.find(d => d.onShift) || matchingDocs[0];
    const shift = shiftsMap[target.key];

    const hasShift = !!shift?.loginAt;
    const isPresent = hasShift || (isTodaySelected && !!activeDoc?.onShift);

    // Login Time
    const loginTime = shift?.loginAt ? formatTime(shift.loginAt) : (isTodaySelected && activeDoc?.onShift ? 'Active (App)' : '—');

    // Lunch Time
    let lunchTime = '—';
    let isLunchOverdue = false;
    if (shift?.lunch?.startAt) {
      if (shift.lunch.endAt) {
        const mins = Math.round((shift.lunch.endAt - shift.lunch.startAt) / 60000);
        lunchTime = `${mins}m`;
        if (mins > 120) isLunchOverdue = true;
      } else {
        const ongoingMins = Math.round((Date.now() - shift.lunch.startAt) / 60000);
        lunchTime = `Ongoing (${ongoingMins}m)`;
        if (ongoingMins > 120) isLunchOverdue = true;
      }
    } else if (shift?.totalLunchMs && shift.totalLunchMs > 0) {
      const mins = Math.round(shift.totalLunchMs / 60000);
      lunchTime = `${mins}m`;
      if (mins > 120) isLunchOverdue = true;
    }

    // Break
    let breakTime = '—';
    if (shift?.shortBreaks && shift.shortBreaks.length > 0) {
      const totalBreakMins = shift.shortBreaks.reduce((acc, b) => {
        const end = b.endAt || Date.now();
        return acc + Math.round((end - b.startAt) / 60000);
      }, 0);
      breakTime = `${totalBreakMins}m (${shift.shortBreaks.length}x)`;
    }

    // Log Out Time
    let logoutTime = '—';
    if (shift?.logoutAt) {
      logoutTime = formatTime(shift.logoutAt);
    } else if (isPresent && isTodaySelected) {
      logoutTime = 'On Shift';
    }

    // Fee
    const fee = isPresent ? (activeDoc?.fee || activeDoc?.dailyFee || target.defaultFee) : 0;

    // Remark
    let remarkText = 'Absent';
    let badgeBg = 'bg-rose-50 border-rose-200';
    let badgeText = 'text-rose-700';

    if (shift?.status === 'working') {
      remarkText = 'Working (On Shift)';
      badgeBg = 'bg-emerald-50 border-emerald-300';
      badgeText = 'text-emerald-800';
    } else if (shift?.status === 'lunch') {
      remarkText = 'On Lunch Break';
      badgeBg = 'bg-amber-50 border-amber-300';
      badgeText = 'text-amber-800';
    } else if (shift?.status === 'short_break') {
      remarkText = 'On Short Break';
      badgeBg = 'bg-blue-50 border-blue-300';
      badgeText = 'text-blue-800';
    } else if (shift?.logoutAt) {
      const totalWorkMs = shift.totalWorkMs || 0;
      if (totalWorkMs >= 7 * 3600 * 1000) {
        remarkText = 'Full Shift Done';
        badgeBg = 'bg-emerald-50 border-emerald-300';
        badgeText = 'text-emerald-800';
      } else if (totalWorkMs > 0 && totalWorkMs < 4 * 3600 * 1000) {
        remarkText = 'Half Day';
        badgeBg = 'bg-amber-50 border-amber-300';
        badgeText = 'text-amber-800';
      } else {
        remarkText = 'Shift Completed';
        badgeBg = 'bg-purple-50 border-purple-300';
        badgeText = 'text-purple-800';
      }
    } else if (isPresent) {
      remarkText = 'Working (On Shift)';
      badgeBg = 'bg-emerald-50 border-emerald-300';
      badgeText = 'text-emerald-800';
    }

    return {
      target,
      phoneHint: activeDoc?.phone ? activeDoc.phone.slice(-4) : target.phoneHint,
      loginTime,
      lunchTime,
      isLunchOverdue,
      breakTime,
      logoutTime,
      fee,
      isPresent,
      remarkText,
      badgeBg,
      badgeText,
    };
  });

  const presentCount = rows.filter(r => r.isPresent).length;
  const absentCount = rows.length - presentCount;
  const totalDailyPayout = rows.reduce((sum, r) => sum + r.fee, 0);

  return (
    <View className="bg-white rounded-3xl p-5 mb-5 border border-gray-200/80 shadow-xs">
      {/* Top Header & Day Navigation */}
      <View className="flex-row items-center justify-between mb-3.5 flex-wrap gap-2">
        <View className="flex-row items-center">
          <View className="w-10 h-10 rounded-2xl bg-purple-100 items-center justify-center mr-3 border border-purple-200">
            <ClipboardList size={20} color="#994bff" />
          </View>
          <View>
            <Text className="text-gray-900 font-black text-lg">Staff Attendance & Shift Ledger</Text>
            <Text className="text-gray-500 text-xs font-semibold">
              {formatFullDateHeader(selectedDate)}
            </Text>
          </View>
        </View>

        {/* Step Day Buttons */}
        <View className="flex-row items-center gap-1.5 bg-gray-100/90 p-1 rounded-2xl border border-gray-200">
          <TouchableOpacity
            onPress={() => handleStepDay(-1)}
            disabled={pastDates.indexOf(selectedDate) >= pastDates.length - 1}
            className={`p-1.5 rounded-xl ${pastDates.indexOf(selectedDate) >= pastDates.length - 1 ? 'opacity-30' : 'bg-white shadow-2xs active:bg-gray-50'}`}
          >
            <ChevronLeft size={16} color="#334155" />
          </TouchableOpacity>
          <Text className="text-xs font-bold text-gray-700 px-2 min-w-[75px] text-center">
            {formatDatePillLabel(selectedDate)}
          </Text>
          <TouchableOpacity
            onPress={() => handleStepDay(1)}
            disabled={pastDates.indexOf(selectedDate) <= 0}
            className={`p-1.5 rounded-xl ${pastDates.indexOf(selectedDate) <= 0 ? 'opacity-30' : 'bg-white shadow-2xs active:bg-gray-50'}`}
          >
            <ChevronRight size={16} color="#334155" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Date Pill Strip (Last 7 Days) */}
      <View className="mb-4">
        <ScrollView horizontal={true} showsHorizontalScrollIndicator={false} className="gap-2">
          {pastDates.map((dStr) => {
            const isSel = dStr === selectedDate;
            const label = formatDatePillLabel(dStr);
            return (
              <TouchableOpacity
                key={dStr}
                onPress={() => setSelectedDate(dStr)}
                className={`px-3.5 py-1.5 rounded-full border mr-1.5 flex-row items-center ${
                  isSel
                    ? 'bg-[#994bff] border-[#994bff] shadow-xs'
                    : 'bg-gray-50 border-gray-200 active:bg-gray-100'
                }`}
              >
                <Calendar size={11} color={isSel ? '#ffffff' : '#64748b'} className="mr-1.5" />
                <Text className={`text-xs font-black ${isSel ? 'text-white' : 'text-gray-600'}`}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Metric Summary Cards */}
      <View className="flex-row gap-3 mb-4 flex-wrap">
        <View className="flex-1 min-w-[100px] bg-emerald-50/80 border border-emerald-200/80 p-3 rounded-2xl">
          <View className="flex-row items-center justify-between mb-0.5">
            <Text className="text-emerald-700 text-[10px] font-black uppercase tracking-wider">Present</Text>
            <CheckCircle2 size={13} color="#059669" />
          </View>
          <Text className="text-emerald-950 font-black text-xl">{presentCount} <Text className="text-xs font-semibold text-emerald-700">/ 5 Staff</Text></Text>
        </View>

        <View className="flex-1 min-w-[100px] bg-rose-50/80 border border-rose-200/80 p-3 rounded-2xl">
          <View className="flex-row items-center justify-between mb-0.5">
            <Text className="text-rose-700 text-[10px] font-black uppercase tracking-wider">Absent</Text>
            <AlertCircle size={13} color="#e11d48" />
          </View>
          <Text className="text-rose-950 font-black text-xl">{absentCount} <Text className="text-xs font-semibold text-rose-700">/ 5 Staff</Text></Text>
        </View>

        <View className="flex-1 min-w-[130px] bg-purple-50/80 border border-purple-200/80 p-3 rounded-2xl">
          <View className="flex-row items-center justify-between mb-0.5">
            <Text className="text-purple-700 text-[10px] font-black uppercase tracking-wider">Day Payout</Text>
            <IndianRupee size={13} color="#994bff" />
          </View>
          <Text className="text-purple-950 font-black text-xl">₹{totalDailyPayout.toLocaleString('en-IN')}</Text>
        </View>
      </View>

      {/* Horizontal Scrollable Table */}
      {loading ? (
        <View className="py-8 items-center justify-center">
          <ActivityIndicator size="small" color="#994bff" />
          <Text className="text-gray-400 text-xs mt-2 font-medium">Loading store attendance...</Text>
        </View>
      ) : (
        <ScrollView
          horizontal={true}
          showsHorizontalScrollIndicator={true}
          className="border border-gray-200 rounded-2xl overflow-hidden"
        >
          <View>
            {/* Table Header */}
            <View className="flex-row bg-gray-100/90 border-b border-gray-200 py-3 px-3.5 items-center">
              <Text className="w-[155px] text-[11px] font-black text-gray-700 uppercase tracking-wider">NAME</Text>
              <Text className="w-[100px] text-[11px] font-black text-gray-700 uppercase tracking-wider">LOGIN TIME</Text>
              <Text className="w-[105px] text-[11px] font-black text-gray-700 uppercase tracking-wider">LUNCH TIME</Text>
              <Text className="w-[95px] text-[11px] font-black text-gray-700 uppercase tracking-wider">BREAK</Text>
              <Text className="w-[100px] text-[11px] font-black text-gray-700 uppercase tracking-wider">LOG OUT</Text>
              <Text className="w-[85px] text-[11px] font-black text-gray-700 uppercase tracking-wider">FEE</Text>
              <Text className="w-[140px] text-[11px] font-black text-gray-700 uppercase tracking-wider">REMARK</Text>
            </View>

            {/* Table Rows */}
            {rows.map((row, idx) => {
              const isEven = idx % 2 === 0;

              return (
                <View
                  key={row.target.key}
                  className={`flex-row items-center border-b border-gray-100 py-3.5 px-3.5 ${
                    isEven ? 'bg-white' : 'bg-gray-50/60'
                  }`}
                >
                  {/* 1. NAME */}
                  <View className="w-[155px] pr-2">
                    <Text className="text-gray-900 font-black text-sm" numberOfLines={1}>
                      {row.target.displayName}
                    </Text>
                    <View className="flex-row items-center mt-1">
                      <View className={`px-2 py-0.5 rounded ${
                        row.target.role === 'rider'
                          ? 'bg-blue-100 border border-blue-200'
                          : 'bg-purple-100 border border-purple-200'
                      }`}>
                        <Text className={`text-[9px] font-black tracking-wider ${
                          row.target.role === 'rider' ? 'text-blue-800' : 'text-purple-800'
                        }`}>
                          {row.target.roleDisplay}
                        </Text>
                      </View>
                      <Text className="text-gray-400 text-[10px] ml-1.5 font-bold">
                        • {row.phoneHint}
                      </Text>
                    </View>
                  </View>

                  {/* 2. LOGIN TIME */}
                  <View className="w-[100px] pr-2">
                    <Text className={`text-xs font-black ${row.isPresent ? 'text-gray-900' : 'text-gray-400'}`}>
                      {row.loginTime}
                    </Text>
                  </View>

                  {/* 3. LUNCH TIME */}
                  <View className="w-[105px] pr-2">
                    {row.lunchTime !== '—' ? (
                      <View className="flex-row items-center">
                        <Text className={`text-xs font-bold ${row.isLunchOverdue ? 'text-amber-700' : 'text-gray-800'}`}>
                          {row.lunchTime}
                        </Text>
                      </View>
                    ) : (
                      <Text className="text-xs font-semibold text-gray-400">—</Text>
                    )}
                  </View>

                  {/* 4. BREAK */}
                  <View className="w-[95px] pr-2">
                    <Text className={`text-xs font-semibold ${row.breakTime !== '—' ? 'text-blue-700' : 'text-gray-400'}`}>
                      {row.breakTime}
                    </Text>
                  </View>

                  {/* 5. LOG OUT */}
                  <View className="w-[100px] pr-2">
                    <Text className={`text-xs font-black ${
                      row.logoutTime === 'On Shift'
                        ? 'text-emerald-700'
                        : row.logoutTime !== '—'
                        ? 'text-gray-900'
                        : 'text-gray-400'
                    }`}>
                      {row.logoutTime}
                    </Text>
                  </View>

                  {/* 6. FEE */}
                  <View className="w-[85px] pr-2">
                    <Text className={`text-xs font-black ${row.isPresent ? 'text-gray-900' : 'text-gray-400'}`}>
                      {row.isPresent ? `₹${row.fee}` : '₹0'}
                    </Text>
                  </View>

                  {/* 7. REMARK */}
                  <View className="w-[140px] pr-2">
                    <View className={`px-2.5 py-1 rounded-xl border self-start ${row.badgeBg}`}>
                      <Text className={`text-[10px] font-black ${row.badgeText}`} numberOfLines={1}>
                        {row.remarkText}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
