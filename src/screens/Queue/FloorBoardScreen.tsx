import React, { useEffect, useMemo } from 'react';
import { View, Text, FlatList, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { filterActiveOrders, ACTIVE_STATUSES, FeedOrder, serviceSummary } from '../../utils/orderFeed';

const STATUS_LABEL: Record<string, string> = {
  placed: 'New',
  confirmed: 'Confirmed',
  pickup_completed: 'Picked Up',
  processing: 'Processing',
  ready: 'Ready',
  out_for_delivery: 'Out for Delivery',
};

export function FloorBoardScreen() {
  const { orders, isLoading, initialize } = useOrderFeedStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  const active = useMemo(() => filterActiveOrders(orders), [orders]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of ACTIVE_STATUSES) c[s] = 0;
    for (const o of active) c[o.status] = (c[o.status] || 0) + 1;
    return c;
  }, [active]);

  if (isLoading && active.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-bgDark items-center justify-center">
        <ActivityIndicator size="large" color="#3B82F6" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bgDark">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-2xl font-bold text-textPrimary">Floor Board</Text>
        <Text className="text-textSecondary">Live order board · {active.length} active</Text>
      </View>
      <View className="flex-row flex-wrap px-4 mb-2">
        {ACTIVE_STATUSES.map(s => (
          <View key={s} className="bg-bgSurface rounded-full px-3 py-1 mr-2 mb-2 border border-bgSurfaceLight">
            <Text className="text-textSecondary text-xs">
              {STATUS_LABEL[s] || s}: <Text className="text-textPrimary font-bold">{counts[s] || 0}</Text>
            </Text>
          </View>
        ))}
      </View>
      <FlatList
        data={active}
        keyExtractor={o => o.id}
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => (
          <View className="bg-bgSurface rounded-xl p-4 mb-3 border border-bgSurfaceLight">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-textPrimary font-bold text-lg">
                #{item.id.slice(-6).toUpperCase()}
              </Text>
              <Text className="text-primary font-bold text-xs">
                {STATUS_LABEL[item.status] || item.status}
              </Text>
            </View>
            <Text className="text-textSecondary text-sm mb-1">
              {item.customerName || 'Unknown customer'}
            </Text>
            <Text className="text-textMuted text-xs">{serviceSummary(item)}</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}
