import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { doc, updateDoc, db } from '../config/firebase';
import { useAuthStore } from '../store/authStore';
import { useOpsStaffStore } from '../store/opsStaffStore';

// 2-minute cadence: low battery, low Firestore write load (~30 writes/hour/rider)
const SYNC_INTERVAL_MS = 2 * 60 * 1000;
// Minimum 60-second throttle guard to guarantee no rapid-fire write loops
const MIN_THROTTLE_MS = 60 * 1000;

export function useRiderLocationSync() {
  const user = useAuthStore(state => state.user);
  const activeRole = useAuthStore(state => state.activeRole);
  const myTasks = useOpsStaffStore(state => state.myTasks);
  const myDeliveries = useOpsStaffStore(state => state.myDeliveries);

  const isSyncingRef = useRef(false);
  const lastSyncTimeRef = useRef(0);
  const myTasksRef = useRef(myTasks);
  const myDeliveriesRef = useRef(myDeliveries);
  myTasksRef.current = myTasks;
  myDeliveriesRef.current = myDeliveries;

  // Stable primitive key that ONLY changes when tasks are added, removed, or change status.
  // Never changes when riderLocation or arbitrary fields are updated on existing tasks!
  const activeTasksKey = [
    myTasks
      .filter(t => t.status === 'pending' || t.status === 'assigned' || t.status === 'in_transit_to_store')
      .map(t => `${t.id}:${t.status}`)
      .sort()
      .join(','),
    myDeliveries
      .filter(d => d.status === 'assigned' || d.status === 'out_for_delivery')
      .map(d => `${d.id}:${d.status}`)
      .sort()
      .join(','),
  ].join('|');

  useEffect(() => {
    // Only run for authenticated riders on active shift
    if (!user?.id || activeRole !== 'rider') {
      return;
    }

    // Active pickups en route to customer (for customer live map broadcast)
    const enRoutePickups = myTasksRef.current.filter(
      t => t.status === 'pending' || t.status === 'assigned'
    );
    // All active pickups including return to hub (for internal ops task tracking)
    const allActivePickups = myTasksRef.current.filter(
      t => t.status === 'pending' || t.status === 'assigned' || t.status === 'in_transit_to_store'
    );
    // Active deliveries (for internal ops delivery tracking only; customer delivery map is disabled)
    const activeDeliveries = myDeliveriesRef.current.filter(
      d => d.status === 'assigned' || d.status === 'out_for_delivery'
    );

    // If rider has no active tasks, do nothing (zero battery/writes)
    if (allActivePickups.length === 0 && activeDeliveries.length === 0) {
      return;
    }

    const broadcastLocation = async () => {
      if (isSyncingRef.current) return;
      const now = Date.now();
      // Enforce strict throttle guard so writes cannot loop
      if (now - lastSyncTimeRef.current < MIN_THROTTLE_MS && lastSyncTimeRef.current !== 0) {
        return;
      }

      isSyncingRef.current = true;
      lastSyncTimeRef.current = now;

      try {
        // Request/check permission
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') {
          return;
        }

        // Get location with 5s timeout fallback
        const position = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
        ]).then(async (pos) => {
          if (pos) return pos;
          return await Location.getLastKnownPositionAsync();
        });

        if (!position?.coords) return;

        const { latitude, longitude } = position.coords;
        const locPayload = { latitude, longitude, updatedAt: now };

        // 1. Update customer order docs ONLY while rider is en route for pickup
        const currentEnRoute = myTasksRef.current.filter(
          t => t.status === 'pending' || t.status === 'assigned'
        );
        for (const task of currentEnRoute) {
          if (task.userId && task.orderId) {
            updateDoc(doc(db, 'users', task.userId, 'orders', task.orderId), {
              riderLocation: locPayload,
            }).catch(() => {});
          }
        }

        // 2. Update ops task docs for internal supervisor / hub tracking
        const currentActivePickups = myTasksRef.current.filter(
          t => t.status === 'pending' || t.status === 'assigned' || t.status === 'in_transit_to_store'
        );
        for (const task of currentActivePickups) {
          if (task.id) {
            updateDoc(doc(db, 'ops_tasks', task.id), {
              riderLocation: locPayload,
            }).catch(() => {});
          }
        }

        // 3. Update ops delivery task docs (internal ops only; customer delivery map is disabled)
        const currentActiveDeliveries = myDeliveriesRef.current.filter(
          d => d.status === 'assigned' || d.status === 'out_for_delivery'
        );
        for (const delivery of currentActiveDeliveries) {
          if (delivery.id) {
            updateDoc(doc(db, 'ops_delivery_tasks', delivery.id), {
              riderLocation: locPayload,
            }).catch(() => {});
          }
        }

        // 4. Update rider staff doc for supervisor tracking
        updateDoc(doc(db, 'ops_staff', user.id), {
          lastKnownLocation: locPayload,
        }).catch(() => {});
      } catch {
        // Silent fail: don't disrupt rider if GPS drops
      } finally {
        isSyncingRef.current = false;
      }
    };

    // Run once immediately on task assignment (if throttle permits)
    broadcastLocation();

    // Run every 2 minutes
    const intervalId = setInterval(broadcastLocation, SYNC_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [user?.id, activeRole, activeTasksKey]);
}

