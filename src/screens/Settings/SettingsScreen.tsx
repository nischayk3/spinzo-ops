import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { 
  LogOut, Power, ShieldCheck, Zap, Users, Truck, Wrench, RefreshCw, 
  CheckCircle2, Clock, Smartphone, Layers
} from 'lucide-react-native';
import { useAuthStore } from '../../store/authStore';
import { useOpsStaffStore } from '../../store/opsStaffStore';
import { useStoreResourcesStore } from '../../store/storeResourcesStore';
import { useStaffRosterStore } from '../../store/staffRosterStore';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { useResponsive } from '../../utils/useResponsive';

export function SettingsScreen() {
  const { user, activeRole, logout } = useAuthStore();
  const { staffDoc, goOnShift, goOffShift, error, clearActiveHelperTask } = useOpsStaffStore();
  const resources = useStoreResourcesStore(s => s.resources);
  const { roster, initialize: initRoster } = useStaffRosterStore();
  const { initialize: initOrderFeed } = useOrderFeedStore();
  const { isDesktop, isTablet, maxContainerStyle } = useResponsive();

  const [isUpdating, setIsUpdating] = useState(false);
  const [maintenanceSuccess, setMaintenanceSuccess] = useState<string | null>(null);

  const onShift = !!staffDoc?.onShift;
  const isSupervisor = activeRole === 'supervisor' || activeRole === 'admin';

  useEffect(() => {
    if (isSupervisor) {
      initRoster();
    }
  }, [isSupervisor, initRoster]);

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
      // Also trigger roster & order re-sync
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

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <View style={maxContainerStyle}>
          {/* Header */}
          <View className="mb-5">
            <Text className="text-xs font-bold text-gray-400 tracking-wider mb-1">OPERATIONS & SYSTEM HUB</Text>
            <Text className="text-2xl font-black text-gray-900">Settings & Station Controls</Text>
            <Text className="text-gray-500 text-sm mt-0.5">Manage store resources, staff assignments, and account</Text>
          </View>

          {/* User Profile Card */}
          <View className="bg-white rounded-3xl p-5 mb-4 border border-gray-200/80 shadow-xs flex-row items-center justify-between flex-wrap gap-3">
            <View className="flex-row items-center">
              <View className="w-12 h-12 rounded-full bg-[#994bff]/15 items-center justify-center mr-3.5 border border-[#994bff]/30">
                <Text className="text-[#994bff] font-black text-lg">
                  {user?.name ? user.name.charAt(0).toUpperCase() : 'U'}
                </Text>
              </View>
              <View>
                <Text className="text-gray-900 font-extrabold text-base">{user?.name || 'Store Staff'}</Text>
                <Text className="text-gray-500 text-xs font-medium">{user?.phone || 'No phone registered'}</Text>
                <Text className="text-gray-400 text-[11px] mt-0.5">Store ID: Main Livfresh Hub</Text>
              </View>
            </View>

            <View className="bg-purple-100 border border-purple-200 px-3 py-1 rounded-full">
              <Text className="text-purple-800 font-black text-xs uppercase tracking-wider">
                {activeRole || 'Helper'}
              </Text>
            </View>
          </View>

          {/* Store Hardware & Stations (Visible to Supervisors & Floor Leads) */}
          {isSupervisor && (
            <View className="bg-white rounded-3xl p-5 mb-4 border border-gray-200/80 shadow-xs">
              <View className="flex-row items-center justify-between mb-3.5">
                <View className="flex-row items-center">
                  <Zap size={18} color="#994bff" className="mr-2" />
                  <Text className="text-gray-900 font-extrabold text-base">Store Hardware Capacity</Text>
                </View>
                <View className="bg-green-100 px-2.5 py-0.5 rounded-full">
                  <Text className="text-green-700 font-bold text-[10px] uppercase">Online</Text>
                </View>
              </View>

              <View className={`gap-3 mb-3 ${isDesktop || isTablet ? 'flex-row' : 'flex-col'}`}>
                {/* Washers */}
                <View className="flex-1 bg-purple-50/70 p-3.5 rounded-2xl border border-purple-100">
                  <View className="flex-row items-center justify-between mb-1.5">
                    <Text className="text-purple-950 font-black text-base">{resources.washers} Washers</Text>
                    <View className="w-2 h-2 rounded-full bg-purple-600" />
                  </View>
                  <Text className="text-purple-700 text-xs font-semibold">Washer 1 & Washer 2</Text>
                  <Text className="text-purple-500 text-[11px] mt-1">30m Timer Lockout Active (Nominal 35m)</Text>
                </View>

                {/* Dryers */}
                <View className="flex-1 bg-blue-50/70 p-3.5 rounded-2xl border border-blue-100">
                  <View className="flex-row items-center justify-between mb-1.5">
                    <Text className="text-blue-950 font-black text-base">{resources.dryers} Dryers</Text>
                    <View className="w-2 h-2 rounded-full bg-blue-600" />
                  </View>
                  <Text className="text-blue-700 text-xs font-semibold">Dryer 1 & Dryer 2</Text>
                  <Text className="text-blue-500 text-[11px] mt-1">30m Timer Lockout Active (Nominal 35m)</Text>
                </View>

                {/* Irons */}
                <View className="flex-1 bg-amber-50/70 p-3.5 rounded-2xl border border-amber-100">
                  <View className="flex-row items-center justify-between mb-1.5">
                    <Text className="text-amber-950 font-black text-base">{resources.ironingStations} Irons</Text>
                    <View className="w-2 h-2 rounded-full bg-amber-600" />
                  </View>
                  <Text className="text-amber-800 text-xs font-semibold">Iron 1 & Iron 2</Text>
                  <Text className="text-amber-600 text-[11px] mt-1">Designated: Samsul (Iron 1) & Abdur (Iron 2)</Text>
                </View>
              </View>

              <View className="bg-gray-50 p-3 rounded-2xl border border-gray-100">
                <Text className="text-gray-700 text-xs font-semibold mb-1">Autopilot Routing Rules Matrix:</Text>
                <Text className="text-gray-500 text-xs leading-5">
                  • <Text className="font-bold text-gray-800">Tagging & Packaging:</Text> Auto-assigned to Abdul (Primary) on pickup completion.{'\n'}
                  • <Text className="font-bold text-gray-800">Ironing Station 1:</Text> Routed to Samsul.{'\n'}
                  • <Text className="font-bold text-gray-800">Ironing Station 2:</Text> Routed to Abdur (Dual-station mode).{'\n'}
                  • <Text className="font-bold text-gray-800">Machine Parallelism:</Text> Helpers freed for manual tasks once washing/drying begins.
                </Text>
              </View>
            </View>
          )}

          {/* Live Staff Deployment Roster */}
          {isSupervisor && (
            <View className="bg-white rounded-3xl p-5 mb-4 border border-gray-200/80 shadow-xs">
              <View className="flex-row items-center justify-between mb-3">
                <View className="flex-row items-center">
                  <Users size={18} color="#994bff" className="mr-2" />
                  <Text className="text-gray-900 font-extrabold text-base">Active Floor Deployment</Text>
                </View>
                <Text className="text-gray-400 text-xs font-bold">{roster.helpers.length} Helpers · {roster.riders.length} Riders</Text>
              </View>

              <View className="gap-2.5">
                {roster.helpers.map(h => (
                  <View key={h.uid} className="flex-row items-center justify-between bg-gray-50 p-3 rounded-2xl border border-gray-100">
                    <View className="flex-row items-center">
                      <View className="w-8 h-8 rounded-full bg-purple-100 items-center justify-center mr-2.5">
                        <Text className="text-purple-800 font-bold text-xs">{h.name?.substring(0,1) || 'H'}</Text>
                      </View>
                      <View>
                        <Text className="text-gray-900 font-bold text-sm">{h.name || 'Helper'}</Text>
                        <Text className="text-gray-500 text-xs">{h.phone}</Text>
                      </View>
                    </View>

                    {h.activeHelperTask ? (
                      <View className="bg-blue-100 border border-blue-200 px-2.5 py-1 rounded-lg">
                        <Text className="text-blue-800 font-bold text-xs uppercase">{h.activeHelperTask.step}</Text>
                      </View>
                    ) : (
                      <View className="bg-green-100 border border-green-200 px-2.5 py-1 rounded-lg">
                        <Text className="text-green-800 font-bold text-xs uppercase">Available</Text>
                      </View>
                    )}
                  </View>
                ))}

                {roster.riders.map(r => (
                  <View key={r.uid} className="flex-row items-center justify-between bg-gray-50 p-3 rounded-2xl border border-gray-100">
                    <View className="flex-row items-center">
                      <View className="w-8 h-8 rounded-full bg-blue-100 items-center justify-center mr-2.5">
                        <Truck size={14} color="#1d4ed8" />
                      </View>
                      <View>
                        <Text className="text-gray-900 font-bold text-sm">{r.name || 'Rider'}</Text>
                        <Text className="text-gray-500 text-xs">{r.phone}</Text>
                      </View>
                    </View>

                    <View className="bg-blue-100 border border-blue-200 px-2.5 py-1 rounded-lg">
                      <Text className="text-blue-800 font-bold text-xs uppercase">Active Rider</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Maintenance & Self-Healing Utilities */}
          {isSupervisor && (
            <View className="bg-white rounded-3xl p-5 mb-4 border border-gray-200/80 shadow-xs">
              <View className="flex-row items-center mb-2">
                <Wrench size={18} color="#994bff" className="mr-2" />
                <Text className="text-gray-900 font-extrabold text-base">Operational Maintenance</Text>
              </View>
              <Text className="text-gray-500 text-xs mb-3">
                Run automated self-healing routines to resolve stuck tasks or cache mismatches.
              </Text>

              {maintenanceSuccess ? (
                <View className="bg-green-50 border border-green-200 p-3 rounded-xl mb-3 flex-row items-center">
                  <CheckCircle2 size={16} color="#16a34a" className="mr-2 shrink-0" />
                  <Text className="text-green-800 text-xs font-semibold flex-1">{maintenanceSuccess}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                onPress={handleClearStaleTasks}
                disabled={isUpdating}
                className="bg-purple-50 border border-purple-200 h-12 rounded-xl items-center justify-center flex-row active:bg-purple-100"
              >
                {isUpdating ? (
                  <ActivityIndicator size="small" color="#994bff" />
                ) : (
                  <>
                    <RefreshCw size={16} color="#994bff" className="mr-2" />
                    <Text className="text-purple-800 font-bold text-sm">Clear Stale Tasks & Re-sync Queue</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Rider Shift Toggle (For Riders) */}
          {activeRole === 'rider' && (
            <View className="bg-white rounded-3xl p-5 mb-4 border border-gray-200/80 shadow-xs">
              <Text className="text-gray-400 font-bold uppercase tracking-widest text-xs mb-3">
                Rider Shift Status
              </Text>
              <View className="flex-row items-center mb-4">
                <Power size={18} color={onShift ? '#22C55E' : '#64748B'} />
                <Text className={`font-bold ml-2 text-base ${onShift ? 'text-green-600' : 'text-gray-400'}`}>
                  {onShift ? 'Currently On Shift' : 'Currently Off Shift'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={handleToggleShift}
                disabled={isUpdating}
                className={`h-12 rounded-xl items-center justify-center flex-row ${
                  onShift ? 'bg-amber-500' : 'bg-primary'
                } ${isUpdating ? 'opacity-70' : ''}`}
              >
                {isUpdating ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text className="text-white text-base font-bold">
                    {onShift ? 'Go off shift' : 'Go on shift'}
                  </Text>
                )}
              </TouchableOpacity>
              {error ? <Text className="text-red-500 text-xs mt-3">{error}</Text> : null}
            </View>
          )}

          {/* Logout Action */}
          <TouchableOpacity
            onPress={handleLogout}
            className="w-full bg-red-50 border border-red-200 h-13 rounded-2xl items-center justify-center flex-row mt-2 active:bg-red-100"
          >
            <LogOut size={18} color="#EF4444" className="mr-2" />
            <Text className="text-red-600 text-base font-extrabold">Log Out of Operations</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
