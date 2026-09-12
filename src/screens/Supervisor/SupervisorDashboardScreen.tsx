import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, TextInput, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AlertTriangle, WashingMachine, Wind, Activity, Users, ClipboardList, Search, ChevronRight, Package, Phone, MapPin, Truck, BellRing } from 'lucide-react-native';
import { useOpsProcessStore } from '../../store/opsProcessStore';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { useAuthStore } from '../../store/authStore';
import { useOpsStaffStore } from '../../store/opsStaffStore';
import { currentStep, isDone, OpsProcess } from '../../utils/opsProcess';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { Linking } from 'react-native';

export function SupervisorDashboardScreen() {
  const { processes, isLoading: processesLoading } = useOpsProcessStore();
  const { orders, isLoading: ordersLoading } = useOrderFeedStore();
  const user = useAuthStore(s => s.user);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (user?.id) {
      useOrderFeedStore.getState().initialize();
      useOpsProcessStore.getState().initialize(user.id);
    }
  }, [user?.id]);

  const isLoading = processesLoading || ordersLoading;

  const stats = useMemo(() => {
    let activeWashing = 0;
    let activeDrying = 0;
    let activeIroning = 0;
    let readyForDelivery = 0;
    let outForDelivery = 0;
    let SLA_Breaches = 0;
    
    let readyToTag = orders.filter(o => o.status === 'pickup_completed' && !processes.find((p: OpsProcess) => p.orderId === o.id)).length;
    
    let totalInPipeline = processes.filter((p: OpsProcess) => {
      if (isDone(p)) return false;
      const order = orders.find(o => o.id === p.orderId);
      if (order && order.status === 'cancelled') return false;
      return true;
    }).length;

    orders.forEach(o => {
      if (o.status === 'cancelled') return; // skip cancelled orders
      if (o.status === 'ready') readyForDelivery++;
      if (o.status === 'out_for_delivery') outForDelivery++;
    });

    processes.forEach((p: OpsProcess) => {
      // Skip processes belonging to cancelled orders
      const order = orders.find(o => o.id === p.orderId);
      if (order && order.status === 'cancelled') return;

      const cur = currentStep(p);
      if (cur === 'getting_washed') activeWashing++;
      if (cur === 'getting_dried') activeDrying++;
      if (cur === 'getting_ironed') activeIroning++;
      
      // Simple SLA proxy check (in real app, calculate actual time difference)
      const curStage = cur ? p.stages?.[cur] : null;
      if (curStage?.startedAt && !curStage?.completedAt) {
        const startMs = typeof (curStage.startedAt as any).toMillis === 'function' ? (curStage.startedAt as any).toMillis() : new Date((curStage.startedAt as any) || Date.now()).getTime();
        const diffMins = (Date.now() - startMs) / 60000;
        if (diffMins > 60) SLA_Breaches++; // arbitrary 60m proxy
      }
    });

    return { activeWashing, activeDrying, activeIroning, readyForDelivery, outForDelivery, SLA_Breaches, readyToTag, totalInPipeline };
  }, [processes, orders]);

  // New incoming orders that haven't reached the processing floor yet
  const incomingOrders = useMemo(() => {
    return orders.filter(o =>
      (o.status === 'placed' || o.status === 'confirmed' || o.status === 'in_transit_to_store')
    ).sort((a, b) => {
      const aMs = (a.createdAt as any)?.toMillis ? (a.createdAt as any).toMillis() : new Date((a.createdAt as any) || Date.now()).getTime();
      const bMs = (b.createdAt as any)?.toMillis ? (b.createdAt as any).toMillis() : new Date((b.createdAt as any) || Date.now()).getTime();
      return bMs - aMs;
    });
  }, [orders]);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase().trim();

    if (q === 'sla:breaches') {
      const breachedOrderIds = new Set<string>();
      processes.forEach((p: OpsProcess) => {
        const order = orders.find(o => o.id === p.orderId);
        if (order && order.status === 'cancelled') return;
        const cur = currentStep(p);
        const curStage = cur ? p.stages?.[cur] : null;
        if (curStage?.startedAt && !curStage?.completedAt) {
          const startMs = typeof (curStage.startedAt as any).toMillis === 'function' ? (curStage.startedAt as any).toMillis() : new Date((curStage.startedAt as any) || Date.now()).getTime();
          const diffMins = (Date.now() - startMs) / 60000;
          if (diffMins > 60) breachedOrderIds.add(p.orderId);
        }
      });
      return orders.filter(o => breachedOrderIds.has(o.id));
    }

    return orders.filter(o => 
      o.id.toLowerCase().includes(q) || 
      (o.customerPhone && o.customerPhone.includes(q)) ||
      (o.customerName && o.customerName.toLowerCase().includes(q))
    ).slice(0, 10); // cap at 10 for performance
  }, [searchQuery, orders, processes]);

  if (isLoading && processes.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 items-center justify-center">
        <ActivityIndicator size="large" color="#994bff" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <ScrollView className="flex-1 px-6 pt-4">
        <View className="mb-6">
          <Text className="text-xs font-bold text-gray-400 tracking-wider mb-1">SUPERVISOR VIEW</Text>
          <Text className="text-2xl font-bold text-gray-900">Live Operations</Text>
        </View>

        {/* Search Bar */}
        <View className="flex-row items-center bg-white rounded-2xl px-4 h-14 border border-gray-200 mb-6 shadow-sm">
          <Search size={20} color="#94a3b8" />
          <TextInput 
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search Order ID, Name or Phone..."
            placeholderTextColor="#94a3b8"
            className="flex-1 h-full px-3 text-gray-900 font-medium"
            autoCapitalize="none"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} className="p-2">
              <Text className="text-gray-400 font-bold">Clear</Text>
            </TouchableOpacity>
          )}
        </View>

        {searchQuery.trim().length > 0 ? (
          <View className="flex-1">
            <Text className="text-gray-900 font-bold mb-4">
              {searchQuery.trim() === 'sla:breaches' ? 'SLA Breaches' : `Search Results (${searchResults.length})`}
            </Text>
            {searchResults.length === 0 ? (
              <View className="items-center py-10">
                <Text className="text-gray-400 font-medium">No orders found matching "{searchQuery}"</Text>
              </View>
            ) : (
              searchResults.map(order => (
                <TouchableOpacity
                  key={order.id}
                  onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}
                  className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm mb-3 flex-row items-center justify-between"
                >
                  <View className="flex-1">
                    <View className="flex-row items-center mb-1">
                      <Text className="font-bold text-gray-900 text-lg mr-2">#{order.id.slice(-6).toUpperCase()}</Text>
                      <View className="bg-gray-100 px-2 py-0.5 rounded-full">
                        <Text className="text-xs font-bold text-gray-600">{order.status.replace('_', ' ').toUpperCase()}</Text>
                      </View>
                    </View>
                    <Text className="text-gray-500 font-medium">{order.customerName || 'Unknown'}</Text>
                  </View>
                  <View className="w-8 h-8 rounded-full bg-gray-50 items-center justify-center">
                    <ChevronRight size={20} color="#94a3b8" />
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        ) : (
          <>
            {/* Incoming Orders Section */}
            {incomingOrders.length > 0 && (
              <View className="mb-6">
                <View className="flex-row items-center mb-3">
                  <BellRing size={18} color="#f97316" />
                  <Text className="text-gray-900 font-bold text-base ml-2">Incoming Orders ({incomingOrders.length})</Text>
                </View>
                {incomingOrders.map(order => {
                  const statusColor = order.status === 'in_transit_to_store' ? 'bg-purple-100 text-purple-700'
                    : order.status === 'confirmed' ? 'bg-blue-100 text-blue-700'
                    : 'bg-orange-100 text-orange-700';
                  const statusLabel = order.status === 'in_transit_to_store' ? 'In Transit to Store'
                    : order.status === 'confirmed' ? 'Confirmed'
                    : 'Placed';
                  return (
                    <TouchableOpacity
                      key={order.id}
                      onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}
                      className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm mb-3"
                    >
                      <View className="flex-row items-center justify-between mb-2">
                        <View className="flex-row items-center">
                          <Text className="font-bold text-gray-900 text-lg mr-2">#{order.id.slice(-6).toUpperCase()}</Text>
                          <View className={`px-2 py-0.5 rounded-full ${statusColor.split(' ')[0]}`}>
                            <Text className={`text-xs font-bold ${statusColor.split(' ')[1]}`}>{statusLabel}</Text>
                          </View>
                        </View>
                        <ChevronRight size={18} color="#94a3b8" />
                      </View>

                      {/* Customer Info */}
                      <View className="bg-gray-50 rounded-xl p-3 mb-2">
                        <Text className="text-gray-900 font-medium text-base">{order.customerName || 'Unknown Customer'}</Text>
                        {order.customerPhone ? (
                          <TouchableOpacity
                            onPress={() => Linking.openURL(`tel:${order.customerPhone}`)}
                            className="flex-row items-center mt-1"
                          >
                            <Phone size={12} color="#3b82f6" />
                            <Text className="text-blue-600 text-sm ml-1 font-medium">{order.customerPhone}</Text>
                          </TouchableOpacity>
                        ) : null}
                        {order.address?.formattedAddress ? (
                          <View className="flex-row items-start mt-1">
                            <MapPin size={12} color="#64748b" className="mt-0.5" />
                            <Text className="text-gray-500 text-xs ml-1 flex-1">{order.address.formattedAddress}</Text>
                          </View>
                        ) : null}
                      </View>

                      {/* Order Summary */}
                      <View className="flex-row items-center justify-between">
                        <Text className="text-gray-500 text-xs">
                          {order.items?.map((i: any) => `${i.quantity || 1}x ${i.name || i.serviceType}`).join(', ') || 'Items not specified'}
                        </Text>
                        {order.totalAmount ? (
                          <Text className="text-gray-900 font-bold text-sm">₹{order.totalAmount}</Text>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Top KPI Cards */}
            <View className="flex-row gap-4 mb-6">
              <View className="flex-1 bg-white p-4 rounded-3xl border border-gray-100 shadow-sm">
                <View className="w-10 h-10 rounded-full bg-[#994bff]/10 items-center justify-center mb-3">
                  <Activity color="#994bff" size={20} />
                </View>
                <Text className="text-3xl font-bold text-gray-900 mb-1">{stats.totalInPipeline}</Text>
                <Text className="text-xs font-medium text-gray-500 uppercase tracking-wide">In Pipeline</Text>
              </View>
              
              <View className="flex-1 bg-white p-4 rounded-3xl border border-gray-100 shadow-sm">
                <View className="w-10 h-10 rounded-full bg-blue-50 items-center justify-center mb-3">
                  <ClipboardList color="#3b82f6" size={20} />
                </View>
                <Text className="text-3xl font-bold text-gray-900 mb-1">{stats.readyToTag}</Text>
                <Text className="text-xs font-medium text-gray-500 uppercase tracking-wide">Ready To Tag</Text>
              </View>
            </View>

            {/* Delivery Stats */}
            <View className="flex-row gap-4 mb-6">
              <View className="flex-1 bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex-row items-center justify-between">
                <View>
                  <Text className="text-3xl font-bold text-gray-900 mb-1">{stats.readyForDelivery} <Text className="text-lg font-medium text-gray-400">/ {stats.outForDelivery}</Text></Text>
                  <Text className="text-xs font-medium text-gray-500 uppercase tracking-wide">Ready / OFD</Text>
                </View>
                <View className="w-12 h-12 rounded-full bg-green-50 items-center justify-center">
                  <Package color="#22c55e" size={24} />
                </View>
              </View>
            </View>

            {/* Alerts Section */}
            {stats.SLA_Breaches > 0 && (
              <View className="bg-red-50 border border-red-200 rounded-2xl p-5 mb-6 flex-row items-center justify-between">
                <View className="flex-row items-center flex-1">
                  <AlertTriangle color="#ef4444" size={24} className="mr-3" />
                  <View>
                    <Text className="text-red-700 font-bold text-base">SLA Breaches</Text>
                    <Text className="text-red-600 text-xs mt-1">{stats.SLA_Breaches} orders have exceeded SLA</Text>
                  </View>
                </View>
                <TouchableOpacity 
                  onPress={() => setSearchQuery('sla:breaches')}
                  className="bg-white px-3 py-1.5 rounded-full border border-red-200">
                  <Text className="text-red-600 font-bold text-xs">View</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Floor Activity */}
            <Text className="text-gray-900 font-bold text-base mb-4">Floor Activity</Text>
            <View className="bg-white rounded-3xl p-2 border border-gray-100 shadow-sm mb-6">
              <View className="flex-row items-center justify-between p-4 border-b border-gray-50">
                <View className="flex-row items-center gap-3">
                  <View className="w-10 h-10 rounded-full bg-blue-50 items-center justify-center">
                    <WashingMachine color="#3b82f6" size={20} />
                  </View>
                  <Text className="text-gray-900 font-medium">Active Washers</Text>
                </View>
                <Text className="text-xl font-bold text-gray-900">{stats.activeWashing}</Text>
              </View>
              
              <View className="flex-row items-center justify-between p-4 border-b border-gray-50">
                <View className="flex-row items-center gap-3">
                  <View className="w-10 h-10 rounded-full bg-orange-50 items-center justify-center">
                    <Wind color="#f97316" size={20} />
                  </View>
                  <Text className="text-gray-900 font-medium">Active Dryers</Text>
                </View>
                <Text className="text-xl font-bold text-gray-900">{stats.activeDrying}</Text>
              </View>

              <View className="flex-row items-center justify-between p-4">
                <View className="flex-row items-center gap-3">
                  <View className="w-10 h-10 rounded-full bg-purple-50 items-center justify-center">
                    <Users color="#a855f7" size={20} />
                  </View>
                  <Text className="text-gray-900 font-medium">Ironing Queue</Text>
                </View>
                <Text className="text-xl font-bold text-gray-900">{stats.activeIroning}</Text>
              </View>
            </View>
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}
