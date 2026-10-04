# Order Sync, Token Display & Pickup Dispatch Control — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop stale order assignments to riders/helpers, surface per-segment token numbers to the supervisor, and give the supervisor manual control over pickup assignment.

**Architecture:** The order's `status` on `users/{uid}/orders/{id}` is the single source of truth. We extend the existing Firestore `onDocumentUpdated` trigger (`syncTaskFromOrder`) to react to `→ processing` and `→ ready` (currently it only handles cancelled/pickup_completed/delivered), guard the `onShiftCatchUp` reassign and helper-eligibility paths against non-pickup order states, add token rendering to supervisor screens, and extend the `supervisorActions` callable with pickup unassign/reassign.

**Tech Stack:** Firebase Cloud Functions v2 (Node + `firebase-admin`), React Native + Zustand + NativeWind (frontend), `node --test` (functions), vitest (`src/**/*.test.ts`).

---

## File map

- `ops/functions/dispatch.js` — pure helpers: `taskTransition`, `pickupGuard`, add `isAwaitingPickup`. Unit-testable.
- `ops/functions/index.js` — triggers (`syncTaskFromOrder`, `onShiftCatchUp`) + callables (`supervisorActions`). Add `deleteProcessDocs` helper, `cleanupProcess` handling, reassign guard, `unassignPickup` action, pickup create-if-missing.
- `src/utils/helperEligibility.ts` — add terminal-order-status filter.
- `src/utils/orderFeed.ts` — add `tokenNumber`/`tokens` to `CustomerOrder` + `customerIndex`.
- `src/screens/Supervisor/CustomerDetailScreen.tsx` — render token chips.
- `src/screens/Queue/FloorBoardScreen.tsx` — nav link to CustomerDetail.
- `src/screens/Supervisor/SupervisorDashboardScreen.tsx` — render token chips.
- `src/store/opsProcessStore.ts` — add `unassignPickup` method.
- `src/screens/Helper/OrderDetailScreen.tsx` — pickup unassign menu item.

---

## Task 1: Expand `taskTransition` + tests

**Files:**
- Modify: `ops/functions/dispatch.js:55-66`
- Create: `ops/functions/dispatch.test.js`

- [ ] **Step 1: Write the failing test**

Create `ops/functions/dispatch.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { taskTransition } = require('./dispatch');

test('taskTransition: processing closes the pickup task', () => {
  assert.deepStrictEqual(taskTransition('pickup_completed', 'processing'), { taskStatus: 'picked_up' });
  assert.deepStrictEqual(taskTransition('confirmed', 'processing'), { taskStatus: 'picked_up' });
});

test('taskTransition: ready cleans up process docs only', () => {
  assert.deepStrictEqual(taskTransition('processing', 'ready'), { cleanupProcess: true });
});

test('taskTransition: existing transitions unchanged', () => {
  assert.deepStrictEqual(taskTransition('placed', 'cancelled'), { taskStatus: 'cancelled', dropQueue: true });
  assert.deepStrictEqual(taskTransition('placed', 'pickup_completed'), { taskStatus: 'picked_up' });
  assert.deepStrictEqual(taskTransition('out_for_delivery', 'delivered'), { taskStatus: 'delivered', dropProcess: true });
  assert.strictEqual(taskTransition('ready', 'ready'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ops/functions && npm test`
Expected: FAIL (assertion on `processing`/`ready` cases — `taskTransition` returns `null` for them).

- [ ] **Step 3: Implement the new transitions**

In `ops/functions/dispatch.js`, replace the body of `taskTransition` (lines 55-66) with:

```js
function taskTransition(beforeStatus, afterStatus) {
  if (afterStatus === 'cancelled' && beforeStatus !== 'cancelled') {
    return { taskStatus: 'cancelled', dropQueue: true };
  }
  if (afterStatus === 'pickup_completed' && beforeStatus !== 'pickup_completed') {
    return { taskStatus: 'picked_up' };
  }
  if (afterStatus === 'processing' && beforeStatus !== 'processing') {
    return { taskStatus: 'picked_up' };
  }
  if (afterStatus === 'ready' && beforeStatus !== 'ready') {
    return { cleanupProcess: true };
  }
  if (afterStatus === 'delivered' && beforeStatus !== 'delivered') {
    return { taskStatus: 'delivered', dropProcess: true };
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ops/functions && npm test`
Expected: PASS (all 3 tests).

