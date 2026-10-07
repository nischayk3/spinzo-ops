import { useEffect, useRef } from 'react';
import { useOpsProcessStore } from '../store/opsProcessStore';
import { useOrderFeedStore } from '../store/orderFeedStore';
import { useAuthStore } from '../store/authStore';
import { useOpsStaffStore } from '../store/opsStaffStore';
import { announceStageTransition, announceNewOrder, announceWasherMilestone } from './alerts';
import * as Speech from 'expo-speech';
import { stepLabel, currentStep } from './opsProcess';
import { triggerAssignmentNotification } from './systemNotifications';

const seenStates: Record<string, number> = {};
const seenOrders = new Set<string>();
const announcedMilestones = new Set<string>();
const announcedHelperTasks = new Set<string>();

export function useLifecycleNotifications() {
  const processes = useOpsProcessStore(s => s.processes);
  const orders = useOrderFeedStore(s => s.orders);
  const isOrdersLoading = useOrderFeedStore(s => s.isLoading);
  const activeRole = useAuthStore(s => s.activeRole);
  const staffDoc = useOpsStaffStore(s => s.staffDoc);
  const myUid = staffDoc?.uid;

  // 1. Announce Stage Transitions
  useEffect(() => {
    processes.forEach(p => {
      const prevIndex = seenStates[p.orderId] ?? -1;
      
      // If order progressed to a new index and we had already seen it before (so we don't announce on first load)
      if (p.currentIndex > prevIndex) {
        if (prevIndex !== -1) {
          // Announce!
          announceStageTransition(p.orderId, stepLabel(p.status));
        }
        seenStates[p.orderId] = p.currentIndex;
      }
    });
  }, [processes]);

  // 2. Announce New Orders
  useEffect(() => {
    if (isOrdersLoading) return; // Wait until initial load is done
    
    // On the first render after loading, we just populate the Set so we don't announce all history.
    if (seenOrders.size === 0 && orders.length > 0) {
      orders.forEach(o => seenOrders.add(o.id));
      return;
    }

    // Now look for brand new orders
    orders.forEach(o => {
      if (!seenOrders.has(o.id)) {
        seenOrders.add(o.id);
        if (o.status === 'placed' || o.status === 'confirmed') {
          announceNewOrder();
        }
      }
    });
  }, [orders, isOrdersLoading]);

  // 3. Washing Machine Chemical Alarms (13m Detergent, 21m Softener, 35m Complete)
  useEffect(() => {
    const isSupervisorOrAdmin = activeRole === 'supervisor' || activeRole === 'admin';

    const checkWasherMilestones = () => {
      const now = Date.now();
      processes.forEach(p => {
        const cur = currentStep(p);
        if (cur !== 'getting_washed') return;
        const stage = p.stages?.getting_washed;
        if (!stage || !stage.startedAt || stage.completedAt) return;

        // Only alert the assigned helper or supervisors/admins
        const isMyTask = myUid && stage.assignee === myUid;
        if (!isMyTask && !isSupervisorOrAdmin) return;

        const startMs = typeof (stage.startedAt as any).toMillis === 'function'
          ? (stage.startedAt as any).toMillis()
          : (stage.startedAt as any).seconds
          ? (stage.startedAt as any).seconds * 1000
          : new Date(stage.startedAt as any).getTime();

        if (!startMs || isNaN(startMs)) return;
        const elapsedMinutes = (now - startMs) / (60 * 1000);

        // Milestone 1: Detergent at 13 minutes
        const detKey = `${p.id}_detergent`;
        if (elapsedMinutes >= 13 && !stage.detergentAddedAt && !announcedMilestones.has(detKey)) {
          announcedMilestones.add(detKey);
          announceWasherMilestone(p.orderId, 'detergent');
        }

        // Milestone 2: Softener at 21 minutes
        const softKey = `${p.id}_softener`;
        if (elapsedMinutes >= 21 && !stage.softenerAddedAt && !announcedMilestones.has(softKey)) {
          announcedMilestones.add(softKey);
          announceWasherMilestone(p.orderId, 'softener');
        }

        // Milestone 3: Cycle Complete at 35 minutes
        const compKey = `${p.id}_complete`;
        if (elapsedMinutes >= 35 && !announcedMilestones.has(compKey)) {
          announcedMilestones.add(compKey);
          announceWasherMilestone(p.orderId, 'complete');
        }
      });
    };

    // Check immediately on processes change and poll every 5 seconds
    checkWasherMilestones();
    const interval = setInterval(checkWasherMilestones, 5000);
    return () => clearInterval(interval);
  }, [processes, activeRole, myUid]);

  // 4. Helper Task Assignment Audio & Voice Announcement
  useEffect(() => {
    if (!myUid) return;
    processes.forEach(p => {
      const cur = currentStep(p);
      if (!cur) return;
      const stage = p.stages?.[cur];
      // If assigned to me by supervisor and not yet accepted
      if (stage && stage.assignee === myUid && stage.assignedBy && !stage.acceptedAt && !stage.completedAt) {
        const key = `${p.id}_${cur}_assigned`;
        if (!announcedHelperTasks.has(key)) {
          announcedHelperTasks.add(key);
          Speech.speak(`New ${stepLabel(cur)} task assigned to you`, { language: 'en-IN' });
          triggerAssignmentNotification({
            orderId: p.orderId,
            orderShortId: p.orderId.slice(-6).toUpperCase(),
            taskType: `${stepLabel(cur)} Stage`,
          });
        }
      }
    });
  }, [processes, myUid]);
}
