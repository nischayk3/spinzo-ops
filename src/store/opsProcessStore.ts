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
  claim: (orderId: string, tokenNumber?: string) => Promise<OpsProcessingResult>;
  acceptStep: (orderId: string, processId?: string) => Promise<OpsProcessingResult>;
  startStep: (orderId: string, processId?: string) => Promise<OpsProcessingResult>;
  completeStep: (orderId: string, processId?: string) => Promise<OpsProcessingResult>;
  completePackaging: (orderId: string, qualityMedia?: any, processId?: string) => Promise<OpsProcessingResult>;
  printLabels: (orderId: string, garmentCount: number, processId?: string) => Promise<OpsProcessingResult>;
  printBundleLabels: (orderId: string, count: number, processId?: string) => Promise<OpsProcessingResult>;
  scanGarment: (orderId: string, qr: string, processId?: string) => Promise<OpsProcessingResult>;
  unregisterGarment: (orderId: string, seq: number, processId?: string) => Promise<OpsProcessingResult>;
  submitTagging: (orderId: string, processId?: string) => Promise<OpsProcessingResult>;
  markOutForDelivery: (orderId: string) => Promise<OpsProcessingResult>;
  pickupDelivery: (orderId: string) => Promise<OpsProcessingResult>;
  // Simulation-only: registers all of an order's labels in one call by scanning
  // each generated QR server-side. Only available when SIM_SCAN is set, since the
  // server still validates each label individually.
  scanAllGarments: (orderId: string, processId?: string) => Promise<ScanAllResult>;
  
  // Supervisor overrides
  cancelOrder: (orderId: string, userId: string, reason: string, note?: string) => Promise<SupervisorActionResult>;
  reschedulePickup: (orderId: string, userId: string, date: string, time: string) => Promise<SupervisorActionResult>;
  scheduleDelivery: (orderId: string, userId: string, date: string, time: string) => Promise<SupervisorActionResult>;
  verifyDeliveryOTP: (orderId: string, userId: string, otp: string, proofUrl?: string) => Promise<SupervisorActionResult>;
  assignTaskToRider: (orderId: string, userId: string, riderId: string, isDelivery: boolean) => Promise<SupervisorActionResult>;
  reset: () => void;
}

let unsub: (() => void) | null = null;

const callOps = () =>
  httpsCallable<{ orderId: string; processId?: string; action: string; garmentCount?: number; qr?: string; seq?: number; qualityMedia?: any; count?: number; garments?: any }, OpsProcessingResult>(
    functions,
    'opsProcessing'
  );

const getProcessId = (orderId: string): string => 
  useOpsProcessStore.getState().processes.find((pr: OpsProcess) => pr.orderId === orderId)?.id || orderId;

const callSupervisor = () =>
  httpsCallable<{ action: string; orderId: string; userId: string; vendorId?: string; reason?: string; note?: string; date?: string; time?: string; otp?: string; riderId?: string; isDelivery?: boolean; proofUrl?: string }, SupervisorActionResult>(
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

  claim: async (orderId, tokenNumber) => {
    try {
      const res = await callOps()({ orderId, action: 'claim', tokenNumber } as any);
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e.message || String(e) };
    }
  },

  acceptStep: async (orderId, processId) => {
    try {
      const res = await callOps()({ orderId, processId: processId || getProcessId(orderId), action: 'acceptStep' } as any);
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e.message || String(e) };
    }
  },

  startStep: async (orderId, processId) => {
    try {
      const res = await callOps()({ orderId, processId: processId || getProcessId(orderId), action: 'startStep' });
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },
  completeStep: async (orderId, processId) => {
    try {
      const res = await callOps()({ orderId, processId: processId || getProcessId(orderId), action: 'completeStep' });
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },
  completePackaging: async (orderId, qualityMedia = {}, processId) => {
    try {
      const res = await callOps()({ orderId, processId: processId || getProcessId(orderId), action: 'completePackaging', qualityMedia });
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },
  printLabels: async (orderId, garmentCount, processId) => {
    try {
      const res = await callOps()({ orderId, processId: processId || getProcessId(orderId), action: 'printLabels', garmentCount });
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },
  printBundleLabels: async (orderId, count, processId) => {
    try {
      const res = await callOps()({ orderId, processId: processId || getProcessId(orderId), action: 'printBundleLabels', count } as any);
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },
  scanGarment: async (orderId, qr, processId) => {
    try {
      const res = await callOps()({ orderId, processId: processId || getProcessId(orderId), action: 'scanGarment', qr });
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },
  unregisterGarment: async (orderId, seq, processId) => {
    try {
      const res = await callOps()({ orderId, processId: processId || getProcessId(orderId), action: 'unregisterGarment', seq });
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },
  submitTagging: async (orderId, processId) => {
    try {
      const res = await callOps()({ orderId, processId: processId || getProcessId(orderId), action: 'submitTagging' });
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },
  markOutForDelivery: async (orderId) => {
    try {
      const res = await callOps()({ orderId, action: 'markOutForDelivery' });
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },
  pickupDelivery: async (orderId) => {
    try {
      const res = await callOps()({ orderId, action: 'pickupDelivery' });
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },
  scanAllGarments: async (orderId, processId) => {
    const targetProcessId = processId || getProcessId(orderId);
    const p = useOpsProcessStore.getState().processes.find((pr: OpsProcess) => pr.id === targetProcessId);
    const labels = p?.garments?.labels;
    if (!labels || labels.length === 0) {
      return { registered: 0, failed: 0, error: 'no_labels_printed' };
    }
    let registered = 0;
    let failed = 0;
    for (const label of labels) {
      // Each scan goes through the real callable so server validation still applies.
      const res = await callOps()({ orderId, processId: targetProcessId, action: 'scanGarment', qr: label.qr });
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

  verifyDeliveryOTP: async (orderId, userId, otp, proofUrl) => {
    try {
      const res = await callSupervisor()({ action: 'verifyDeliveryOTP', orderId, userId, otp, proofUrl });
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
