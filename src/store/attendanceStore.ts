import { create } from 'zustand';
import { Alert } from 'react-native';
import { auth, db } from '../config/firebase';
import { doc, onSnapshot, setDoc, updateDoc, getDoc, Unsubscribe } from '../config/firebase';
import { useAuthStore } from './authStore';
import { useOpsStaffStore } from './opsStaffStore';

export type AttendanceStatus = 'off' | 'working' | 'lunch' | 'short_break';

export interface ShortBreak {
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
  lunch: { startAt: number; endAt: number | null } | null;
  shortBreaks: ShortBreak[];
  totalWorkMs: number;
  totalLunchMs: number;
  // Fines (₹)
  lateFine?: number;       // ₹50 if login after 8:30 AM
  lunchOvertimeFine?: number; // ₹50 if lunch > limit
  earlyLogoutFine?: number;  // ₹50 if logout before 10 PM
}

const HELPER_LUNCH_LIMIT_MS = 1.5 * 60 * 60 * 1000; // 1.5 hours for helpers
const RIDER_LUNCH_LIMIT_MS = 2 * 60 * 60 * 1000;    // 2 hours for riders
const SHORT_BREAK_LIMIT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_SHORT_BREAKS = 3;

const LATE_LOGIN_CUTOFF = 8 * 60 + 30; // 8:30 AM in minutes from midnight
const EARLY_LOGOUT_CUTOFF = 22 * 60;   // 10:00 PM in minutes from midnight
const FINE_AMOUNT = 50; // ₹50 per rule violation

interface AttendanceState {
  currentShift: ShiftDoc | null;
  status: AttendanceStatus;
  isLoading: boolean;
  lunchOverdue: boolean;
  lunchRemainingMs: number;
  shortBreakRemainingMs: number;
  shortBreakOverdue: boolean;
  shortBreakCount: number;

  initializeListener: () => void;
  clockIn: (storeId: string) => Promise<void>;
  lunchOut: () => Promise<void>;
  lunchIn: () => Promise<void>;
  shortBreakOut: () => Promise<void>;
  shortBreakIn: () => Promise<void>;
  clockOut: () => Promise<void>;
  getLunchLimit: () => number;
}

let unsubShift: Unsubscribe | null = null;
let lunchTicker: NodeJS.Timeout | null = null;
let breakTicker: NodeJS.Timeout | null = null;

