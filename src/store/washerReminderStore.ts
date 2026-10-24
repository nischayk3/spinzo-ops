import { create } from 'zustand';

export type WasherMilestoneType = 'detergent' | 'softener' | 'complete';

export interface WasherReminder {
  orderId: string;
  processId: string;
  milestone: WasherMilestoneType;
  elapsedMinutes: number;
}

interface WasherReminderState {
  activeReminder: WasherReminder | null;
  snoozedUntil: Record<string, number>;
  showReminder: (reminder: WasherReminder) => void;
  dismissReminder: () => void;
  snoozeReminder: (minutes?: number) => void;
  isSnoozed: (key: string) => boolean;
}

export const useWasherReminderStore = create<WasherReminderState>((set, get) => ({
  activeReminder: null,
  snoozedUntil: {},

  showReminder: (reminder) => {
    const key = `${reminder.processId}_${reminder.milestone}`;
    const snoozed = get().snoozedUntil[key];
    if (snoozed && Date.now() < snoozed) {
      return; // suppressed while snoozed
    }
    set({ activeReminder: reminder });
  },

  dismissReminder: () => set({ activeReminder: null }),

  snoozeReminder: (minutes = 2) => {
    const current = get().activeReminder;
    if (!current) return;
    const key = `${current.processId}_${current.milestone}`;
    set(state => ({
      activeReminder: null,
      snoozedUntil: {
        ...state.snoozedUntil,
        [key]: Date.now() + minutes * 60 * 1000,
      },
    }));
  },

  isSnoozed: (key) => {
    const snoozed = get().snoozedUntil[key];
    return !!snoozed && Date.now() < snoozed;
  },
}));
