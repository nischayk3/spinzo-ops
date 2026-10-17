import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, Modal, ScrollView, TouchableOpacity, Linking, ActivityIndicator } from 'react-native';
import { X, Truck, Phone, MapPin, Navigation, Zap, ChevronRight, AlertTriangle, ArrowRight, Package, Bike } from 'lucide-react-native';
import { db } from '../../config/firebase';
import { collection, query, where, onSnapshot } from '../../config/firebase';
import { buildSmartRoute, SmartRouteStop, safeShortId } from '../../utils/smartRoute';
import { OpsTask, parseOpsTask } from '../../utils/opsTasks';
import { DeliveryTask } from '../../store/opsStaffStore';
import { FeedOrder, orderTotal } from '../../utils/orderFeed';
import { StaffMember } from '../../store/staffRosterStore';

interface SupervisorRiderRouteModalProps {
  visible: boolean;
  onClose: () => void;
  rider: StaffMember | null;
  orders: FeedOrder[];
  onOpenOrder: (orderId: string) => void;
}

export function SupervisorRiderRouteModal({
  visible,
  onClose,
  rider,
  orders,
  onOpenOrder,
}: SupervisorRiderRouteModalProps) {
  const [tasks, setTasks] = useState<OpsTask[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryTask[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !rider?.uid) {
      setTasks([]);
      setDeliveries([]);
      return;
    }

    setLoading(true);
    const qTasks = query(collection(db, 'ops_tasks'), where('assignee', '==', rider.uid));
    const qDel = query(collection(db, 'ops_delivery_tasks'), where('assignee', '==', rider.uid));

    const unsubTasks = onSnapshot(qTasks, snap => {
      const list: OpsTask[] = [];
      snap.forEach(d => list.push(parseOpsTask(d.id, d.data())));
      setTasks(list);
      setLoading(false);
    }, () => setLoading(false));

    const unsubDel = onSnapshot(qDel, snap => {
      const list: DeliveryTask[] = [];
      snap.forEach(d => {
        const data = d.data();
        list.push({
          id: d.id,
          orderId: data.orderId || d.id,
          userId: data.userId || '',
          vendorId: data.vendorId || '',
          status: data.status || 'assigned',
          assignee: data.assignee || rider.uid,
          deliveryAddress: data.deliveryAddress,
          deliveryDate: data.deliveryDate,
          deliveryTime: data.deliveryTime,
          deliveryOTP: data.deliveryOTP,
          assignedAt: data.assignedAt,
          pickedUpAt: data.pickedUpAt,
          deliveredAt: data.deliveredAt,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          totalAmount: data.totalAmount,
          items: data.items,
          tokenNumber: data.tokenNumber,
          tokens: data.tokens,
          bundleCount: data.bundleCount,
          bundleLabels: data.bundleLabels,
        });
      });
      setDeliveries(list);
    });

    return () => {
      unsubTasks();
      unsubDel();
    };
  }, [visible, rider?.uid]);

  // Compute live smart route for this rider
  const stops = useMemo(() => {
    if (!rider?.uid) return [];
    return buildSmartRoute({
      myTasks: tasks,
      myDeliveries: deliveries,
      orders,
    });
  }, [tasks, deliveries, orders, rider?.uid]);

  const activePickups = stops.filter(s => s.type === 'pickup' || s.type === 'store_dropoff').length;
  const activeDeliveries = stops.filter(s => s.type === 'delivery' || s.type === 'store_pickup').length;
  const totalLoadUnits = stops.reduce((sum, s) => sum + (s.loadUnits || 1), 0);

  if (!visible || !rider) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black/60 justify-end md:justify-center md:items-center p-0 md:p-6">
        <View className="bg-white w-full md:max-w-2xl rounded-t-3xl md:rounded-3xl max-h-[90%] flex-col overflow-hidden shadow-2xl">
          {/* Header */}
          <View className="p-4 bg-slate-900 border-b border-slate-800 flex-row items-center justify-between">
            <View className="flex-row items-center gap-3">
              <View className="w-10 h-10 rounded-full bg-blue-500/20 border border-blue-400/40 items-center justify-center">
                <Truck size={18} color="#60A5FA" />
              </View>
              <View>
                <View className="flex-row items-center gap-2">
                  <Text className="text-white font-black text-base">{rider.name || 'Rider'}</Text>
                  <View className="bg-blue-500/20 border border-blue-400/40 px-2 py-0.5 rounded-full">
                    <Text className="text-blue-300 font-extrabold text-[10px] uppercase">On Route</Text>
                  </View>
                </View>
                <Text className="text-slate-400 text-xs font-semibold">{rider.phone}</Text>
              </View>
            </View>

            <TouchableOpacity
              onPress={onClose}
              className="w-8 h-8 rounded-full bg-slate-800 items-center justify-center active:opacity-70"
            >
              <X size={16} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* Quick Metrics Bar */}
          <View className="flex-row items-center justify-around bg-slate-50 border-b border-slate-200 py-3 px-4">
            <View className="items-center">
              <Text className="text-slate-400 font-bold text-[10px] uppercase">Active Pickups</Text>
              <Text className="text-slate-900 font-extrabold text-sm">{activePickups}</Text>
            </View>
            <View className="h-6 w-px bg-slate-200" />
            <View className="items-center">
              <Text className="text-slate-400 font-bold text-[10px] uppercase">Active Deliveries</Text>
              <Text className="text-slate-900 font-extrabold text-sm">{activeDeliveries}</Text>
            </View>
            <View className="h-6 w-px bg-slate-200" />
            <View className="items-center">
              <Text className="text-slate-400 font-bold text-[10px] uppercase">Scooty Bag Load</Text>
              <Text className={`font-extrabold text-sm ${totalLoadUnits >= 3 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {totalLoadUnits} / 3 Bags {totalLoadUnits >= 3 ? '(Full)' : '(Available)'}
              </Text>
            </View>
          </View>

          {/* Stops List */}
          <ScrollView contentContainerStyle={{ padding: 16 }} className="flex-1">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-slate-900 font-extrabold text-sm uppercase tracking-wide">
                Live Smart Route ({stops.length} Stop{stops.length === 1 ? '' : 's'})
              </Text>
              <Text className="text-slate-500 text-xs font-medium">Ordered by SLA & Locality</Text>
            </View>

            {loading ? (
              <View className="py-12 items-center justify-center">
                <ActivityIndicator size="small" color="#994bff" />
                <Text className="text-slate-400 text-xs font-medium mt-2">Loading rider tasks...</Text>
              </View>
            ) : stops.length === 0 ? (
              <View className="py-12 items-center justify-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                <Truck size={32} color="#94A3B8" />
                <Text className="text-slate-700 font-bold text-sm mt-2">No active tasks assigned</Text>
                <Text className="text-slate-400 text-xs text-center mt-1">
                  Assign pickups or deliveries to {rider.name} from the inbound queue or order details.
                </Text>
              </View>
            ) : (
              <View className="space-y-3">
                {stops.map(stop => {
                  const isPickup = stop.type === 'pickup';
                  const isStore = stop.type === 'store_dropoff' || stop.type === 'store_pickup';
                  return (
                    <TouchableOpacity
                      key={stop.id}
                      onPress={() => {
                        onClose();
                        onOpenOrder(stop.orderId);
                      }}
                      className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs mb-2.5 active:opacity-95"
                    >
                      <View className="flex-row items-center justify-between mb-1.5">
                        <View className="flex-row items-center gap-2">
                          <View className="w-5 h-5 rounded-full bg-slate-900 items-center justify-center">
                            <Text className="text-white text-[10px] font-black">{stop.stopNumber}</Text>
                          </View>

                          <View
                            className={`px-2 py-0.5 rounded-md flex-row items-center ${
                              isStore
                                ? 'bg-amber-100 border border-amber-200'
                                : isPickup
                                ? 'bg-blue-100 border border-blue-200'
                                : 'bg-purple-100 border border-purple-200'
                            }`}
                          >
                            {isPickup ? (
                              <Bike size={11} color="#1d4ed8" className="mr-1" />
                            ) : (
                              <Package size={11} color="#7e22ce" className="mr-1" />
                            )}
                            <Text
                              className={`font-black text-[10px] uppercase ${
                                isStore ? 'text-amber-800' : isPickup ? 'text-blue-800' : 'text-purple-800'
                              }`}
                            >
                              {stop.type.replace(/_/g, ' ')}
                            </Text>
                          </View>

                          {stop.isInstant && (
                            <View className="bg-amber-50 border border-amber-300 px-1.5 py-0.2 rounded flex-row items-center">
                              <Zap size={9} color="#d97706" className="mr-0.5" />
                              <Text className="text-amber-800 font-extrabold text-[9px]">⚡ INSTANT</Text>
                            </View>
                          )}

                          <View className="bg-slate-100 px-1.5 py-0.2 rounded">
                            <Text className="text-slate-600 font-bold text-[9px]">{stop.locality}</Text>
                          </View>

                          {stop.loadUnits > 1 && (
                            <View className="bg-purple-50 border border-purple-200 px-1.5 py-0.2 rounded">
                              <Text className="text-purple-700 font-bold text-[9px]">🐘 Bulky (2 Bags)</Text>
                            </View>
                          )}
                        </View>

                        <Text className="text-slate-900 font-extrabold text-xs">
                          #{safeShortId(stop.orderId)}
                        </Text>
                      </View>

                      <View className="flex-row items-center justify-between mb-1">
                        <Text className="text-slate-900 font-bold text-xs" numberOfLines={1}>
                          {stop.customerName || (isStore ? 'SpinZo BTM Store' : 'Customer')}
                        </Text>
                        {stop.totalAmount ? (
                          <Text className="text-slate-800 font-extrabold text-xs">₹{stop.totalAmount}</Text>
                        ) : null}
                      </View>

                      <View className="flex-row items-start gap-1 mb-2">
                        <MapPin size={11} color="#64748B" className="mt-0.5" />
                        <Text className="text-slate-500 text-[11px] flex-1 leading-tight" numberOfLines={2}>
                          {stop.address}
                        </Text>
                      </View>

                      <View className="pt-2 border-t border-slate-100 flex-row items-center justify-between">
                        <Text className="text-slate-400 text-[10px]">
                          Slot: <Text className="text-slate-600 font-semibold">{stop.slotText}</Text>
                        </Text>
                        <View className="flex-row items-center text-purple-700">
                          <Text className="text-purple-700 font-extrabold text-[10px] mr-0.5">Manage / Reassign</Text>
                          <ChevronRight size={11} color="#7e22ce" />
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </ScrollView>

          {/* Footer */}
          <View className="p-4 bg-slate-50 border-t border-slate-200 flex-row items-center justify-between">
            <Text className="text-slate-500 text-xs">
              Tap any stop to reassign, change status, or reschedule.
            </Text>
            <TouchableOpacity
              onPress={onClose}
              className="px-4 py-2 bg-slate-900 rounded-xl active:opacity-90"
            >
              <Text className="text-white font-bold text-xs">Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
