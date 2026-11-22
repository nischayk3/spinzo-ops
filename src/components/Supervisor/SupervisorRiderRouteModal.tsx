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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/60 justify-center items-center p-4">
        <View className="bg-bgSurface border border-white/10 max-w-lg w-[92%] max-h-[82%] rounded-3xl flex-col overflow-hidden shadow-2xl">
          {/* Header */}
          <View className="px-4 py-3.5 border-b border-white/10 flex-row items-center justify-between">
            <View className="flex-row items-center gap-3 flex-1 pr-2">
              <View className="w-10 h-10 rounded-full bg-info/15 border border-info/30 items-center justify-center">
                <Truck size={18} color="#60A5FA" />
              </View>
              <View className="flex-1">
                <View className="flex-row items-center gap-2 flex-wrap">
                  <Text className="text-textPrimary font-extrabold text-base" numberOfLines={1}>
                    {rider.name || 'Rider'}
                  </Text>
                  <View className="bg-info/15 border border-info/30 px-2 py-0.5 rounded-full">
                    <Text className="text-info font-bold text-[10px]">
                      {stops.length} Active {stops.length === 1 ? 'Stop' : 'Stops'}
                    </Text>
                  </View>
                </View>
                {rider.phone ? (
                  <Text className="text-textMuted text-xs font-medium mt-0.5">{rider.phone}</Text>
                ) : null}
              </View>
            </View>

            <TouchableOpacity
              onPress={onClose}
              className="w-8 h-8 rounded-full bg-bgSurfaceLight items-center justify-center active:opacity-70"
              accessibilityLabel="Close rider route modal"
            >
              <X size={16} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* Quick Metrics Bar */}
          <View className="flex-row items-center justify-around bg-bgSurfaceLight border-b border-white/10 py-2.5 px-3">
            <View className="items-center">
              <Text className="text-textMuted font-bold text-[9px] uppercase tracking-wider">Pickups</Text>
              <Text className="text-textPrimary font-extrabold text-sm mt-0.5">{activePickups}</Text>
            </View>
            <View className="h-6 w-px bg-white/10" />
            <View className="items-center">
              <Text className="text-textMuted font-bold text-[9px] uppercase tracking-wider">Deliveries</Text>
              <Text className="text-textPrimary font-extrabold text-sm mt-0.5">{activeDeliveries}</Text>
            </View>
            <View className="h-6 w-px bg-white/10" />
            <View className="items-center">
              <Text className="text-textMuted font-bold text-[9px] uppercase tracking-wider">Bag Load</Text>
              <Text className={`font-extrabold text-sm mt-0.5 ${totalLoadUnits >= 3 ? 'text-warning' : 'text-emerald-400'}`}>
                {totalLoadUnits}/3 {totalLoadUnits >= 3 ? '(Full)' : '(Open)'}
              </Text>
            </View>
          </View>

          {/* Stops List */}
          <ScrollView contentContainerStyle={{ padding: 14 }} className="flex-grow-0">
            <View className="flex-row items-center justify-between mb-2.5">
              <Text className="text-textPrimary font-extrabold text-xs uppercase tracking-wider">
                Live Smart Route ({stops.length})
              </Text>
              <Text className="text-textMuted text-[10px] font-medium">By SLA & Locality</Text>
            </View>

            {loading ? (
              <View className="py-10 items-center justify-center">
                <ActivityIndicator size="small" color="#994BFF" />
                <Text className="text-textMuted text-xs font-medium mt-2">Loading rider tasks...</Text>
              </View>
            ) : stops.length === 0 ? (
              <View className="py-10 px-4 items-center justify-center bg-bgSurfaceLight rounded-2xl border border-white/10">
                <Truck size={28} color="#94A3B8" />
                <Text className="text-textPrimary font-bold text-sm mt-2.5">No active orders assigned</Text>
                <Text className="text-textMuted text-xs text-center mt-1">
                  Assign pickups or deliveries to {rider.name || 'this rider'} from the inbound queue or order details.
                </Text>
              </View>
            ) : (
              <View className="gap-2.5">
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
                      className="bg-bgSurfaceLight p-3 rounded-xl border border-white/10 active:opacity-80"
                    >
                      <View className="flex-row items-center justify-between gap-2 mb-1.5">
                        <View className="flex-row items-center flex-wrap gap-1.5 flex-1">
                          <View className="w-5 h-5 rounded-full bg-bgDark border border-white/15 items-center justify-center">
                            <Text className="text-textPrimary text-[10px] font-black">{stop.stopNumber}</Text>
                          </View>

                          <View
                            className={`px-2 py-0.5 rounded-md border flex-row items-center ${
                              isStore
                                ? 'bg-warning/15 border-warning/30'
                                : isPickup
                                ? 'bg-info/15 border-info/30'
                                : 'bg-primary/15 border-primary/30'
                            }`}
                          >
                            {isPickup ? (
                              <Bike size={10} color="#60A5FA" className="mr-1" />
                            ) : (
                              <Package size={10} color="#C084FC" className="mr-1" />
                            )}
                            <Text
                              className={`font-extrabold text-[9px] uppercase ${
                                isStore ? 'text-warning' : isPickup ? 'text-info' : 'text-primary'
                              }`}
                            >
                              {stop.type.replace(/_/g, ' ')}
                            </Text>
                          </View>

                          {stop.isExpress && (
                            <View className="bg-orange-600 px-1.5 py-0.5 rounded flex-row items-center">
                              <Zap size={8} color="#ffffff" className="mr-0.5" />
                              <Text className="text-white font-extrabold text-[8px]">EXPRESS</Text>
                            </View>
                          )}

                          {stop.isInstant && (
                            <View className="bg-warning/15 border border-warning/30 px-1.5 py-0.5 rounded flex-row items-center">
                              <Zap size={8} color="#F59E0B" className="mr-0.5" />
                              <Text className="text-warning font-extrabold text-[8px]">INSTANT</Text>
                            </View>
                          )}

                          {stop.locality ? (
                            <View className="bg-bgSurface px-1.5 py-0.5 rounded border border-white/10">
                              <Text className="text-textSecondary font-semibold text-[9px]">{stop.locality}</Text>
                            </View>
                          ) : null}

                          {stop.loadUnits > 1 && (
                            <View className="bg-primary/15 border border-primary/30 px-1.5 py-0.5 rounded">
                              <Text className="text-primary font-bold text-[9px]">Bulky (2)</Text>
                            </View>
                          )}
                        </View>

                        <Text className="text-textPrimary font-extrabold text-xs shrink-0">
                          #{safeShortId(stop.orderId)}
                        </Text>
                      </View>

                      <View className="flex-row items-center justify-between mb-1">
                        <Text className="text-textPrimary font-bold text-xs flex-1 mr-2" numberOfLines={1}>
                          {stop.customerName || (isStore ? 'SpinZo BTM Store' : 'Customer')}
                        </Text>
                        {stop.totalAmount ? (
                          <Text className="text-textPrimary font-extrabold text-xs">₹{stop.totalAmount}</Text>
                        ) : null}
                      </View>

                      <View className="flex-row items-start gap-1 mb-2">
                        <MapPin size={11} color="#94A3B8" className="mt-0.5" />
                        <Text className="text-textSecondary text-[11px] flex-1 leading-4" numberOfLines={2}>
                          {stop.address}
                        </Text>
                      </View>

                      <View className="pt-2 border-t border-white/10 flex-row items-center justify-between">
                        <Text className="text-textMuted text-[10px]" numberOfLines={1}>
                          Slot: <Text className="text-textSecondary font-semibold">{stop.slotText}</Text>
                        </Text>
                        <View className="flex-row items-center">
                          <Text className="text-primary font-bold text-[11px] mr-0.5">Open Order</Text>
                          <ChevronRight size={12} color="#994BFF" />
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </ScrollView>

          {/* Footer */}
          <View className="px-4 py-3 border-t border-white/10 flex-row items-center justify-between">
            <Text className="text-textMuted text-[11px] flex-1 mr-2" numberOfLines={1}>
              Tap any stop to manage or reassign.
            </Text>
            <TouchableOpacity
              onPress={onClose}
              className="px-4 py-2 bg-bgSurfaceLight border border-white/10 rounded-xl active:opacity-80"
            >
              <Text className="text-textPrimary font-bold text-xs">Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
