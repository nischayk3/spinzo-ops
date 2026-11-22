import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  LogOut,
  Power,
  Zap,
  Users,
  Truck,
  Wrench,
  RefreshCw,
  CheckCircle2,
  Calendar,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  User,
  ShieldAlert,
  Eye,
  EyeOff,
} from 'lucide-react-native';
import { useAuthStore } from '../../store/authStore';
import { useOpsStaffStore } from '../../store/opsStaffStore';
import { useStoreResourcesStore } from '../../store/storeResourcesStore';
import { useStaffRosterStore, type StaffMember } from '../../store/staffRosterStore';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { useOpsProcessStore } from '../../store/opsProcessStore';
import { useHelperRulesStore, type HelperStageKey } from '../../store/helperRulesStore';
import { isHelperAllowedForStage, normalizePhone } from '../../utils/helperEligibility';
import { getHelperLiveTasks } from '../../utils/rosterTasks';
import { currentStep } from '../../utils/opsProcess';
import { db, doc, getDoc } from '../../config/firebase';
import type { OpsStaffRoster } from '../../utils/opsRole';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { useResponsive } from '../../utils/useResponsive';
import { StaffAttendanceTable } from './StaffAttendanceTable';
import { SupervisorHelperTasksModal } from '../../components/Supervisor/SupervisorHelperTasksModal';
import { SupervisorRiderRouteModal } from '../../components/Supervisor/SupervisorRiderRouteModal';

type SupervisorTabKey = 'rules' | 'attendance' | 'stations' | 'account';

const STAGE_COLUMNS: { key: HelperStageKey; label: string }[] = [
  { key: 'tagging', label: 'Tag' },
  { key: 'getting_washed', label: 'Wash' },
  { key: 'getting_dried', label: 'Dry' },
  { key: 'getting_ironed', label: 'Iron' },
  { key: 'packaging', label: 'Pack' },
];

interface StaffRuleRow {
  phone: string;
  name: string;
  role: string;
  online: boolean;
  uid?: string;
  activeCount: number;
  isTestAccount: boolean;
}

const formatStaffName = (name?: string, fallback = 'Staff'): string => {
  if (!name) return fallback;
  return name.charAt(0).toUpperCase() + name.slice(1);
};

const isNumericTestName = (name: string): boolean => /^\d+$/.test(name.trim());

