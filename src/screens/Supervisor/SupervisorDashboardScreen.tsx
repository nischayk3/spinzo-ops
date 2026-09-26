import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, ChevronRight, Truck, Users, AlertTriangle, IndianRupee } from 'lucide-react-native';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { useAuthStore } from '../../store/authStore';
import { useStaffRosterStore } from '../../store/staffRosterStore';
import { dayRevenue, orderTotal } from '../../utils/orderFeed';
import { announceSkippedOrder } from '../../utils/alerts';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/RootNavigator';

export function SupervisorDashboardScreen() {
  const { orders, initialize } = useOrderFeedStore();
  const user = useAuthStore(s => s.user);
  const { roster } = useStaffRosterStore();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Skipped / inbound queue = orders waiting for pickup or in transit (not yet on floor)
  const inbound = useMemo(() => {
    return orders
      .filter(o => (o.status === 'placed' || o.status === 'confirmed' || o.status === 'in_transit_to_store'))
      .sort((a, b) => {
        const aMs = (a.createdAt as any)?.toMillis ? (a.createdAt as any).toMillis() : new Date((a.createdAt as any) || Date.now()).getTime();
        const bMs = (b.createdAt as any)?.toMillis ? (b.createdAt as any).toMillis() : new Date((b.createdAt as any) || Date.now()).getTime();
        return bMs - aMs;
      });
  }, [orders]);

  // One-shot "You skipped an order" alert per new inbound order still awaiting pickup.
  // dramaticChime(false) plays a short burst (not a loop), and announceSkippedOrder
  // dedupes so the same order only rings once — it never rings forever.
  useEffect(() => {
    if (user?.role === 'supervisor') {
      inbound.forEach(o => { if (o.status === 'placed' || o.status === 'confirmed') { announceSkippedOrder(o.id); } });
    }
  }, [inbound.length]);

  const stats = dayRevenue(orders);

  const [searchResults, setSearchResults] = useState<any[]>([]);
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const q = searchQuery.toLowerCase().trim();
    setSearchResults(orders.filter(o =>
      o.id.toLowerCase().includes(q) ||
      (o.customerPhone && o.customerPhone.includes(q)) ||
      (o.customerName && o.customerName.toLowerCase().includes(q))
    ).slice(0, 12));
  }, [searchQuery, orders]);

  const pipeline = useMemo(() => {
    const count = (status: string) => orders.filter(o => o.status === status).length;
    return [
      { key: 'pickup_completed', label: 'Ready to tag', n: count('pickup_completed'), color: 'bg-purple-100 text-purple-700' },
      { key: 'processing', label: 'Processing', n: count('processing'), color: 'bg-blue-100 text-blue-700' },
      { key: 'ready', label: 'Ready', n: count('ready'), color: 'bg-green-100 text-green-700' },
      { key: 'out_for_delivery', label: 'Out for Delivery', n: count('out_for_delivery'), color: 'bg-orange-100 text-orange-700' },
      { key: 'delivered', label: 'Delivered', n: count('delivered'), color: 'bg-gray-100 text-gray-600' },
    ];
  }, [orders]);

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View className="mb-4">
          <Text className="text-xs font-bold text-gray-400 tracking-wider mb-1">SUPERVISOR VIEW</Text>
          <Text className="text-2xl font-bold text-gray-900">Store Today</Text>
        </View>

        {/* Search */}
        <View className="flex-row items-center bg-white rounded-2xl px-4 h-12 border border-gray-200 mb-4">
          <Search size={20} color="#94a3b8" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search Order ID, Name or Phone..."
            placeholderTextColor="#94a3b8"
            className="flex-1 h-full px-3 text-gray-900 font-medium"
            autoCapitalize="none"
          />
        </View>

        {searchResults.length > 0 && (
          <View className="mb-5">
            <Text className="text-gray-900 font-bold mb-3">{searchResults.length} Result(s)</Text>
            {searchResults.map(o => (
              <TouchableOpacity
                key={o.id}
                onPress={() => navigation.navigate('OrderDetail', { orderId: o.id })}
                className="bg-white rounded-2xl p-4 border border-gray-100 mb-2"
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-1">
                    <Text className="font-bold text-gray-900 text-base">#{o.id.slice(-6).toUpperCase()}</Text>
                    <Text className="text-gray-500 text-sm">{o.customerName || 'Unknown'}</Text>
                  </View>
                  <ChevronRight size={18} color="#94a3b8" />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Revenue card */}
        <View className="bg-[#994bff] rounded-3xl p-5 mb-4">
          <View className="flex-row items-center mb-2">
            <View className="w-9 h-9 rounded-full bg-white/20 items-center justify-center mr-3">
              <IndianRupee color="#fff" size={18} />
            </View>
            <Text className="text-white font-bold">Today's Revenue</Text>
          </View>
          <Text className="text-4xl font-black text-white mb-3">₹{stats.revenue.toLocaleString('en-IN')}</Text>
          <View className="flex-row justify-between">
            <Text className="text-white/90 text-sm">{stats.orderCount} orders</Text>
            <Text className="text-white/90 text-sm">{stats.readyCount} ready · {stats.outForDelivery} OFD</Text>
          </View>
        </View>

        {/* Staff availability */}
        <View className="flex-row gap-3 mb-4">
          <View className="flex-1 bg-white rounded-3xl p-4 border border-gray-100 items-center">
            <View className="w-10 h-10 rounded-full bg-purple-50 items-center justify-center mb-2">
              <Users color="#994bff" size={20} />
            </View>
            <Text className="text-3xl font-bold text-gray-900">{roster.countHelpers}</Text>
            <Text className="text-xs text-gray-500 font-medium">Helpers</Text>
          </View>
          <View className="flex-1 bg-white rounded-3xl p-4 border border-gray-100 items-center">
            <View className="w-10 h-10 rounded-full bg-blue-50 items-center justify-center mb-2">
              <Truck color="#3b82f6" size={20} />
            </View>
            <Text className="text-3xl font-bold text-gray-900">{roster.countRiders}</Text>
            <Text className="text-xs text-gray-500 font-medium">Riders</Text>
          </View>
        </View>

        {/* Skipped / Inbound queue */}
        {inbound.length > 0 && (
          <View className="mb-5">
            <View className="flex-row items-center mb-3">
              <AlertTriangle color="#f97316" size={18} />
              <Text className="text-gray-900 font-bold text-base ml-2">
                Incoming / Skipped ({inbound.length})
              </Text>
            </View>
            {inbound.map(o => (
              <TouchableOpacity
                key={o.id}
                onPress={() => navigation.navigate('OrderDetail', { orderId: o.id })}
                className="bg-white rounded-2xl p-4 border border-gray-100 mb-2"
              >
                <View className="flex-row items-center justify-between mb-2">
                  <Text className="font-bold text-gray-900 text-base">#{o.id.slice(-6).toUpperCase()}</Text>
                  <View className="px-2 py-0.5 rounded-full bg-orange-100">
                    <Text className="text-orange-700 font-bold text-xs uppercase">{o.status.replace('_', ' ')}</Text>
                  </View>
                </View>
                <Text className="text-gray-700 font-medium">{o.customerName}</Text>
                <Text className="text-gray-500 text-xs mt-1">₹{orderTotal(o)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <Text className="text-gray-900 font-bold text-base mb-3">Queue</Text>
        <View className="bg-white rounded-3xl p-4 border border-gray-100 mb-5 flex-row">
          <View className="flex-1 items-center border-r border-gray-100">
            <Text className="text-2xl font-bold text-gray-900">{stats.readyCount}</Text>
            <Text className="text-gray-500 text-xs">Ready</Text>
          </View>
          <View className="flex-1 items-center">
            <Text className="text-2xl font-bold text-gray-900">{stats.outForDelivery}</Text>
            <Text className="text-gray-500 text-xs">Out for Delivery</Text>
          </View>
        </View>

        {/* Pipeline */}
        <Text className="text-gray-900 font-bold text-base mb-3">Pipeline</Text>
        <View className="bg-white rounded-2xl border border-gray-100 mb-6 overflow-hidden">
          {pipeline.map((p, i) => (
            <View
              key={p.key}
              className={`flex-row items-center justify-between px-4 py-3 ${i < pipeline.length - 1 ? 'border-b border-gray-100' : ''}`}
            >
              <Text className="text-gray-700 font-medium">{p.label}</Text>
              <View className={`px-2.5 py-0.5 rounded-full ${p.color}`}>
                <Text className="font-bold text-xs">{p.n}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
