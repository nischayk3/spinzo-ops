import { create } from 'zustand';

export type AttendanceStatus = 'not_logged_in' | 'active' | 'break' | 'lunch';

interface BreakRecord {
  startTime: string;
  endTime: string | null;
  type: 'short_break' | 'lunch';
}

interface AttendanceState {
  status: AttendanceStatus;
  sessionStartTime: string | null;
  breaks: BreakRecord[];
  
  // Actions
  scanLogin: (qrData: string) => void;
  scanBreakOut: (qrData: string) => void;
  scanBreakIn: (qrData: string) => void;
  scanLunchOut: (qrData: string) => void;
  scanLunchIn: (qrData: string) => void;
  scanLogout: (qrData: string) => void;
}

export const useAttendanceStore = create<AttendanceState>((set, get) => ({
  status: 'not_logged_in',
  sessionStartTime: null,
  breaks: [],

  scanLogin: (qrData) => {
    set({ status: 'active', sessionStartTime: new Date().toISOString() });
  },

  scanBreakOut: (qrData) => {
    const { status, breaks } = get();
    if (status === 'active') {
      const activeBreaks = breaks.filter(b => b.type === 'short_break').length;
      if (activeBreaks < 3) {
        set({
          status: 'break',
          breaks: [...breaks, { startTime: new Date().toISOString(), endTime: null, type: 'short_break' }]
        });
      }
    }
  },

  scanBreakIn: (qrData) => {
    const { status, breaks } = get();
    if (status === 'break') {
      const updatedBreaks = [...breaks];
      updatedBreaks[updatedBreaks.length - 1].endTime = new Date().toISOString();
      set({ status: 'active', breaks: updatedBreaks });
    }
  },

  scanLunchOut: (qrData) => {
    const { status, breaks } = get();
    if (status === 'active') {
      set({
        status: 'lunch',
        breaks: [...breaks, { startTime: new Date().toISOString(), endTime: null, type: 'lunch' }]
      });
    }
  },

  scanLunchIn: (qrData) => {
    const { status, breaks } = get();
    if (status === 'lunch') {
      const updatedBreaks = [...breaks];
      updatedBreaks[updatedBreaks.length - 1].endTime = new Date().toISOString();
      set({ status: 'active', breaks: updatedBreaks });
    }
  },

  scanLogout: (qrData) => {
    if (qrData.includes('logout') || qrData.includes('store')) {
      set({ status: 'not_logged_in', sessionStartTime: null, breaks: [] });
    }
  }
}));
