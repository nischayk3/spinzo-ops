import { create } from 'zustand';
import { Platform } from 'react-native';
import { db } from '../config/firebase';
import { doc, onSnapshot, query, collection, where, setDoc, getDoc, updateDoc, deleteField } from '../config/firebase';
import { parseOpsTask, shouldAnnounce, taskAlertKey, isPending, OpsTask } from '../utils/opsTasks';
import { resolveCustomerCoordinates } from '../utils/storeGeo';
import { primeAlerts, announceAssignedPickup, announceAssignedDelivery, stopAlarm } from '../utils/alerts';
import { cancelAllStageNudgeTimers } from '../utils/systemNotifications';
import { useWasherReminderStore } from './washerReminderStore';
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
  onBreak?: boolean;
  attendanceStatus?: 'working' | 'lunch' | 'short_break' | 'off';
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
  assignedBy?: string | null;
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
  billDetails?: Record<string, any>;
  paymentStatus?: string | null;
  paymentMode?: string | null;
  latitude?: number;
  longitude?: number;
  notes?: string;
  pickupNote?: string;
  isUrgent?: boolean;
  orderStatus?: string;
  createdAt?: unknown;
  assignedAt?: unknown;
  acceptedAt?: unknown;
  pickedUpAt?: unknown;
  deliveredAt?: unknown;
  proofUrl?: string | null;
  isExpress?: boolean;
}

interface OpsStaffState {
  staffDoc: StaffDoc | null;
  myTasks: OpsTask[];
  myDeliveries: DeliveryTask[];
  isLoading: boolean;
  error: string | null;
  initialize: (uid: string) => void;
  goOnShift: (uid: string, role: string, phone: string, name?: string, extra?: Record<string, unknown>) => Promise<void>;
  setBreakState: (uid: string, status: 'working' | 'lunch' | 'short_break') => Promise<void>;
  goOffShift: (uid: string) => Promise<void>;
  fetchStore: (storeId: string) => Promise<StoreInfo | null>;
  clearActiveHelperTask: () => Promise<void>;
  reset: () => void;
}

let unsubStaff: (() => void) | null = null;
let unsubTasks: (() => void) | null = null;
let unsubDeliveries: (() => void) | null = null;
let activeInitializedUid: string | null = null;
let rawTasks: OpsTask[] = [];
let rawDeliveries: DeliveryTask[] = [];
const activeOrderUnsubs = new Map<string, () => void>();
const activeOrderData = new Map<string, Record<string, any>>();
const activeOrderSig = new Map<string, string>();
const activeUserProfiles = new Map<string, Record<string, any>>();
const pendingUserLookups = new Set<string>();
// Tracks ids we've already alerted on so a refresh/re-subscribe doesn't re-announce.
const announcedTaskIds = loadAnnounced();

function clearActiveOrderListeners(clearRaw = true) {
  activeOrderUnsubs.forEach((unsub) => {
    try { unsub(); } catch { /* ignore */ }
  });
  activeOrderUnsubs.clear();
  activeOrderData.clear();
  activeOrderSig.clear();
  activeUserProfiles.clear();
  pendingUserLookups.clear();
  if (clearRaw) {
    rawTasks = [];
    rawDeliveries = [];
  }
}

function resolveAddressText(addr: any): string | undefined {
  if (!addr) return undefined;
  if (typeof addr === 'string') return addr;
  return addr.formattedAddress || addr.address || addr.fullAddress || addr.line1 || undefined;
}

function firstNonEmptyString(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === 'string') {
      const trimmed = c.trim();
      if (trimmed.length > 0 && trimmed.toLowerCase() !== 'customer' && trimmed.toLowerCase() !== 'unknown') {
        return trimmed;
      }
    }
  }
  return undefined;
}

function resolveName(task: any, ord: any, userDoc: any): string | undefined {
  return firstNonEmptyString(
    task?.customerName,
    task?.userName,
    ord?.customerName,
    ord?.userName,
    ord?.name,
    ord?.address?.name,
    ord?.address?.recipientName,
    userDoc?.name,
    userDoc?.displayName,
    userDoc?.fullName
  );
}

function resolvePhone(task: any, ord: any, userDoc: any): string | undefined {
  return firstNonEmptyString(
    task?.customerPhone,
    task?.userPhone,
    ord?.customerPhone,
    ord?.userPhone,
    ord?.phone,
    ord?.phoneNumber,
    ord?.address?.phone,
    ord?.address?.mobile,
    userDoc?.phone,
    userDoc?.phoneNumber,
    userDoc?.mobile
  );
}

