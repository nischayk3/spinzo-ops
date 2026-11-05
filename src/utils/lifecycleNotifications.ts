import { useEffect, useRef } from 'react';
import { useOpsProcessStore } from '../store/opsProcessStore';
import { useOrderFeedStore } from '../store/orderFeedStore';
import { useAuthStore } from '../store/authStore';
import { useOpsStaffStore } from '../store/opsStaffStore';
import { announceStageTransition, announceNewOrder, announceWasherMilestone } from './alerts';
import * as Speech from 'expo-speech';
import { stepLabel, currentStep } from './opsProcess';
import { triggerAssignmentNotification } from './systemNotifications';
import { useWasherReminderStore } from '../store/washerReminderStore';
import { useStaffRosterStore } from '../store/staffRosterStore';

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
  const isSupervisorOrAdmin = activeRole === 'supervisor' || activeRole === 'admin' || staffDoc?.role === 'supervisor' || staffDoc?.role === 'admin';

  // 1. Announce Stage Transitions (Supervisors and admins only)
  useEffect(() => {
    if (!isSupervisorOrAdmin) return;
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
  }, [processes, isSupervisorOrAdmin]);

  // 2. Announce New Orders (Supervisors and admins only; delivery partners get alerted strictly on order assignment)
  useEffect(() => {
    if (!isSupervisorOrAdmin) return;
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
  }, [orders, isOrdersLoading, isSupervisorOrAdmin]);

  // 3. Washing Machine Chemical Alarms (13m Detergent, 21m Softener, 35m Complete) - Active Working Helper ONLY
  const rosterHelpers = useStaffRosterStore(s => s.roster.helpers);
  const isOnShift = staffDoc?.onShift === true;
  const isOnBreak = Boolean(
    staffDoc?.onBreak ||
    staffDoc?.attendanceStatus === 'lunch' ||
    staffDoc?.attendanceStatus === 'short_break'
  );

  useEffect(() => {
    // Supervisors, admins, clocked-out staff, and on-break staff must NEVER receive machine reminders
    if (isSupervisorOrAdmin || !myUid || !isOnShift || isOnBreak) {
      useWasherReminderStore.getState().dismissReminder();
      return;
    }

    const checkWasherMilestones = () => {
      const now = Date.now();
      const workingHelperIds = new Set(
        rosterHelpers
          .filter(
            h =>
              (h.role === 'helper' || h.role === 'iron') &&
              h.onShift === true &&
              !h.onBreak &&
              h.attendanceStatus !== 'lunch' &&
              h.attendanceStatus !== 'short_break' &&
              h.attendanceStatus !== 'off'
          )
          .map(h => h.uid)
      );
      workingHelperIds.add(myUid);

      processes.forEach(p => {
        const cur = currentStep(p);
        if (cur !== 'getting_washed') return;
        const stage = p.stages?.getting_washed;
        if (!stage || !stage.startedAt || stage.completedAt) return;

        // Alert the assigned helper, OR a working floor helper if the original assignee went on break / clocked out
        const isMyTask = stage.assignee === myUid;
        const isCoveringBreak =
          typeof stage.assignee === 'string' &&
          stage.assignee.length > 0 &&
          stage.assignee !== myUid &&
          !workingHelperIds.has(stage.assignee);
        if (!isMyTask && !isCoveringBreak) return;

        const startMs = typeof (stage.startedAt as any).toMillis === 'function'
          ? (stage.startedAt as any).toMillis()
          : (stage.startedAt as any).seconds
          ? (stage.startedAt as any).seconds * 1000
          : new Date(stage.startedAt as any).getTime();

        if (!startMs || isNaN(startMs)) return;
        const elapsedMinutes = (now - startMs) / (60 * 1000);

        // Milestone 1: Detergent at 13 minutes
        const detKey = `${p.id}_detergent`;
        if (elapsedMinutes >= 13 && !stage.detergentAddedAt) {
          useWasherReminderStore.getState().showReminder({
            orderId: p.orderId,
            processId: p.id,
            milestone: 'detergent',
            elapsedMinutes: Math.round(elapsedMinutes),
          });
          if (!announcedMilestones.has(detKey)) {
            announcedMilestones.add(detKey);
            announceWasherMilestone(p.orderId, 'detergent');
          }
        }

        // Milestone 2: Softener at 21 minutes
        const softKey = `${p.id}_softener`;
        if (elapsedMinutes >= 21 && !stage.softenerAddedAt) {
          useWasherReminderStore.getState().showReminder({
            orderId: p.orderId,
            processId: p.id,
            milestone: 'softener',
            elapsedMinutes: Math.round(elapsedMinutes),
          });
          if (!announcedMilestones.has(softKey)) {
            announcedMilestones.add(softKey);
            announceWasherMilestone(p.orderId, 'softener');
          }
        }

        // Milestone 3: Cycle Complete at 35 minutes
        const compKey = `${p.id}_complete`;
        if (elapsedMinutes >= 35) {
          useWasherReminderStore.getState().showReminder({
            orderId: p.orderId,
            processId: p.id,
            milestone: 'complete',
            elapsedMinutes: Math.round(elapsedMinutes),
          });
          if (!announcedMilestones.has(compKey)) {
            announcedMilestones.add(compKey);
            announceWasherMilestone(p.orderId, 'complete');
          }
        }
      });
    };

    // Check immediately on processes change and poll every 5 seconds
    checkWasherMilestones();
    const interval = setInterval(checkWasherMilestones, 5000);
    return () => clearInterval(interval);
  }, [processes, activeRole, myUid, isSupervisorOrAdmin, isOnShift, isOnBreak, rosterHelpers]);

  // 4. Helper Task Assignment Audio & Voice Announcement
  useEffect(() => {
    if (!myUid || !isOnShift) return;
    processes.forEach(p => {
      const cur = currentStep(p);
      if (!cur) return;
      const stage = p.stages?.[cur];
      const isSupervisorPush = Boolean(stage?.assignedBy && stage.assignedBy !== 'system_auto' && stage.assignedBy !== 'self_claim');
      if (isOnBreak && !isSupervisorPush) return;
      // If assigned to me and not yet accepted
      if (stage && stage.assignee === myUid && stage.assignedBy && stage.assignedBy !== 'self_claim' && !stage.acceptedAt && !stage.completedAt) {
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
