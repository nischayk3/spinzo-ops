import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, ActivityIndicator, Alert } from 'react-native';
import { BellRing, CheckCircle2, MapPin, Package, Hash, User, Layers } from 'lucide-react-native';
import { useOpsStaffStore } from '../store/opsStaffStore';
import { useOrderFeedStore } from '../store/orderFeedStore';
import { useOpsProcessStore } from '../store/opsProcessStore';
import { useAuthStore } from '../store/authStore';
import { getTopEligibleTask } from '../utils/helperEligibility';
import { useStoreResourcesStore } from '../store/storeResourcesStore';
import { stopAlarm, dramaticChime } from '../utils/alerts';
import { stepLabel } from '../utils/opsProcess';
import { serviceSummary, orderTotal } from '../utils/orderFeed';
import { doc, runTransaction } from '../config/firebase';
import { db } from '../config/firebase';

export function HelperAssignmentModal() {
  const { staffDoc, clearActiveHelperTask } = useOpsStaffStore();
  const { processes, claim, acceptStep, isLoading: isProcessesLoading } = useOpsProcessStore();
  const { orders, isLoading: isOrdersLoading } = useOrderFeedStore();
  const authRole = useAuthStore(s => s.activeRole);
  const resources = useStoreResourcesStore(s => s.resources);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const effectiveRole = authRole || staffDoc?.role || 'helper';
  const activeTask = staffDoc ? getTopEligibleTask(processes, orders, staffDoc.uid, effectiveRole, staffDoc.activeHelperTask || null, resources, staffDoc.onShift === true) : null;
  const order = activeTask ? orders.find(o => o.id === activeTask.orderId) : undefined;

  useEffect(() => {
    if (activeTask && !acceptingId) {
      dramaticChime();
    } else {
      stopAlarm();
    }
    return () => {
      stopAlarm();
    };
  }, [activeTask?.id]);

  // Auto-clear active task if the order was cancelled or completely deleted by someone else
  useEffect(() => {
    if (!staffDoc?.activeHelperTask) return;
    if (isOrdersLoading || isProcessesLoading) return;

    const { orderId } = staffDoc.activeHelperTask;
    const p = processes.find(x => x.orderId === orderId);
    const o = orders.find(x => x.id === orderId);

    const isCancelled = p?.status === 'cancelled' || o?.status === 'cancelled';
    const isZombie = !o;

    if (isCancelled || isZombie) {
      clearActiveHelperTask();
    }
  }, [staffDoc?.activeHelperTask, processes, orders, isOrdersLoading, isProcessesLoading, clearActiveHelperTask]);

  const handleAccept = async () => {
    if (!activeTask || !staffDoc) return;
    setAcceptingId(activeTask.id);
    stopAlarm();

    try {
      const curStep = activeTask.steps[activeTask.currentIndex] || activeTask.status;

      if (curStep === 'tagging' && Object.keys(activeTask.stages || {}).length === 0) {
        const res = await claim(activeTask.id, '');
        if (!res.ok) throw new Error(res.error || 'Failed to claim tagging task.');

        const staffRef = doc(db, 'ops_staff', staffDoc.uid);
        await runTransaction(db, async (tx) => {
          tx.update(staffRef, {
            activeHelperTask: {
              orderId: activeTask.id,
              step: 'tagging'
            }
          });
        });
        return;
      }

      const res = await acceptStep(activeTask.id);
      if (!res.ok) throw new Error(res.error || 'Failed to claim task.');

      const staffRef = doc(db, 'ops_staff', staffDoc.uid);
      await runTransaction(db, async (tx) => {
        tx.update(staffRef, {
          activeHelperTask: {
            orderId: activeTask.id,
            step: curStep
          }
        });
      });

    } catch (err: any) {
      console.warn("Failed to claim task:", err);
      Alert.alert('Task Unavailable', err?.message || 'Someone else might have claimed it.');
    } finally {
      setAcceptingId(null);
    }
  };

  if (!activeTask) return null;

  const curStep = activeTask.steps[activeTask.currentIndex] || activeTask.status;
  const token = activeTask.tokenNumber || order?.tokenNumber;
  const orderShort = (activeTask.orderId || '').slice(-6).toUpperCase();
  const items = order?.items || [];
  const qty = items.reduce((sum, i: any) => sum + (i.quantity || 0), 0);
  const serviceLabel = activeTask.serviceLabel || (order ? serviceSummary(order) : '');

  return (
    <Modal visible={true} animationType="fade" transparent onRequestClose={() => {/* Helpers must accept */}}>
      <View className="flex-1 bg-black/80 justify-center p-5">
        <View className="bg-bgSurface rounded-3xl border border-bgSurfaceLight shadow-lg max-h-[88%]">
          {/* Header */}
          <View className="items-center pt-7 px-5 pb-4 border-b border-bgSurfaceLight">
            <View className="w-16 h-16 rounded-full bg-primary/15 items-center justify-center mb-4">
              <BellRing size={30} color="#994BFF" />
            </View>
            <Text className="text-2xl font-black text-textPrimary text-center">New Task Available</Text>
            <View className="mt-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
              <Text className="text-primary font-black uppercase tracking-widest text-sm">{stepLabel(curStep)}</Text>
            </View>
          </View>

          {/* Order identity — order number + token (truck #) so two helpers never mix up orders */}
          <View className="px-5 py-4">
            {token ? (
              <View className="flex-row items-center justify-between bg-primary/10 border border-primary/20 rounded-2xl p-4 mb-4">
                <View className="flex-row items-center">
                  <Hash size={20} color="#994BFF" className="mr-2" />
                  <Text className="text-textSecondary text-sm font-semibold">Token / Bundle</Text>
                </View>
                <Text className="text-primary font-black text-3xl">#{token}</Text>
              </View>
            ) : null}

            <View className="flex-row items-start mb-3">
              <View className="w-9 h-9 rounded-full bg-bgSurfaceLight items-center justify-center mr-3">
                <Package size={16} color="#3B82F6" />
              </View>
              <View className="flex-1">
                <Text className="text-textMuted text-xs font-bold uppercase tracking-wide">Order</Text>
                <Text className="text-textPrimary font-bold text-lg">#{orderShort}</Text>
              </View>
            </View>

            {order?.customerName ? (
              <View className="flex-row items-start mb-3">
                <View className="w-9 h-9 rounded-full bg-bgSurfaceLight items-center justify-center mr-3">
                  <User size={16} color="#10b981" />
                </View>
                <View className="flex-1">
                  <Text className="text-textMuted text-xs font-bold uppercase tracking-wide">Customer</Text>
                  <Text className="text-textPrimary font-bold text-base">{order.customerName}</Text>
                </View>
              </View>
            ) : null}

            {serviceLabel || qty > 0 ? (
              <View className="flex-row items-start mb-3">
                <View className="w-9 h-9 rounded-full bg-bgSurfaceLight items-center justify-center mr-3">
                  <Layers size={16} color="#f59e0b" />
                </View>
                <View className="flex-1">
                  <Text className="text-textMuted text-xs font-bold uppercase tracking-wide">Service</Text>
                  <Text className="text-textPrimary font-medium text-base">{serviceLabel || '—'}{qty > 0 ? ` · ${qty} units` : ''}</Text>
                </View>
              </View>
            ) : null}

            {order?.totalAmount ? (
              <View className="flex-row items-start">
                <View className="w-9 h-9 rounded-full bg-bgSurfaceLight items-center justify-center mr-3">
                  <Text className="text-textMuted text-xs font-bold">₹</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-textMuted text-xs font-bold uppercase tracking-wide">Order Value</Text>
                  <Text className="text-textPrimary font-bold text-base">₹{orderTotal(order)}</Text>
                </View>
              </View>
            ) : null}
          </View>

          {/* Accept — kept inside the scrollable card so the button never goes out of view */}
          <View className="px-5 pb-6 pt-2">
            <TouchableOpacity
              onPress={handleAccept}
              disabled={!!acceptingId}
              className="w-full h-16 bg-primary rounded-2xl items-center justify-center flex-row"
            >
              {acceptingId ? (
                <ActivityIndicator color="#fff" size="large" />
              ) : (
                <>
                  <CheckCircle2 color="white" size={24} className="mr-3" />
                  <Text className="text-white text-lg font-black tracking-wide uppercase">Accept Task</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
