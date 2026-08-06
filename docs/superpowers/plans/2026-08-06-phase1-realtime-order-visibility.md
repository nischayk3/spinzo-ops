# SpinZo Ops — Phase 1: Realtime Order Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real order placed in the production customer app appears live in the SpinZo Ops intake queue and the supervisor floor board, with zero production writes from the ops client.

**Architecture:** This is an additive, read-only layer on the existing production Firebase project (`spin-it-a135a`). Production `firestore.rules` gains a read-only `isOpsStaff()` check (no write-rule changes). A `config/opsStaff` doc holds the roster (phone → role). The ops app (Expo SDK 57, web target for Phase 1) signs in staff via phone OTP, resolves role from `config/opsStaff`, listens to `collectionGroup('orders')` (client-side filtered to active statuses, since the `orders.status` collection-group index is not deployed), and shows an intake queue + a supervisor floor board. **No cloud functions are needed in Phase 1** (they arrive in Phase 2 for dispatch). The boilerplate's `dualWrite` pipeline is removed because it writes directly to production — a safety violation.

**Tech Stack:** Expo SDK 57 (web), React Navigation, Zustand, Firebase web SDK 12 (auth + firestore), vitest (pure-logic unit tests), Firebase console (seeding) + firebase-tools (rules deploy).

**Repos:** ops repo = `/Users/nischaykumar/Desktop/Developer/spinzo-ops.nosync`. production repo = `/Users/nischaykumar/Desktop/Developer/Livfresh.nosync`.

---

## File Structure

**Ops repo — new files:**
- `vitest.config.ts` — vitest config (node env, `src/**/*.test.ts`)
- `src/utils/orderFeed.ts` — pure feed/filter/sort helpers (no RN deps)
- `src/utils/opsRole.ts` — pure phone normalization + roster role resolution
- `src/utils/__tests__/orderFeed.test.ts`
- `src/utils/__tests__/opsRole.test.ts`
- `src/store/orderFeedStore.ts` — read-only realtime `collectionGroup('orders')` store
- `src/screens/Queue/IntakeScreen.tsx` — staff intake queue (all staff)
- `src/screens/Queue/FloorBoardScreen.tsx` — supervisor live board (supervisor only)
- `src/screens/Auth/NotInRosterScreen.tsx` — logged-in but no roster role

**Ops repo — modified:**
- `package.json` — add `vitest`, `@types/node`, `test` script
- `src/store/authStore.ts` — resolve role from `config/opsStaff` instead of hardcoding `helper-a`
- `src/navigation/RootNavigator.tsx` — roster-gated stack; Intake/Attendance/FloorBoard tabs; drop the dualWrite pipeline screens

**Ops repo — deleted (dualWrite safety removal, rebuilt in Phase 4):**
- `src/store/orderStore.ts`, `src/screens/Queue/QueueScreen.tsx`, `src/screens/Queue/OrderDetailScreen.tsx`, `src/screens/Auth/SelectRoleScreen.tsx`
- `src/services/firebase.ts`, `src/services/firebase.native.ts`, `src/services/firebaseConfig.ts` (orphaned; `.native.ts` requires uninstalled `@react-native-firebase/*`)

**Production repo — modified:**
- `firestore.rules` — add `isOpsStaff()` + read-only access for ops staff to `orders` CG and `users/{userId}`; make `config/opsStaff` readable by authenticated users. Write rules unchanged.

---

### Task 1: Add vitest + `orderFeed` pure helpers (TDD)

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/utils/orderFeed.ts`
- Create: `src/utils/__tests__/orderFeed.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/utils/__tests__/orderFeed.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  ACTIVE_STATUSES,
  INTAKE_STATUSES,
  isIntakeOrder,
  filterIntakeOrders,
  filterActiveOrders,
  sortNewestFirst,
  FeedOrder,
} from '../orderFeed';

const makeOrder = (overrides: Partial<FeedOrder>): FeedOrder => ({
  id: '1',
  userId: 'u1',
  status: 'placed',
  ...overrides,
});

