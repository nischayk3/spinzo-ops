import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, TouchableOpacity, TextInput, Linking, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, ChevronRight, Phone, MapPin, PackageOpen, Tag, Zap, Clock, Calendar, CheckCircle2 } from 'lucide-react-native';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { ACTIVE_STATUSES, FeedOrder, serviceSummary, orderTotal, parseOrderTokens, matchOrderSearch, sortReadyOrders, getPickupInfo } from '../../utils/orderFeed';
import { stepLabel } from '../../utils/opsProcess';
import { useResponsive } from '../../utils/useResponsive';
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
const FILTER_TABS = ['All', 'Action Required', 'Processing', 'Ready', 'Out for Delivery', 'Delivered', 'Cancelled'];

export function FloorBoardScreen() {
  const { orders, isLoading, initialize } = useOrderFeedStore();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { isDesktop, isTablet, maxContainerStyle } = useResponsive();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('All');
  const [urgentOnly, setUrgentOnly] = useState(false);

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Derived filtered orders
  const filteredOrders = useMemo(() => {
    let result = orders;

    // Exclude cancelled and delivered orders from the default view
    if (!searchQuery.trim() && activeTab !== 'Delivered' && activeTab !== 'Cancelled') {
      result = result.filter(o => o.status !== 'cancelled' && o.status !== 'delivered');
    }

    // Apply Urgent filter
    if (urgentOnly) {
      result = result.filter(o => o.isUrgent);
    }

    // Apply Search
    if (searchQuery.trim()) {
      result = result.filter(o => matchOrderSearch(o, searchQuery));
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
      result = sortReadyOrders(result.filter(o => String(o.status).toLowerCase() === 'ready'));
    } else if (activeTab === 'Out for Delivery') {
      result = sortReadyOrders(result.filter(o => String(o.status).toLowerCase() === 'out_for_delivery'));
    } else if (activeTab === 'Delivered') {
      result = result.filter(o => String(o.status).toLowerCase() === 'delivered');
    } else if (activeTab === 'Cancelled') {
      result = result.filter(o => String(o.status).toLowerCase() === 'cancelled');
    }

    return result;
  }, [orders, searchQuery, activeTab, urgentOnly]);

  if (isLoading && orders.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 items-center justify-center">
        <ActivityIndicator size="large" color="#994bff" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View style={maxContainerStyle} className="flex-1">
        {/* Header */}
        <View className="px-6 pt-4 pb-2 flex-row items-center justify-between flex-wrap gap-2">
          <View>
            <Text className="text-2xl font-black text-gray-900">Orders Database</Text>
            <Text className="text-gray-500 text-sm mt-0.5">Manage and track all store orders ({filteredOrders.length} showing)</Text>
          </View>

          {/* Urgent Filter Toggle */}
          <TouchableOpacity
            onPress={() => setUrgentOnly(!urgentOnly)}
            className={`px-3 py-1.5 rounded-full border flex-row items-center ${
              urgentOnly ? 'bg-red-500 border-red-500' : 'bg-white border-gray-200'
            }`}
          >
            <Zap size={14} color={urgentOnly ? '#fff' : '#ef4444'} className="mr-1" />
            <Text className={`font-bold text-xs ${urgentOnly ? 'text-white' : 'text-gray-700'}`}>
              Urgent Only
            </Text>
          </TouchableOpacity>
        </View>

        {/* Search Bar */}
        <View className="px-6 mb-3">
          <View className="flex-row items-center bg-white rounded-2xl px-4 h-12 border border-gray-200 shadow-xs">
            <Search size={18} color="#94a3b8" />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search by Token #, Order ID, Phone, Customer..."
              placeholderTextColor="#94a3b8"
              className="flex-1 h-full px-3 text-gray-900 font-medium text-sm"
              autoCapitalize="none"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} className="p-1">
                <Text className="text-gray-400 font-bold text-xs">Clear</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Filter Tabs */}
        <View className="mb-3">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, gap: 8 }}>
            {FILTER_TABS.map(tab => {
              const isActive = activeTab === tab;
              return (
                <TouchableOpacity
                  key={tab}
                  onPress={() => setActiveTab(tab)}
                  className={`px-4 py-2 rounded-full border ${isActive ? 'bg-[#994bff] border-[#994bff]' : 'bg-white border-gray-200'}`}
                >
                  <Text className={`font-bold text-xs ${isActive ? 'text-white' : 'text-gray-600'}`}>{tab}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Orders List / 2-Column Desktop Grid */}
        <FlatList
          key={isDesktop ? 'desktop-grid' : 'mobile-list'}
          data={filteredOrders}
          keyExtractor={o => o.id}
          numColumns={isDesktop ? 2 : 1}
          className="flex-1 px-4"
          contentContainerStyle={{ paddingBottom: 32 }}
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
              item.status === 'pickup_completed' ? 'bg-purple-100 text-purple-700' :
              'bg-gray-100 text-gray-700';

            const tokenChips = parseOrderTokens(item.tokens, item.tokenNumber, item.items);
            const garmentCount = item.garmentCount || (item as any).opsDetails?.garmentCount;

            return (
              <TouchableOpacity
                onPress={() => navigation.navigate('OrderDetail', { orderId: item.id })}
                className={`bg-white rounded-2xl p-4 mb-3 border border-gray-200/90 shadow-xs active:opacity-90 ${
                  isDesktop ? 'flex-1 m-1.5' : ''
                }`}
              >
                {/* Header: ID, Tokens, Urgency, Status */}
                <View className="flex-row items-center justify-between mb-2">
                  <View className="flex-row items-center flex-wrap gap-1.5 flex-1 mr-2">
                    <Text className="text-gray-900 font-black text-base">
                      #{item.id.slice(-6).toUpperCase()}
                    </Text>
                    {item.isUrgent && (
                      <View className="bg-red-500/15 border border-red-500/40 px-2 py-0.5 rounded-full flex-row items-center">
                        <Zap size={10} color="#ef4444" className="mr-0.5" />
                        <Text className="text-red-600 text-[10px] font-black uppercase">URGENT</Text>
                      </View>
                    )}
                    {tokenChips.map((c, i) => (
                      <View key={i} className="bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-md flex-row items-center">
                        <Text className="text-amber-900 font-extrabold text-[11px]">T-{c.token}</Text>
                      </View>
                    ))}
                    {['placed', 'confirmed'].includes(item.status) && (() => {
                      const pInfo = getPickupInfo(item);
                      return (
                        <View className={`px-2 py-0.5 rounded-full border flex-row items-center ${
                          pInfo.isInstant ? 'bg-amber-100/90 border-amber-300' : 'bg-blue-50 border-blue-200'
                        }`}>
                          {pInfo.isInstant ? (
                            <Zap size={9} color="#b45309" className="mr-0.5" />
                          ) : (
                            <Calendar size={9} color="#1d4ed8" className="mr-0.5" />
                          )}
                          <Text className={`text-[10px] font-black uppercase ${
                            pInfo.isInstant ? 'text-amber-900' : 'text-blue-900'
                          }`}>
                            {pInfo.isInstant ? 'Instant' : (pInfo.dateLabel || 'Scheduled')}
                          </Text>
                        </View>
                      );
                    })()}
                  </View>

                  <View className="flex-row items-center">
                    <View className={`px-2 py-0.5 rounded-full mr-2 ${statusColor.split(' ')[0]}`}>
                      <Text className={`text-xs font-bold ${statusColor.split(' ')[1]}`}>
                        {STATUS_LABEL[item.status] || item.status}
                      </Text>
                    </View>
                    <ChevronRight size={18} color="#94a3b8" />
                  </View>
                </View>

                {/* Customer, Phone, Total & Payment */}
                <View className="flex-row items-start justify-between mb-2.5">
                  <View className="flex-1 mr-4">
                    <Text className="text-gray-900 font-bold text-sm mb-0.5" numberOfLines={1}>
                      {item.customerName || 'Unknown Customer'}
                    </Text>
                    {item.customerPhone ? (
                      <TouchableOpacity
                        onPress={(e) => {
                          e?.stopPropagation?.();
                          Linking.openURL(`tel:${item.customerPhone}`);
                        }}
                        className="flex-row items-center self-start py-0.5"
                      >
                        <Phone size={11} color="#994bff" className="mr-1" />
                        <Text className="text-[#994bff] font-semibold text-xs">{item.customerPhone}</Text>
                      </TouchableOpacity>
                    ) : null}
                    {item.address?.formattedAddress ? (
                      <View className="flex-row items-start mt-0.5">
                        <MapPin size={11} color="#94a3b8" className="mt-0.5 shrink-0" />
                        <Text className="text-gray-500 text-xs ml-1 flex-1" numberOfLines={1}>{item.address.formattedAddress}</Text>
                      </View>
                    ) : null}
                  </View>

                  <View className="items-end shrink-0">
                    <Text className="text-gray-900 font-black text-base">
                      {orderTotal(item) > 0 ? `₹${orderTotal(item)}` : '—'}
                    </Text>
                    <Text className="text-gray-400 text-[10px] font-bold uppercase mt-0.5">
                      {item.paymentStatus || 'Pending'}
                    </Text>
                  </View>
                </View>

                {/* Service & Stage Ribbon */}
                <View className="bg-gray-50 rounded-xl p-2.5 flex-row justify-between items-center border border-gray-100 mb-2">
                  <View className="flex-1 mr-2">
                    <Text className="text-gray-400 text-[10px] uppercase tracking-wider font-extrabold">Services</Text>
                    <Text className="text-gray-800 font-semibold text-xs" numberOfLines={1}>
                      {serviceSummary(item)}
                    </Text>
                    {garmentCount ? (
                      <Text className="text-primary text-[11px] font-bold mt-0.5">👕 {garmentCount} Tagged</Text>
                    ) : null}
                  </View>

                  {item.status === 'processing' && item.processingStep && (
                    <View className="items-end">
                      <Text className="text-gray-400 text-[10px] uppercase tracking-wider font-extrabold">Floor Step</Text>
                      <View className="bg-blue-100 px-2 py-0.5 rounded mt-0.5">
                        <Text className="text-blue-800 font-bold text-xs">
                          {stepLabel(item.processingStep)}
                        </Text>
                      </View>
                    </View>
                  )}

                  {['placed', 'confirmed', 'in_transit_to_store'].includes(item.status) && (() => {
                    const pInfo = getPickupInfo(item);
                    return (
                      <View className="items-end">
                        <View className="flex-row items-center gap-1">
                          {pInfo.isInstant ? (
                            <Zap size={9} color="#b45309" />
                          ) : (
                            <Calendar size={9} color="#1d4ed8" />
                          )}
                          <Text className={`text-[10px] uppercase tracking-wider font-extrabold ${
                            pInfo.isInstant ? 'text-amber-800' : 'text-blue-800'
                          }`}>
                            {pInfo.isInstant ? 'Instant Pickup' : 'Pickup Slot'}
                          </Text>
                        </View>
                        <Text className={`font-bold text-xs mt-0.5 ${
                          pInfo.isInstant ? 'text-amber-700' : 'text-blue-700'
                        }`}>
                          {pInfo.isInstant
                            ? (pInfo.timeLabel || 'Within 30–45m')
                            : `${pInfo.dateLabel ? `${pInfo.dateLabel}, ` : ''}${pInfo.timeLabel || 'Scheduled'}`}
                        </Text>
                      </View>
                    );
                  })()}

                  {(item.status === 'ready' || item.status === 'out_for_delivery') && (
                    item.deliveryDate ? (
                      <View className="items-end">
                        <Text className="text-gray-400 text-[10px] uppercase tracking-wider font-extrabold">Delivery Target</Text>
                        <Text className="text-green-700 font-bold text-xs mt-0.5">
                          {item.deliveryDate} {item.deliveryTime || ''}
                        </Text>
                      </View>
                    ) : (
                      <View className="items-end">
                        <Text className="text-gray-400 text-[10px] uppercase tracking-wider font-extrabold">Delivery Target</Text>
                        <Text className="text-amber-600 font-bold text-xs mt-0.5">
                          Awaiting Slot
                        </Text>
                      </View>
                    )
                  )}
                </View>

                {/* Pickup / Staff Footer */}
                {(item.pickupNote || (item as any).opsMeta?.pickupNote) ? (
                  <View className="bg-amber-50 border border-amber-300 rounded-xl p-2 mt-1.5">
                    <Text className="text-amber-800 text-xs">
                      <Text className="font-bold">📝 Note: </Text>{item.pickupNote || (item as any).opsMeta?.pickupNote}
                    </Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          }}
        />
      </View>
    </SafeAreaView>
  );
}
