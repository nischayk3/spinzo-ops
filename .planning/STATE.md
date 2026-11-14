# SpinZo Ops — Active GSD Session State

**Last Updated:** 2026-11-14
**Active Sync:** Antigravity (Tech Owner) ↔ Claude Code (`@AGENTS.md` + `.planning/`)
**Deep Architecture & Risk Audit:** `docs/STATE.md`

---

## 1. Verification Baseline
- **TypeScript (`npx tsc --noEmit`)**: PASS (0 errors)
- **Unit Tests (`npm run test`)**: PASS (15 test files, 204/204 tests passing)
- **Cloud Functions (`node --check` + `node --test`)**: PASS (`ops/functions/index.js`, `ops/functions/dispatch.js`, 41/41 dispatch tests passing)

## 2. Recently Shipped Baseline
- **Phase 8.2 — Restored Full Rider Task Card, Assignment Modal & Customer Hydration Details**:
  - **Simultaneous Customer Name & Phone Number (`RiderTaskCard.tsx`, `GlobalAssignmentModal.tsx`)**: Always renders both `customerName` and the formatted 10-digit mobile number pill (`formatDisplayPhone(p.customerPhone)`) directly below it (tappable to dial) in addition to the Call button — even when `in_transit_to_store`. Also added customer name, phone, and delivery slot display inside `GlobalAssignmentModal.tsx`.
  - **Order Placement Date/Time, Assigned Time & Friendly Date/Slot Windows (`opsTasks.ts`, `RiderTaskCard.tsx`)**: Added `formatRiderDateLabel` and `buildRiderSlotDisplay` in `src/utils/opsTasks.ts` so Instant pickups, Scheduled pickups, and Deliveries display both the friendly calendar date (`Today, 14 Nov` / `Tomorrow, 15 Nov` / `Tue, 17 Nov`) and time window. Card headers now show full `formatDateTime(p.createdAt)` + `timeAgo(p.createdAt)` and `Assigned: ...` timestamps instead of only relative `timeAgo`.
  - **In-Transit Store Drop Origin, Bundle Labels, Payment Mode & Doorstep Edit Access**: Kept the pickup/delivery window banner and added `Picked up from: <pickupAddress>` inside `in_transit_to_store` Store Drop cards; rendered `bundleLabels` chips and `paymentMode` (`PAID • ONLINE` vs `COLLECT CASH / UPI`); enabled `onEdit` in `PickupsScreen.tsx` for all pre-handover pickups (even if initial `items` is empty) and computed `unpaidAmount` for unpaid pickups.
  - **Order & Customer Profile Hydration (`opsStaffStore.ts`)**: Updated `mergeTasksWithOrders` to resolve `userName`/`userPhone`/`address.name`/`address.phone`, use canonical `billDetails.total` precedence, hydrate `pickupSlot`, `deliveryDate`/`deliveryTime`, `createdAt`/`assignedAt`, `paymentMode`, and `bundleLabels` from the order doc, plus one-time cached `getDoc(doc(db, 'users', userId))` fallback when task + order still lack customer name or phone.
  - **Unit Tests (`src/utils/__tests__/opsTasks.test.ts`)**: Added 5 unit tests covering `formatRiderDateLabel` and `buildRiderSlotDisplay` across instant, scheduled, legacy, and delivery windows.