describe('orderFeed', () => {
  it('defines intake = placed + confirmed', () => {
    expect(INTAKE_STATUSES).toEqual(['placed', 'confirmed']);
  });

  it('includes all active statuses in ACTIVE_STATUSES', () => {
    expect(ACTIVE_STATUSES).toEqual([
      'placed', 'confirmed', 'pickup_completed', 'processing', 'ready', 'out_for_delivery',
    ]);
  });

  it('isIntakeOrder is true only for placed/confirmed', () => {
    expect(isIntakeOrder(makeOrder({ status: 'placed' }))).toBe(true);
    expect(isIntakeOrder(makeOrder({ status: 'confirmed' }))).toBe(true);
    expect(isIntakeOrder(makeOrder({ status: 'processing' }))).toBe(false);
    expect(isIntakeOrder(makeOrder({ status: 'delivered' }))).toBe(false);
  });

  it('filterIntakeOrders keeps only placed/confirmed', () => {
    const orders = [
      makeOrder({ id: 'a', status: 'placed' }),
      makeOrder({ id: 'b', status: 'confirmed' }),
      makeOrder({ id: 'c', status: 'ready' }),
      makeOrder({ id: 'd', status: 'delivered' }),
    ];
    expect(filterIntakeOrders(orders).map(o => o.id)).toEqual(['a', 'b']);
  });

  it('filterActiveOrders drops delivered and cancelled', () => {
    const orders = [
      makeOrder({ id: 'a', status: 'placed' }),
      makeOrder({ id: 'b', status: 'delivered' }),
      makeOrder({ id: 'c', status: 'cancelled' }),
      makeOrder({ id: 'd', status: 'out_for_delivery' }),
    ];
    expect(filterActiveOrders(orders).map(o => o.id)).toEqual(['a', 'd']);
  });

  it('sortNewestFirst orders by createdAt desc, handling Timestamp-like objects', () => {
    const ts = (seconds: number) => ({ seconds, nanoseconds: 0, toDate: () => new Date(seconds * 1000) });
    const orders = [
      makeOrder({ id: 'old', createdAt: ts(1000) }),
      makeOrder({ id: 'new', createdAt: ts(3000) }),
      makeOrder({ id: 'mid', createdAt: ts(2000) }),
    ];
    expect(sortNewestFirst(orders).map(o => o.id)).toEqual(['new', 'mid', 'old']);
  });
});
```

- [ ] **Step 2: Add vitest config + devDeps**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
```

Modify `package.json`:

```json
  "scripts": {
    "start": "expo start",
    "android": "expo start --android",
    "ios": "expo start --ios",
    "web": "expo start --web",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@babel/core": "^7.29.7",
    "@types/node": "^22.0.0",
    "@types/react": "~19.2.2",
    "babel-preset-expo": "^57.0.5",
    "react-native-css-interop": "^0.2.2",
    "tailwindcss": "^3.4.19",
    "typescript": "~6.0.3",
    "vitest": "^2.1.9"
  },
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm install && npm test`
Expected: FAIL — `orderFeed` module does not exist (Cannot find module).

- [ ] **Step 4: Implement `src/utils/orderFeed.ts`**

