import { create } from 'zustand';
import { db } from '../config/firebase';
import { doc, onSnapshot, query, collection, where, setDoc } from 'firebase/firestore';
import { parseOpsTask, shouldAnnounce, OpsTask } from '../utils/opsTasks';
import { primeAlerts, announceAssignedPickup } from '../utils/alerts';

export interface StaffDoc {
  uid: string;
  role: string;
  phone: string;
  name?: string;
  onShift?: boolean;
  shiftStartAt?: unknown;
}

interface OpsStaffState {
  staffDoc: StaffDoc | null;
  myTasks: OpsTask[];
  isLoading: boolean;
  error: string | null;
  initialize: (uid: string) => void;
  goOnShift: (uid: string, role: string, phone: string, name?: string) => Promise<void>;
  goOffShift: (uid: string) => Promise<void>;
  reset: () => void;
}

let unsubStaff: (() => void) | null = null;
let unsubTasks: (() => void) | null = null;
// Tracks ids we've already alerted on so a refresh/re-subscribe doesn't re-announce.
const announcedTaskIds = new Set<string>();

export const useOpsStaffStore = create<OpsStaffState>((set, get) => ({
  staffDoc: null,
  myTasks: [],
  isLoading: false,
  error: null,

  initialize: (uid) => {
    unsubStaff?.();
    unsubTasks?.();

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
            announceAssignedPickup(t);
          }
        });
        set({ myTasks: tasks });
      },
      (err) => set({ error: String(err), isLoading: false })
    );
  },

  goOnShift: async (uid, role, phone, name) => {
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
        },
        { merge: true }
      );
    } catch (err) {
      set({ error: String(err) });
      throw err;
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
    unsubStaff = null;
    unsubTasks = null;
    set({ staffDoc: null, myTasks: [], isLoading: false, error: null });
  },
}));
