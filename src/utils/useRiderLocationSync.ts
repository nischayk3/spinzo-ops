import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { doc, updateDoc, db } from '../config/firebase';
import { useAuthStore } from '../store/authStore';
import { useOpsStaffStore } from '../store/opsStaffStore';
import { haversineMeters, LatLng } from './storeGeo';

// 2-minute cadence: low battery, low Firestore write load (~30 writes/hour/rider)
const SYNC_INTERVAL_MS = 2 * 60 * 1000;
// Minimum 60-second throttle guard to guarantee no rapid-fire write loops
const MIN_THROTTLE_MS = 60 * 1000;
// Minimum movement threshold (meters) before transmitting a new GPS update
const MIN_DISTANCE_METERS = 25;

export function useRiderLocationSync() {
  const user = useAuthStore(state => state.user);
  const activeRole = useAuthStore(state => state.activeRole);
  const myTasks = useOpsStaffStore(state => state.myTasks);

  const isSyncingRef = useRef(false);
  const lastSyncTimeRef = useRef(0);
  const lastCoordsRef = useRef<LatLng | null>(null);
  const myTasksRef = useRef(myTasks);
  myTasksRef.current = myTasks;

  // Stable primitive key that ONLY changes when en-route pickups are added, removed, or change status.
  const activeTasksKey = myTasks
    .filter(t => t.status === 'pending' || t.status === 'assigned')
    .map(t => `${t.id}:${t.status}`)
    .sort()
    .join(',');

  useEffect(() => {
    // Only run for authenticated riders on active shift
    if (!user?.id || activeRole !== 'rider') {
      lastCoordsRef.current = null;
      return;
    }

    // Active pickups en route to customer (for customer live map broadcast)
    const enRoutePickups = myTasksRef.current.filter(
      t => t.status === 'pending' || t.status === 'assigned'
    );

    // If rider has no active en-route pickups, do nothing (zero battery/writes)
    if (enRoutePickups.length === 0) {
      lastCoordsRef.current = null;
      return;
    }

    // New/changed en-route pickup set should receive an initial location once throttle permits
    lastCoordsRef.current = null;

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
        const newCoords: LatLng = { latitude, longitude };
        if (
          lastCoordsRef.current &&
          haversineMeters(lastCoordsRef.current, newCoords) < MIN_DISTANCE_METERS
        ) {
          return;
        }
        lastCoordsRef.current = newCoords;

        const locPayload = { latitude, longitude, updatedAt: now };

        // Update customer order docs ONLY while rider is en route for pickup
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