```ts
import { OrderStatus } from '../types';

export const ACTIVE_STATUSES: OrderStatus[] = [
  'placed',
  'confirmed',
  'pickup_completed',
  'processing',
  'ready',
  'out_for_delivery',
];

export const INTAKE_STATUSES: OrderStatus[] = ['placed', 'confirmed'];

export interface FeedOrder {
  id: string;
  userId: string;
  vendorId?: string;
  status: OrderStatus;
  customerName?: string;
  customerPhone?: string;
  pickupDetails?: {
    type?: string;
    scheduledDate?: string;
    scheduledTime?: string;
    isInstant?: boolean;
  };
  items?: Array<{
    serviceName?: string;
    serviceType?: string;
    quantity?: number;
    totalPrice?: number;
  }>;
  tokenNumber?: string;
  pickupOTP?: string;
  address?: string;
  createdAt?: any;
}

export function isIntakeOrder(order: FeedOrder): boolean {
  return INTAKE_STATUSES.includes(order.status);
}

export function filterIntakeOrders(orders: FeedOrder[]): FeedOrder[] {
  return orders.filter(isIntakeOrder);
}

export function filterActiveOrders(orders: FeedOrder[]): FeedOrder[] {
  return orders.filter(o => ACTIVE_STATUSES.includes(o.status));
}

export function sortNewestFirst(orders: FeedOrder[]): FeedOrder[] {
  const getMs = (v: any): number => {
    if (!v) return 0;
    if (typeof v.toDate === 'function') return v.toDate().getTime();
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    return new Date(v).getTime() || 0;
  };
  return [...orders].sort((a, b) => getMs(b.createdAt) - getMs(a.createdAt));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/utils/orderFeed.ts src/utils/__tests__/orderFeed.test.ts
git commit -m "test: add orderFeed helpers + vitest setup (Phase 1)"
```

---

### Task 2: Add `opsRole` pure helpers (TDD)

**Files:**
- Create: `src/utils/opsRole.ts`
- Create: `src/utils/__tests__/opsRole.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/utils/__tests__/opsRole.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizePhone, resolveRoleFromRoster, OpsStaffRoster } from '../opsRole';

describe('opsRole', () => {
  it('normalizes 10-digit to +91', () => {
    expect(normalizePhone('9661802634')).toBe('+919661802634');
  });

  it('normalizes +91-prefixed and spaces', () => {
    expect(normalizePhone('+91 96618 02634')).toBe('+919661802634');
  });

  it('resolves role from roster by normalized phone', () => {
    const roster: OpsStaffRoster = { phones: { '+919661802634': 'supervisor', '+919852030638': 'rider' } };
    expect(resolveRoleFromRoster('9661802634', roster)).toBe('supervisor');
  });

  it('returns null for unknown phone or missing roster', () => {
    const roster: OpsStaffRoster = { phones: { '+919661802634': 'supervisor' } };
    expect(resolveRoleFromRoster('9852030638', roster)).toBeNull();
    expect(resolveRoleFromRoster('9661802634', null)).toBeNull();
    expect(resolveRoleFromRoster(null, roster)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `opsRole` module not found.

- [ ] **Step 3: Implement `src/utils/opsRole.ts`**

```ts
import { ShiftRole } from '../types';

export interface OpsStaffRoster {
  phones: Record<string, ShiftRole>;
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return phone;
}

