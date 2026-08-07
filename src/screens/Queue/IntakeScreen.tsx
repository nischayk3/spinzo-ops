import React, { useEffect, useRef } from 'react';
import { View, Text, FlatList, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Clock } from 'lucide-react-native';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import {
  filterIntakeOrders,
  timeAgo,
  serviceSummary,
  slotLabel,
} from '../../utils/orderFeed';
import { announceNewOrder } from '../../utils/alerts';

// Tracks intake ids we've already announced so a remount / refresh doesn't re-announce.
const announcedOrderIds = new Set<string>();

export function IntakeScreen() {
  const { orders, isLoading, initialize } = useOrderFeedStore();
  const baselineCaptured = useRef(false);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const intake = filterIntakeOrders(orders);

  // Wait for the initial snapshot to settle (isLoading -> false), then mark every
  // already-visible order as seen so a fresh login doesn't blast "New order" for old orders.
  useEffect(() => {
    if (baselineCaptured.current || isLoading) return;
    for (const o of intake) announcedOrderIds.add(o.id);
    baselineCaptured.current = true;
  }, [isLoading, intake]);

  // Announce intake orders that arrived after the baseline snapshot.
  useEffect(() => {
    for (const o of intake) {
      if (!announcedOrderIds.has(o.id)) {
        announcedOrderIds.add(o.id);
        announceNewOrder();
      }
    }
  }, [intake]);

  if (isLoading && intake.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-bgDark items-center justify-center">
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text className="text-textSecondary mt-4 font-bold">Watching for new orders…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bgDark">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-2xl font-bold text-textPrimary">New Orders</Text>
        <Text className="text-textSecondary">Orders waiting for pickup · {intake.length}</Text>
      </View>
      <FlatList
        data={intake}
        keyExtractor={o => o.id}
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={
          <View className="items-center justify-center mt-20">
            <Text className="text-textSecondary text-lg font-bold">No new orders</Text>
            <Text className="text-textMuted text-center mt-2">New orders appear here instantly.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View className="bg-bgSurface rounded-xl p-4 mb-3 border border-bgSurfaceLight">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-textPrimary font-bold text-lg">
                #{item.id.slice(-6).toUpperCase()}
              </Text>
              <View className="flex-row items-center">
                <Clock size={13} color="#94A3B8" />
                <Text className="text-textMuted text-xs ml-1">{timeAgo(item.createdAt)}</Text>
              </View>
            </View>
            <Text className="text-textSecondary text-sm mb-1">
              {item.customerName || 'Unknown customer'}
            </Text>
            <Text className="text-textMuted text-xs mb-3">{serviceSummary(item)}</Text>
            <View className="bg-bgDark px-2 py-1 rounded-md self-start">
              <Text className="text-primary text-xs font-bold">{slotLabel(item)}</Text>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}
