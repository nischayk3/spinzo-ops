import { create } from 'zustand';
import { auth, db } from '../config/firebase';
import { doc, onSnapshot, setDoc, updateDoc, getDoc, Unsubscribe } from 'firebase/firestore';
import { useAuthStore } from './authStore';

export type AttendanceStatus = 'off' | 'working' | 'break' | 'lunch';

export interface BreakRecord {
  startAt: number;
  endAt: number | null;
}

export interface ShiftDoc {
  staffId: string;
  date: string; // YYYY-MM-DD
  storeId: string;
  loginAt: number;
  logoutAt: number | null;
  status: AttendanceStatus;
  breaks: BreakRecord[];
  lunch: BreakRecord | null;
  totalWorkMs: number;
  totalBreakMs: number;
  totalLunchMs: number;
}

interface AttendanceState {
  currentShift: ShiftDoc | null;
  status: AttendanceStatus;
  isLoading: boolean;
  
  initializeListener: () => void;
  clockIn: (storeId: string) => Promise<void>;
  startBreak: () => Promise<void>;
  endBreak: () => Promise<void>;
  lunchOut: () => Promise<void>;
  lunchIn: () => Promise<void>;
  clockOut: () => Promise<void>;
}

let unsubShift: Unsubscribe | null = null;
let breakTimeout: NodeJS.Timeout | null = null;
let lunchTimeout: NodeJS.Timeout | null = null;

const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const useAttendanceStore = create<AttendanceState>((set, get) => ({
  currentShift: null,
  status: 'off',
  isLoading: false,

  initializeListener: () => {
    unsubShift?.();
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

        // Auto-end break timer
        if (breakTimeout) clearTimeout(breakTimeout);
        if (data.status === 'break') {
          const activeBreak = data.breaks.find(b => !b.endAt);
          if (activeBreak) {
            const elapsed = Date.now() - activeBreak.startAt;
            const remaining = (10 * 60 * 1000) - elapsed;
            if (remaining <= 0) {
              get().endBreak();
            } else {
              breakTimeout = setTimeout(() => {
                get().endBreak();
              }, remaining);
            }
          }
        }

        // Lunch warning timer
        if (lunchTimeout) clearTimeout(lunchTimeout);
        if (data.status === 'lunch') {
          const lunch = data.lunch;
          if (lunch && !lunch.endAt) {
            const elapsed = Date.now() - lunch.startAt;
            const remaining = (45 * 60 * 1000) - elapsed;
            if (remaining > 0) {
              lunchTimeout = setTimeout(() => {
                // In a real app, fire a local notification or alert here
                console.warn('Lunch break exceeded 45 minutes!');
              }, remaining);
            }
          }
        }
      } else {
        set({ currentShift: null, status: 'off' });
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
          breaks: [],
          lunch: null,
          totalWorkMs: 0,
          totalBreakMs: 0,
          totalLunchMs: 0
        };
        await setDoc(shiftRef, newShift);
      } else {
        // Resume shift if it was previously off
        await updateDoc(shiftRef, { status: 'working' });
      }
    } catch (err) {
      console.error('Failed to clock in:', err);
    } finally {
      set({ isLoading: false });
    }
  },

  startBreak: async () => {
    const { currentShift } = get();
    if (!currentShift || currentShift.status !== 'working') return;
    
    // Check max breaks (3)
    if (currentShift.breaks.length >= 3) return;

    set({ isLoading: true });
    try {
      const user = useAuthStore.getState().user;
      if (!user) return;
      const shiftRef = doc(db, `ops_attendance/${user.id}/shifts`, currentShift.date);
      
      await updateDoc(shiftRef, {
        status: 'break',
        breaks: [...currentShift.breaks, { startAt: Date.now(), endAt: null }]
      });
    } catch (err) {
      console.error('Failed to start break:', err);
    } finally {
      set({ isLoading: false });
    }
  },

  endBreak: async () => {
    const { currentShift } = get();
    if (!currentShift || currentShift.status !== 'break') return;

    set({ isLoading: true });
    try {
      const user = useAuthStore.getState().user;
      if (!user) return;
      const shiftRef = doc(db, `ops_attendance/${user.id}/shifts`, currentShift.date);
      
      const updatedBreaks = [...currentShift.breaks];
      const activeBreak = updatedBreaks[updatedBreaks.length - 1];
      if (activeBreak && !activeBreak.endAt) {
        activeBreak.endAt = Date.now();
        const duration = activeBreak.endAt - activeBreak.startAt;
        
        await updateDoc(shiftRef, {
          status: 'working',
          breaks: updatedBreaks,
          totalBreakMs: (currentShift.totalBreakMs || 0) + duration
        });
      }
    } catch (err) {
      console.error('Failed to end break:', err);
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
        lunch: { startAt: Date.now(), endAt: null }
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
        totalLunchMs: (currentShift.totalLunchMs || 0) + duration
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
      
      // If currently on break/lunch, end it first before clocking out
      let updates: any = {
        status: 'off',
        logoutAt: Date.now()
      };
      
      const now = Date.now();
      if (currentShift.status === 'break') {
        const breaks = [...currentShift.breaks];
        const active = breaks[breaks.length - 1];
        if (active && !active.endAt) {
          active.endAt = now;
          updates.breaks = breaks;
          updates.totalBreakMs = (currentShift.totalBreakMs || 0) + (now - active.startAt);
        }
      } else if (currentShift.status === 'lunch') {
        if (currentShift.lunch && !currentShift.lunch.endAt) {
          updates.lunch = { ...currentShift.lunch, endAt: now };
          updates.totalLunchMs = (currentShift.totalLunchMs || 0) + (now - currentShift.lunch.startAt);
        }
      }

      await updateDoc(shiftRef, updates);
    } catch (err) {
      console.error('Failed to clock out:', err);
    } finally {
      set({ isLoading: false });
    }
  }
}));