- [ ] **Step 5: Commit**

```bash
git add ops/functions/dispatch.js ops/functions/dispatch.test.js
git commit -m "feat(dispatch): handle processing/ready transitions in taskTransition"
```

---

## Task 2: Handle `cleanupProcess` in `syncTaskFromOrder` (+ DRY the process-delete)

**Files:**
- Modify: `ops/functions/index.js:419-511`

- [ ] **Step 1: Add a shared `deleteProcessDocs` helper**

Add this top-level function just above `exports.syncTaskFromOrder` (near line 417):

```js
async function deleteProcessDocs(orderId) {
  try {
    const processDocs = await db.collection('ops_process')
      .where('parentOrderId', '==', orderId).get();
    const batch = db.batch();
    processDocs.forEach((d) => batch.delete(d.ref));
    if (!processDocs.empty) await batch.commit();
  } catch (err) {
    console.error(`deleteProcessDocs(${orderId}) failed`, err);
  }
}
```

- [ ] **Step 2: Replace the two inline process-delete blocks with calls**

In `syncTaskFromOrder`, replace the block at lines 474-483 (inside the `trans.dropQueue` branch):

```js
    // Also clean up any ops_process docs for this order.
    try {
      const processDocs = await db.collection('ops_process')
        .where('parentOrderId', '==', orderId).get();
      const batch = db.batch();
      processDocs.forEach((d) => batch.delete(d.ref));
      if (!processDocs.empty) await batch.commit();
    } catch (err) {
      console.error(`syncTaskFromOrder: process cleanup failed for ${orderId}`, err);
    }
```

with:

```js
    // Also clean up any ops_process docs for this order.
    await deleteProcessDocs(orderId);
```

And replace the block at lines 501-509 (inside the `trans.dropProcess` branch):

```js
    try {
      const processDocs = await db.collection('ops_process')
        .where('parentOrderId', '==', orderId).get();
      const batch = db.batch();
      processDocs.forEach((d) => batch.delete(d.ref));
      if (!processDocs.empty) await batch.commit();
    } catch (err) {
      console.error(`syncTaskFromOrder: process cleanup failed for ${orderId}`, err);
    }
```

with:

```js
    await deleteProcessDocs(orderId);
```

- [ ] **Step 3: Add the `cleanupProcess` branch**

After the `trans.dropProcess` block (after line 510, before the closing `});` at 511), add:

```js
  if (trans.cleanupProcess) {
    // Order became 'ready': remove any stuck ops_process docs so helpers stop
    // being offered tagging/processing steps for an already-finished order.
    // Do NOT touch the delivery task — syncDeliveryTask creates it as 'pending'.
    await deleteProcessDocs(orderId);
  }
```

- [ ] **Step 4: Type/lint sanity check**

