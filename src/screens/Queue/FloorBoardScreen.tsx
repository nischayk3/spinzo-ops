import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, TouchableOpacity, TextInput, Linking, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, ChevronRight, Phone, MapPin, PackageOpen } from 'lucide-react-native';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { ACTIVE_STATUSES, FeedOrder, serviceSummary } from '../../utils/orderFeed';
import { stepLabel } from '../../utils/opsProcess';
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
const FILTER_TABS = ['All', 'Action Required', 'Processing', 'Ready', 'Out for Delivery'];

export function FloorBoardScreen() {
  const { orders, isLoading, initialize } = useOrderFeedStore();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('All');

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Derived filtered orders
  const filteredOrders = useMemo(() => {
    let result = orders;

    // Exclude cancelled and delivered orders from the default view
    if (!searchQuery.trim()) {
      result = result.filter(o => o.status !== 'cancelled' && o.status !== 'delivered');
    }

    // Apply Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(o =>
        o.id.toLowerCase().includes(q) ||
        (o.customerPhone && o.customerPhone.includes(q)) ||
        (o.customerName && o.customerName.toLowerCase().includes(q))
      );
    }

    // Apply Tab Filter
    if (activeTab === 'Action Required') {
      result = result.filter(o => {
        const s = String(o.status).toLowerCase();
        return ['placed', 'confirmed', 'in_transit_to_store', 'pickup_completed'].includes(s);
      });
    } else if (activeTab === 'Processing') {
      result = result.filter(o => String(o.status).toLowerCase() === 'processing');
    } else if (activeTab === 'Ready') {
      result = result.filter(o => String(o.status).toLowerCase() === 'ready');
    } else if (activeTab === 'Out for Delivery') {
      result = result.filter(o => String(o.status).toLowerCase() === 'out_for_delivery');
    }

    return result;
  }, [orders, searchQuery, activeTab]);

  if (isLoading && orders.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 items-center justify-center">
        <ActivityIndicator size="large" color="#994bff" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="px-6 pt-4 pb-2">
        <Text className="text-2xl font-bold text-gray-900">Orders Database</Text>
        <Text className="text-gray-500 mt-1">Manage and track all orders</Text>
      </View>

      {/* Search Bar */}
      <View className="px-6 mb-4">
        <View className="flex-row items-center bg-white rounded-2xl px-4 h-14 border border-gray-200 shadow-sm">
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
      </View>

      {/* Filter Tabs */}
      <View className="mb-4">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, gap: 8 }}>
          {FILTER_TABS.map(tab => {
            const isActive = activeTab === tab;
            return (
              <TouchableOpacity
                key={tab}
                onPress={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-full border ${isActive ? 'bg-[#994bff] border-[#994bff]' : 'bg-white border-gray-200'}`}
              >
                <Text className={`font-bold ${isActive ? 'text-white' : 'text-gray-600'}`}>{tab}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Orders List */}
      <FlatList
        data={filteredOrders}
        keyExtractor={o => o.id}
        className="flex-1 px-6"
        contentContainerStyle={{ paddingBottom: 24 }}
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
            'bg-gray-100 text-gray-700';

          return (
            <TouchableOpacity
              onPress={() => navigation.navigate('OrderDetail', { orderId: item.id })}
              className="bg-white rounded-2xl p-4 mb-3 border border-gray-100 shadow-sm"
            >
              <View className="flex-row items-center justify-between mb-3">
                <View className="flex-row items-center">
                  <Text className="text-gray-900 font-bold text-lg mr-2">
                    #{item.id.slice(-6).toUpperCase()}
                  </Text>
                  <View className={`px-2 py-0.5 rounded-full ${statusColor.split(' ')[0]}`}>
                    <Text className={`text-xs font-bold ${statusColor.split(' ')[1]}`}>
                      {STATUS_LABEL[item.status] || item.status}
                    </Text>
                  </View>
                </View>
                <ChevronRight size={20} color="#94a3b8" />
              </View>

              <View className="flex-row items-start justify-between mb-3">
                <View className="flex-1 mr-4">
                  <Text className="text-gray-900 font-medium text-base mb-1">
                    {item.customerName || 'Unknown Customer'}
                  </Text>
                  {item.customerPhone ? (
                    <TouchableOpacity onPress={() => Linking.openURL(`tel:${item.customerPhone}`)} className="flex-row items-center mb-1">
                      <Phone size={12} color="#994bff" />
                      <Text className="text-[#994bff] font-medium text-sm ml-1">{item.customerPhone}</Text>
                    </TouchableOpacity>
                  ) : null}
                  {item.address?.formattedAddress ? (
                    <View className="flex-row items-start">
                      <MapPin size={12} color="#94a3b8" className="mt-0.5" />
                      <Text className="text-gray-500 text-xs ml-1 flex-1" numberOfLines={1}>{item.address.formattedAddress}</Text>
                    </View>
                  ) : null}
                </View>

                <View className="items-end">
                  <Text className="text-gray-900 font-bold text-lg">
                    {item.totalAmount ? `₹${item.totalAmount}` : '—'}
                  </Text>
                  <Text className="text-gray-400 text-xs font-medium uppercase mt-0.5">
                    {item.paymentStatus || 'Pending'}
                  </Text>
                </View>
              </View>

              <View className="bg-gray-50 rounded-xl p-3 flex-row justify-between items-center">
                <View className="flex-1 mr-2">
                  <Text className="text-gray-500 text-xs mb-0.5 uppercase tracking-wider font-bold">Services</Text>
                  <Text className="text-gray-900 font-medium text-sm" numberOfLines={1}>
                    {serviceSummary(item)}
                  </Text>
                </View>
                {item.status === 'processing' && item.processingStep && (
                  <View className="items-end">
                    <Text className="text-gray-500 text-xs mb-0.5 uppercase tracking-wider font-bold">Floor Step</Text>
                    <Text className="text-blue-600 font-bold text-sm">
                      {stepLabel(item.processingStep)}
                    </Text>
                  </View>
                )}
                {(item.status === 'ready' || item.status === 'out_for_delivery') && item.deliveryDate && (
                  <View className="items-end">
                    <Text className="text-gray-500 text-xs mb-0.5 uppercase tracking-wider font-bold">Scheduled</Text>
                    <Text className="text-green-700 font-bold text-sm">
                      {item.deliveryDate} {item.deliveryTime}
                    </Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
}
