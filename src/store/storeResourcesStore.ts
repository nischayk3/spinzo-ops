import { create } from 'zustand';
import { doc, onSnapshot } from '../config/firebase';
import { db } from '../config/firebase';

/**
 * Store resource configuration — tracks how many machines the store has.
 * Reads from Firestore `config/storeResources`.
 * When the store grows (buys more machines), just update the Firestore doc — zero code changes.
 */
export interface StoreResources {
  washers: number;
  dryers: number;
  ironingStations: number;
  washerNames?: string[];
  dryerNames?: string[];
}

// Sensible defaults for a single-store operation
const DEFAULTS: StoreResources = {
  washers: 1,
  dryers: 1,
  ironingStations: 1,
  washerNames: ['Washer 1'],
  dryerNames: ['Dryer 1'],
};

interface StoreResourcesState {
  resources: StoreResources;
  isLoaded: boolean;
  initialize: () => void;
  reset: () => void;
}

let unsub: (() => void) | null = null;

export const useStoreResourcesStore = create<StoreResourcesState>((set) => ({
  resources: DEFAULTS,
  isLoaded: false,

  initialize: () => {
    unsub?.();
    const ref = doc(db, 'config', 'storeResources');
    unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          const washers = data.washers ?? DEFAULTS.washers;
          const dryers = data.dryers ?? DEFAULTS.dryers;
          set({
            resources: {
              washers,
              dryers,
              ironingStations: data.ironingStations ?? DEFAULTS.ironingStations,
              washerNames: Array.isArray(data.washerNames) && data.washerNames.length > 0
                ? data.washerNames
                : Array.from({ length: washers }, (_, i) => `Washer ${i + 1}`),
              dryerNames: Array.isArray(data.dryerNames) && data.dryerNames.length > 0
                ? data.dryerNames
                : Array.from({ length: dryers }, (_, i) => `Dryer ${i + 1}`),
            },
            isLoaded: true,
          });
        } else {
          // Doc doesn't exist yet — use defaults
          set({ resources: DEFAULTS, isLoaded: true });
        }
      },
      (err) => {
        console.error('Failed to load store resources:', err);
        set({ resources: DEFAULTS, isLoaded: true });
      }
    );
  },

  reset: () => {
    unsub?.();
    unsub = null;
    set({ resources: DEFAULTS, isLoaded: false });
  },
}));
