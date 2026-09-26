import { create } from 'zustand';
import { db } from '../config/firebase';
import { collection, onSnapshot, query, where } from '../config/firebase';

export interface StaffMember {
  uid: string;
  name?: string;
  phone: string;
  role: string;
  onShift?: boolean;
  shiftStartAt?: unknown;
  activeHelperTask?: { orderId: string; step: string } | null;
  storeId?: string;
}

export interface StaffRoster {
  helpers: StaffMember[];
  riders: StaffMember[];
  countHelpers: number;
  countRiders: number;
}

interface StaffRosterState {
  roster: StaffRoster;
  isLoading: boolean;
  initialize: () => void;
  reset: () => void;
}

const emptyRoster = (): StaffRoster => ({ helpers: [], riders: [], countHelpers: 0, countRiders: 0 });

let unsub: (() => void) | null = null;

export const useStaffRosterStore = create<StaffRosterState>((set) => ({
  roster: emptyRoster(),
  isLoading: true,

  initialize: () => {
    unsub?.();
    set({ isLoading: true });
    const q = query(collection(db, 'ops_staff'), where('onShift', '==', true));
    unsub = onSnapshot(
      q,
      (snap) => {
        const helpers: StaffMember[] = [];
        const riders: StaffMember[] = [];
        snap.forEach((doc) => {
          const d = doc.data() as StaffMember;
          d.uid = doc.id;
          if (d.role === 'rider') riders.push(d);
          else helpers.push(d);
        });
        set({
          roster: { helpers, riders, countHelpers: helpers.length, countRiders: riders.length },
          isLoading: false,
        });
      },
      () => set({ isLoading: false }),
    );
  },

  reset: () => {
    unsub?.();
    unsub = null;
    set({ roster: emptyRoster(), isLoading: false });
  },
}));