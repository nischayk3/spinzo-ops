import { create } from 'zustand';
import { ShiftRole, UserProfile } from '../types';
import { OpsStaffRoster, resolveRoleFromRoster } from '../utils/opsRole';
import { Platform } from 'react-native';
import { auth, db } from '../config/firebase';
import { 
  signInWithPhoneNumber, 
  ConfirmationResult,
  onAuthStateChanged,
  signOut as firebaseSignOut
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

// Helper to get or create verifier (web only)
const getVerifier = () => {
  if (Platform.OS !== 'web') return null;

  try {
    const { RecaptchaVerifier } = require('firebase/auth');
    
    // Clear old instance if it exists to prevent stale widget errors
    if ((window as any).opsRecaptchaVerifier) {
      try {
        (window as any).opsRecaptchaVerifier.clear();
      } catch (e) {
        // Ignore clear errors
      }
    }
    
    // Create fresh instance with normal size to bypass local heuristic blocking
    (window as any).opsRecaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
      size: 'normal',
    });
    
    return (window as any).opsRecaptchaVerifier;
  } catch (e) {
    console.warn("Ops Recaptcha init warning:", e);
    return null;
  }
};

interface AuthState {
  user: UserProfile | null;
  isLoggedIn: boolean;
  activeRole: ShiftRole | null;
  currentStoreId: string | null;
  isLoading: boolean;
  error: string | null;
  authInitialized: boolean;

  confirmationResult: ConfirmationResult | null;

  initializeAuth: () => void;
  requestOTP: (phone: string) => Promise<void>;
  verifyOTP: (otp: string) => Promise<void>;
  setRole: (role: ShiftRole) => void;
  setStoreId: (storeId: string) => void;
  logout: () => Promise<void>;
}

const fetchRosterRole = async (phone: string): Promise<ShiftRole | null> => {
  try {
    const snap = await getDoc(doc(db, 'config', 'opsStaff'));
    if (!snap.exists()) return null;
    return resolveRoleFromRoster(phone, snap.data() as OpsStaffRoster);
  } catch (err) {
    console.error('[auth] roster lookup failed:', err);
    return null;
  }
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isLoggedIn: false,
  activeRole: null,
  currentStoreId: null,
  isLoading: false,
  error: null,
  authInitialized: false,
  confirmationResult: null,

  initializeAuth: () => {
    onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const phone = firebaseUser.phoneNumber || '';
        const role = await fetchRosterRole(phone);
        set({
          user: {
            id: firebaseUser.uid,
            phone,
            name: 'Admin User',
            role: role || 'helper',
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          isLoggedIn: true,
          activeRole: role,
          authInitialized: true,
          error: null,
        });
      } else {
        set({ user: null, isLoggedIn: false, activeRole: null, authInitialized: true });
      }
    });
  },

  requestOTP: async (phone) => {
    set({ isLoading: true, error: null });
    try {
      // Ensure phone has country code
      const formattedPhone = phone.startsWith('+') ? phone : `+91${phone}`;
      
      let appVerifier = null;
      if (Platform.OS === 'web') {
        appVerifier = getVerifier();
      }

      const confirmationResult = await signInWithPhoneNumber(auth, formattedPhone, appVerifier || undefined);
      set({ confirmationResult, isLoading: false });
    } catch (error: any) {
      console.error("OTP Request Failed", error);
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  verifyOTP: async (otp) => {
    set({ isLoading: true, error: null });
    const { confirmationResult } = get();
    
    if (!confirmationResult) {
      set({ error: 'No active OTP request found.', isLoading: false });
      return;
    }

    try {
      const result = await confirmationResult.confirm(otp);
      const user = result.user;
      const role = await fetchRosterRole(user.phoneNumber || '');

      set({
        user: {
          id: user.uid,
          phone: user.phoneNumber || '',
          name: 'Admin User', // Placeholder
          role: role || 'helper',
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        isLoggedIn: true,
        activeRole: role,
        isLoading: false,
        confirmationResult: null, // clear
      });
    } catch (error: any) {
      console.error("OTP Verification Failed", error);
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  setRole: (role) => set({ activeRole: role }),
  setStoreId: (storeId) => set({ currentStoreId: storeId }),
  
  logout: async () => {
    try {
      await firebaseSignOut(auth);
      set({ user: null, isLoggedIn: false, activeRole: null, currentStoreId: null });
    } catch (error) {
      console.error("Logout failed", error);
    }
  },
}));