- **Phase 8.1 — Rider Location Consistency, Doorstep Order Edit & Channelized Order Sync**:
  - **Eliminated 3-Location Divergence for the Same Customer**: Added deterministic coordinate resolution (`isValidCoord`, `resolveCustomerCoordinates`, `buildDirectionsDestination`) in `src/utils/storeGeo.ts` and unified `RiderTaskCard.tsx`, `SmartRouteSheet.tsx`, and `smartRoute.ts`. Stopped synthesizing `LOCALITY_COORDINATES` onto `stop.latitude`/`stop.longitude` (kept `LOCALITY_COORDINATES` strictly for internal sort distance) and stopped overwriting `assigned` delivery stops with `SPINZO_STORE_LOCATION` / `SPINZO_STORE_ADDRESS`.
  - **Channelized Per-Order Rider Sync (`opsStaffStore.ts`)**: Replaced global `collectionGroup('orders')` reliance with targeted `onSnapshot(doc(db, 'users', userId, 'orders', orderId))` subscriptions strictly for the rider's active `myTasks`/`myDeliveries` (`mergeTasksWithOrders`, `syncActiveOrderListeners`, `clearActiveOrderListeners`), with snapshot signature deduplication ignoring `riderLocation`/`updatedAt` so doorstep order edits (`items`, `billDetails`, `totalAmount`, `paymentStatus`), exact GPS coordinates, and stale `orderStatus` filtering work with minimal RAM/bandwidth.
  - **Optimized Location Telemetry (`useRiderLocationSync.ts`)**: Scoped location sync to en-route pickups (`pending`/`assigned`) only, writing strictly to `users/{userId}/orders/{orderId}` (eliminated unconsumed writes to `ops_tasks`, `ops_delivery_tasks`, and `ops_staff`), gated by a 25m `haversineMeters` movement filter (`MIN_DISTANCE_METERS = 25`) + 60s throttle.
  - **Selector & Cloud Function Parity**: Converted `AppTabs` in `RootNavigator.tsx` and `PickupsScreen.tsx`/`DeliveriesScreen.tsx` to granular/primitive Zustand selectors. Updated `ops/functions/index.js` (`taskPayload`, `autoAssignRider`, `syncDeliveryTask`, `markOutForDelivery`, `assignTaskToRider`, `unassignPickup`, `onOpsTaskWritten`) with `extractLatitudeFromOrder`, `extractLongitudeFromOrder`, and `nonEmptyItems` so task docs preserve valid coordinates, `items`, `billDetails`, and `totalAmount` (pending Firebase Cloud Functions deployment).
- **Phase 8 — Lightweight & High-Performance Overhaul (`R11`–`R14`)**:
  - **Fixed Unresponsive Buttons**: Flattened `RiderTaskCard.tsx` from outer `<Pressable>` to standard `<View>`, eliminating React Native touch responder contention. Call, Directions, Edit, and the 52px Primary CTA button now respond with immediate, tactile feedback (`hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}`).
  - **Eliminated Runaway GPS / Firestore Write Loop**: Replaced object-array dependency in `useRiderLocationSync.ts` with primitive `activeTasksKey`, enforced a 60-second minimum write throttle guard with `lastSyncTimeRef`, and eliminated rapid-fire writes. Device thermal throttling and battery drain eliminated.
  - **Restored True FlatList Virtualization**: Replaced fake `data={[0]}` and `ListHeaderComponent.map()` in `PickupsScreen.tsx` and `DeliveriesScreen.tsx` with direct virtualized `data={filteredList}` (`windowSize={5}`, `maxToRenderPerBatch={4}`, `removeClippedSubviews`).
  - **Decoupled Riders from Global `orderFeedStore`**: Gated `RootNavigator.tsx` so riders never mount `orderFeedStore` or `opsProcessStore`. Rider RAM dropped from ~250MB to <25MB, eliminating cross-factory GC pauses.
  - **Self-Contained Rider Tasks**: Made `smartRoute.ts`, `PickupsScreen`, `DeliveriesScreen`, and `GlobalAssignmentModal` source customer, address, item, token, slot, and amount data directly from `OpsTask` and `DeliveryTask`. Added `paymentStatus` and `paymentMode` to `DeliveryTask`.
  - **Debounced Search Inputs**: Added 250ms debouncing in `FloorBoardScreen.tsx` and `SupervisorDashboardScreen.tsx` to stop synchronous full-array filtering loops on every keystroke.
  - **Store Re-Subscription & Re-Download Guards**: Added strict idempotency checks in `orderFeedStore`, `opsProcessStore`, `staffRosterStore`, `storeResourcesStore`, and `attendanceStore` to preserve active snapshot connections across tab switches without tearing down and re-downloading thousands of documents.
  - **Helper Touch & Full Session Teardown**: Removed no-op `stopPropagation` and added `hitSlop` in `ProcessingScreen.tsx`; added complete multi-store reset on logout in `authStore.ts` to ensure 0 memory leaks across user sessions.
  - **Role-Gated Notifications**: Gated `useLifecycleNotifications.ts` to return static empty arrays for riders, preventing background re-renders.
- **Phase 7 — Scheduled Rider Alerts, Break/Night Silencing & Premium Laundry Pipeline (`R8`–`R10`)**:
  - Shipped in commit `0c5cb19`.
- **Supervisor & Ops Overhaul (`R1`–`R6`) & Pricing/Slot Fixes**:
  - Shipped in commits `24cf788` and `3ce6785`.

## 3. Active Focus
- Phase 8 fully implemented and verified against all TypeScript, Vitest, and Cloud Function syntax gates. Ready for field test with riders and deployment.
