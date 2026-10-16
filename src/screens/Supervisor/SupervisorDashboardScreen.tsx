import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, ChevronRight, Truck, Users, AlertTriangle, IndianRupee, Timer, X, Zap } from 'lucide-react-native';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { useAuthStore } from '../../store/authStore';
import { useStaffRosterStore } from '../../store/staffRosterStore';
import { useOpsProcessStore } from '../../store/opsProcessStore';
import { dayRevenue, orderTotal, parseOrderTokens, matchOrderSearch } from '../../utils/orderFeed';
import { announceSkippedOrder } from '../../utils/alerts';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/RootNavigator';

export function SupervisorDashboardScreen() {
  const { orders, initialize } = useOrderFeedStore();
  const processes = useOpsProcessStore(s => s.processes);
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
    setSearchResults(orders.filter(o => matchOrderSearch(o, searchQuery)).slice(0, 16));
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

  const stageAverages = useMemo(() => {
    const statsMap: Record<string, { total: number; count: number }> = {
      tagging: { total: 0, count: 0 },
      getting_washed: { total: 0, count: 0 },
      getting_dried: { total: 0, count: 0 },
      getting_ironed: { total: 0, count: 0 },
      packaging: { total: 0, count: 0 },
    };

    processes.forEach(p => {
      Object.entries(p.stages || {}).forEach(([step, s]: [string, any]) => {
        if (statsMap[step] && typeof s?.acceptToCompleteMin === 'number') {
          statsMap[step].total += s.acceptToCompleteMin;
          statsMap[step].count += 1;
        }
      });
    });

    return [
      { key: 'tagging', label: 'Tagging', avg: statsMap.tagging.count ? Math.round(statsMap.tagging.total / statsMap.tagging.count) : null },
      { key: 'getting_washed', label: 'Washing', avg: statsMap.getting_washed.count ? Math.round(statsMap.getting_washed.total / statsMap.getting_washed.count) : null },
      { key: 'getting_dried', label: 'Drying', avg: statsMap.getting_dried.count ? Math.round(statsMap.getting_dried.total / statsMap.getting_dried.count) : null },
      { key: 'getting_ironed', label: 'Ironing', avg: statsMap.getting_ironed.count ? Math.round(statsMap.getting_ironed.total / statsMap.getting_ironed.count) : null },
      { key: 'packaging', label: 'Packaging', avg: statsMap.packaging.count ? Math.round(statsMap.packaging.total / statsMap.packaging.count) : null },
    ];
  }, [processes]);

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View className="mb-4">
          <Text className="text-xs font-bold text-gray-400 tracking-wider mb-1">SUPERVISOR VIEW</Text>
          <Text className="text-2xl font-bold text-gray-900">Store Today</Text>
        </View>

        {/* Search */}
        <View className="flex-row items-center bg-white rounded-2xl px-4 h-12 border border-gray-200 mb-4 shadow-sm">
          <Search size={20} color="#94a3b8" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search Token #, Order ID, Phone, Customer..."
            placeholderTextColor="#94a3b8"
            className="flex-1 h-full px-3 text-gray-900 font-medium"
            autoCapitalize="none"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} className="p-1">
              <X size={18} color="#94a3b8" />
            </TouchableOpacity>
          )}
        </View>

        {searchResults.length > 0 && (
          <View className="mb-5">
            <Text className="text-gray-900 font-bold mb-3">{searchResults.length} Result(s)</Text>
            {searchResults.map(o => {
              const chips = parseOrderTokens(o.tokens, o.tokenNumber, o.items);
              const garmentCount = o.garmentCount || o.opsDetails?.garmentCount;
              return (
                <TouchableOpacity
                  key={o.id}
                  onPress={() => navigation.navigate('OrderDetail', { orderId: o.id })}
                  className="bg-white rounded-2xl p-4 border border-gray-100 mb-2 shadow-sm"
                >
                  <View className="flex-row items-start justify-between">
                    <View className="flex-1 mr-3">
                      <View className="flex-row items-center flex-wrap gap-1.5 mb-1">
                        <Text className="font-bold text-gray-900 text-base">#{o.id.slice(-6).toUpperCase()}</Text>
                        {o.isUrgent && (
                          <View className="bg-red-500/20 border border-red-500/50 px-2 py-0.5 rounded-full flex-row items-center">
                            <Zap size={10} color="#ef4444" className="mr-0.5" />
                            <Text className="text-red-500 font-black text-[10px] uppercase">URGENT</Text>
                          </View>
                        )}
                        <View className="bg-gray-100 px-2 py-0.5 rounded-full">
                          <Text className="text-gray-600 text-[10px] font-bold uppercase">{o.status?.replace(/_/g, ' ')}</Text>
                        </View>
                      </View>

                      {/* Prominent Tokens */}
                      {chips.length > 0 && (
                        <View className="flex-row flex-wrap gap-1.5 mb-1.5">
                          {chips.map((c, i) => (
                            <View key={i} className="bg-amber-100/80 border border-amber-300 px-2.5 py-0.5 rounded-md flex-row items-center">
                              <Text className="text-amber-900 font-extrabold text-xs">
                                Token #{c.token}
                              </Text>
                              {c.serviceLabel ? (
                                <Text className="text-amber-700 text-[11px] ml-1 font-medium">({c.serviceLabel})</Text>
                              ) : null}
                            </View>
                          ))}
                        </View>
                      )}

                      <Text className="text-gray-800 font-medium text-sm">{o.customerName || 'Unknown customer'}</Text>
                      {o.customerPhone && (
                        <Text className="text-gray-500 text-xs mt-0.5">{o.customerPhone}</Text>
                      )}
                      {garmentCount ? (
                        <Text className="text-blue-600 text-xs font-semibold mt-1">
                          👕 {garmentCount} Garments Tagged
                        </Text>
                      ) : null}
                    </View>

                    <View className="items-end">
                      <Text className="font-bold text-gray-900 text-sm">₹{orderTotal(o)}</Text>
                      <ChevronRight size={18} color="#94a3b8" className="mt-2" />
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
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
                {(() => {
                  const chips = parseOrderTokens(o.tokens, o.tokenNumber, o.items);
                  if (chips.length === 0) return null;
                  return (
                    <View className="flex-row flex-wrap gap-1 mt-2">
                      {chips.map((c, i) => (
                        <View key={i} className="bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                          <Text className="text-amber-800 font-bold text-xs">
                            Token #{c.token}{c.serviceLabel ? ` · ${c.serviceLabel}` : ''}
                          </Text>
                        </View>
                      ))}
                    </View>
                  );
                })()}
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

        {/* Stage Timing Metrics */}
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-gray-900 font-bold text-base">Stage Timing (Accept to Complete)</Text>
          <View className="flex-row items-center">
            <Timer size={14} color="#6b7280" className="mr-1" />
            <Text className="text-gray-500 text-xs">Live Avg</Text>
          </View>
        </View>
        <View className="bg-white rounded-2xl border border-gray-100 p-4 mb-6">
          <View className="flex-row flex-wrap gap-2">
            {stageAverages.map(s => (
              <View key={s.key} className="flex-1 min-w-[90px] bg-gray-50 p-3 rounded-xl border border-gray-100 items-center">
                <Text className="text-gray-500 text-[11px] font-bold uppercase">{s.label}</Text>
                <Text className="text-gray-900 font-extrabold text-lg mt-1">
                  {s.avg !== null ? `${s.avg}m` : '—'}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