function resolveCanonicalTotal(ord: any, task: any): number | undefined {
  if (typeof ord?.billDetails?.total === 'number') return ord.billDetails.total;
  if (typeof ord?.totalAmount === 'number') return ord.totalAmount;
  if (typeof ord?.cartTotal === 'number') return ord.cartTotal;
  if (typeof task?.billDetails?.total === 'number') return task.billDetails.total;
  if (typeof task?.totalAmount === 'number') return task.totalAmount;
  return undefined;
}

function mergeTasksWithOrders(): { myTasks: OpsTask[]; myDeliveries: DeliveryTask[] } {
  const mergedTasks = rawTasks.map((t) => {
    const ord = activeOrderData.get(t.orderId || t.id);
    const userDoc = t.userId ? activeUserProfiles.get(t.userId) : undefined;
    if (!ord && !userDoc) return t;

    const coords = resolveCustomerCoordinates([ord, t]);
    const items =
      Array.isArray(ord?.items) && ord.items.length > 0
        ? ord.items
        : (Array.isArray(t.items) && t.items.length > 0 ? t.items : (ord?.items || t.items));
    const totalAmount = resolveCanonicalTotal(ord, t);
    const ordAddr = resolveAddressText(ord?.pickupAddress || ord?.address || ord?.customerAddress);
    const derivedSlot =
      t.pickupSlot ||
      ord?.pickupDetails ||
      ord?.pickupSlot ||
      (ord?.slot || ord?.pickupTime || ord?.pickupDate
        ? {
            scheduledTime: ord?.pickupTime || ord?.slot || undefined,
            scheduledDate: ord?.pickupDate || undefined,
            isInstant: Boolean(ord?.isInstant),
          }
        : null);

    return {
      ...t,
      customerName: resolveName(t, ord, userDoc) || t.customerName,
      customerPhone: resolvePhone(t, ord, userDoc) || t.customerPhone,
      pickupAddress: t.pickupAddress || ordAddr,
      pickupSlot: derivedSlot,
      createdAt: ord?.createdAt || t.createdAt,
      assignedAt: t.assignedAt || ord?.assignedAt,
      items,
      totalAmount,
      billDetails: ord?.billDetails || t.billDetails,
      vendorId: ord?.vendorId || t.vendorId || 'default',
      paymentStatus: ord?.paymentStatus || t.paymentStatus,
      paymentMode: ord?.paymentMode || ord?.paymentMethod || t.paymentMode,
      notes: ord?.notes || ord?.instruction || t.notes,
      pickupNote: ord?.opsMeta?.pickupNote ?? ord?.pickupNote ?? t.pickupNote,
      isUrgent: ord?.opsMeta?.isUrgent ?? ord?.isUrgent ?? t.isUrgent,
      isExpress: Boolean(
        t.isExpress ||
        ord?.isExpress ||
        ord?.turnaroundMode === 'express_6_8h' ||
        ord?.pickupDetails?.isExpress ||
        ord?.billDetails?.isExpress
      ),
      tokenNumber: ord?.tokenNumber || t.tokenNumber,
      tokens: ord?.tokens || t.tokens,
      latitude: coords?.latitude,
      longitude: coords?.longitude,
      orderStatus: ord?.status ?? t.orderStatus,
    };
  });

  const mergedDeliveries = rawDeliveries.map((d) => {
    const ord = activeOrderData.get(d.orderId || d.id);
    const userDoc = d.userId ? activeUserProfiles.get(d.userId) : undefined;
    if (!ord && !userDoc) return d;

    const coords = resolveCustomerCoordinates([ord, d]);
    const items = Array.isArray(ord?.items) && ord.items.length > 0 ? ord.items : d.items;
    const totalAmount = resolveCanonicalTotal(ord, d);
    const ordAddr = resolveAddressText(ord?.deliveryAddress || ord?.pickupAddress || ord?.address || ord?.customerAddress);
    const bundleLabels =
      Array.isArray(d.bundleLabels) && d.bundleLabels.length > 0
        ? d.bundleLabels
        : (Array.isArray(ord?.bundleLabels) ? ord.bundleLabels : undefined);

    return {
      ...d,
      customerName: resolveName(d, ord, userDoc) || d.customerName || '',
      customerPhone: resolvePhone(d, ord, userDoc) || d.customerPhone || '',
      deliveryAddress: d.deliveryAddress || ordAddr || '',
      deliveryDate: d.deliveryDate || ord?.deliveryDate || ord?.deliveryDetails?.scheduledDate || ord?.pickupDetails?.scheduledDate || null,
      deliveryTime: d.deliveryTime || ord?.deliveryTime || ord?.deliverySlot || ord?.deliveryDetails?.scheduledTime || null,
      createdAt: ord?.createdAt || d.createdAt,
      assignedAt: d.assignedAt || ord?.deliveryAssignedAt || ord?.assignedAt,
      items,
      totalAmount,
      billDetails: ord?.billDetails || d.billDetails,
      paymentStatus: ord?.paymentStatus || d.paymentStatus || null,
      paymentMode: ord?.paymentMode || ord?.paymentMethod || d.paymentMode || null,
      bundleCount: d.bundleCount ?? ord?.bundleCount ?? 1,
      bundleLabels,
      tokenNumber: ord?.tokenNumber || d.tokenNumber || null,
      tokens: ord?.tokens || d.tokens || null,
      latitude: coords?.latitude,
      longitude: coords?.longitude,
      notes: ord?.notes || ord?.instruction || d.notes,
      pickupNote: ord?.opsMeta?.pickupNote ?? ord?.pickupNote ?? d.pickupNote,
      isUrgent: Boolean(ord?.opsMeta?.isUrgent ?? ord?.isUrgent ?? d.isUrgent),
      isExpress: Boolean(d.isExpress || ord?.isExpress || ord?.turnaroundMode === 'express_6_8h') || undefined,
      orderStatus: ord?.status ?? d.orderStatus,
    };
  });

  return { myTasks: mergedTasks, myDeliveries: mergedDeliveries };
}

