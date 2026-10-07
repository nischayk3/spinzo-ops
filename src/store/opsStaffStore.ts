import { create } from 'zustand';
import { Platform } from 'react-native';
import { db } from '../config/firebase';
import { doc, onSnapshot, query, collection, where, setDoc, getDoc, updateDoc, deleteField } from '../config/firebase';
import { parseOpsTask, shouldAnnounce, OpsTask } from '../utils/opsTasks';
import { primeAlerts, announceAssignedPickup, announceAssignedDelivery, stopAlarm } from '../utils/alerts';
import * as Notifications from 'expo-notifications';
import { SpinzoOverlay } from 'spinzo-overlay';

// Persist announced task ids so a page reload doesn't re-announce the same pickup.
const ANNOUNCED_KEY = 'opsAnnouncedTasks';
const isWeb = Platform.OS === 'web';
function loadAnnounced(): Set<string> {
  if (!isWeb) return new Set();
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(ANNOUNCED_KEY) : null;
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}
function saveAnnounced(ids: Set<string>) {
  if (!isWeb) return;
  try {
    window.localStorage.setItem(ANNOUNCED_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // best-effort
  }
}

export interface StaffDoc {
  uid: string;
  role: string;
  phone: string;
  name?: string;
  onShift?: boolean;
  shiftStartAt?: unknown;
  storeId?: string;
  storeName?: string;
  geoVerifiedAt?: unknown;
  verifiedAt?: unknown;
  activeHelperTask?: {
    orderId: string;
    step: string;
  } | null;
  fcmToken?: string | null;
}

export interface StoreInfo {
  storeId: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  enforceGeofence: boolean;
}

export interface DeliveryTask {
  id: string;
  orderId: string;
  userId: string;
  vendorId: string;
  status: string;
  assignee: string | null;
  deliveryAddress: string;
  deliveryDate: string | null;
  deliveryTime: string | null;
  deliveryOTP: string | null;
  customerName: string;
  customerPhone: string;
  bundleCount?: number;
  bundleLabels?: { seq: number; qr: string }[];
  tokenNumber?: string | null;
  tokens?: Record<string, string> | null;
  items?: any[];
  totalAmount?: number;
  createdAt?: unknown;
  assignedAt?: unknown;
  acceptedAt?: unknown;
  pickedUpAt?: unknown;
  deliveredAt?: unknown;
  proofUrl?: string | null;
}

interface OpsStaffState {
  staffDoc: StaffDoc | null;
  myTasks: OpsTask[];
  myDeliveries: DeliveryTask[];
  isLoading: boolean;
  error: string | null;
  initialize: (uid: string) => void;
  goOnShift: (uid: string, role: string, phone: string, name?: string, extra?: Record<string, unknown>) => Promise<void>;
  goOffShift: (uid: string) => Promise<void>;
  fetchStore: (storeId: string) => Promise<StoreInfo | null>;
  clearActiveHelperTask: () => Promise<void>;
  reset: () => void;
}

let unsubStaff: (() => void) | null = null;
let unsubTasks: (() => void) | null = null;
let unsubDeliveries: (() => void) | null = null;
// Tracks ids we've already alerted on so a refresh/re-subscribe doesn't re-announce.
const announcedTaskIds = loadAnnounced();

export async function syncFCMToken(uid: string): Promise<string | null> {
  if (!uid) return null;
  try {
    let token: string | null = null;
    if (Platform.OS === 'android') {
      try {
        token = await SpinzoOverlay.getFCMToken();
      } catch (e) {
        console.warn('[opsStaff] Native getFCMToken error:', e);
      }
    }
    if (!token && Platform.OS !== 'web') {
      try {
        const tokenRes = await Notifications.getDevicePushTokenAsync();
        token = tokenRes?.data || null;
      } catch (e) {
        console.warn('[opsStaff] Expo push token error:', e);
      }
    }

    if (token) {
      console.log(`[opsStaff] Successfully synced FCM token for ${uid}`);
      await setDoc(
        doc(db, 'ops_staff', uid),
        { fcmToken: token },
        { merge: true }
      );
      return token;
    }
  } catch (err) {
    console.warn('[opsStaff] syncFCMToken failed non-fatally:', err);
  }
  return null;
}

export const useOpsStaffStore = create<OpsStaffState>((set, get) => ({
  staffDoc: null,
  myTasks: [],
  myDeliveries: [],
  isLoading: false,
  error: null,

  initialize: (uid) => {
    unsubStaff?.();
    unsubTasks?.();
    unsubDeliveries?.();

    set({ isLoading: true });
    syncFCMToken(uid);

    unsubStaff = onSnapshot(
      doc(db, 'ops_staff', uid),
      (snap) => {
        if (!snap.exists()) {
          set({ staffDoc: null, isLoading: false });
          return;
        }
        const d = snap.data() as StaffDoc;
        set({ staffDoc: { ...d, uid }, isLoading: false });
        if (Platform.OS === 'android') {
          SpinzoOverlay.setOnShift(d.onShift === true);
        }
        if (!d.fcmToken) {
          syncFCMToken(uid);
        }
      },
      (err) => set({ error: String(err), isLoading: false })
    );

    let isInitialTasks = true;
    unsubTasks = onSnapshot(
      query(collection(db, 'ops_tasks'), where('assignee', '==', uid)),
      (snap) => {
        const tasks: OpsTask[] = [];
        snap.forEach((docSnap) => {
          const t = parseOpsTask(docSnap.id, docSnap.data());
          tasks.push(t);
          if (!isInitialTasks && shouldAnnounce(t, announcedTaskIds) && docSnap.id) {
            announcedTaskIds.add(docSnap.id);
            saveAnnounced(announcedTaskIds);
            announceAssignedPickup(t);
          } else if (docSnap.id) {
            announcedTaskIds.add(docSnap.id);
          }
        });
        isInitialTasks = false;
        set({ myTasks: tasks });
      },
      (err) => set({ error: String(err), isLoading: false })
    );

    // Listen for delivery tasks assigned to this rider
    let isInitialDeliveries = true;
    unsubDeliveries = onSnapshot(
      query(collection(db, 'ops_delivery_tasks'), where('assignee', '==', uid)),
      (snap) => {
        const deliveries: DeliveryTask[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          const task = {
            id: docSnap.id,
            orderId: d.orderId || docSnap.id,
            userId: d.userId || '',
            vendorId: d.vendorId || 'vendor_1',
            status: d.status || 'pending',
            assignee: d.assignee || null,
            deliveryAddress: d.deliveryAddress || '',
            deliveryDate: d.deliveryDate || null,
            deliveryTime: d.deliveryTime || null,
            deliveryOTP: d.deliveryOTP || null,
            customerName: d.customerName || d.userName || '',
            customerPhone: d.customerPhone || d.userPhone || '',
            bundleCount: d.bundleCount,
            bundleLabels: d.bundleLabels || [],
            tokenNumber: d.tokenNumber || null,
            tokens: d.tokens || null,
            items: d.items,
            totalAmount: d.totalAmount,
            assignedAt: d.assignedAt,
            acceptedAt: d.acceptedAt,
            createdAt: d.createdAt,
            pickedUpAt: d.pickedUpAt,
            deliveredAt: d.deliveredAt,
            proofUrl: d.proofUrl || null,
          };
          deliveries.push(task);
          if (!isInitialDeliveries && shouldAnnounce(task, announcedTaskIds) && docSnap.id) {
            announcedTaskIds.add(docSnap.id);
            saveAnnounced(announcedTaskIds);
            announceAssignedDelivery(task.orderId, task.deliveryAddress);
          } else if (docSnap.id) {
            announcedTaskIds.add(docSnap.id);
          }
        });
        isInitialDeliveries = false;
        set({ myDeliveries: deliveries });
      },
      (err) => console.error('[opsStaff] delivery tasks error:', err)
    );
  },

  goOnShift: async (uid, role, phone, name, extra) => {
    primeAlerts();
    if (Platform.OS === 'android') {
      SpinzoOverlay.setOnShift(true);
    }

    let fcmToken: string | null = null;
    try {
      fcmToken = await syncFCMToken(uid);
    } catch (e) {
      console.warn('[opsStaff] FCM token retrieval notice:', e);
    }

    try {
      await setDoc(
        doc(db, 'ops_staff', uid),
        {
          uid,
          role,
          phone,
          name: name || '',
          onShift: true,
          shiftStartAt: new Date(),
          ...(fcmToken ? { fcmToken } : {}),
          ...(extra || {}),
        },
        { merge: true }
      );
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  fetchStore: async (storeId) => {
    try {
      // config/opsStores is a single config doc with a `stores` map, matching the
      // existing config/adminPhones pattern (see firestore.rules).
      const snap = await getDoc(doc(db, 'config', 'opsStores'));
      if (!snap.exists()) return null;
      const stores = (snap.data() as any).stores || {};
      const s = stores[storeId];
      if (!s) return null;
      return {
        storeId,
        name: s.name || storeId,
        lat: s.lat,
        lng: s.lng,
        radiusMeters: s.radiusMeters || 150,
        enforceGeofence: s.enforceGeofence === true,
      };
    } catch (err) {
      console.error('[opsStaff] fetchStore error:', err);
      return null;
    }
  },

  clearActiveHelperTask: async () => {
    const uid = get().staffDoc?.uid;
    if (!uid) return;
    try {
      await updateDoc(doc(db, 'ops_staff', uid), {
        activeHelperTask: deleteField(),
      });
    } catch (e) {
      console.warn("Failed to clear active task", e);
    }
  },

  goOffShift: async (uid) => {
    if (Platform.OS === 'android') {
      SpinzoOverlay.setOnShift(false);
      SpinzoOverlay.dismissOverlay();
    }
    try {
      await setDoc(doc(db, 'ops_staff', uid), { onShift: false, shiftEndAt: new Date() }, { merge: true });
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  reset: () => {
    if (Platform.OS === 'android') {
      SpinzoOverlay.setOnShift(false);
      SpinzoOverlay.dismissOverlay();
    }
    unsubStaff?.();
    unsubTasks?.();
    unsubDeliveries?.();
    unsubStaff = null;
    unsubTasks = null;
    unsubDeliveries = null;
    announcedTaskIds.clear();
    stopAlarm();
    set({ staffDoc: null, myTasks: [], myDeliveries: [], isLoading: false, error: null });
  },
}));
