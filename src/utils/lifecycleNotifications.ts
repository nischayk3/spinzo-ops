import { useEffect } from 'react';
import { useOpsProcessStore } from '../store/opsProcessStore';
import { useOrderFeedStore } from '../store/orderFeedStore';
import { announceStageTransition, announceNewOrder } from './alerts';
import { stepLabel } from './opsProcess';

const seenStates: Record<string, number> = {};
const seenOrders = new Set<string>();

export function useLifecycleNotifications() {
  const processes = useOpsProcessStore(s => s.processes);
  const orders = useOrderFeedStore(s => s.orders);
  const isOrdersLoading = useOrderFeedStore(s => s.isLoading);

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
}