function maybeHydrateUserProfile(userId: string | undefined, task: any, oid: string, set: (partial: Partial<OpsStaffState>) => void) {
  if (!userId || activeUserProfiles.has(userId) || pendingUserLookups.has(userId)) return;
  const ord = activeOrderData.get(oid);
  if (resolveName(task, ord, undefined) && resolvePhone(task, ord, undefined)) return;

  pendingUserLookups.add(userId);
  getDoc(doc(db, 'users', userId))
    .then((userSnap) => {
      activeUserProfiles.set(userId, userSnap.exists() ? (userSnap.data() || {}) : {});
      if (userSnap.exists()) {
        const merged = mergeTasksWithOrders();
        set({ myTasks: merged.myTasks, myDeliveries: merged.myDeliveries });
      }
    })
    .catch((err) => {
      console.warn(`[opsStaff] user profile lookup failed (${userId}):`, err);
    })
    .finally(() => {
      pendingUserLookups.delete(userId);
    });
}

function syncActiveOrderListeners(set: (partial: Partial<OpsStaffState>) => void) {
  const needed = new Map<string, { orderId: string; userId: string; task: any }>();

  for (const t of rawTasks) {
    const oid = t.orderId || t.id;
    if (isPending(t) && t.userId && oid) {
      needed.set(oid, { orderId: oid, userId: t.userId, task: t });
    }
  }
  for (const d of rawDeliveries) {
    const oid = d.orderId || d.id;
    if ((d.status === 'assigned' || d.status === 'out_for_delivery') && d.userId && oid) {
      needed.set(oid, { orderId: oid, userId: d.userId, task: d });
    }
  }

  for (const [oid, unsub] of activeOrderUnsubs.entries()) {
    if (!needed.has(oid)) {
      try { unsub(); } catch { /* ignore */ }
      activeOrderUnsubs.delete(oid);
      activeOrderData.delete(oid);
      activeOrderSig.delete(oid);
    }
  }

  for (const [oid, target] of needed.entries()) {
    maybeHydrateUserProfile(target.userId, target.task, oid, set);
    if (activeOrderUnsubs.has(oid)) continue;
    const orderRef = doc(db, 'users', target.userId, 'orders', target.orderId);
    const unsub = onSnapshot(
      orderRef,
      (orderSnap) => {
        if (!orderSnap.exists()) {
          if (activeOrderData.delete(oid)) {
            activeOrderSig.delete(oid);
            const merged = mergeTasksWithOrders();
            set({ myTasks: merged.myTasks, myDeliveries: merged.myDeliveries });
          }
          maybeHydrateUserProfile(target.userId, target.task, oid, set);
          return;
        }
        const od = orderSnap.data() || {};
        // Exclude riderLocation & updatedAt so GPS broadcasts never trigger UI re-renders
        const sig = JSON.stringify({
          s: od.status,
          cn: od.customerName || od.userName,
          cp: od.customerPhone || od.userPhone,
          lat: od.latitude ?? od.address?.latitude ?? od.address?.location?.latitude ?? od.address?.coords?.latitude,
          lng: od.longitude ?? od.address?.longitude ?? od.address?.location?.longitude ?? od.address?.coords?.longitude,
          addr: od.address,
          pd: od.pickupDetails || od.pickupSlot,
          dd: od.deliveryDate,
          dt: od.deliveryTime || od.deliverySlot,
          tot: od.billDetails?.total ?? od.totalAmount,
          disc: od.billDetails?.discount,
          it: od.items,
          ps: od.paymentStatus,
          pm: od.paymentMode || od.paymentMethod,
          tk: od.tokens,
          tkn: od.tokenNumber,
          urg: od.opsMeta?.isUrgent ?? od.isUrgent,
          pnote: od.opsMeta?.pickupNote ?? od.pickupNote,
          ca: od.createdAt,
          bl: od.bundleLabels,
          bc: od.bundleCount,
        });
        if (activeOrderSig.get(oid) === sig) return;
        activeOrderSig.set(oid, sig);
        activeOrderData.set(oid, od);
        maybeHydrateUserProfile(target.userId, target.task, oid, set);
        const merged = mergeTasksWithOrders();
        set({ myTasks: merged.myTasks, myDeliveries: merged.myDeliveries });
      },
      (err) => {
        console.warn(`[opsStaff] active order listener error (${oid}):`, err);
      }
    );
    activeOrderUnsubs.set(oid, unsub);
  }
}

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
    if (activeInitializedUid === uid && unsubStaff && unsubTasks && unsubDeliveries) {
      return;
    }
    unsubStaff?.();
    unsubTasks?.();
    unsubDeliveries?.();
    clearActiveOrderListeners(true);
    activeInitializedUid = uid;

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
          if (d.onShift !== true) {
            SpinzoOverlay.dismissOverlay();
          }
        }
        if (d.onShift !== true || d.onBreak === true || d.attendanceStatus === 'lunch' || d.attendanceStatus === 'short_break') {
          useWasherReminderStore.getState().dismissReminder();
        }
        if (d.onShift === true && activeOrderUnsubs.size === 0 && (rawTasks.length > 0 || rawDeliveries.length > 0)) {
          syncActiveOrderListeners(set);
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
          const alertKey = taskAlertKey(t, 'pickup');
          if (!isInitialTasks && shouldAnnounce(t, announcedTaskIds, 'pickup') && docSnap.id) {
            announcedTaskIds.add(alertKey);
            saveAnnounced(announcedTaskIds);
            const sd = get().staffDoc;
            const isSupervisorOverride = Boolean(t.assignedBy && t.assignedBy !== 'system_auto');
            const isOnBreak = sd?.onBreak === true || sd?.attendanceStatus === 'lunch' || sd?.attendanceStatus === 'short_break';
            if ((!sd || sd.onShift !== false) && (!isOnBreak || isSupervisorOverride)) {
              const ord = activeOrderData.get(t.orderId || t.id);
              announceAssignedPickup({
                ...t,
                tokenNumber: ord?.tokenNumber || t.tokenNumber,
                tokens: ord?.tokens || t.tokens,
                isExpress: Boolean(
                  t.isExpress ||
                  ord?.isExpress ||
                  ord?.turnaroundMode === 'express_6_8h'
                ),
              });
            }
          } else if (docSnap.id && t.acceptedAt) {
            announcedTaskIds.add(alertKey);
          }
        });
        isInitialTasks = false;
        rawTasks = tasks;
        syncActiveOrderListeners(set);
        const merged = mergeTasksWithOrders();
        set({ myTasks: merged.myTasks });
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
          const coords = resolveCustomerCoordinates([d]);
          const task: DeliveryTask = {
            id: docSnap.id,
            orderId: d.orderId || docSnap.id,
            userId: d.userId || '',
            vendorId: d.vendorId || 'vendor_1',
            status: d.status || 'pending',
            assignee: d.assignee || null,
            assignedBy: d.assignedBy || null,
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
            billDetails: d.billDetails || undefined,
            paymentStatus: d.paymentStatus || null,
            paymentMode: d.paymentMode || null,
            latitude: coords?.latitude,
            longitude: coords?.longitude,
            notes: d.notes || d.instruction || undefined,
            pickupNote: d.pickupNote || d.opsMeta?.pickupNote || undefined,
            isUrgent: Boolean(d.isUrgent || d.opsMeta?.isUrgent) || undefined,
            assignedAt: d.assignedAt,
            acceptedAt: d.acceptedAt,
            createdAt: d.createdAt,
            pickedUpAt: d.pickedUpAt,
            deliveredAt: d.deliveredAt,
            proofUrl: d.proofUrl || null,
            isExpress: Boolean(
              d.isExpress ||
              d.turnaroundMode === 'express_6_8h' ||
              (Array.isArray(d.items) && d.items.some((i: any) => i?.isExpress))
            ) || undefined,
          };
          deliveries.push(task);
          const alertKey = taskAlertKey(task, 'delivery');
          if (!isInitialDeliveries && shouldAnnounce(task, announcedTaskIds, 'delivery') && docSnap.id) {
            announcedTaskIds.add(alertKey);
            saveAnnounced(announcedTaskIds);
            const sd = get().staffDoc;
            const isSupervisorOverride = Boolean(task.assignedBy && task.assignedBy !== 'system_auto');
            const isOnBreak = sd?.onBreak === true || sd?.attendanceStatus === 'lunch' || sd?.attendanceStatus === 'short_break';
            if ((!sd || sd.onShift !== false) && (!isOnBreak || isSupervisorOverride)) {
              const ord = activeOrderData.get(task.orderId || task.id);
              announceAssignedDelivery(task.orderId, task.deliveryAddress, {
                tokenNumber: ord?.tokenNumber || task.tokenNumber,
                tokensMap: ord?.tokens || task.tokens,
                isExpress: Boolean(
                  task.isExpress ||
                  ord?.isExpress ||
                  ord?.turnaroundMode === 'express_6_8h'
                ),
              });
            }
          } else if (docSnap.id && task.acceptedAt) {
            announcedTaskIds.add(alertKey);
          }
        });
        isInitialDeliveries = false;
        rawDeliveries = deliveries;
        syncActiveOrderListeners(set);
        const merged = mergeTasksWithOrders();
        set({ myDeliveries: merged.myDeliveries });
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
          onBreak: false,
          attendanceStatus: 'working',
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

  setBreakState: async (uid, status) => {
    const isBreak = status === 'lunch' || status === 'short_break';
    if (isBreak) {
      stopAlarm();
      cancelAllStageNudgeTimers();
      useWasherReminderStore.getState().dismissReminder();
      if (Platform.OS === 'android') {
        SpinzoOverlay.dismissOverlay();
      }
    }
    try {
      await setDoc(
        doc(db, 'ops_staff', uid),
        {
          onBreak: isBreak,
          attendanceStatus: status,
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('[opsStaff] setBreakState failed:', err);
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
    stopAlarm();
    cancelAllStageNudgeTimers();
    clearActiveOrderListeners(false);
    useWasherReminderStore.getState().dismissReminder();
    if (Platform.OS === 'android') {
      SpinzoOverlay.setOnShift(false);
      SpinzoOverlay.dismissOverlay();
    }
    try {
      await setDoc(
        doc(db, 'ops_staff', uid),
        {
          onShift: false,
          onBreak: false,
          attendanceStatus: 'off',
          shiftEndAt: new Date(),
        },
        { merge: true }
      );
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  reset: () => {
    stopAlarm();
    cancelAllStageNudgeTimers();
    useWasherReminderStore.getState().dismissReminder();
    if (Platform.OS === 'android') {
      SpinzoOverlay.setOnShift(false);
      SpinzoOverlay.dismissOverlay();
    }
    activeInitializedUid = null;
    unsubStaff?.();
    unsubTasks?.();
    unsubDeliveries?.();
    unsubStaff = null;
    unsubTasks = null;
    unsubDeliveries = null;
    clearActiveOrderListeners(true);
    announcedTaskIds.clear();
    stopAlarm();
    set({ staffDoc: null, myTasks: [], myDeliveries: [], isLoading: false, error: null });
  },
}));
