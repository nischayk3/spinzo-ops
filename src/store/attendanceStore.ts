import { create } from 'zustand';
import { auth, db } from '../config/firebase';
import { doc, onSnapshot, setDoc, updateDoc, getDoc, Unsubscribe } from 'firebase/firestore';
import { useAuthStore } from './authStore';

export type AttendanceStatus = 'off' | 'working' | 'lunch';

export interface ShiftDoc {
  staffId: string;
  date: string; // YYYY-MM-DD
  storeId: string;
  loginAt: number;
  logoutAt: number | null;
  status: AttendanceStatus;
  lunch: { startAt: number; endAt: number | null } | null;
  totalWorkMs: number;
  totalLunchMs: number;
}

const LUNCH_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

interface AttendanceState {
  currentShift: ShiftDoc | null;
  status: AttendanceStatus;
  isLoading: boolean;
  lunchOverdue: boolean;
  lunchRemainingMs: number;
  
  initializeListener: () => void;
  clockIn: (storeId: string) => Promise<void>;
  lunchOut: () => Promise<void>;
  lunchIn: () => Promise<void>;
  clockOut: () => Promise<void>;
}

let unsubShift: Unsubscribe | null = null;
let lunchTicker: NodeJS.Timeout | null = null;

const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const useAttendanceStore = create<AttendanceState>((set, get) => ({
  currentShift: null,
  status: 'off',
  isLoading: false,
  lunchOverdue: false,
  lunchRemainingMs: LUNCH_LIMIT_MS,

  initializeListener: () => {
    unsubShift?.();
    if (lunchTicker) clearInterval(lunchTicker);

    const user = useAuthStore.getState().user;
    if (!user) {
      set({ currentShift: null, status: 'off' });
      return;
    }

    const today = getTodayStr();
    const shiftRef = doc(db, `ops_attendance/${user.id}/shifts`, today);

    unsubShift = onSnapshot(shiftRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data() as ShiftDoc;
        set({ currentShift: data, status: data.status });

        // Start lunch countdown ticker
        if (lunchTicker) clearInterval(lunchTicker);
        if (data.status === 'lunch' && data.lunch && !data.lunch.endAt) {
          const tickFn = () => {
            const elapsed = Date.now() - data.lunch!.startAt;
            const remaining = LUNCH_LIMIT_MS - elapsed;
            set({
              lunchRemainingMs: Math.max(0, remaining),
              lunchOverdue: remaining <= 0,
            });
          };
          tickFn(); // immediate
          lunchTicker = setInterval(tickFn, 1000);
        } else {
          set({ lunchRemainingMs: LUNCH_LIMIT_MS, lunchOverdue: false });
        }
      } else {
        set({ currentShift: null, status: 'off', lunchRemainingMs: LUNCH_LIMIT_MS, lunchOverdue: false });
      }
    });
  },

  clockIn: async (storeId) => {
    const user = useAuthStore.getState().user;
    if (!user) return;
    set({ isLoading: true });
    try {
      const today = getTodayStr();
      const shiftRef = doc(db, `ops_attendance/${user.id}/shifts`, today);
      
      const snap = await getDoc(shiftRef);
      if (!snap.exists()) {
        const newShift: ShiftDoc = {
          staffId: user.id,
          date: today,
          storeId,
          loginAt: Date.now(),
          logoutAt: null,
          status: 'working',
          lunch: null,
          totalWorkMs: 0,
          totalLunchMs: 0,
        };
        await setDoc(shiftRef, newShift);
      } else {
        await updateDoc(shiftRef, { status: 'working', logoutAt: null });
      }
    } catch (err) {
      console.error('Failed to clock in:', err);
    } finally {
      set({ isLoading: false });
    }
  },

  lunchOut: async () => {
    const { currentShift } = get();
    if (!currentShift || currentShift.status !== 'working') return;
    if (currentShift.lunch) return; // Only 1 lunch allowed

    set({ isLoading: true });
    try {
      const user = useAuthStore.getState().user;
      if (!user) return;
      const shiftRef = doc(db, `ops_attendance/${user.id}/shifts`, currentShift.date);
      
      await updateDoc(shiftRef, {
        status: 'lunch',
        lunch: { startAt: Date.now(), endAt: null },
      });
    } catch (err) {
      console.error('Failed to start lunch:', err);
    } finally {
      set({ isLoading: false });
    }
  },

  lunchIn: async () => {
    const { currentShift } = get();
    if (!currentShift || currentShift.status !== 'lunch' || !currentShift.lunch) return;

    set({ isLoading: true });
    try {
      const user = useAuthStore.getState().user;
      if (!user) return;
      const shiftRef = doc(db, `ops_attendance/${user.id}/shifts`, currentShift.date);
      
      const lunch = { ...currentShift.lunch, endAt: Date.now() };
      const duration = lunch.endAt - lunch.startAt;
      
      await updateDoc(shiftRef, {
        status: 'working',
        lunch,
        totalLunchMs: (currentShift.totalLunchMs || 0) + duration,
      });
    } catch (err) {
      console.error('Failed to end lunch:', err);
    } finally {
      set({ isLoading: false });
    }
  },

  clockOut: async () => {
    const { currentShift } = get();
    if (!currentShift) return;

    set({ isLoading: true });
    try {
      const user = useAuthStore.getState().user;
      if (!user) return;
      const shiftRef = doc(db, `ops_attendance/${user.id}/shifts`, currentShift.date);
      
      const updates: any = {
        status: 'off',
        logoutAt: Date.now(),
      };
      
      // If on lunch, end it before clocking out
      const now = Date.now();
      if (currentShift.status === 'lunch' && currentShift.lunch && !currentShift.lunch.endAt) {
        updates.lunch = { ...currentShift.lunch, endAt: now };
        updates.totalLunchMs = (currentShift.totalLunchMs || 0) + (now - currentShift.lunch.startAt);
      }

      await updateDoc(shiftRef, updates);
      if (lunchTicker) clearInterval(lunchTicker);
    } catch (err) {
      console.error('Failed to clock out:', err);
    } finally {
      set({ isLoading: false });
    }
  },
}));
