# Order Sync, Token Display & Pickup Dispatch Control

**Date:** 2026-10-04
**Status:** Approved (tech-owner decisions)
**Scope:** SpinZo Ops (`spinzo-ops.nosync`) — backend cloud functions + frontend. No changes to the Livfresh admin panel.

## Decisions

1. **Tokens are per-segment**, surfaced **aggregated per customer**. The `tokens` map (`{wash_fold:"23", wash_iron:"24", …}`) is already the data model; the fix is display-only. Fallback to the scalar `tokenNumber` (comma-split) when only that exists (e.g. pickup done via the Livfresh admin).
2. **Pickup dispatch gets full manual control**, mirroring deliveries: assign to a specific rider, unassign → park to `ops_queue`, reassign to another rider. Smart auto-assign (`selectRider`/`pickRider`) stays the default when no manual action is taken.

## Root causes

| Bug | Root cause | Location |
|---|---|---|
| Stale assignment on login / order-state divergence | `taskTransition` maps only →cancelled/→pickup_completed/→delivered; no `processing`/`ready` handling, so `ops_tasks`/`ops_process` freeze when the admin advances an order. `onShiftCatchUp` reassign re-points pending tasks without re-reading order status. `autoAssignRider` has no status filter. Helper eligibility never checks `order.status === 'ready'`. | `ops/functions/dispatch.js:55-66`, `ops/functions/index.js:125-143`, `index.js:78-109`, `src/utils/helperEligibility.ts:71-174` |
| Token numbers not shown to supervisor | `SupervisorDashboardScreen` (the primary view) renders no token chips; `CustomerDetailScreen` renders none and is unreachable. `FloorBoardScreen`/`OrderDetailScreen` already render per-order chips. | `src/screens/Supervisor/SupervisorDashboardScreen.tsx`, `src/screens/Supervisor/CustomerDetailScreen.tsx`, `src/utils/orderFeed.ts:310-353` |
| No pickup-assignment control | Pickup branch of `assignTaskToRider` requires an existing task/queue doc and has no unassign/reassign surface; deliveries have first-class controls. | `ops/functions/index.js:1355-1372`, `src/screens/Helper/OrderDetailScreen.tsx` |

## Workstream A — server-side order-state sync

1. **Extend `taskTransition`** (`dispatch.js`) to also map:
   - `→ processing`: `{ taskStatus: 'picked_up' }` (pickup is complete).
   - `→ ready`: `{ cleanupProcess: true }` — delete stuck `ops_process` docs **without** touching the delivery task (which `syncDeliveryTask` creates as `pending`).
2. **Handle `cleanupProcess` in `syncTaskFromOrder`** (`index.js`) with a process-only cleanup block (reuse the existing `parentOrderId` batch delete; do NOT mark the delivery task `delivered`).
3. **Guard `onShiftCatchUp` reassign branch** (`index.js:125-143`) with the same order-status check the parked-queue branch already has (`index.js:154-168`): skip/delete tasks whose order is no longer `placed`/`confirmed`.
4. **`autoAssignRider`** — no change required (fires only at order creation), but add a status assertion for safety if trivial.
5. **Helper eligibility** (`src/utils/helperEligibility.ts`): treat an order in `ready`/`out_for_delivery`/`delivered` as ineligible, mirroring the existing `cancelled` check.

## Workstream B — token display

6. Add `tokenNumber`/`tokens` to the `CustomerOrder` type and copy them in `customerIndex`; render `parseOrderTokens` chips in `CustomerDetailScreen`; wire a navigation link so the screen is reachable.
7. Add token chips to `SupervisorDashboardScreen` order cards (inbound + search results).

## Workstream C — supervisor pickup-assignment control

8. Extend the pickup branch of `assignTaskToRider` (`index.js:1355-1372`): accept `riderId` of `null`/`''` as "unassign → park to `ops_queue`"; create the task when missing (order still `placed`/`confirmed`) instead of returning `task_not_found`.
9. Add first-class pickup assign/unassign/reassign controls in `OrderDetailScreen`, mirroring the existing delivery controls.

## Testing

- `dispatch.js` is unit-testable (`node --test`). Add tests for the expanded `taskTransition` matrix and the `pickupGuard`.
- `npx tsc --noEmit` must stay clean (strict mode).

## Non-goals

- No Livfresh admin changes.
- No schema/status-contract changes (statuses stay as-is).
- No changes to `selectRider`/`pickRider` weighting logic.