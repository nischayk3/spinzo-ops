import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { doc, updateDoc, db } from '../config/firebase';
import { useAuthStore } from '../store/authStore';
import { useOpsStaffStore } from '../store/opsStaffStore';

// 2-minute cadence: low battery, low Firestore write load (~30 writes/hour/rider)
const SYNC_INTERVAL_MS = 2 * 60 * 1000;

export function useRiderLocationSync() {
  const user = useAuthStore(state => state.user);
  const activeRole = useAuthStore(state => state.activeRole);
  const myTasks = useOpsStaffStore(state => state.myTasks);
  const myDeliveries = useOpsStaffStore(state => state.myDeliveries);

  const isSyncingRef = useRef(false);

  useEffect(() => {
    // Only run for authenticated riders on active shift
    if (!user?.id || activeRole !== 'rider') {
      return;
    }

    // Check if there are active pickups or active deliveries
    const activePickups = myTasks.filter(
      t => t.status === 'pending' || t.status === 'assigned' || t.status === 'in_transit_to_store'
    );
    const activeDeliveries = myDeliveries.filter(
      d => d.status === 'assigned' || d.status === 'out_for_delivery'
    );

    // If rider has no active tasks, do nothing (zero battery/writes)
    if (activePickups.length === 0 && activeDeliveries.length === 0) {
      return;
    }

    const broadcastLocation = async () => {
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;

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
        const now = Date.now();
        const locPayload = { latitude, longitude, updatedAt: now };

        // 1. Update active pickups (customer order doc & task doc)
        for (const task of activePickups) {
          if (task.userId && task.orderId) {
            updateDoc(doc(db, 'users', task.userId, 'orders', task.orderId), {
              riderLocation: locPayload,
            }).catch(() => {});
          }
          if (task.id) {
            updateDoc(doc(db, 'ops_tasks', task.id), {
              riderLocation: locPayload,
            }).catch(() => {});
          }
        }

        // 2. Update active deliveries (customer order doc & delivery task doc)
        for (const delivery of activeDeliveries) {
          if (delivery.userId && delivery.orderId) {
            updateDoc(doc(db, 'users', delivery.userId, 'orders', delivery.orderId), {
              riderLocation: locPayload,
            }).catch(() => {});
          }
          if (delivery.id) {
            updateDoc(doc(db, 'ops_delivery_tasks', delivery.id), {
              riderLocation: locPayload,
            }).catch(() => {});
          }
        }

        // 3. Update rider staff doc for supervisor tracking
        updateDoc(doc(db, 'ops_staff', user.id), {
          lastKnownLocation: locPayload,
        }).catch(() => {});
      } catch {
        // Silent fail: don't disrupt rider if GPS drops
      } finally {
        isSyncingRef.current = false;
      }
    };

    // Run once immediately on task assignment
    broadcastLocation();

    // Run every 2 minutes
    const intervalId = setInterval(broadcastLocation, SYNC_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [user?.id, activeRole, myTasks, myDeliveries]);
}

