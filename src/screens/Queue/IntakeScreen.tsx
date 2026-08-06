import React, { useEffect } from 'react';
import { View, Text, FlatList, SafeAreaView, ActivityIndicator } from 'react-native';
import { Clock } from 'lucide-react-native';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { filterIntakeOrders, FeedOrder } from '../../utils/orderFeed';

const timeAgo = (v: any): string => {
  if (!v) return '';
  let ms: number;
  if (typeof v.toDate === 'function') ms = v.toDate().getTime();
  else if (typeof v.seconds === 'number') ms = v.seconds * 1000;
  else ms = new Date(v).getTime();
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
};

const slotLabel = (o: FeedOrder): string => {
  const p = o.pickupDetails;
  if (!p) return '—';
  if (p.isInstant) return 'Instant pickup';
  return `${p.scheduledDate || ''} ${p.scheduledTime || ''}`.trim() || 'Scheduled';
};

const serviceSummary = (o: FeedOrder): string =>
  (o.items || []).map(i => i.serviceName || i.serviceType).filter(Boolean).join(', ') || 'Unknown';

export function IntakeScreen() {
  const { orders, isLoading, initialize } = useOrderFeedStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  const intake = filterIntakeOrders(orders);

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