export function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user, activeRole, logout } = useAuthStore();
  const { staffDoc, goOnShift, goOffShift, error, clearActiveHelperTask } = useOpsStaffStore();
  const resources = useStoreResourcesStore(s => s.resources);
  const { roster, initialize: initRoster } = useStaffRosterStore();
  const { orders, initialize: initOrderFeed } = useOrderFeedStore();
  const processes = useOpsProcessStore(s => s.processes);
  const {
    rules: helperRules,
    loaded: rulesLoaded,
    subscribe: subscribeHelperRules,
    toggleHelperStageRule,
  } = useHelperRulesStore();
  const { isDesktop, isTablet, maxContainerStyle } = useResponsive();

  const [activeTab, setActiveTab] = useState<SupervisorTabKey>('rules');
  const [isUpdating, setIsUpdating] = useState(false);
  const [maintenanceSuccess, setMaintenanceSuccess] = useState<string | null>(null);
  const [opsStaffRoster, setOpsStaffRoster] = useState<OpsStaffRoster | null>(null);
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const [showTestAccounts, setShowTestAccounts] = useState(false);
  const [fineRulesExpanded, setFineRulesExpanded] = useState(false);
  const [selectedRosterHelper, setSelectedRosterHelper] = useState<StaffMember | null>(null);
  const [selectedRosterRider, setSelectedRosterRider] = useState<StaffMember | null>(null);

  const onShift = !!staffDoc?.onShift;
  const isSupervisor = activeRole === 'supervisor' || activeRole === 'admin';
  const isWide = isDesktop || isTablet;

  useEffect(() => {
    if (!isSupervisor) return;
    initRoster();
    initOrderFeed();
    subscribeHelperRules();

    let cancelled = false;
    getDoc(doc(db, 'config', 'opsStaff'))
      .then((snap) => {
        if (!cancelled && snap.exists()) {
          setOpsStaffRoster(snap.data() as OpsStaffRoster);
        }
      })
      .catch((err) => {
        console.warn('[Settings] Failed to load config/opsStaff:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [isSupervisor, initRoster, initOrderFeed, subscribeHelperRules]);

  const helperRuleRows = useMemo<StaffRuleRow[]>(() => {
    const map = new Map<string, StaffRuleRow>();
    const liveByPhone = new Map<string, StaffMember>();
    for (const h of roster.helpers) {
      const norm = normalizePhone(h.phone);
      if (norm) liveByPhone.set(norm, h);
    }

    if (opsStaffRoster?.phones) {
      for (const [rawPhone, roleVal] of Object.entries(opsStaffRoster.phones)) {
        if (roleVal !== 'helper' && roleVal !== 'iron') continue;
        const norm = normalizePhone(rawPhone);
        if (!norm) continue;
        const rosterName = opsStaffRoster.names?.[norm] || opsStaffRoster.names?.[rawPhone];
        const liveMatch = liveByPhone.get(norm);
        const resolvedName = (rosterName || liveMatch?.name || norm.slice(-4)).trim();
        const liveTasks = getHelperLiveTasks(
          { uid: liveMatch?.uid, name: resolvedName, phone: norm },
          processes
        );
        map.set(norm, {
          phone: norm,
          name: resolvedName,
          role: roleVal,
          online: Boolean(liveMatch),
          uid: liveMatch?.uid,
          activeCount: liveTasks.length,
          isTestAccount: isNumericTestName(resolvedName),
        });
      }
    }

    // Merge any live on-shift helpers that might not yet be in the cached snapshot
    for (const h of roster.helpers) {
      const norm = normalizePhone(h.phone);
      if (!norm) continue;
      const existing = map.get(norm);
      if (existing) {
        existing.online = true;
        if (!existing.uid) existing.uid = h.uid;
        if (existing.isTestAccount && h.name && !isNumericTestName(h.name)) {
          existing.name = h.name.trim();
          existing.isTestAccount = false;
        }
        existing.activeCount = getHelperLiveTasks(h, processes).length;
      } else {
        const resolvedName = (h.name || norm.slice(-4)).trim();
        map.set(norm, {
          phone: norm,
          name: resolvedName,
          role: h.role || 'helper',
          online: true,
          uid: h.uid,
          activeCount: getHelperLiveTasks(h, processes).length,
          isTestAccount: isNumericTestName(resolvedName),
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      if (a.activeCount !== b.activeCount) return b.activeCount - a.activeCount;
      return a.name.localeCompare(b.name);
    });
  }, [opsStaffRoster, roster.helpers, processes]);

  const realHelperRows = useMemo(
    () => helperRuleRows.filter(r => !r.isTestAccount),
    [helperRuleRows]
  );

  const testHelperRows = useMemo(
    () => helperRuleRows.filter(r => r.isTestAccount),
    [helperRuleRows]
  );

  const visibleRuleRows = useMemo(
    () => (showTestAccounts ? [...realHelperRows, ...testHelperRows] : realHelperRows),
    [showTestAccounts, realHelperRows, testHelperRows]
  );

  // Live hardware occupancy computed directly from active ops_process documents
  const liveStationUsage = useMemo(() => {
    let activeWashers = 0;
    let activeDryers = 0;
    let activeIrons = 0;

    for (const proc of processes) {
      if (!proc || proc.status === 'done') continue;
      const stages = proc.stages || {};
      const cur = currentStep(proc);

      const washRec = stages.getting_washed;
      if (washRec && Boolean(washRec.startedAt) && !washRec.completedAt) {
        activeWashers += 1;
      }

      const dryRec = stages.getting_dried;
      if (dryRec && Boolean(dryRec.startedAt) && !dryRec.completedAt) {
        activeDryers += 1;
      }

      const ironRec = stages.getting_ironed;
      if (
        ironRec &&
        !ironRec.completedAt &&
        (Boolean(ironRec.startedAt) ||
          (cur === 'getting_ironed' && Boolean(ironRec.assignee || ironRec.acceptedAt)))
      ) {
        activeIrons += 1;
      }
    }

    return { activeWashers, activeDryers, activeIrons };
  }, [processes]);

  const selectedHelperTasks = useMemo(
    () => (selectedRosterHelper ? getHelperLiveTasks(selectedRosterHelper, processes) : []),
    [selectedRosterHelper, processes]
  );

  // Live active pickup & delivery order counts per rider (mirrors SupervisorDashboardScreen)
  const getRiderActiveCounts = (riderUid: string) => {
    let pickups = 0;
    let deliveries = 0;
    for (const o of orders) {
      if (
        (o.status === 'placed' || o.status === 'confirmed' || o.status === 'in_transit_to_store') &&
        o.riderId === riderUid
      ) {
        pickups += 1;
      } else if (
        (o.status === 'ready' || o.status === 'out_for_delivery') &&
        o.deliveryRiderId === riderUid
      ) {
        deliveries += 1;
      }
    }
    return { pickups, deliveries, total: pickups + deliveries };
  };

  const handleToggleRule = async (phone: string, stage: HelperStageKey, currentEnabled: boolean) => {
    const cellKey = `${phone}_${stage}`;
    if (savingCell === cellKey) return;
    setSavingCell(cellKey);
    try {
      await toggleHelperStageRule(phone, stage, !currentEnabled);
    } catch (err: any) {
      Alert.alert('Update Failed', err?.message || 'Could not update assignment rule');
    } finally {
      setSavingCell(null);
    }
  };

  const handleToggleShift = async () => {
    if (!user || isUpdating) return;
    setIsUpdating(true);
    try {
      if (onShift) {
        await goOffShift(user.id);
      } else {
        await goOnShift(user.id, user.role, user.phone, user.name);
      }
    } catch {
      // Swallowed as store surfaces error
    } finally {
      setIsUpdating(false);
    }
  };

  const handleClearStaleTasks = async () => {
    setIsUpdating(true);
    setMaintenanceSuccess(null);
    try {
      await clearActiveHelperTask();
      initRoster();
      initOrderFeed();
      setMaintenanceSuccess('Stale tasks cleared and store cache refreshed successfully.');
    } catch (err: any) {
      Alert.alert('Maintenance Failed', err?.message || 'Could not clear stale tasks');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleLogout = () => {
    logout();
  };

  // Non-supervisor single-view Account & Shift Status screen
  if (!isSupervisor) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50">
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
          <View style={maxContainerStyle}>
            {/* Header */}
            <View className="mb-4">
              <Text className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">
                ACCOUNT & SHIFT
              </Text>
              <Text className="text-xl font-black text-gray-900">Settings</Text>
            </View>

            {/* User Profile Card */}
            <View className="bg-white rounded-3xl p-4 mb-4 border border-gray-200/80 shadow-xs flex-row items-center justify-between gap-3">
              <View className="flex-row items-center flex-1">
                <View className="w-11 h-11 rounded-full bg-[#994bff]/15 items-center justify-center mr-3 border border-[#994bff]/30 shrink-0">
                  <Text className="text-[#994bff] font-black text-base">
                    {user?.name ? user.name.charAt(0).toUpperCase() : 'U'}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-gray-900 font-extrabold text-sm" numberOfLines={1}>
                    {user?.name || 'Store Staff'}
                  </Text>
                  <Text className="text-gray-500 text-xs font-medium" numberOfLines={1}>
                    {user?.phone || 'No phone registered'}
                  </Text>
                  <Text className="text-gray-400 text-[11px] mt-0.5">Store ID: Main Livfresh Hub</Text>
                </View>
              </View>

              <View className="bg-purple-100 border border-purple-200 px-2.5 py-1 rounded-full shrink-0">
                <Text className="text-purple-800 font-black text-[11px] uppercase tracking-wider">
                  {activeRole || 'Helper'}
                </Text>
              </View>
            </View>

            {/* Rider Shift Toggle (For Riders) */}
            {activeRole === 'rider' && (
              <View className="bg-white rounded-3xl p-4 mb-4 border border-gray-200/80 shadow-xs">
                <Text className="text-gray-400 font-bold uppercase tracking-widest text-[11px] mb-2.5">
                  Rider Shift Status
                </Text>
                <View className="flex-row items-center mb-3.5">
                  <Power size={17} color={onShift ? '#22C55E' : '#64748B'} />
                  <Text className={`font-bold ml-2 text-sm ${onShift ? 'text-green-600' : 'text-gray-400'}`}>
                    {onShift ? 'Currently On Shift' : 'Currently Off Shift'}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={handleToggleShift}
                  disabled={isUpdating}
                  className={`h-11 rounded-xl items-center justify-center flex-row ${
                    onShift ? 'bg-amber-500' : 'bg-[#994bff]'
                  } ${isUpdating ? 'opacity-70' : ''}`}
                >
                  {isUpdating ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text className="text-white text-sm font-bold">
                      {onShift ? 'Go Off Shift' : 'Go On Shift'}
                    </Text>
                  )}
                </TouchableOpacity>
                {error ? <Text className="text-red-500 text-xs mt-2.5">{error}</Text> : null}
              </View>
            )}

            {/* Logout Action */}
            <TouchableOpacity
              onPress={handleLogout}
              className="w-full bg-red-50 border border-red-200 h-12 rounded-2xl items-center justify-center flex-row mt-1 active:bg-red-100"
            >
              <LogOut size={17} color="#EF4444" className="mr-2" />
              <Text className="text-red-600 text-sm font-extrabold">Log Out of Operations</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const tabs: { key: SupervisorTabKey; label: string; shortLabel: string; icon: typeof SlidersHorizontal }[] = [
    { key: 'rules', label: 'Assignment Rules', shortLabel: 'Rules', icon: SlidersHorizontal },
    { key: 'attendance', label: 'Attendance', shortLabel: 'Attendance', icon: Calendar },
    { key: 'stations', label: 'Stations & Staff', shortLabel: 'Stations', icon: Zap },
    { key: 'account', label: 'Account', shortLabel: 'Account', icon: User },
  ];

  const onShiftHelperCount = realHelperRows.filter(r => r.online).length;

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <View style={maxContainerStyle}>
          {/* Compact Single-Row Top Header Bar */}
          <View className="flex-row items-center justify-between gap-2 mb-3.5">
            <View className="flex-1 min-w-0">
              <Text className="text-xl font-black text-gray-900" numberOfLines={1}>
                Settings
              </Text>
            </View>

            <View className="flex-row items-center gap-2 shrink-0">
              <View className="flex-row items-center bg-white border border-gray-200/80 rounded-full pl-1 pr-2.5 py-1">
                <View className="w-6 h-6 rounded-full bg-[#994bff]/15 border border-[#994bff]/30 items-center justify-center mr-1.5">
                  <Text className="text-[#994bff] font-black text-[11px]">
                    {user?.name ? user.name.charAt(0).toUpperCase() : 'S'}
                  </Text>
                </View>
                <Text className="text-gray-800 font-bold text-xs max-w-[110px]" numberOfLines={1}>
                  {user?.name || 'Supervisor'}
                </Text>
              </View>

              <View className="bg-purple-100 border border-purple-200 px-2.5 py-1 rounded-full">
                <Text className="text-purple-800 font-black text-[10px] uppercase tracking-wider">
                  {activeRole || 'Supervisor'}
                </Text>
              </View>
            </View>
          </View>

          {/* 4-Tab Horizontal Segmented Workspace Bar */}
          <View className="bg-gray-100 p-1 rounded-2xl flex-row items-center mb-4 border border-gray-200/70">
            {tabs.map(tab => {
              const Icon = tab.icon;
              const active = activeTab === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  onPress={() => setActiveTab(tab.key)}
                  activeOpacity={0.8}
                  className={`flex-1 flex-row items-center justify-center py-2 px-1.5 rounded-xl gap-1.5 ${
                    active ? 'bg-white shadow-xs border border-gray-200/70' : ''
                  }`}
                >
                  <Icon size={14} color={active ? '#994bff' : '#6B7280'} />
                  <Text
                    numberOfLines={1}
                    className={`text-xs font-extrabold ${
                      active ? 'text-gray-900' : 'text-gray-500'
                    }`}
                  >
                    {isWide ? tab.label : tab.shortLabel}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* TAB 1: Assignment Rules */}
          {activeTab === 'rules' && (
            <View className="bg-white rounded-3xl p-4 border border-gray-200/80 shadow-xs">
              <View className="flex-row items-center justify-between mb-3 gap-2">
                <View className="flex-row items-center flex-1 min-w-0">
                  <View className="w-8 h-8 rounded-xl bg-[#994bff]/10 border border-[#994bff]/20 items-center justify-center mr-2.5 shrink-0">
                    <SlidersHorizontal size={15} color="#994bff" />
                  </View>
                  <View className="flex-1 min-w-0">
                    <Text className="text-gray-900 font-extrabold text-[15px]" numberOfLines={1}>
                      Helper Assignment Rules
                    </Text>
                    <Text className="text-gray-500 text-[11px] mt-0.5" numberOfLines={1}>
                      {onShiftHelperCount} on shift · {realHelperRows.length} floor staff
                    </Text>
                  </View>
                </View>

                <View className="bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full shrink-0">
                  <Text className="text-emerald-700 font-bold text-[10px] uppercase tracking-wide">
                    Live Sync
                  </Text>
                </View>
              </View>

              {!rulesLoaded && helperRuleRows.length === 0 ? (
                <View className="py-8 items-center">
                  <ActivityIndicator size="small" color="#994bff" />
                  <Text className="text-gray-400 text-xs mt-2">Loading helper rules…</Text>
                </View>
              ) : visibleRuleRows.length === 0 ? (
                <View className="py-8 items-center bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                  <Text className="text-gray-500 text-xs font-medium">No helpers found in roster.</Text>
                </View>
              ) : (
                <View className="rounded-2xl border border-gray-200/80 overflow-hidden">
                  {/* Table Header */}
                  <View className="flex-row items-center bg-gray-50 px-3 py-2 border-b border-gray-200/80">
                    <View className={isWide ? 'w-48 pr-2' : 'flex-1 min-w-[92px] pr-1.5'}>
                      <Text className="text-gray-400 text-[10px] font-extrabold uppercase tracking-wider">
                        Helper
                      </Text>
                    </View>

                    {isWide && (
                      <View className="flex-1 px-2">
                        <Text className="text-gray-400 text-[10px] font-extrabold uppercase tracking-wider">
                          Live Status
                        </Text>
                      </View>
                    )}

                    {STAGE_COLUMNS.map(col => (
                      <View
                        key={col.key}
                        className={isWide ? 'w-14 items-center' : 'w-11 items-center'}
                      >
                        <Text className="text-gray-500 text-[10px] font-extrabold uppercase tracking-wider">
                          {col.label}
                        </Text>
                      </View>
                    ))}
                  </View>

                  {/* Helper Rows */}
                  {visibleRuleRows.map((row, idx) => {
                    const statusPill = row.online
                      ? row.activeCount > 0
                        ? {
                            label: `${row.activeCount} active`,
                            bg: 'bg-purple-100 border-purple-200',
                            text: 'text-purple-800',
                          }
                        : {
                            label: 'Idle',
                            bg: 'bg-emerald-50 border-emerald-200',
                            text: 'text-emerald-700',
                          }
                      : {
                          label: 'Off-shift',
                          bg: 'bg-gray-100 border-gray-200',
                          text: 'text-gray-500',
                        };

                    return (
                      <View
                        key={row.phone}
                        className={`flex-row items-center px-3 py-2.5 ${
                          idx % 2 === 1 ? 'bg-gray-50/70' : 'bg-white'
                        } ${idx < visibleRuleRows.length - 1 ? 'border-b border-gray-100' : ''}`}
                      >
                        {/* Helper Name & Phone */}
                        <View className={isWide ? 'w-48 pr-2' : 'flex-1 min-w-[92px] pr-1.5'}>
                          <View className="flex-row items-center">
                            <View
                              className={`w-2 h-2 rounded-full mr-1.5 shrink-0 ${
                                row.online ? 'bg-emerald-500' : 'bg-gray-300'
                              }`}
                            />
                            <Text
                              className="text-gray-900 font-bold text-xs flex-1"
                              numberOfLines={1}
                            >
                              {formatStaffName(row.name)}
                            </Text>
                          </View>
                          <View className="flex-row items-center gap-1.5 ml-3.5 mt-0.5">
                            <Text className="text-gray-400 text-[10px] font-medium" numberOfLines={1}>
                              ···{row.phone.slice(-4)}
                            </Text>
                            {!isWide && (
                              <View className={`px-1.5 py-0.2 rounded-full border ${statusPill.bg}`}>
                                <Text className={`text-[9px] font-bold ${statusPill.text}`}>
                                  {statusPill.label}
                                </Text>
                              </View>
                            )}
                          </View>
                        </View>

                        {/* Live Status Column (Tablet/Desktop) */}
                        {isWide && (
                          <View className="flex-1 px-2 flex-row items-center">
                            <View className={`px-2.5 py-0.5 rounded-full border ${statusPill.bg}`}>
                              <Text className={`text-[11px] font-bold ${statusPill.text}`}>
                                {statusPill.label}
                              </Text>
                            </View>
                          </View>
                        )}

                        {/* 5 Stage Toggles */}
                        {STAGE_COLUMNS.map(col => {
                          const enabled = isHelperAllowedForStage(row.phone, col.key, helperRules);
                          const cellKey = `${row.phone}_${col.key}`;
                          const isSaving = savingCell === cellKey;
                          return (
                            <View
                              key={col.key}
                              className={isWide ? 'w-14 items-center justify-center' : 'w-11 items-center justify-center'}
                            >
                              <TouchableOpacity
                                onPress={() => handleToggleRule(row.phone, col.key, enabled)}
                                disabled={isSaving}
                                activeOpacity={0.75}
                                hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                                accessibilityRole="switch"
                                accessibilityState={{ checked: enabled }}
                                accessibilityLabel={`${row.name} ${col.label}`}
                                className={`w-9 h-5 rounded-full p-0.5 justify-center ${
                                  enabled ? 'bg-[#994bff]' : 'bg-gray-200'
                                } ${isSaving ? 'opacity-60' : ''}`}
                              >
                                <View
                                  className={`w-4 h-4 rounded-full bg-white shadow-2xs ${
                                    enabled ? 'self-end' : 'self-start'
                                  }`}
                                />
                              </TouchableOpacity>
                            </View>
                          );
                        })}
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Footer: Sync hint + Test accounts toggle */}
              <View className="flex-row items-center justify-between flex-wrap gap-2 mt-3">
                <Text className="text-gray-400 text-[11px] flex-1 min-w-[200px]">
                  Changes sync immediately to dispatch & helper task pools. Green dot = on shift.
                </Text>

                {testHelperRows.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setShowTestAccounts(prev => !prev)}
                    activeOpacity={0.75}
                    className="flex-row items-center gap-1.5 bg-gray-100 border border-gray-200 px-2.5 py-1 rounded-full"
                  >
                    {showTestAccounts ? (
                      <EyeOff size={12} color="#6B7280" />
                    ) : (
                      <Eye size={12} color="#6B7280" />
                    )}
                    <Text className="text-gray-600 font-bold text-[11px]">
                      {showTestAccounts
                        ? `Hide ${testHelperRows.length} test ${testHelperRows.length === 1 ? 'account' : 'accounts'}`
                        : `Show ${testHelperRows.length} test ${testHelperRows.length === 1 ? 'account' : 'accounts'}`}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {/* TAB 2: Attendance */}
          {activeTab === 'attendance' && (
            <View>
              <StaffAttendanceTable />

              {/* Compact Collapsible Attendance & Fine Rules Card */}
              <View className="bg-white rounded-3xl p-4 border border-gray-200/80 shadow-xs">
                <TouchableOpacity
                  onPress={() => setFineRulesExpanded(prev => !prev)}
                  activeOpacity={0.8}
                  className="flex-row items-center justify-between"
                >
                  <View className="flex-row items-center flex-1 mr-2">
                    <View className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-200 items-center justify-center mr-2.5">
                      <ShieldAlert size={15} color="#D97706" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-gray-900 font-extrabold text-sm">
                        Attendance & Fine Rules
                      </Text>
                      <Text className="text-gray-500 text-[11px] mt-0.5" numberOfLines={1}>
                        Shift cutoffs, break allowances, and automatic ₹50 fine triggers
                      </Text>
                    </View>
                  </View>

                  <View className="flex-row items-center gap-1.5">
                    <Text className="text-gray-400 font-bold text-[10px] uppercase tracking-wider">
                      {fineRulesExpanded ? 'Hide' : 'View'}
                    </Text>
                    {fineRulesExpanded ? (
                      <ChevronUp size={16} color="#6B7280" />
                    ) : (
                      <ChevronDown size={16} color="#6B7280" />
                    )}
                  </View>
                </TouchableOpacity>

                {fineRulesExpanded && (
                  <View className="mt-3 pt-3 border-t border-gray-100 gap-2">
                    <View className="flex-row items-center justify-between bg-gray-50 px-3 py-2 rounded-xl border border-gray-100">
                      <Text className="text-gray-700 font-bold text-xs">Late Clock-In Cutoff</Text>
                      <Text className="text-rose-700 font-extrabold text-xs">After 8:30 AM · ₹50 fine</Text>
                    </View>
                    <View className="flex-row items-center justify-between bg-gray-50 px-3 py-2 rounded-xl border border-gray-100">
                      <Text className="text-gray-700 font-bold text-xs">Early Clock-Out Cutoff</Text>
                      <Text className="text-rose-700 font-extrabold text-xs">Before 10:00 PM · ₹50 fine</Text>
                    </View>
                    <View className="flex-row items-center justify-between bg-gray-50 px-3 py-2 rounded-xl border border-gray-100">
                      <Text className="text-gray-700 font-bold text-xs">Lunch Break Limit</Text>
                      <Text className="text-amber-700 font-extrabold text-xs">1.5h Helper · 2h Rider (₹50 OT)</Text>
                    </View>
                    <View className="flex-row items-center justify-between bg-gray-50 px-3 py-2 rounded-xl border border-gray-100">
                      <Text className="text-gray-700 font-bold text-xs">Short Breaks</Text>
                      <Text className="text-gray-800 font-extrabold text-xs">Max 3 × 10 min / shift</Text>
                    </View>
                    <View className="flex-row items-center justify-between bg-gray-50 px-3 py-2 rounded-xl border border-gray-100">
                      <Text className="text-gray-700 font-bold text-xs">Base Daily Payout</Text>
                      <Text className="text-emerald-700 font-extrabold text-xs">₹650 Helper · ₹800 Rider</Text>
                    </View>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* TAB 3: Stations & Staff */}
          {activeTab === 'stations' && (
            <View className="gap-4">
              {/* Store Hardware Capacity with Live Active Counts */}
              <View className="bg-white rounded-3xl p-4 border border-gray-200/80 shadow-xs">
                <View className="flex-row items-center justify-between mb-3">
                  <View className="flex-row items-center">
                    <Zap size={16} color="#994bff" className="mr-2" />
                    <Text className="text-gray-900 font-extrabold text-[15px]">
                      Store Hardware Capacity
                    </Text>
                  </View>
                  <View className="bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                    <Text className="text-emerald-700 font-bold text-[10px] uppercase tracking-wide">
                      Live Telemetry
                    </Text>
                  </View>
                </View>

                <View className={`gap-2.5 ${isWide ? 'flex-row' : 'flex-col'}`}>
                  {/* Washers */}
                  <View className="flex-1 bg-purple-50/70 p-3.5 rounded-2xl border border-purple-100">
                    <View className="flex-row items-center justify-between mb-1.5">
                      <Text className="text-purple-950 font-black text-sm">Washers</Text>
                      <View
                        className={`px-2 py-0.5 rounded-full border ${
                          liveStationUsage.activeWashers > 0
                            ? 'bg-purple-200/80 border-purple-300'
                            : 'bg-white border-purple-200'
                        }`}
                      >
                        <Text className="text-purple-900 font-extrabold text-[11px]">
                          {liveStationUsage.activeWashers} / {resources.washers} Running
                        </Text>
                      </View>
                    </View>
                    <Text className="text-purple-700 text-xs font-semibold">
                      Washer 1 & Washer 2
                    </Text>
                    <Text className="text-purple-500 text-[11px] mt-0.5">
                      30m Lockout · 36m Cycle (3m Det · 21m Soft)
                    </Text>
                  </View>

                  {/* Dryers */}
                  <View className="flex-1 bg-blue-50/70 p-3.5 rounded-2xl border border-blue-100">
                    <View className="flex-row items-center justify-between mb-1.5">
                      <Text className="text-blue-950 font-black text-sm">Dryers</Text>
                      <View
                        className={`px-2 py-0.5 rounded-full border ${
                          liveStationUsage.activeDryers > 0
                            ? 'bg-blue-200/80 border-blue-300'
                            : 'bg-white border-blue-200'
                        }`}
                      >
                        <Text className="text-blue-900 font-extrabold text-[11px]">
                          {liveStationUsage.activeDryers} / {resources.dryers} Running
                        </Text>
                      </View>
                    </View>
                    <Text className="text-blue-700 text-xs font-semibold">
                      Dryer 1 & Dryer 2
                    </Text>
                    <Text className="text-blue-500 text-[11px] mt-0.5">
                      30m Lockout · 40m Nominal Cycle
                    </Text>
                  </View>

                  {/* Irons */}
                  <View className="flex-1 bg-amber-50/70 p-3.5 rounded-2xl border border-amber-100">
                    <View className="flex-row items-center justify-between mb-1.5">
                      <Text className="text-amber-950 font-black text-sm">Irons</Text>
                      <View
                        className={`px-2 py-0.5 rounded-full border ${
                          liveStationUsage.activeIrons > 0
                            ? 'bg-amber-200/80 border-amber-300'
                            : 'bg-white border-amber-200'
                        }`}
                      >
                        <Text className="text-amber-900 font-extrabold text-[11px]">
                          {liveStationUsage.activeIrons} / {resources.ironingStations} Active
                        </Text>
                      </View>
                    </View>
                    <Text className="text-amber-800 text-xs font-semibold">
                      Iron 1 & Iron 2
                    </Text>
                    <Text className="text-amber-600 text-[11px] mt-0.5">
                      Stage permissions managed in Assignment Rules
                    </Text>
                  </View>
                </View>
              </View>

              {/* Live Floor Deployment (Accurate real-time task counts + tappable modals) */}
              <View className="bg-white rounded-3xl p-4 border border-gray-200/80 shadow-xs">
                <View className="flex-row items-center justify-between mb-3">
                  <View className="flex-row items-center">
                    <Users size={16} color="#994bff" className="mr-2" />
                    <Text className="text-gray-900 font-extrabold text-[15px]">
                      Live Floor Deployment
                    </Text>
                  </View>
                  <Text className="text-gray-500 text-xs font-bold">
                    {roster.helpers.length} Helpers · {roster.riders.length} Riders
                  </Text>
                </View>

                {roster.helpers.length === 0 && roster.riders.length === 0 ? (
                  <View className="py-8 items-center justify-center bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                    <Text className="text-gray-400 text-xs font-medium">
                      No staff currently clocked in on shift
                    </Text>
                  </View>
                ) : (
                  <View className="gap-2">
                    {/* Helpers */}
                    {roster.helpers.map(h => {
                      const liveTasks = getHelperLiveTasks(h, processes);
                      const topTask = liveTasks[0];
                      const taskSummary = topTask
                        ? `${topTask.stageLabel} · ${
                            topTask.tokens.length > 0 ? `T-${topTask.tokens[0]}` : `#${topTask.orderNumber}`
                          }${liveTasks.length > 1 ? ` +${liveTasks.length - 1} more` : ''}`
                        : h.phone || 'On floor shift';

                      return (
                        <TouchableOpacity
                          key={h.uid}
                          onPress={() => setSelectedRosterHelper(h)}
                          activeOpacity={0.8}
                          className="flex-row items-center justify-between bg-gray-50 px-3 py-2.5 rounded-2xl border border-gray-200/70 active:bg-gray-100"
                        >
                          <View className="flex-row items-center flex-1 mr-2 min-w-0">
                            <View className="w-8 h-8 rounded-full bg-purple-100 border border-purple-200 items-center justify-center mr-2.5 shrink-0">
                              <Text className="text-purple-800 font-black text-xs">
                                {h.name ? h.name.charAt(0).toUpperCase() : 'H'}
                              </Text>
                            </View>
                            <View className="flex-1 min-w-0">
                              <Text className="text-gray-900 font-bold text-sm" numberOfLines={1}>
                                {formatStaffName(h.name, 'Helper')}
                              </Text>
                              <Text
                                className={`text-xs mt-0.5 ${
                                  topTask ? 'text-purple-700 font-semibold' : 'text-gray-400 font-medium'
                                }`}
                                numberOfLines={1}
                              >
                                {taskSummary}
                              </Text>
                            </View>
                          </View>

                          <View className="flex-row items-center gap-1.5 shrink-0">
                            {liveTasks.length > 0 ? (
                              <View className="bg-purple-100 border border-purple-200 px-2.5 py-0.5 rounded-full">
                                <Text className="text-purple-800 font-extrabold text-[11px]">
                                  {liveTasks.length} {liveTasks.length === 1 ? 'Order' : 'Orders'}
                                </Text>
                              </View>
                            ) : (
                              <View className="bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                                <Text className="text-emerald-700 font-bold text-[11px]">Idle</Text>
                              </View>
                            )}
                            <ChevronRight size={14} color="#64748B" />
                          </View>
                        </TouchableOpacity>
                      );
                    })}

                    {/* Riders */}
                    {roster.riders.map(r => {
                      const counts = getRiderActiveCounts(r.uid);
                      const breakdown =
                        counts.total > 0
                          ? [
                              counts.pickups > 0
                                ? `${counts.pickups} Pickup${counts.pickups > 1 ? 's' : ''}`
                                : null,
                              counts.deliveries > 0
                                ? `${counts.deliveries} Deliv.`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')
                          : r.phone || 'Delivery partner';

                      return (
                        <TouchableOpacity
                          key={r.uid}
                          onPress={() => setSelectedRosterRider(r)}
                          activeOpacity={0.8}
                          className="flex-row items-center justify-between bg-gray-50 px-3 py-2.5 rounded-2xl border border-gray-200/70 active:bg-gray-100"
                        >
                          <View className="flex-row items-center flex-1 mr-2 min-w-0">
                            <View className="w-8 h-8 rounded-full bg-blue-100 border border-blue-200 items-center justify-center mr-2.5 shrink-0">
                              <Truck size={14} color="#1d4ed8" />
                            </View>
                            <View className="flex-1 min-w-0">
                              <Text className="text-gray-900 font-bold text-sm" numberOfLines={1}>
                                {formatStaffName(r.name, 'Rider')}
                              </Text>
                              <Text
                                className={`text-xs mt-0.5 ${
                                  counts.total > 0 ? 'text-blue-700 font-semibold' : 'text-gray-400 font-medium'
                                }`}
                                numberOfLines={1}
                              >
                                {breakdown}
                              </Text>
                            </View>
                          </View>

                          <View className="flex-row items-center gap-1.5 shrink-0">
                            {counts.total > 0 ? (
                              <View className="bg-blue-100 border border-blue-200 px-2.5 py-0.5 rounded-full">
                                <Text className="text-blue-800 font-extrabold text-[11px]">
                                  {counts.total} {counts.total === 1 ? 'Order' : 'Orders'}
                                </Text>
                              </View>
                            ) : (
                              <View className="bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                                <Text className="text-emerald-700 font-bold text-[11px]">Idle</Text>
                              </View>
                            )}
                            <ChevronRight size={14} color="#64748B" />
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                <Text className="text-gray-400 text-[11px] mt-2.5">
                  Tap any helper or rider to inspect their live tasks or smart route.
                </Text>
              </View>
            </View>
          )}

          {/* TAB 4: Account */}
          {activeTab === 'account' && (
            <View className="gap-4">
              {/* Profile Details Card */}
              <View className="bg-white rounded-3xl p-4 border border-gray-200/80 shadow-xs">
                <View className="flex-row items-center justify-between gap-3">
                  <View className="flex-row items-center flex-1 min-w-0">
                    <View className="w-12 h-12 rounded-full bg-[#994bff]/15 items-center justify-center mr-3 border border-[#994bff]/30 shrink-0">
                      <Text className="text-[#994bff] font-black text-lg">
                        {user?.name ? user.name.charAt(0).toUpperCase() : 'S'}
                      </Text>
                    </View>
                    <View className="flex-1 min-w-0">
                      <Text className="text-gray-900 font-extrabold text-base" numberOfLines={1}>
                        {user?.name || 'Store Supervisor'}
                      </Text>
                      <Text className="text-gray-500 text-xs font-medium" numberOfLines={1}>
                        {user?.phone || 'No phone registered'}
                      </Text>
                      <Text className="text-gray-400 text-[11px] mt-0.5">
                        Store ID: Main Livfresh Hub
                      </Text>
                    </View>
                  </View>

                  <View className="bg-purple-100 border border-purple-200 px-3 py-1 rounded-full shrink-0">
                    <Text className="text-purple-800 font-black text-xs uppercase tracking-wider">
                      {activeRole || 'Supervisor'}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Operational Maintenance */}
              <View className="bg-white rounded-3xl p-4 border border-gray-200/80 shadow-xs">
                <View className="flex-row items-center mb-1.5">
                  <Wrench size={16} color="#994bff" className="mr-2" />
                  <Text className="text-gray-900 font-extrabold text-[15px]">
                    Operational Maintenance
                  </Text>
                </View>
                <Text className="text-gray-500 text-xs mb-3">
                  Run self-healing routines to clear stuck helper tasks and refresh live queues.
                </Text>

                {maintenanceSuccess ? (
                  <View className="bg-emerald-50 border border-emerald-200 p-3 rounded-xl mb-3 flex-row items-center">
                    <CheckCircle2 size={15} color="#16a34a" className="mr-2 shrink-0" />
                    <Text className="text-emerald-800 text-xs font-semibold flex-1">
                      {maintenanceSuccess}
                    </Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  onPress={handleClearStaleTasks}
                  disabled={isUpdating}
                  className="bg-purple-50 border border-purple-200 h-11 rounded-xl items-center justify-center flex-row active:bg-purple-100"
                >
                  {isUpdating ? (
                    <ActivityIndicator size="small" color="#994bff" />
                  ) : (
                    <>
                      <RefreshCw size={15} color="#994bff" className="mr-2" />
                      <Text className="text-purple-800 font-bold text-xs">
                        Clear Stale Tasks & Re-sync Queue
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              {/* Sign Out */}
              <TouchableOpacity
                onPress={handleLogout}
                className="w-full bg-red-50 border border-red-200 h-12 rounded-2xl items-center justify-center flex-row active:bg-red-100"
              >
                <LogOut size={17} color="#EF4444" className="mr-2" />
                <Text className="text-red-600 text-sm font-extrabold">Log Out of Operations</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Modals for Live Floor Deployment */}
      <SupervisorHelperTasksModal
        visible={!!selectedRosterHelper}
        helper={selectedRosterHelper}
        tasks={selectedHelperTasks}
        onClose={() => setSelectedRosterHelper(null)}
        onSelectOrder={(orderId, processId) => {
          setSelectedRosterHelper(null);
          navigation.navigate('OrderDetail', { orderId, processId });
        }}
      />

      <SupervisorRiderRouteModal
        visible={!!selectedRosterRider}
        rider={selectedRosterRider}
        orders={orders}
        onClose={() => setSelectedRosterRider(null)}
        onOpenOrder={(orderId) => {
          setSelectedRosterRider(null);
          navigation.navigate('OrderDetail', { orderId });
        }}
      />
    </SafeAreaView>
  );
}
