import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Phone, MessageCircle } from 'lucide-react-native';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { customerIndex, CustomerSummary, parseOrderTokens } from '../../utils/orderFeed';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'CustomerDetail'>;

export function CustomerDetailScreen({ route, navigation }: Props) {
  const { phone } = route.params;
  const orders = useOrderFeedStore(s => s.orders);

  const customer = useMemo(() => {
    const idx = customerIndex(orders);
    return idx.get(phone) || null;
  }, [orders, phone]);

  if (!customer) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 items-center justify-center">
        <ActivityIndicator size="large" color="#994bff" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="px-6 pt-4 pb-4 flex-row items-center justify-between bg-white border-b border-gray-100">
        <TouchableOpacity onPress={() => navigation.goBack()} className="w-10 h-10 rounded-full bg-gray-100 items-center justify-center">
          <ArrowLeft size={20} color="#64748b" />
        </TouchableOpacity>
        <Text className="text-gray-900 font-bold text-lg">Customer</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <View className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
          <Text className="text-gray-900 text-2xl font-bold mb-1">{customer.name}</Text>
          <Text className="text-gray-500 text-sm mb-4">{customer.phone}</Text>
          <View className="flex-row gap-3 mb-4">
            <TouchableOpacity onPress={() => Linking.openURL(`tel:${customer.phone}`)} className="flex-1 h-12 bg-purple-50 rounded-xl items-center justify-center flex-row border border-purple-200">
              <Phone size={16} color="#994bff" className="mr-2" />
              <Text className="text-purple-700 font-bold">Call</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                const p = customer.phone.replace(/\D/g, '');
                const fp = p.startsWith('91') ? p : `91${p}`;
                Linking.openURL(`https://wa.me/${fp}`);
              }}
              className="flex-1 h-12 bg-green-50 rounded-xl items-center justify-center flex-row border border-green-200"
            >
              <MessageCircle size={16} color="#22c55e" className="mr-2" />
              <Text className="text-green-700 font-bold">WhatsApp</Text>
            </TouchableOpacity>
          </View>
          <View className="flex-row justify-between px-4 py-3 bg-gray-50 rounded-xl">
            <View className="items-center">
              <Text className="text-gray-900 font-bold text-xl">{customer.totalOrders}</Text>
              <Text className="text-gray-500 text-xs">Orders</Text>
            </View>
            <View className="items-center">
              <Text className="text-gray-900 font-bold text-xl">₹{customer.totalRevenue}</Text>
              <Text className="text-gray-500 text-xs">Revenue</Text>
            </View>
          </View>
        </View>

        <Text className="text-gray-900 font-bold text-base mb-4">Order History</Text>
        {customer.orders.map((o, idx) => {
          const statusLabel = (o.status || '').replace(/_/g, ' ');
          return (
            <TouchableOpacity
              key={o.orderId}
              onPress={() => navigation.navigate('OrderDetail', { orderId: o.orderId })}
              className="bg-white rounded-2xl p-4 border border-gray-100 mb-3"
            >
              <View className="flex-row justify-between items-center mb-2">
                <Text className="text-gray-900 font-bold text-lg">#{o.orderId.slice(-6).toUpperCase()}</Text>
                <Text className="text-gray-500 text-sm uppercase font-bold">{statusLabel}</Text>
              </View>
              <Text className="text-gray-500 text-sm mb-1">₹{o.total}</Text>
              {(() => {
                const chips = parseOrderTokens(o.tokens, o.tokenNumber, o.items);
                if (chips.length === 0) return null;
                return (
                  <View className="flex-row flex-wrap gap-1 mb-1">
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
              {o.items && o.items.length > 0 && (
                <Text className="text-gray-400 text-xs" numberOfLines={1}>
                  {o.items.map((i: any) => `${i.serviceName || i.serviceType}`).join(', ')}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}