No JS compiler step exists for functions. Review the diff visually (`git diff`) to confirm no dangling braces and that `deleteProcessDocs` is referenced before definition is fine (it's a hoisted function declaration).

- [ ] **Step 5: Commit**

```bash
git add ops/functions/index.js
git commit -m "feat(sync): clean up stuck ops_process docs on ->ready"
```

---

## Task 3: Guard `onShiftCatchUp` reassign against non-pickup orders

**Files:**
- Modify: `ops/functions/dispatch.js` (add `isAwaitingPickup`)
- Modify: `ops/functions/index.js:125-168`

- [ ] **Step 1: Add `isAwaitingPickup` to dispatch.js**

Add above `taskTransition` (near line 49), and export it in `module.exports`:

```js
function isAwaitingPickup(status) {
  return !status || status === 'placed' || status === 'confirmed';
}
```

Update the `module.exports` line (line 219) to include `isAwaitingPickup`:

```js
module.exports = { pickRider, normalizePhone, pickupGuard, taskTransition, isAwaitingPickup, getProcessingSteps, nextStep, opsStepsForOrder, isProductionStep, firstProductionStep, parseGarmentQr, generateLabels, stepsForServiceType, splitOrderIntoServices, SERVICE_LABELS };
```

- [ ] **Step 2: Add a unit test for `isAwaitingPickup`**

Append to `ops/functions/dispatch.test.js`:

```js
const { isAwaitingPickup } = require('./dispatch');

test('isAwaitingPickup: true for placed/confirmed/unknown, false otherwise', () => {
  assert.strictEqual(isAwaitingPickup('placed'), true);
  assert.strictEqual(isAwaitingPickup('confirmed'), true);
  assert.strictEqual(isAwaitingPickup(undefined), true);
  assert.strictEqual(isAwaitingPickup('pickup_completed'), false);
  assert.strictEqual(isAwaitingPickup('ready'), false);
});
```

- [ ] **Step 3: Update the import in index.js**

At the top import (line 5), add `isAwaitingPickup` to the destructured require:

```js
const { pickRider, pickupGuard, normalizePhone, isAwaitingPickup, taskTransition, opsStepsForOrder, isProductionStep, firstProductionStep, parseGarmentQr, generateLabels, stepsForServiceType, splitOrderIntoServices, SERVICE_LABELS } = require('./dispatch');
```

- [ ] **Step 4: Add the guard to the reassign branch**

In `onShiftCatchUp`, inside the `for (const taskDoc of taskQuery.docs)` loop (lines 126-143), insert the guard after the existing assignee-onShift check (after line 133) and before the `db.doc(...).update` at line 136:

```js
    // ⚠️ STATE SYNC: don't re-point a pickup whose order has already progressed
    // past placed/confirmed (already picked up, processing, ready, …). Without
    // this, stale tasks are re-assigned to the newly on-shift rider.
    if (td.userId) {
      const orderSnap = await db.doc(`users/${td.userId}/orders/${taskDoc.id}`).get();
      if (orderSnap.exists && !isAwaitingPickup(orderSnap.data().status)) {
        await db.doc(`ops_tasks/${taskDoc.id}`).delete();
        continue;
      }
    }
```

- [ ] **Step 5: Use `isAwaitingPickup` in the parked-queue branch (DRY)**

Replace the inline status check at lines 159-167 (currently `if (st && st !== 'placed' && st !== 'confirmed')`):

```js
        if (orderSnap.exists) {
          const st = orderSnap.data().status;
          if (st && st !== 'placed' && st !== 'confirmed') {
            // Pickup already done or order progressed — drop the stale parked entry.
            await db.doc(`ops_queue/${orderId}`).delete();
            continue;
          }
        }
```

with:

```js
        if (orderSnap.exists && !isAwaitingPickup(orderSnap.data().status)) {
          // Pickup already done or order progressed — drop the stale parked entry.
          await db.doc(`ops_queue/${orderId}`).delete();
          continue;
        }
```

- [ ] **Step 6: Run functions tests**

Run: `cd ops/functions && npm test`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add ops/functions/dispatch.js ops/functions/dispatch.test.js ops/functions/index.js
git commit -m "feat(sync): don't reassign pickups whose order has progressed"
```

---

## Task 4: Helper eligibility — exclude terminal order states

**Files:**
- Modify: `src/utils/helperEligibility.ts:63-117, 172-180`
- Create: `src/utils/__tests__/helperEligibility.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/utils/__tests__/helperEligibility.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getTopEligibleTask } from '../helperEligibility';
import { OpsProcess } from '../opsProcess';

const makeProcess = (overrides: Partial<OpsProcess> = {}): OpsProcess => ({
  id: 'p1',
  orderId: 'o1',
  steps: ['tagging'],
  currentIndex: 0,
  status: 'tagging',
  stages: {},
  garments: { labels: [], registered: [] },
  ...overrides,
});

const resources = { washers: 5, dryers: 5, ironingStations: 5 };

