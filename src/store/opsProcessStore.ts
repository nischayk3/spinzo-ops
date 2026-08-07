import { create } from 'zustand';
import { db } from '../config/firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';
import { parseOpsProcess, OpsProcess, myInProgress, GarmentLabel } from '../utils/opsProcess';

export type OpsProcessingResult =
  | { ok: true; currentIndex?: number; status?: string; step?: string; count?: number; labels?: GarmentLabel[]; seq?: number }
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
  printLabels: (orderId: string, garmentCount: number) => Promise<OpsProcessingResult>;
  scanGarment: (orderId: string, qr: string) => Promise<OpsProcessingResult>;
  unregisterGarment: (orderId: string, seq: number) => Promise<OpsProcessingResult>;
  submitTagging: (orderId: string) => Promise<OpsProcessingResult>;
  reset: () => void;
}

let unsub: (() => void) | null = null;

const callOps = () =>
  httpsCallable<{ orderId: string; action: string; garmentCount?: number; qr?: string; seq?: number }, OpsProcessingResult>(
    functions,
    'opsProcessing'
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

  reset: () => {
    unsub?.();
    unsub = null;
    set({ processes: [], myProcesses: [], isLoading: false, error: null });
  },
}));
