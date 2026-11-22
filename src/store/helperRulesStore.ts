import { create } from 'zustand';
import { db, doc, onSnapshot, setDoc, serverTimestamp } from '../config/firebase';
import { DEFAULT_HELPER_STAGE_RULES, normalizePhone } from '../utils/helperEligibility';

export type HelperStageKey =
  | 'tagging'
  | 'getting_washed'
  | 'getting_dried'
  | 'getting_ironed'
  | 'packaging';

export type HelperStageRuleMap = Record<HelperStageKey, boolean>;
export type HelperAssignmentRules = Record<string, HelperStageRuleMap>;

export const HELPER_STAGE_KEYS: HelperStageKey[] = [
  'tagging',
  'getting_washed',
  'getting_dried',
  'getting_ironed',
  'packaging',
];

interface HelperRulesState {
  rules: HelperAssignmentRules;
  loaded: boolean;
  subscribe: () => void;
  unsubscribe: () => void;
  toggleHelperStageRule: (phone: string, stage: HelperStageKey, enabled: boolean) => Promise<void>;
}

let unsub: (() => void) | null = null;

function parseRulesDoc(data: Record<string, any> | undefined): HelperAssignmentRules {
  if (!data || typeof data !== 'object') return {};
  const parsed: HelperAssignmentRules = {};

  for (const [key, val] of Object.entries(data)) {
    if (key === 'updatedAt' || key === 'updatedBy') continue;
    if (!val || typeof val !== 'object' || Array.isArray(val)) continue;

    const defaults = DEFAULT_HELPER_STAGE_RULES(key);
    const ruleMap: HelperStageRuleMap = {
      tagging: typeof val.tagging === 'boolean' ? val.tagging : defaults.tagging,
      getting_washed: typeof val.getting_washed === 'boolean' ? val.getting_washed : defaults.getting_washed,
      getting_dried: typeof val.getting_dried === 'boolean' ? val.getting_dried : defaults.getting_dried,
      getting_ironed: typeof val.getting_ironed === 'boolean' ? val.getting_ironed : defaults.getting_ironed,
      packaging: typeof val.packaging === 'boolean' ? val.packaging : defaults.packaging,
    };
    parsed[key] = ruleMap;
  }

  return parsed;
}

export const useHelperRulesStore = create<HelperRulesState>((set, get) => ({
  rules: {},
  loaded: false,

  subscribe: () => {
    if (unsub) return;
    const ref = doc(db, 'config', 'helperAssignmentRules');
    unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          set({ rules: parseRulesDoc(snap.data() as Record<string, any>), loaded: true });
        } else {
          set({ rules: {}, loaded: true });
        }
      },
      (err) => {
        console.error('[helperRulesStore] Failed to listen to helperAssignmentRules:', err);
        set({ loaded: true });
      }
    );
  },

  unsubscribe: () => {
    unsub?.();
    unsub = null;
  },

  toggleHelperStageRule: async (phone: string, stage: HelperStageKey, enabled: boolean) => {
    const normPhone = normalizePhone(phone);
    if (!normPhone) return;

    const currentRules = get().rules;
    const digits10 = normPhone.replace(/\D/g, '').slice(-10);
    const existing = currentRules[normPhone] || (digits10 ? currentRules[digits10] : undefined) || currentRules[phone];
    const defaults = DEFAULT_HELPER_STAGE_RULES(normPhone);
    const nextRule: HelperStageRuleMap = {
      ...defaults,
      ...(existing || {}),
      [stage]: enabled,
    };

    // Optimistic update
    set((state) => ({
      rules: {
        ...state.rules,
        [normPhone]: nextRule,
      },
    }));

    const ref = doc(db, 'config', 'helperAssignmentRules');
    await setDoc(
      ref,
      {
        [normPhone]: nextRule,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  },
}));
