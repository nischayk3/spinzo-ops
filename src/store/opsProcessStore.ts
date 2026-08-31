import { create } from 'zustand';
import { db } from '../config/firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';
import { parseOpsProcess, OpsProcess, myInProgress, GarmentLabel } from '../utils/opsProcess';

export type OpsProcessingResult =
  | { ok: true; currentIndex?: number; status?: string; step?: string; count?: number; labels?: GarmentLabel[]; seq?: number }
  | { ok: false; error: string };

export interface ScanAllResult {
  registered: number;
  failed: number;
  error?: string;
}

export type SupervisorActionResult =
  | { ok: true; status?: string }
  | { ok: false; error: string };

interface OpsProcessState {
  processes: OpsProcess[];
  myProcesses: OpsProcess[];
  isLoading: boolean;
  error: string | null;
  initialize: (uid: string) => void;
  claim: (orderId: string) => Promise<OpsProcessingResult>;
  startStep: (orderId: string) => Promise<OpsProcessingResult>;
  completeStep: (orderId: string) => Promise<OpsProcessingResult>;
  completePackaging: (orderId: string, qualityMedia?: any) => Promise<OpsProcessingResult>;
  printLabels: (orderId: string, garmentCount: number) => Promise<OpsProcessingResult>;
  scanGarment: (orderId: string, qr: string) => Promise<OpsProcessingResult>;
  unregisterGarment: (orderId: string, seq: number) => Promise<OpsProcessingResult>;
  submitTagging: (orderId: string) => Promise<OpsProcessingResult>;
  // Simulation-only: registers all of an order's labels in one call by scanning
  // each generated QR server-side. Only available when SIM_SCAN is set, since the
  // server still validates each label individually.
  scanAllGarments: (orderId: string) => Promise<ScanAllResult>;
  
  // Supervisor overrides
  cancelOrder: (orderId: string, userId: string, reason: string, note?: string) => Promise<SupervisorActionResult>;
  reschedulePickup: (orderId: string, userId: string, date: string, time: string) => Promise<SupervisorActionResult>;
  scheduleDelivery: (orderId: string, userId: string, date: string, time: string) => Promise<SupervisorActionResult>;
  markOutForDelivery: (orderId: string, userId: string) => Promise<SupervisorActionResult>;
  verifyDeliveryOTP: (orderId: string, userId: string, otp: string) => Promise<SupervisorActionResult>;
  assignTaskToRider: (orderId: string, userId: string, riderId: string, isDelivery: boolean) => Promise<SupervisorActionResult>;
  reset: () => void;
}

let unsub: (() => void) | null = null;

const callOps = () =>
  httpsCallable<{ orderId: string; action: string; garmentCount?: number; qr?: string; seq?: number; qualityMedia?: any }, OpsProcessingResult>(
    functions,
    'opsProcessing'
  );

const callSupervisor = () =>
  httpsCallable<{ action: string; orderId: string; userId: string; vendorId?: string; reason?: string; note?: string; date?: string; time?: string; otp?: string; riderId?: string; isDelivery?: boolean }, SupervisorActionResult>(
    functions,
    'supervisorActions'
  );

export const useOpsProcessStore = create<OpsProcessState>((set) => ({
  processes: [],
  myProcesses: [],
  isLoading: false,
  error: null,

  initialize: (uid) => {
    unsub?.();
    set({ isLoading: true });
    unsub = onSnapshot(
      collection(db, 'ops_process'),
      (snap) => {
        const list: OpsProcess[] = [];
        snap.forEach((d) => list.push(parseOpsProcess(d.id, d.data())));
        set({ processes: list, myProcesses: list.filter((p) => myInProgress(p, uid)), isLoading: false });
      },
      (err) => set({ error: String(err), isLoading: false })
    );
  },

  claim: async (orderId) => {
    try {
      const res = await callOps()({ orderId, action: 'claim' });
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },
  startStep: async (orderId) => {
    try {
      const res = await callOps()({ orderId, action: 'startStep' });
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },
  completeStep: async (orderId) => {
    try {
      const res = await callOps()({ orderId, action: 'completeStep' });
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },
  completePackaging: async (orderId, qualityMedia = {}) => {
    try {
      const res = await callOps()({ orderId, action: 'completePackaging', qualityMedia });
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },
  printLabels: async (orderId, garmentCount) => {
    try {
      const res = await callOps()({ orderId, action: 'printLabels', garmentCount });
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },
  scanGarment: async (orderId, qr) => {
    try {
      const res = await callOps()({ orderId, action: 'scanGarment', qr });
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },
  unregisterGarment: async (orderId, seq) => {
    try {
      const res = await callOps()({ orderId, action: 'unregisterGarment', seq });
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },
  submitTagging: async (orderId) => {
    try {
      const res = await callOps()({ orderId, action: 'submitTagging' });
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },
  scanAllGarments: async (orderId) => {
    const p = useOpsProcessStore.getState().processes.find((pr) => pr.orderId === orderId);
    const labels = p?.garments?.labels;
    if (!labels || labels.length === 0) {
      return { registered: 0, failed: 0, error: 'no_labels_printed' };
    }
    let registered = 0;
    let failed = 0;
    for (const label of labels) {
      // Each scan goes through the real callable so server validation still applies.
      const res = await callOps()({ orderId, action: 'scanGarment', qr: label.qr });
      if (res.data.ok) registered += 1;
      else failed += 1;
    }
    return { registered, failed };
  },

  cancelOrder: async (orderId, userId, reason, note) => {
    try {
      const res = await callSupervisor()({ action: 'cancelOrder', orderId, userId, reason, note });
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },

  reschedulePickup: async (orderId, userId, date, time) => {
    try {
      const res = await callSupervisor()({ action: 'reschedulePickup', orderId, userId, date, time });
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },

  scheduleDelivery: async (orderId, userId, date, time) => {
    try {
      const res = await callSupervisor()({ action: 'scheduleDelivery', orderId, userId, date, time });
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },

  markOutForDelivery: async (orderId, userId) => {
    try {
      const res = await callSupervisor()({ action: 'markOutForDelivery', orderId, userId });
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },

  verifyDeliveryOTP: async (orderId, userId, otp) => {
    try {
      const res = await callSupervisor()({ action: 'verifyDeliveryOTP', orderId, userId, otp });
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },

  assignTaskToRider: async (orderId, userId, riderId, isDelivery) => {
    try {
      const res = await callSupervisor()({ action: 'assignTaskToRider', orderId, userId, riderId, isDelivery });
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },

  reset: () => {
    unsub?.();
    unsub = null;
    set({ processes: [], myProcesses: [], isLoading: false, error: null });
  },
}));