const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const useAttendanceStore = create<AttendanceState>((set, get) => ({
  currentShift: null,
  status: 'off',
  isLoading: false,
  lunchOverdue: false,
  lunchRemainingMs: HELPER_LUNCH_LIMIT_MS, // default; getLunchLimit() resolves per role
  shortBreakRemainingMs: SHORT_BREAK_LIMIT_MS,
  shortBreakOverdue: false,
  shortBreakCount: 0,

  initializeListener: () => {
    unsubShift?.();
    if (lunchTicker) clearInterval(lunchTicker);
    if (breakTicker) clearInterval(breakTicker);

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
        // Ensure shortBreaks array exists
        if (!data.shortBreaks) data.shortBreaks = [];
        set({ currentShift: data, status: data.status, shortBreakCount: (data.shortBreaks || []).filter(b => b.endAt !== null).length });

        // Start short break countdown ticker
        if (breakTicker) clearInterval(breakTicker);
        if (data.status === 'short_break') {
          const activeBreak = (data.shortBreaks || []).find(b => b.endAt === null);
          if (activeBreak) {
            const tickFn = () => {
              const elapsed = Date.now() - activeBreak.startAt;
              const remaining = SHORT_BREAK_LIMIT_MS - elapsed;
              set({
                shortBreakRemainingMs: Math.max(0, remaining),
                shortBreakOverdue: remaining <= 0,
              });
            };
            tickFn();
            breakTicker = setInterval(tickFn, 1000);
          }
        } else {
          set({ shortBreakRemainingMs: SHORT_BREAK_LIMIT_MS, shortBreakOverdue: false });
        }
        
        if (lunchTicker) clearInterval(lunchTicker);
        const lunchLimitForRole = get().getLunchLimit();
        if (data.status === 'lunch' && data.lunch && !data.lunch.endAt) {
          const tickFn = () => {
            const elapsed = Date.now() - data.lunch!.startAt;
            const remaining = lunchLimitForRole - elapsed;
            set({
              lunchRemainingMs: Math.max(0, remaining),
              lunchOverdue: remaining <= 0,
            });
          };
          tickFn(); // immediate
          lunchTicker = setInterval(tickFn, 1000);
        } else {
          set({ lunchRemainingMs: lunchLimitForRole, lunchOverdue: false });
        }
      } else {
        set({ currentShift: null, status: 'off', lunchRemainingMs: get().getLunchLimit(), lunchOverdue: false });
      }
    });
  },

  getLunchLimit: () => {
    const role = useAuthStore.getState().activeRole;
    return role === 'rider' ? RIDER_LUNCH_LIMIT_MS : HELPER_LUNCH_LIMIT_MS;
  },

  clockIn: async (storeId) => {
    const user = useAuthStore.getState().user;
    if (!user) {
      Alert.alert('Authentication Error', 'User not found. Please log in again.');
      return;
    }
    set({ isLoading: true });
    try {
      const today = getTodayStr();
      const shiftRef = doc(db, `ops_attendance/${user.id}/shifts`, today);

      // Check if late (after 8:30 AM)
      const now = new Date();
      const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
      const lateFine = minutesSinceMidnight > LATE_LOGIN_CUTOFF ? FINE_AMOUNT : 0;

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
          shortBreaks: [],
          totalWorkMs: 0,
          totalLunchMs: 0,
          lateFine,
        };
        await setDoc(shiftRef, newShift);
      } else {
        await updateDoc(shiftRef, { status: 'working', logoutAt: null, storeId, lateFine });
      }

      if (lateFine > 0) {
        Alert.alert('Late Login', `You logged in after 8:30 AM. A fine of ₹${lateFine} has been applied.`);
      }

      // Sync with ops_staff for order assignment
      await useOpsStaffStore.getState().goOnShift(user.id, user.role, user.phone, user.name, { storeId });
    } catch (err: any) {
      console.error('Failed to clock in:', err);
      Alert.alert('Clock In Failed', err?.message || 'Failed to update attendance shift. Please check your network and try again.');
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
      await useOpsStaffStore.getState().setBreakState(user.id, 'lunch');
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
      const limit = get().getLunchLimit();
      const lunchOvertimeFine = duration > limit ? FINE_AMOUNT : 0;

      await updateDoc(shiftRef, {
        status: 'working',
        lunch,
        totalLunchMs: (currentShift.totalLunchMs || 0) + duration,
        lunchOvertimeFine,
      });
      await useOpsStaffStore.getState().setBreakState(user.id, 'working');

      if (lunchOvertimeFine > 0) {
        Alert.alert('Lunch Overtime', `Your lunch exceeded the time limit. A fine of ₹${lunchOvertimeFine} has been applied.`);
      }
    } catch (err) {
      console.error('Failed to end lunch:', err);
    } finally {
      set({ isLoading: false });
    }
  },

  shortBreakOut: async () => {
    const { currentShift } = get();
    if (!currentShift || currentShift.status !== 'working') return;
    
    const existingBreaks = currentShift.shortBreaks || [];
    if (existingBreaks.length >= MAX_SHORT_BREAKS) return; // Reached limit

    set({ isLoading: true });
    try {
      const user = useAuthStore.getState().user;
      if (!user) return;
      const shiftRef = doc(db, `ops_attendance/${user.id}/shifts`, currentShift.date);
      
      const newBreak = { startAt: Date.now(), endAt: null };
      
      await updateDoc(shiftRef, {
        status: 'short_break',
        shortBreaks: [...existingBreaks, newBreak],
      });
      await useOpsStaffStore.getState().setBreakState(user.id, 'short_break');
    } catch (err) {
      console.error('Failed to start short break:', err);
    } finally {
      set({ isLoading: false });
    }
  },

  shortBreakIn: async () => {
    const { currentShift } = get();
    if (!currentShift || currentShift.status !== 'short_break') return;
    
    const existingBreaks = currentShift.shortBreaks || [];
    const activeBreakIndex = existingBreaks.findIndex(b => b.endAt === null);
    if (activeBreakIndex === -1) return;

    set({ isLoading: true });
    try {
      const user = useAuthStore.getState().user;
      if (!user) return;
      const shiftRef = doc(db, `ops_attendance/${user.id}/shifts`, currentShift.date);
      
      const updatedBreaks = [...existingBreaks];
      updatedBreaks[activeBreakIndex] = {
        ...updatedBreaks[activeBreakIndex],
        endAt: Date.now()
      };
      
      await updateDoc(shiftRef, {
        status: 'working',
        shortBreaks: updatedBreaks,
      });
      await useOpsStaffStore.getState().setBreakState(user.id, 'working');
    } catch (err) {
      console.error('Failed to end short break:', err);
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
      const now = Date.now();

      // Check early logout (before 10 PM)
      const logoutH = new Date(now).getHours();
      const logoutMin = new Date(now).getMinutes();
      const minutesSinceMidnight = logoutH * 60 + logoutMin;
      const earlyLogoutFine = minutesSinceMidnight < EARLY_LOGOUT_CUTOFF ? FINE_AMOUNT : 0;

      const updates: any = {
        status: 'off',
        logoutAt: now,
        earlyLogoutFine,
      };

      // If on lunch, end it before clocking out
      if (currentShift.status === 'lunch' && currentShift.lunch && !currentShift.lunch.endAt) {
        updates.lunch = { ...currentShift.lunch, endAt: now };
        updates.totalLunchMs = (currentShift.totalLunchMs || 0) + (now - currentShift.lunch.startAt);
      }

      await updateDoc(shiftRef, updates);
      if (lunchTicker) clearInterval(lunchTicker);

      if (earlyLogoutFine > 0) {
        Alert.alert('Early Logout', `You logged out before 10 PM. A fine of ₹${earlyLogoutFine} has been applied.`);
      }

      // Sync with ops_staff to stop receiving new orders
      await useOpsStaffStore.getState().goOffShift(user.id);
    } catch (err) {
      console.error('Failed to clock out:', err);
    } finally {
      set({ isLoading: false });
    }
  },
}));