describe('getTopEligibleTask', () => {
  it('returns null when the order is already ready (not cancelled)', () => {
    const processes = [makeProcess()];
    const orders = [{ id: 'o1', status: 'ready' }];
    expect(getTopEligibleTask(processes, orders, 'h1', 'helper', null, resources, true)).toBeNull();
  });

  it('returns a tagging task for a pickup_completed order', () => {
    const orders = [{ id: 'o1', status: 'pickup_completed', userId: 'u1', vendorId: 'v1' }];
    const result = getTopEligibleTask([], orders, 'h1', 'helper', null, resources, true);
    expect(result).not.toBeNull();
    expect(result!.orderId).toBe('o1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/helperEligibility.test.ts`
Expected: FAIL on the first test (a `ready` order still yields an eligible process).

- [ ] **Step 3: Add the terminal-status filter**

In `getTopEligibleTask`, add a helper above the function (near line 54):

```ts
function isOrderTerminal(status?: string): boolean {
  return status === 'cancelled' || status === 'ready' || status === 'out_for_delivery' || status === 'delivered';
}
```

Change the `eligible` filter (lines 172-174) from:

```ts
  const eligible = processes.filter(p => {
    const order = orders.find(o => o.id === p.orderId);
    if (order?.status === 'cancelled') return false;
```

to:

```ts
  const eligible = processes.filter(p => {
    const order = orders.find(o => o.id === p.orderId);
    if (isOrderTerminal(order?.status)) return false;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/helperEligibility.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/utils/helperEligibility.ts src/utils/__tests__/helperEligibility.test.ts
git commit -m "fix(helper): don't offer tasks for ready/delivered orders"
```

---

## Task 5: Tokens in the customer detail view

**Files:**
- Modify: `src/utils/orderFeed.ts:310-353`
- Modify: `src/screens/Supervisor/CustomerDetailScreen.tsx:73-93`

- [ ] **Step 1: Add token fields to `CustomerOrder`**

In `src/utils/orderFeed.ts`, inside the `CustomerOrder` interface (around line 310-318), add two fields:

```ts
  tokenNumber?: string;
  tokens?: Record<string, string>;
```

- [ ] **Step 2: Copy tokens in `customerIndex`**

In `customerIndex` (lines 339-347), add the two fields to the pushed object:

```js
    c.orders.push({
      orderId: o.id,
      status: o.status,
      total: orderTotal(o),
      createdAt: o.createdAt,
      items: o.items,
      deliveryDate: o.deliveryDate,
      deliveryTime: o.deliveryTime,
      tokenNumber: o.tokenNumber,
      tokens: o.tokens,
    });
```

- [ ] **Step 3: Render token chips in `CustomerDetailScreen`**

In `CustomerDetailScreen.tsx`, first import `parseOrderTokens` (extend the import from `../../utils/orderFeed` on line 6):

```ts
import { customerIndex, CustomerSummary, parseOrderTokens } from '../../utils/orderFeed';
```

Then, inside the order-history `map` (lines 73-93), add token chips after the `₹{o.total}` line (line 85). Insert before the `{o.items && o.items.length > 0 && (` block:

```tsx
              {(() => {
                const chips = parseOrderTokens(o.tokens, o.tokenNumber, o.items);
                if (chips.length === 0) return null;
                return (
                  <View className="flex-row flex-wrap gap-1 mb-1">
                    {chips.map((c, i) => (
                      <View key={i} className="bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                        <Text className="text-amber-800 font-bold text-xs">
                          Token #{c.token}{c.serviceLabel ? ` · ${c.serviceLabel}` : ''}
                        </Text>
                      </View>
                    ))}
                  </View>
                );
              })()}
```

- [ ] **Step 4: Add a unit test for `customerIndex` token carry-through**

Create `src/utils/__tests__/customerIndex.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { customerIndex } from '../orderFeed';

describe('customerIndex', () => {
  it('carries token fields onto customer orders', () => {
    const orders = [{
      id: 'o1', status: 'ready', customerPhone: '9999999999', customerName: 'A',
      tokens: { wash_fold: '23' }, tokenNumber: '23', items: [{ serviceType: 'wash_fold' }],
      createdAt: new Date(), totalAmount: 100,
    }];
    const idx = customerIndex(orders as any);
    const c = idx.get('9999999999')!;
    expect(c.orders[0].tokens).toEqual({ wash_fold: '23' });
    expect(c.orders[0].tokenNumber).toBe('23');
  });
});
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/utils/__tests__/customerIndex.test.ts && npx tsc --noEmit`
Expected: PASS and no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/utils/orderFeed.ts src/screens/Supervisor/CustomerDetailScreen.tsx src/utils/__tests__/customerIndex.test.ts
git commit -m "feat(supervisor): show token numbers in customer detail"
```

---

## Task 6: Make CustomerDetail reachable from the floor board

**Files:**
- Modify: `src/screens/Queue/FloorBoardScreen.tsx`

- [ ] **Step 1: Add a "View customer" link**

In `FloorBoardScreen.tsx`, the order card already renders the customer name at lines 171-173. Wrap the customer name in a tappable that navigates to CustomerDetail (on stopPropagation-safe press). Replace the name `Text` (lines 171-173):

```tsx
                  <Text className="text-gray-900 font-medium text-base mb-1">
                    {item.customerName || 'Unknown Customer'}
                  </Text>
```

with:

```tsx
                  <TouchableOpacity onPress={() => item.customerPhone && navigation.navigate('CustomerDetail', { phone: item.customerPhone })}>
                    <Text className="text-gray-900 font-medium text-base mb-1">
                      {item.customerName || 'Unknown Customer'}
                    </Text>
                  </TouchableOpacity>
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (`CustomerDetail` already exists in `RootStackParamList` with `{ phone: string }`).

- [ ] **Step 3: Commit**

```bash
git add src/screens/Queue/FloorBoardScreen.tsx
git commit -m "feat(supervisor): link customer name to aggregate token view"
```

---

## Task 7: Token chips on the supervisor dashboard

**Files:**
- Modify: `src/screens/Supervisor/SupervisorDashboardScreen.tsx`

- [ ] **Step 1: Import `parseOrderTokens`**

Extend the import on line 8:

```ts
import { dayRevenue, orderTotal, parseOrderTokens } from '../../utils/orderFeed';
```

- [ ] **Step 2: Render chips in the inbound list cards**

In the inbound `map` (lines 153-167), after the `₹{orderTotal(o)}` line (line 166), add:

```tsx
                {(() => {
                  const chips = parseOrderTokens(o.tokens, o.tokenNumber, o.items);
                  if (chips.length === 0) return null;
                  return (
                    <View className="flex-row flex-wrap gap-1 mt-2">
                      {chips.map((c, i) => (
                        <View key={i} className="bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                          <Text className="text-amber-800 font-bold text-xs">
                            Token #{c.token}{c.serviceLabel ? ` · ${c.serviceLabel}` : ''}
                          </Text>
                        </View>
                      ))}
                    </View>
                  );
                })()}
```

- [ ] **Step 3: Render chips in search results**

In the search-results `map` (lines 93-107), after the customer name `Text` (line 102), add the same chip block (copy from Step 2, using `o` instead of `o` — identical variable name).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/screens/Supervisor/SupervisorDashboardScreen.tsx
git commit -m "feat(supervisor): show token chips on dashboard"
```

---

## Task 8: Backend — pickup assign (create-if-missing) + unassign action

**Files:**
- Modify: `ops/functions/index.js:1331-1372`

- [ ] **Step 1: Fix the pickup branch's `task_not_found` case**

In `assignTaskToRider`'s pickup (`else`) branch (lines 1355-1372), replace the trailing `else` that returns `task_not_found` (lines 1368-1370) so it creates the task:

```js
          } else {
            // Manual pickup assignment with no existing task/queue — create one.
            tx.set(db.doc(`ops_tasks/${orderId}`), {
              orderId, userId, vendorId, assignee: riderId, status: 'assigned',
              pickupAddress: pickupAddressFromOrder(order),
              pickupSlot: order.pickupDetails || null,
              tokenNumber: order.tokenNumber || null,
              pickupOTP: order.pickupOTP || null,
              assignedAt: now, createdAt: now,
            });
          }
```

- [ ] **Step 2: Add the `unassignPickup` action**

Insert a new action block immediately after the `assignTaskToRider` block's closing (after line 1373-1375 area, i.e. after `return { ok: false, error: 'invalid_action' };` line 1375 — actually insert before that final return, at the same nesting level as the other `if (action === …)` blocks). Place it right after the `assignTaskToRider` block ends (after line 1372's `return { ok: true, status: 'assigned' };` + `}` at 1373):

```js
      if (action === 'unassignPickup') {
        if (order.status !== 'placed' && order.status !== 'confirmed') {
          return { ok: false, error: 'invalid_state' };
        }
        // Move the pickup out of a rider's queue and park it for later (manual or auto) assignment.
        if (taskSnap.exists) {
          tx.delete(db.doc(`ops_tasks/${orderId}`));
        }
        if (!queueSnap.exists) {
          tx.set(db.doc(`ops_queue/${orderId}`), {
            orderId, userId, vendorId, status: 'pending',
            pickupAddress: pickupAddressFromOrder(order),
            pickupSlot: order.pickupDetails || null,
            tokenNumber: order.tokenNumber || null,
            pickupOTP: order.pickupOTP || null,
            createdAt: now,
          });
        }
        return { ok: true, status: 'parked' };
      }
```

- [ ] **Step 3: Review the diff**

Run: `git diff ops/functions/index.js`
Expected: the new `unassignPickup` block is inside the transaction, at the same indentation as the sibling `if (action === …)` blocks, before the final `return { ok: false, error: 'invalid_action' };`.

- [ ] **Step 4: Commit**

```bash
git add ops/functions/index.js
git commit -m "feat(dispatch): manual pickup assign (create) + unassign-to-queue"
```

---

## Task 9: Store + UI — expose pickup unassign

**Files:**
- Modify: `src/store/opsProcessStore.ts` (add `unassignPickup`)
- Modify: `src/screens/Helper/OrderDetailScreen.tsx` (menu item)

- [ ] **Step 1: Add `unassignPickup` to the store**

In `src/store/opsProcessStore.ts`, add a method after `assignTaskToRider` (after line 250):

```ts
  unassignPickup: async (orderId: string, userId: string) => {
    try {
      const res = await callSupervisor()({ action: 'unassignPickup', orderId, userId });
      return res.data;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'request_failed' };
    }
  },
```

Also add it to the `OpsProcessState` interface (the `create<OpsProcessState>` generic). Locate the interface and add:

```ts
  unassignPickup: (orderId: string, userId: string) => Promise<any>;
```

- [ ] **Step 2: Add menu item in `OrderDetailScreen`**

In the supervisor menu (lines 605-628), add an "unassign" entry after the existing "Assign Rider" entry (lines 613-618), inside the same `(order?.status === 'placed' || order?.status === 'confirmed')` guard:

```tsx
            {(order?.status === 'placed' || order?.status === 'confirmed') && (
              <TouchableOpacity onPress={() => { setShowMenu(false); handleUnassignPickup(); }} className="p-4 border-b border-gray-100 flex-row items-center">
                <Undo2 size={16} color="#f59e0b" className="mr-3" />
                <Text className="text-amber-600 font-medium">Unassign / Return to Queue</Text>
              </TouchableOpacity>
            )}
```

Add `Undo2` to the lucide import at the top of the file (extend the existing `lucide-react-native` import).

- [ ] **Step 3: Add the `handleUnassignPickup` handler**

Near the other handlers (`handleCancelOrder`, `handleReschedule`), add:

```tsx
  const handleUnassignPickup = async () => {
    setBusy(true);
    try {
      const res = await useOpsProcessStore.getState().unassignPickup(orderId, order?.userId || '');
      setBusy(false);
      setActionError(res.ok ? undefined : friendlyActionError(res.error));
    } catch (e: any) {
      setBusy(false);
      setActionError(friendlyActionError(e?.message || 'request_failed'));
    }
  };
```

(Confirm `setActionError` and `friendlyActionError` are already in scope — they are used by the existing assign handler at lines 858.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/store/opsProcessStore.ts src/screens/Helper/OrderDetailScreen.tsx
git commit -m "feat(supervisor): unassign pickup back to queue"
```

---

## Task 10: Full verification

- [ ] **Step 1: Functions tests**

Run: `cd ops/functions && npm test`

- [ ] **Step 2: Frontend tests**

Run: `npm test`

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Manual smoke (web)**

Run: `npm run web`. Verify: (a) a ready order no longer appears as "tagging" to a helper; (b) token chips appear on the supervisor dashboard + customer detail; (c) the supervisor can assign/unassign a pickup. (Note: cloud functions must be redeployed for server changes — see below.)

- [ ] **Step 5: Note on deploy**

The `ops/functions/index.js` / `dispatch.js` changes require `firebase deploy --only functions` to take effect in production. Surface this to the operator before closing the work.

---

## Self-review notes

- Spec coverage: Workstream A → Tasks 1-4; Workstream B → Tasks 5-7; Workstream C → Tasks 8-9; verification → Task 10. All spec items mapped.
- No placeholders: every step has concrete code/commands.
- Type consistency: `tokenNumber`/`tokens` field names match across `FeedOrder`, `CustomerOrder`, `customerIndex`, `parseOrderTokens`; `unassignPickup` matches between store method and the `supervisorActions` action string; `isAwaitingPickup` is exported and imported consistently.