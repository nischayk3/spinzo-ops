import { create } from 'zustand';
import { db } from '../config/firebase';
import { query, collection, where, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';
import { parseOpsProcess, OpsProcess } from '../utils/opsProcess';

export type OpsProcessingResult =
  | { ok: true; currentIndex?: number; status?: string; next?: string }
  | { ok: false; error: string };

interface OpsProcessState {
  myProcesses: OpsProcess[];
  isLoading: boolean;
  error: string | null;
  initialize: (uid: string) => void;
  claim: (orderId: string) => Promise<OpsProcessingResult>;
  startStep: (orderId: string) => Promise<OpsProcessingResult>;
  completeStep: (orderId: string) => Promise<OpsProcessingResult>;
  advanceStep: (orderId: string) => Promise<OpsProcessingResult>;
  reset: () => void;
}

let unsub: (() => void) | null = null;

const callOps = () => httpsCallable<{ orderId: string; action: string }, OpsProcessingResult>(functions, 'opsProcessing');

export const useOpsProcessStore = create<OpsProcessState>((set) => ({
  myProcesses: [],
  isLoading: false,
  error: null,

  initialize: (uid) => {
    unsub?.();
    set({ isLoading: true });
    unsub = onSnapshot(
      query(collection(db, 'ops_process'), where('assignee', '==', uid)),
      (snap) => {
        const list: OpsProcess[] = [];
        snap.forEach((d) => list.push(parseOpsProcess(d.id, d.data())));
        set({ myProcesses: list, isLoading: false });
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
  advanceStep: async (orderId) => {
    try {
      const res = await callOps()({ orderId, action: 'advanceStep' });
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },

  reset: () => {
    unsub?.();
    unsub = null;
    set({ myProcesses: [], isLoading: false, error: null });
  },
}));