export function resolveRoleFromRoster(
  phone: string | null,
  roster: OpsStaffRoster | null,
): ShiftRole | null {
  if (!phone || !roster?.phones) return null;
  return roster.phones[normalizePhone(phone)] ?? roster.phones[phone] ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (8 total).

- [ ] **Step 5: Commit**

```bash
git add src/utils/opsRole.ts src/utils/__tests__/opsRole.test.ts
git commit -m "test: add opsRole helpers (Phase 1)"
```

---

### Task 3: Create the read-only `orderFeedStore`

**Files:**
- Create: `src/store/orderFeedStore.ts`

- [ ] **Step 1: Implement the store**

Create `src/store/orderFeedStore.ts`:

```ts
import { create } from 'zustand';
import {
  collectionGroup,
  onSnapshot,
  query,
  QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { FeedOrder, sortNewestFirst } from '../utils/orderFeed';

interface OrderFeedState {
  orders: FeedOrder[];
  isLoading: boolean;
  error: string | null;
  initialize: () => void;
  reset: () => void;
}

const orderFromDoc = (d: QueryDocumentSnapshot): FeedOrder => {
  const data = d.data() as any;
  const userId = data.userId || (d.ref.parent?.parent as any)?.id || '';
  return {
    id: d.id,
    userId,
    vendorId: data.vendorId,
    status: data.status,
    customerName: data.customerName || data.userName,
    customerPhone: data.customerPhone || data.userPhone,
    pickupDetails: data.pickupDetails || data.pickup,
    items: data.items || [],
    tokenNumber: data.tokenNumber,
    pickupOTP: data.pickupOTP,
    address: data.address,
    createdAt: data.createdAt,
  };
};

let unsubscribe: (() => void) | null = null;

export const useOrderFeedStore = create<OrderFeedState>((set, get) => ({
  orders: [],
  isLoading: false,
  error: null,

  initialize: () => {
    if (unsubscribe) unsubscribe();

    set({ isLoading: true, error: null });
    const q = query(collectionGroup(db, 'orders'));

    unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const map = new Map<string, FeedOrder>();
        snapshot.forEach((d) => map.set(d.id, orderFromDoc(d)));
        set({ orders: sortNewestFirst(Array.from(map.values())), isLoading: false });
      },
      (err) => {
        console.error('[orderFeed] snapshot error:', err);
        set({ isLoading: false, error: String(err) });
      },
    );
  },

  reset: () => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    set({ orders: [], isLoading: false, error: null });
  },
}));
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors in the new file).

- [ ] **Step 3: Commit**

```bash
git add src/store/orderFeedStore.ts
git commit -m "feat: read-only realtime order feed store (Phase 1)"
```

---

### Task 4: Roster-driven auth in `authStore`

**Files:**
- Modify: `src/store/authStore.ts`
- Modify: `src/types/index.ts`

- [ ] **Step 0: Align `ShiftRole` with the ops roster**

Modify `src/types/index.ts` so the roster roles match (the old `helper-a/b/c` are replaced by the ops roles):

```ts
// ─── Auth Roles ───
export type ShiftRole = 'rider' | 'helper' | 'iron' | 'supervisor';
```

- [ ] **Step 1: Add roster role resolution**

Modify `src/store/authStore.ts`:

1. Import the roster helper (add near the top, after existing imports):

```ts
import { getDoc, doc } from 'firebase/firestore'; // already imported
import { resolveRoleFromRoster, OpsStaffRoster } from '../utils/opsRole';
```

2. Add a module-level helper (place above `export const useAuthStore`):

```ts
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
```

3. In `initializeAuth`'s `onAuthStateChanged`, replace the hardcoded `role: 'helper-a'` block so it resolves the role asynchronously. Replace the current `if (firebaseUser)` branch body with:

```ts
if (firebaseUser) {
  const phone = firebaseUser.phoneNumber || '';
  const role = await fetchRosterRole(phone);
  set({
    user: {
      id: firebaseUser.uid,
      phone,
      name: 'Admin User', // placeholder; full profile lands in Phase 2 roster
      role: role || 'helper-a',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    isLoggedIn: true,
    activeRole: role,
    error: null,
  });
} else {
  set({ user: null, isLoggedIn: false, activeRole: null });
}
```

4. In `verifyOTP`, after `const user = result.user;` and before `set({...})`, resolve the role:

```ts
const role = await fetchRosterRole(user.phoneNumber || '');
```

Then in the `set` call inside `verifyOTP`, change `role: 'helper-a'` to `role: role || 'helper-a'` and add `activeRole: role`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/store/authStore.ts
git commit -m "feat: resolve staff role from ops roster on login (Phase 1)"
```

---

### Task 5: Create the Intake screen

**Files:**
- Create: `src/screens/Queue/IntakeScreen.tsx`

- [ ] **Step 1: Implement the screen**

Create `src/screens/Queue/IntakeScreen.tsx`:

```tsx
import React, { useEffect } from 'react';
import { View, Text, FlatList, SafeAreaView, ActivityIndicator } from 'react-native';
import { Clock } from 'lucide-react-native';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { filterIntakeOrders, FeedOrder } from '../../utils/orderFeed';

const timeAgo = (v: any): string => {
  if (!v) return '';
  let ms: number;
  if (typeof v.toDate === 'function') ms = v.toDate().getTime();
  else if (typeof v.seconds === 'number') ms = v.seconds * 1000;
  else ms = new Date(v).getTime();
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
};

const slotLabel = (o: FeedOrder): string => {
  const p = o.pickupDetails;
  if (!p) return '—';
  if (p.isInstant) return 'Instant pickup';
  return `${p.scheduledDate || ''} ${p.scheduledTime || ''}`.trim() || 'Scheduled';
};

const serviceSummary = (o: FeedOrder): string =>
  (o.items || []).map(i => i.serviceName || i.serviceType).filter(Boolean).join(', ') || 'Unknown';

export function IntakeScreen() {
  const { orders, isLoading, initialize } = useOrderFeedStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  const intake = filterIntakeOrders(orders);

  if (isLoading && intake.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-bgDark items-center justify-center">
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text className="text-textSecondary mt-4 font-bold">Watching for new orders…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bgDark">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-2xl font-bold text-textPrimary">New Orders</Text>
        <Text className="text-textSecondary">Orders waiting for pickup · {intake.length}</Text>
      </View>
      <FlatList
        data={intake}
        keyExtractor={o => o.id}
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={
          <View className="items-center justify-center mt-20">
            <Text className="text-textSecondary text-lg font-bold">No new orders</Text>
            <Text className="text-textMuted text-center mt-2">New orders appear here instantly.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View className="bg-bgSurface rounded-xl p-4 mb-3 border border-bgSurfaceLight">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-textPrimary font-bold text-lg">
                #{item.id.slice(-6).toUpperCase()}
              </Text>
              <View className="flex-row items-center">
                <Clock size={13} color="#94A3B8" />
                <Text className="text-textMuted text-xs ml-1">{timeAgo(item.createdAt)}</Text>
              </View>
            </View>
            <Text className="text-textSecondary text-sm mb-1">
              {item.customerName || 'Unknown customer'}
            </Text>
            <Text className="text-textMuted text-xs mb-3">{serviceSummary(item)}</Text>
            <View className="bg-bgDark px-2 py-1 rounded-md self-start">
              <Text className="text-primary text-xs font-bold">{slotLabel(item)}</Text>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/screens/Queue/IntakeScreen.tsx
git commit -m "feat: intake queue screen (Phase 1)"
```

---

### Task 6: Create the supervisor Floor Board screen

**Files:**
- Create: `src/screens/Queue/FloorBoardScreen.tsx`

- [ ] **Step 1: Implement the screen**

Create `src/screens/Queue/FloorBoardScreen.tsx`:

```tsx
import React, { useEffect, useMemo } from 'react';
import { View, Text, FlatList, SafeAreaView, ActivityIndicator } from 'react-native';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { filterActiveOrders, ACTIVE_STATUSES, FeedOrder } from '../../utils/orderFeed';

const STATUS_LABEL: Record<string, string> = {
  placed: 'New',
  confirmed: 'Confirmed',
  pickup_completed: 'Picked Up',
  processing: 'Processing',
  ready: 'Ready',
  out_for_delivery: 'Out for Delivery',
};

const orderSummary = (o: FeedOrder): string =>
  (o.items || []).map(i => i.serviceName || i.serviceType).filter(Boolean).join(', ') || 'Unknown';

export function FloorBoardScreen() {
  const { orders, isLoading, initialize } = useOrderFeedStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  const active = useMemo(() => filterActiveOrders(orders), [orders]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of ACTIVE_STATUSES) c[s] = 0;
    for (const o of active) c[o.status] = (c[o.status] || 0) + 1;
    return c;
  }, [active]);

  if (isLoading && active.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-bgDark items-center justify-center">
        <ActivityIndicator size="large" color="#3B82F6" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bgDark">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-2xl font-bold text-textPrimary">Floor Board</Text>
        <Text className="text-textSecondary">Live order board · {active.length} active</Text>
      </View>
      <View className="flex-row flex-wrap px-4 mb-2">
        {ACTIVE_STATUSES.map(s => (
          <View key={s} className="bg-bgSurface rounded-full px-3 py-1 mr-2 mb-2 border border-bgSurfaceLight">
            <Text className="text-textSecondary text-xs">
              {STATUS_LABEL[s] || s}: <Text className="text-textPrimary font-bold">{counts[s] || 0}</Text>
            </Text>
          </View>
        ))}
      </View>
      <FlatList
        data={active}
        keyExtractor={o => o.id}
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => (
          <View className="bg-bgSurface rounded-xl p-4 mb-3 border border-bgSurfaceLight">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-textPrimary font-bold text-lg">
                #{item.id.slice(-6).toUpperCase()}
              </Text>
              <Text className="text-primary font-bold text-xs">
                {STATUS_LABEL[item.status] || item.status}
              </Text>
            </View>
            <Text className="text-textSecondary text-sm mb-1">
              {item.customerName || 'Unknown customer'}
            </Text>
            <Text className="text-textMuted text-xs">{orderSummary(item)}</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/screens/Queue/FloorBoardScreen.tsx
git commit -m "feat: supervisor floor board screen (Phase 1)"
```

---

### Task 7: Create the Not-in-Roster screen

**Files:**
- Create: `src/screens/Auth/NotInRosterScreen.tsx`

- [ ] **Step 1: Implement the screen**

Create `src/screens/Auth/NotInRosterScreen.tsx`:

```tsx
import React from 'react';
import { View, Text, TouchableOpacity, SafeAreaView } from 'react-native';
import { useAuthStore } from '../../store/authStore';

export function NotInRosterScreen() {
  const logout = useAuthStore(s => s.logout);
  return (
    <SafeAreaView className="flex-1 bg-bgDark items-center justify-center px-6">
      <Text className="text-2xl font-bold text-textPrimary mb-2">Not in the roster</Text>
      <Text className="text-center text-textSecondary mb-8">
        This phone number isn't registered as SpinZo Ops staff. Ask the supervisor to add it.
      </Text>
      <TouchableOpacity
        onPress={logout}
        className="w-full bg-primary h-14 rounded-xl items-center justify-center"
      >
        <Text className="text-white text-lg font-bold">Log out</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add src/screens/Auth/NotInRosterScreen.tsx
git commit -m "feat: not-in-roster gate screen (Phase 1)"
```

---

### Task 8: Rewire navigation; remove the dualWrite pipeline

**Files:**
- Modify: `src/navigation/RootNavigator.tsx`
- Delete: `src/store/orderStore.ts`
- Delete: `src/screens/Queue/QueueScreen.tsx`
- Delete: `src/screens/Queue/OrderDetailScreen.tsx`
- Delete: `src/screens/Auth/SelectRoleScreen.tsx`

- [ ] **Step 1: Rewrite `RootNavigator.tsx`**

Replace the whole file with:

```tsx
import React, { useState, useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuthStore } from '../store/authStore';
import { LoginScreen } from '../screens/Auth/LoginScreen';
import { NotInRosterScreen } from '../screens/Auth/NotInRosterScreen';
import { IntakeScreen } from '../screens/Queue/IntakeScreen';
import { FloorBoardScreen } from '../screens/Queue/FloorBoardScreen';
import { Home, ClipboardList, Settings } from 'lucide-react-native';
import { View, Text, ActivityIndicator } from 'react-native';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const Placeholder = ({ name }: { name: string }) => (
  <View className="flex-1 items-center justify-center bg-bgDark">
    <Text className="text-xl font-bold text-textPrimary">{name}</Text>
    <Text className="text-textSecondary mt-2">Coming soon…</Text>
  </View>
);

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};

const AppTabs = () => {
  const activeRole = useAuthStore(state => state.activeRole);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#1E293B',
          borderTopColor: '#334155',
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: '#3B82F6',
        tabBarInactiveTintColor: '#64748B',
      }}
    >
      <Tab.Screen
        name="Intake"
        options={{ tabBarIcon: ({ color }) => <Home color={color} size={24} /> }}
      >
        {() => <IntakeScreen />}
      </Tab.Screen>

      {activeRole === 'supervisor' && (
        <Tab.Screen
          name="FloorBoard"
          options={{ tabBarIcon: ({ color }) => <ClipboardList color={color} size={24} /> }}
        >
          {() => <FloorBoardScreen />}
        </Tab.Screen>
      )}

      <Tab.Screen
        name="Settings"
        options={{ tabBarIcon: ({ color }) => <Settings color={color} size={24} /> }}
      >
        {() => <Placeholder name="Settings" />}
      </Tab.Screen>
    </Tab.Navigator>
  );
};

export function RootNavigator() {
  const { isLoggedIn, activeRole, initializeAuth } = useAuthStore();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    initializeAuth();
    const timer = setTimeout(() => setIsReady(true), 500);
    return () => clearTimeout(timer);
  }, [initializeAuth]);

  if (!isReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!isLoggedIn ? (
        <Stack.Screen name="Login" component={LoginScreen} />
      ) : !activeRole ? (
        <Stack.Screen name="NotInRoster" component={NotInRosterScreen} />
      ) : (
        <Stack.Screen name="Main" component={AppTabs} />
      )}
    </Stack.Navigator>
  );
}
```

- [ ] **Step 2: Delete the dualWrite pipeline files**

```bash
git rm src/store/orderStore.ts src/screens/Queue/QueueScreen.tsx src/screens/Queue/OrderDetailScreen.tsx src/screens/Auth/SelectRoleScreen.tsx
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no dangling imports remain — only the screens above imported `orderStore`).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: roster-gated navigation; remove dualWrite pipeline (Phase 1)"
```

---

### Task 9: Remove orphaned Firebase service files

**Files:**
- Delete: `src/services/firebase.ts`, `src/services/firebase.native.ts`, `src/services/firebaseConfig.ts`

- [ ] **Step 1: Verify nothing imports them**

Run: `grep -rn "services/firebase" src App.tsx index.ts`
Expected: only the files themselves; no imports elsewhere.

- [ ] **Step 2: Delete + commit**

```bash
git rm src/services/firebase.ts src/services/firebase.native.ts src/services/firebaseConfig.ts
git commit -m "chore: remove orphaned firebase service files (Phase 1)"
```

---

### Task 10: Production rules — add read-only `isOpsStaff`

**Repo:** `/Users/nischaykumar/Desktop/Developer/Livfresh.nosync`

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: Back up current rules in git**

```bash
git status --porcelain
```
Expected: clean (or note any uncommitted changes). If clean, the committed `firestore.rules` is your backup; create a tag for extra safety:

```bash
git tag rules-before-ops-read-only
```

- [ ] **Step 2: Add the `isOpsStaff()` helper**

Insert after the `isAdmin()` function (after line 23) in `firestore.rules`:

```
    // Helper function to check if a phone number is registered ops staff
    function isOpsStaff() {
      return isAuthenticated() &&
        'phone_number' in request.auth.token &&
        request.auth.token.phone_number != null &&
        request.auth.token.phone_number in get(/databases/$(database)/documents/config/opsStaff).data.phones;
    }
```

- [ ] **Step 3: Grant ops staff read-only access to orders + users, and config read**

Replace the orders collection-group rule (line 28) with:

```
      allow read: if isAdmin() || isOpsStaff() || (isAuthenticated() && (resource == null || resource.data.userId == request.auth.uid));
      allow write: if isAdmin() || (isAuthenticated() && (resource == null || resource.data.userId == request.auth.uid));
```

Replace the `config/{configId}` read rule (line 40) with:

```
      allow read: if configId == 'adminPhones' || configId == 'serviceAvailability' || configId == 'opsStaff' || isAdmin() || isAuthenticated();
```

Replace the `users/{userId}` rule (lines 44-46) with:

```
    match /users/{userId} {
      allow create: if isAuthenticated() && request.auth.uid == userId;
      allow read: if isAdmin() || isOpsStaff() || isOwner(userId);
      allow update: if isAdmin() || isOwner(userId);
```

(Sub-rules for `addresses`, `orders`, `subscriptions`, `notifications` under `users/{userId}` are unchanged.)

- [ ] **Step 4: Verify no write rules changed**

Run: `git diff firestore.rules`
Expected: only the three additions above; no `allow write:` line changed.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules
git commit -m "security: grant ops staff read-only order/user access (isOpsStaff)"
```

---

### Task 11: Deploy rules + seed `config/opsStaff`

**Repo:** `/Users/nischaykumar/Desktop/Developer/Livfresh.nosync`

- [ ] **Step 1: Install firebase-tools (one-time)**

```bash
npm install -g firebase-tools
```
Verify: `firebase --version`

- [ ] **Step 2: Deploy rules to production**

```bash
firebase deploy --only firestore:rules --project spin-it-a135a
```
Expected: `Deploy complete!`

- [ ] **Step 3: Seed `config/opsStaff` via Firebase console**

Open the Firebase console → Firestore Database → document `config/opsStaff` and create it with the exact shape:

```
config/opsStaff {
  phones: {
    "<supervisor phone with +91, e.g. +919661802634>": "supervisor",
    "<rider phone>": "rider",
    "<helper phone>": "helper",
    "<iron phone>": "iron"
  },
  updatedAt: <server timestamp>
}
```

For each staff member, use their real phone with the `+91` prefix (10-digit after `+91`). The app's `normalizePhone` matches exactly this form.

- [ ] **Step 4: Smoke-test the rules**

Open a private/incognito browser to the ops app (once Phase 1 app is running) and:
- Log in with a **roster** phone → Intake screen loads orders (read allowed).
- Log in with a **non-roster** phone → Not-in-roster screen (read of `config/opsStaff` allowed but role null).
- In the Firebase console, verify a non-authenticated `curl`-style read of `users/{someoneElse}` is still denied (no rule change there for anon).

---

### Task 12: End-to-end verification with a real order

- [ ] **Step 1: Start the ops app on web**

In the ops repo:

```bash
npm run web
```
Expected: app loads, login with a roster phone shows the Intake screen.

- [ ] **Step 2: Place a real order**

In the production customer app (or the Netlify-hosted web customer app), place a real order with an item and a pickup slot. Expected: the order is created with `status: 'placed'`.

- [ ] **Step 3: Confirm it appears**

Within a few seconds the order appears at the top of the ops app Intake screen (newest first) showing `#<last6>`, customer name, service summary, and pickup slot. The supervisor (roster role `supervisor`) sees it on the Floor Board under "New".

- [ ] **Step 4: Confirm no production writes from the ops app**

In the Firebase console, verify the ops app session only performed **reads** (the order doc is untouched by the ops client). The only writer of production data remains the production app.

- [ ] **Step 5: Commit any Phase 1 fixes**

If verification exposed bugs, fix them in new commits (do not amend).

---

## Self-Review Checklist

- **Spec coverage (Phase 1):** realtime visibility in ops app ✓ (Task 3-5); supervisor read-only board ✓ (Task 6); `isOpsStaff` read-only rule ✓ (Task 10-11); `config/opsStaff` roster ✓ (Task 11); staff onboarding ✓ (Task 4, 11). Cloud functions + alerts + dispatch correctly deferred to Phase 2 (not part of this plan).
- **Placeholder scan:** no "TBD/TODO"; all code is complete. The one manual dependency (real staff phones for `config/opsStaff`) is called out explicitly.
- **Type consistency:** `ShiftRole` from `src/types` is used by `opsRole`; `FeedOrder.status` is `OrderStatus`; the store and screens all use the same `FeedOrder` shape. `RootStackParamList` no longer references `OrderDetail`.
- **Known deliberate limitation:** the ops app is web-first for Phase 1 (native phone OTP + custom sounds need a dev build — Phase 2). The feed subscribes to all `collectionGroup('orders')` and filters client-side because the `orders.status` collection-group index is not deployed; adding that index is a Phase 2 optimization, not a Phase 1 blocker.
