import React, { useState, useMemo } from 'react';
import { View, Text, Pressable, Modal, ScrollView, Linking, TouchableOpacity } from 'react-native';
import { Navigation, Bike, Package, Zap, ChevronRight, Phone, MapPin, X, CheckCircle2, Store } from 'lucide-react-native';
import { buildSmartRoute, SmartRouteStop, safeShortId } from '../../utils/smartRoute';
import { DeliveryTask } from '../../store/opsStaffStore';
import { OpsTask } from '../../utils/opsTasks';
import { FeedOrder, formatDisplayPhone } from '../../utils/orderFeed';
import { SPINZO_STORE_ADDRESS, SPINZO_STORE_LOCATION } from '../../utils/storeGeo';

interface SmartRouteSheetProps {
  myTasks: OpsTask[];
  myDeliveries: DeliveryTask[];
  orders: FeedOrder[];
  onSelectTask?: (stop: SmartRouteStop) => void;
}

const openMaps = (address: string, lat?: number, lng?: number) => {
  let dest = address;
  if (lat && lng) {
    dest = `${lat},${lng}`;
  }
  if (!dest) return;
  const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
  Linking.openURL(url).catch(() => {
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dest)}`);
  });
};

const callCustomer = (phone?: string | null) => {
  if (!phone) return;
  const clean = phone.replace(/[^0-9+]/g, '');
  Linking.openURL(`tel:${clean}`);
};

export function SmartRouteSheet({
  myTasks,
  myDeliveries,
  orders,
  onSelectTask,
}: SmartRouteSheetProps) {
  const [modalVisible, setModalVisible] = useState(false);

  const stops = useMemo(() => {
    return buildSmartRoute({
      myTasks,
      myDeliveries,
      orders,
    });
  }, [myTasks, myDeliveries, orders]);

  if (stops.length === 0) return null;

  const currentStop = stops[0];
  const nextStop = stops.length > 1 ? stops[1] : null;

  return (
    <>
      {/* High-Contrast Mission Control Runner */}
      <Pressable
        onPress={() => setModalVisible(true)}
        className="mb-2 mx-4 rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 shadow-sm active:opacity-90 flex-row items-center justify-between"
      >
        <View className="flex-row items-center flex-1 mr-2">
          {/* Left Icon Badge */}
          <View
            className={`w-7 h-7 rounded-lg items-center justify-center mr-2 shadow-xs ${
              currentStop.type === 'pickup'
                ? 'bg-purple-600'
                : currentStop.type === 'store_dropoff' || currentStop.type === 'store_pickup'
                ? 'bg-emerald-600'
                : 'bg-blue-600'
            }`}
          >
            {currentStop.type === 'pickup' ? (
              <Bike size={14} color="#FFFFFF" />
            ) : currentStop.type === 'store_dropoff' ? (
              <Store size={14} color="#FFFFFF" />
            ) : (
              <Package size={14} color="#FFFFFF" />
            )}
          </View>

          {/* Center Info */}
          <View className="flex-1">
            <View className="flex-row items-center gap-1.5 mb-0.5">
              <Text className="text-white font-black text-xs" numberOfLines={1}>
                STOP 1: {currentStop.customerName || `#${safeShortId(currentStop.orderId)}`}
              </Text>
              {currentStop.isInstant && (
                <View className="bg-amber-400 px-1 py-0.2 rounded shadow-xs">
                  <Text className="text-slate-950 text-[9px] font-black">⚡ INSTANT</Text>
                </View>
              )}
              <View className="bg-slate-800 border border-slate-700 px-1.5 py-0.2 rounded">
                <Text className="text-slate-200 text-[9px] font-black uppercase">
                  {currentStop.locality}
                </Text>
              </View>
            </View>

            <Text className="text-slate-400 text-[11px] font-medium" numberOfLines={1}>
              {stops.length} stop{stops.length > 1 ? 's' : ''} on route
              {nextStop ? ` • Stop 2: ${nextStop.customerName || `#${safeShortId(nextStop.orderId)}`}` : ''}
            </Text>
          </View>
        </View>

        {/* Right Action Button */}
        <View className="bg-purple-600 active:bg-purple-700 px-2.5 py-1.5 rounded-lg flex-row items-center shadow-xs">
          <Text className="text-white text-[11px] font-black mr-0.5">Run Sheet</Text>
          <ChevronRight size={12} color="#FFFFFF" />
        </View>
      </Pressable>

      {/* Full Modal Run Sheet */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <View className="flex-1 bg-black/75 justify-end">
          <View className="bg-white rounded-t-3xl border-t border-slate-300 max-h-[88%] p-5 pb-8 shadow-2xl">
            {/* Modal Header */}
            <View className="flex-row items-center justify-between pb-3 border-b-2 border-slate-200 mb-4">
              <View>
                <View className="flex-row items-center gap-2">
                  <Zap size={20} color="#7C3AED" />
                  <Text className="text-xl font-black text-slate-950">Smart Run Sheet</Text>
                </View>
                <Text className="text-slate-600 text-xs mt-0.5 font-bold">
                  {stops.length} stops scheduled in shortest-distance circuit
                </Text>
              </View>
              <Pressable
                onPress={() => setModalVisible(false)}
                className="w-9 h-9 rounded-full bg-slate-100 border border-slate-300 items-center justify-center"
              >
                <X size={18} color="#0F172A" />
              </Pressable>
            </View>

            {/* Stops Timeline */}
            <ScrollView showsVerticalScrollIndicator={false} className="space-y-3">
              {stops.map((stop, index) => {
                const isFirst = index === 0;
                const isStore = stop.type === 'store_dropoff' || stop.type === 'store_pickup';
                return (
                  <View
                    key={stop.taskId}
                    className={`p-4 rounded-3xl border-2 ${
                      isFirst
                        ? 'bg-purple-50/80 border-purple-600 shadow-sm'
                        : isStore
                        ? 'bg-emerald-50/80 border-emerald-500'
                        : 'bg-white border-slate-300'
                    } mb-3`}
                  >
                    <View className="flex-row items-center justify-between mb-2">
                      <View className="flex-row items-center gap-2 flex-wrap flex-1 mr-2">
                        <View
                          className={`w-7 h-7 rounded-lg items-center justify-center font-bold text-xs ${
                            isFirst ? 'bg-purple-600' : isStore ? 'bg-emerald-600' : 'bg-slate-900'
                          }`}
                        >
                          <Text className="text-white text-xs font-black">{stop.stopNumber}</Text>
                        </View>
                        <Text
                          className={`font-black text-xs uppercase ${
                            stop.type === 'pickup'
                              ? 'text-purple-700'
                              : isStore
                              ? 'text-emerald-700'
                              : 'text-blue-700'
                          }`}
                        >
                          {stop.type === 'pickup'
                            ? 'Pickup'
                            : stop.type === 'store_dropoff'
                            ? 'Store Drop'
                            : stop.type === 'store_pickup'
                            ? 'Store Pickup'
                            : 'Delivery'}
                        </Text>
                        {stop.isInstant && (
                          <View className="bg-amber-400 border border-amber-500 px-2 py-0.5 rounded shadow-xs">
                            <Text className="text-slate-950 font-black text-[10px]">
                              ⚡ INSTANT
                            </Text>
                          </View>
                        )}
                        <View className="bg-slate-900 px-2 py-0.5 rounded">
                          <Text className="text-white font-black text-[10px] uppercase">
                            {stop.locality}
                          </Text>
                        </View>
                        {stop.loadUnits > 1 && (
                          <View className="bg-purple-100 border border-purple-400 px-2 py-0.5 rounded">
                            <Text className="text-purple-950 font-black text-[10px] uppercase">
                              🐘 BULKY LOAD
                            </Text>
                          </View>
                        )}
                      </View>

                      <Text className="text-slate-950 font-black text-sm">
                        #{safeShortId(stop.orderId)}
                      </Text>
                    </View>

                    {stop.customerName && (
                      <Text className="text-slate-950 font-black text-base mb-1">
                        {stop.customerName}
                      </Text>
                    )}

                    <View className="flex-row items-start gap-1.5 mb-2">
                      <MapPin size={14} color="#0F172A" className="mt-0.5" />
                      <Text className="text-slate-900 text-xs flex-1 leading-relaxed font-bold">
                        {stop.address}
                      </Text>
                    </View>

                    {stop.slot && (
                      <Text className="text-slate-700 text-xs mb-3 font-semibold">
                        Window: <Text className="text-slate-950 font-black">{stop.slot}</Text>
                      </Text>
                    )}

                    <View className="flex-row items-center gap-2 pt-2 border-t border-slate-200">
                      <TouchableOpacity
                        onPress={() => openMaps(stop.address, stop.latitude, stop.longitude)}
                        className="flex-1 bg-blue-600 active:bg-blue-700 py-2.5 rounded-xl flex-row items-center justify-center gap-1.5 shadow-sm"
                      >
                        <Navigation size={13} color="#FFFFFF" />
                        <Text className="text-white text-xs font-black">Directions</Text>
                      </TouchableOpacity>

                      {stop.customerPhone && (
                        <TouchableOpacity
                          onPress={() => callCustomer(stop.customerPhone)}
                          className="bg-emerald-600 active:bg-emerald-700 py-2.5 px-3 rounded-xl flex-row items-center justify-center gap-1.5 shadow-sm"
                        >
                          <Phone size={13} color="#FFFFFF" />
                          <Text className="text-white text-xs font-black">{formatDisplayPhone(stop.customerPhone)}</Text>
                        </TouchableOpacity>
                      )}

                      <TouchableOpacity
                        onPress={() => {
                          setModalVisible(false);
                          onSelectTask?.(stop);
                        }}
                        className="bg-slate-950 active:bg-slate-800 py-2.5 px-3.5 rounded-xl flex-row items-center justify-center shadow-sm"
                      >
                        <Text className="text-white text-xs font-black">Open Task</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}
