import React, { useEffect } from 'react';
import { View, Text, FlatList, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bike, Clock, MapPin } from 'lucide-react-native';
import { useAuthStore } from '../../store/authStore';
import { useOpsStaffStore } from '../../store/opsStaffStore';
import { isPending, pickupLabel } from '../../utils/opsTasks';
import { timeAgo } from '../../utils/orderFeed';

export function PickupsScreen() {
  const user = useAuthStore(state => state.user);
  const { myTasks, isLoading, initialize } = useOpsStaffStore();

  useEffect(() => {
    if (user?.id) initialize(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = myTasks.filter(isPending);

  if (isLoading && pending.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-bgDark items-center justify-center">
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text className="text-textSecondary mt-4 font-bold">Loading pickups…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bgDark">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-2xl font-bold text-textPrimary">My Pickups</Text>
        <Text className="text-textSecondary">
          {pending.length} pending pickup{pending.length === 1 ? '' : 's'}
        </Text>
      </View>
      <FlatList
        data={pending}
        keyExtractor={t => t.id}
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={
          <View className="items-center justify-center mt-20">
            <Bike size={36} color="#64748B" />
            <Text className="text-textSecondary text-lg font-bold mt-3">No pickups assigned yet</Text>
            <Text className="text-textMuted text-center mt-2">Assigned pickups appear here instantly.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View className="bg-bgSurface rounded-xl p-4 mb-3 border border-bgSurfaceLight">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-textPrimary font-bold text-lg">
                #{item.orderId.slice(-6).toUpperCase()}
              </Text>
              {item.createdAt ? (
                <View className="flex-row items-center">
                  <Clock size={13} color="#94A3B8" />
                  <Text className="text-textMuted text-xs ml-1">{timeAgo(item.createdAt)}</Text>
                </View>
              ) : null}
            </View>
            {item.pickupAddress ? (
              <View className="flex-row items-start mb-2">
                <MapPin size={14} color="#94A3B8" className="mt-0.5" />
                <Text className="text-textSecondary text-sm ml-1 flex-1">{item.pickupAddress}</Text>
              </View>
            ) : null}
            <View className="flex-row items-center justify-between">
              <View className="bg-bgDark px-2 py-1 rounded-md self-start">
                <Text className="text-primary text-xs font-bold">{pickupLabel(item)}</Text>
              </View>
              {item.tokenNumber ? (
                <Text className="text-textMuted text-xs">Token #{item.tokenNumber}</Text>
              ) : null}
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}
