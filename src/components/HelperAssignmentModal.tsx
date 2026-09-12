import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, ActivityIndicator, Alert } from 'react-native';
import { BellRing, CheckCircle2 } from 'lucide-react-native';
import { useOpsStaffStore } from '../store/opsStaffStore';
import { useOrderFeedStore } from '../store/orderFeedStore';
import { useOpsProcessStore } from '../store/opsProcessStore';
import { useAuthStore } from '../store/authStore';
import { getTopEligibleTask } from '../utils/helperEligibility';
import { useStoreResourcesStore } from '../store/storeResourcesStore';
import { stopAlarm, dramaticChime } from '../utils/alerts';
import { stepLabel } from '../utils/opsProcess';
import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../config/firebase';

export function HelperAssignmentModal() {
  const { staffDoc, clearActiveHelperTask } = useOpsStaffStore();
  const { processes, claim, acceptStep, isLoading: isProcessesLoading } = useOpsProcessStore();
  const { orders, isLoading: isOrdersLoading } = useOrderFeedStore();
  const authRole = useAuthStore(s => s.activeRole);
  const resources = useStoreResourcesStore(s => s.resources);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  // Determine if there's an eligible task using the active view role + store resources
  const effectiveRole = authRole || staffDoc?.role || 'helper';
  const activeTask = staffDoc ? getTopEligibleTask(processes, orders, staffDoc.uid, effectiveRole, staffDoc.activeHelperTask || null, resources) : null;

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
    // Don't do anything if we are still loading the feeds
    if (isOrdersLoading || isProcessesLoading) return;

    const { orderId } = staffDoc.activeHelperTask;
    const p = processes.find(x => x.orderId === orderId);
    const o = orders.find(x => x.id === orderId);
    
    const isCancelled = p?.status === 'cancelled' || o?.status === 'cancelled';
    const isZombie = !o; // Underlying order doesn't exist at all in the feed

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
        // This is a brand new order coming from the order feed. 
        // We must call the backend `claim` function to create the ops_process document.
        const res = await claim(activeTask.id, '');
        if (!res.ok) throw new Error(res.error || 'Failed to claim tagging task.');
        
        // Update helper's active task locally
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

      // 1. Run backend action to claim this specific step exclusively for existing processes
      const res = await acceptStep(activeTask.id);
      if (!res.ok) throw new Error(res.error || 'Failed to claim task.');

      // Update helper's active task locally to lock them in immediately
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

  return (
    <Modal visible={true} animationType="fade" transparent onRequestClose={() => {/* Helpers must accept */}}>
      <View className="flex-1 bg-black/80 justify-center p-6">
        <View className="bg-white rounded-3xl p-6 items-center shadow-2xl border-4 border-primary">
          <View className="w-20 h-20 rounded-full bg-primary/20 items-center justify-center mb-6 animate-pulse">
            <BellRing size={40} color="#994bff" />
          </View>

          <Text className="text-3xl font-black text-gray-900 mb-2 text-center">New Task Available</Text>
          <Text className="text-lg text-gray-500 font-medium mb-6 text-center">
            Order #{activeTask.orderId.slice(-6).toUpperCase()}
          </Text>

          <View className="w-full bg-primary/10 rounded-2xl p-5 mb-8 border border-primary/20 items-center">
            <Text className="text-primary font-black text-2xl uppercase tracking-widest">
              {stepLabel(curStep)}
            </Text>
          </View>

          <TouchableOpacity
            onPress={handleAccept}
            disabled={!!acceptingId}
            className="w-full h-16 bg-primary rounded-2xl items-center justify-center flex-row shadow-lg shadow-primary/30"
          >
            {acceptingId ? (
              <ActivityIndicator color="#fff" size="large" />
            ) : (
              <>
                <CheckCircle2 color="white" size={24} className="mr-3" />
                <Text className="text-white text-xl font-black tracking-wide uppercase">Accept Task</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
