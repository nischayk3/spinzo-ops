import { create } from 'zustand';
import { Platform } from 'react-native';
import { db } from '../config/firebase';
import { doc, onSnapshot, query, collection, where, setDoc, getDoc } from 'firebase/firestore';
import { parseOpsTask, shouldAnnounce, OpsTask } from '../utils/opsTasks';
import { primeAlerts, announceAssignedPickup } from '../utils/alerts';

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
  assignedAt?: unknown;
  acceptedAt?: unknown;
  createdAt?: unknown;
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
  reset: () => void;
}

let unsubStaff: (() => void) | null = null;
let unsubTasks: (() => void) | null = null;
let unsubDeliveries: (() => void) | null = null;
// Tracks ids we've already alerted on so a refresh/re-subscribe doesn't re-announce.
const announcedTaskIds = loadAnnounced();

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

    unsubStaff = onSnapshot(
      doc(db, 'ops_staff', uid),
      (snap) => {
        if (!snap.exists()) {
          set({ staffDoc: null, isLoading: false });
          return;
        }
        const d = snap.data() as StaffDoc;
        set({ staffDoc: { ...d, uid }, isLoading: false });
      },
      (err) => set({ error: String(err), isLoading: false })
    );

    unsubTasks = onSnapshot(
      query(collection(db, 'ops_tasks'), where('assignee', '==', uid)),
      (snap) => {
        const tasks: OpsTask[] = [];
        snap.forEach((docSnap) => {
          const t = parseOpsTask(docSnap.id, docSnap.data());
          tasks.push(t);
          if (shouldAnnounce(t, announcedTaskIds) && docSnap.id) {
            announcedTaskIds.add(docSnap.id);
            saveAnnounced(announcedTaskIds);
            announceAssignedPickup(t);
          }
        });
        set({ myTasks: tasks });
      },
      (err) => set({ error: String(err), isLoading: false })
    );

    // Listen for delivery tasks assigned to this rider
    unsubDeliveries = onSnapshot(
      query(collection(db, 'ops_delivery_tasks'), where('assignee', '==', uid)),
      (snap) => {
        const deliveries: DeliveryTask[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          deliveries.push({
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
            customerName: d.customerName || '',
            customerPhone: d.customerPhone || '',
            assignedAt: d.assignedAt,
            acceptedAt: d.acceptedAt,
            createdAt: d.createdAt,
          });
        });
        set({ myDeliveries: deliveries });
      },
      (err) => console.error('[opsStaff] delivery tasks error:', err)
    );
  },

  goOnShift: async (uid, role, phone, name, extra) => {
    primeAlerts();
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
      console.error('[opsStaff] fetchStore failed:', err);
      return null;
    }
  },

  goOffShift: async (uid) => {
    try {
      await setDoc(doc(db, 'ops_staff', uid), { onShift: false, shiftEndAt: new Date() }, { merge: true });
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  reset: () => {
    unsubStaff?.();
    unsubTasks?.();
    unsubDeliveries?.();
    unsubStaff = null;
    unsubTasks = null;
    unsubDeliveries = null;
    set({ staffDoc: null, myTasks: [], myDeliveries: [], isLoading: false, error: null });
  },
}));
