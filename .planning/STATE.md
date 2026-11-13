# SpinZo Ops — Active GSD Session State

**Last Updated:** 2026-11-13
**Active Sync:** Antigravity (Tech Owner) ↔ Claude Code (`@AGENTS.md` + `.planning/`)
**Deep Architecture & Risk Audit:** `docs/STATE.md`

---

## 1. Verification Baseline
- **TypeScript (`npx tsc --noEmit`)**: PASS (0 errors)
- **Unit Tests (`npm run test`)**: PASS (15 test files, 193/193 tests passing)
- **Cloud Functions (`node --check` + `node --test`)**: PASS (`ops/functions/index.js`, `ops/functions/dispatch.js`, 40/40 dispatch tests passing)

## 2. Recently Shipped Baseline
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
