# Requirements — Supervisor Dashboard & Operations Overhaul

## R1: Home Dashboard Tab Redesign (SupervisorDashboardScreen)

### R1.1 In-Transit orders removed from Home "All" tab
- `in_transit_to_store` orders must NOT appear in the Home "All" inbound queue
- They should only be visible in the "In Transit" filter tab
- Also: `pickup_completed` should NOT be shown in "All" — it's a tagging queue, not inbound

### R1.2 Urgent orders hidden from Home page
- Urgent orders must NOT appear in the Home dashboard at all
- They remain visible on Orders page (FloorBoardScreen)

### R1.3 Today's pickup tab (new default Home tab)
- A new primary tab showing ONLY today's pickups (`placed`/`confirmed` with pickup date = today)
- Not tomorrow's, not future ones
- Orders sorted in ASCENDING order of pickup time (earliest first)

### R1.4 Tomorrow's pickup only on Orders page
- Tomorrow's scheduled pickups should appear ONLY in FloorBoardScreen "Action Required" tab
- NOT in Home dashboard

### R1.5 Pickup & Delivery benchmarks on Home page
- Surface the existing `computePickupBenchmark` and `computeDeliveryBenchmark` data

## R2: Ready Order Time Slot Highlighting

- Ready section should highlight the delivery time slot more prominently
- Show scheduled delivery slot as the primary info (not buried)

## R3: Rider Assign/Reassign from FloorBoard Cards (Bug Fix)

- FloorBoardScreen card shows assignee name
- Tapping assignee name should open reassign helper/rider picker
- The actual `assignStepToHelper` / `assignTaskToRider` callable must work from the inline card view (currently only works from OrderDetailScreen)
- **Root cause hypothesis:** FloorBoardScreen does not have the assign helper modal wired at all — need to add it

## R4: Attendance Rules & Fines

### R4.1 Fine logic
- Login after 8:30 AM → Fine ₹50
- Helper lunch > 1.5 hours → Fine ₹50 (currently tracked as 2h)
- Rider lunch > 2 hours → Fine ₹50
- Logout before 10:00 PM → Fine ₹50

### R4.2 Lunch limit change
- Helper lunch limit: reduce from 2 hours → 1.5 hours
- Rider lunch limit: keep 2 hours

### R4.3 UI for attendance rules
- Show fine tracking on StaffAttendanceTable
- Show rules on Settings page

## R5: Assign/Reassign Enhancement on Floor Board

- Cards show assigned helper/rider name
- Clicking assigned name opens an inline reassign modal
- Works both for helper steps and rider dispatch
- Currently `AssignHelperModal` exists but isn't wired into FloorBoardScreen

## R6: Operations Record Sheet

- New screen accessible from a button on Supervisor Dashboard
- Date range selector (custom start/end date)
- Profile selector (per-staff or role filter)
- Shows average time per stage for helpers (tagging → washing → drying → ironing → packaging)
- For riders: shows average pickup and delivery time

## R7: No Over-Engineering

- Follow existing patterns (NativeWind, Zustand, lucide icons)
- Don't break existing functionality
- Don't add new packages
- Keep it simple and maintainable

---

## R8: Scheduled Pickup & Delivery Rider Alerting

- Hold scheduled pickups and deliveries until **15–20 minutes before** the scheduled slot (20m lead window), then dispatch to the rider with full popup (`GlobalAssignmentModal`), Android overlay/FCM, looping siren (`dramaticChime`), and voice announcement.
- Supervisor manual assignment (`assignTaskToRider`) always alerts immediately.
- Eliminate pickup ↔ delivery ID collision (`ops_tasks/{orderId}` vs `ops_delivery_tasks/{orderId}`), duplicate listener re-init on screen mount, and `onOpsTaskWritten` auto-heal FCM suppression.

## R9: Break, Lunch & Night Auto-Logout Silencing + Floor-Helper Reminder Fallback

- Sync QR break states (`attendanceStatus: 'working' | 'lunch' | 'short_break' | 'off'`, `onBreak: boolean`) onto `ops_staff/{uid}`.
- Never auto-assign pickups, deliveries, or processing stages to staff on `lunch`, `short_break`, or clocked out / logged out (`!onShift`). Drain waiting queues automatically when staff return from break.
- **Supervisor Override**: Manual assignments by a supervisor (`assignTaskToRider`, `assignStepToHelper`) still assign and ring even if the staff member is on break.
- **Zero Off-Shift / Night Reminders**: Once clocked out or auto-logged out at 11:30 PM IST, staff must receive zero washing/drying/chemical reminders or order alerts (cancel local timers, gate Android `SpinzoMessagingService`, gate client modals, gate backend `checkUnstartedMachineNudges` & `sendFCMStageNudge`).
- **Mid-Cycle Break Fallback**: During store hours, if a helper assigned to a running/accepted `getting_washed` or `getting_dried` order goes on lunch or short break, silence reminders for that helper and route due washer/dryer nudges to an available working floor helper (allowing any working floor helper to start/unload/snooze that machine).

## R10: Premium Laundry 5-Step Pipeline

- `premium_laundry` must follow `tagging → getting_washed → getting_dried → getting_ironed → packaging` (include `getting_ironed` in `stepsForServiceType` and `getProcessingSteps`, and auto-heal in-flight `premium_laundry` `ops_process` docs created before this fix).

---

## Phase 8: Lightweight & High-Performance Overhaul (R11–R14)

### R11: Immediate Touch & Rider Stability Fixes
- **R11.1 (GPS Write Loop)**: Break the circular GPS write-snapshot loop in `useRiderLocationSync.ts`. Depend only on a stable primitive key of task IDs (`activeTaskIdsKey`), enforce a 120s minimum write throttle guard, and avoid writing `riderLocation` onto collections monitored by the rider's active snapshot listeners.
- **R11.2 (Touch Responder / Flatten RiderTaskCard)**: Flatten `RiderTaskCard.tsx`. Remove the outer `<Pressable>` wrapping the card to eliminate React Native touch responder contention. Provide dedicated, non-overlapping touch targets with `hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}` for Call, Directions, Edit, and the 52px Primary CTA button.
- **R11.3 (Genuine FlatList Virtualization)**: Replace the fake `data={[0]}` / `ListHeaderComponent.map()` pattern in `PickupsScreen.tsx` and `DeliveriesScreen.tsx` with standard virtualized `FlatList` (`data={activeTasks}`, `renderItem`, `windowSize={5}`, `maxToRenderPerBatch={4}`).

### R12: Decouple Riders from Global `orderFeedStore`
- **R12.1 (Zero Order Feed Listener for Riders)**: In `RootNavigator.tsx`, riders must never mount `useOrderFeedStore`. Drop rider memory footprint from ~250MB to <25MB and eliminate cross-company snapshot re-renders.
- **R12.2 (Self-Contained Task Operations)**: Refactor `PickupsScreen`, `DeliveriesScreen`, `GlobalAssignmentModal`, and `smartRoute.ts` to source customer, address, item, token, slot, and amount data directly from `OpsTask` and `DeliveryTask` without relying on `orders.find(...)`.

### R13: Bounded & Paginated Firestore Queries for Floor Helpers & Supervisors
- **R13.1 (Scoped Order Feed)**: Replace the unbounded `collectionGroup('orders')` query with a bounded query targeting only active statuses (`where('status', 'in', ACTIVE_STATUSES)`).
- **R13.2 (Scoped Ops Process)**: Scope `ops_process` to incomplete stages (`where('status', 'in', ['pending', 'in_progress'])`) to prevent downloading historical records.
- **R13.3 (Historical Orders On-Demand)**: Load delivered/cancelled historical records with pagination (`limit(50)` + `startAfter`).

### R14: UI Thread & Timer Consolidation
- **R14.1 (Role-Gated Notifications)**: Guard `useLifecycleNotifications.ts` so machine/washer checks never run on rider devices.
- **R14.2 (Timer Consolidation & Debounced Search)**: Consolidate scattered `setInterval(1000)` timers and debounce text search inputs in `SupervisorDashboardScreen` and `FloorBoardScreen` (300ms debounce).

---

## Phases 9–13: Team Operational Feedback Overhaul (R15–R22)

### R15: Unassign Pickup & Delivery Hold + UI Sync (Phase 9)
- **R15.1 (Prevent Auto Re-Assignment)**: `unassignPickup` and `unassignDelivery` must set an explicit `manualHold: true` / `status: 'manual_hold'` hold so `syncDeliveryTask`, `drainScheduledRiderTasks`, and `onShiftCatchUp` never auto-reassign manually unassigned tasks until a supervisor manually assigns them or reschedules the slot.
- **R15.2 (Clear Stale Rider Fields)**: `unassignPickup` must delete `riderId`, `riderName`, and `pickupRider`; `unassignDelivery` must delete `deliveryRiderId`, `deliveryRiderName`, `deliveryRiderPhone`, `deliveryRider`, `riderId`, and `riderName`. Supervisor cards (`SupervisorDashboardScreen`, `FloorBoardScreen`, `OrderDetailScreen`) must immediately show "Not Assigned" (and read `deliveryRiderId`/`deliveryRiderName` for delivery-stage orders).

### R16: Delivery Auto-Assign Status Parity (Phase 9)
- When the system auto-assigns a delivery rider (`syncDeliveryTask`, `drainScheduledRiderTasks`, `onShiftCatchUp`, `markOutForDelivery`), immediately set `order.status = 'out_for_delivery'`, `outForDeliveryAt = now`, and `ops_delivery_tasks.status = 'out_for_delivery'` (matching manual `assignTaskToRider`), so the supervisor panel and customer app reflect `out_for_delivery` immediately.

### R17: Washing/Drying Cycle Durations & Chemical Reminders (Phase 10)
- **Wash cycle**: `36 min` (`2160s`) across backend (`dispatch.js`, `index.js`) and client (`stageNudges.ts`, `lifecycleNotifications.ts`, `WasherReminderModal.tsx`, `OrderDetailScreen.tsx`, `FloatingTaskCard.tsx`, `alerts.ts`).
- **Dry cycle**: `40 min` (`2400s`) across backend and client (fixing the 45m vs 30m mismatch).
- **Detergent reminder**: `3 min` (`180s`) after machine start.
- **Softener reminder**: `21 min` (`1260s`) after machine start (15 min left on 36 min wash).
- **Minimum completion lock**: Keep at `30 min` (`1800s`) for both wash and dry.

### R18: Tagging & Packaging Reminders (Phase 10)
- Add reminders for `tagging` and `packaging` across client (`stageNudges.ts`, `StageNudgeModal.tsx`, `systemNotifications.ts`, `opsProcessStore.ts`) and backend (`dispatch.js`, `index.js` `checkUnstartedMachineNudges` + `snoozeNudge`).
- First reminder fires **10 minutes** after `assignedAt`, then repeats every **5 minutes** until the stage is completed (bypassing `isHelperDoingHandsOn` suppression for the helper's own tagging/packaging task).

### R19: Multi-Load (>8kg) Aggregation & Separate Load Timing Stages (Phase 11)
- For orders split into 2+ loads (`loadCount > 1`), aggregate across all sibling `ops_process` docs in backend (`submitTagging`, `completeStep`, `completePackaging`, `persistOpsDetailsToOrder`) and client (`OrderDetailScreen`, `FloorBoardScreen`):
  - Sum total garments tagged (`garmentCount`)
  - Sum total bundles (`bundles`)
  - Combine all packaging photos (deduplicated)
  - Collect all packaging videos (`packagingVideos: Array<{ url, processId, label }>`)
- Store and render **separate timing stages per load** (`loadTimings`: 2 loads → 2 timing stage timelines, 3 loads → 3 timing stage timelines).

### R20: Tagging Pre-Existing Damage Report (Photo / Record Video) (Phase 12)
- Add a **Report** button in Tagging (`OrderDetailScreen.tsx` `renderTagging`, both registration and scanning views) that opens camera options (**Click Photo** or **Record Video**) + optional short note to document pre-existing cloth damage.
- Upload media via `uploadMediaToStorage` under `damage_reports/{orderId}` and persist via `opsProcessing` `reportDamage` callable to `ops_process` and `users/{uid}/orders/{orderId}`.
- Render a "Pre-Existing Damage Reports" card on `OrderDetailScreen` and a damage indicator badge on `FloorBoardScreen`.

### R21: Supervisor Home Floor Roster Deployment Multi-Order Modal (Phase 13)
- Tapping any **helper** or **delivery partner** in `SupervisorDashboardScreen` Floor Roster Deployment opens a centered modal showing **all** currently assigned orders/tasks (fixing `getHelperLiveTask` returning only the first match).
- Show accurate live multi-order count badges on roster rows.

### R22: Settings Helper Assignment Rules Matrix (Phase 13)
- Add an **Assignment Rules** section in `SettingsScreen.tsx` (for supervisors) listing all helpers from `config/opsStaff` in the left column and 5 stage columns on the right (`Tagging`, `Washing`, `Drying`, `Ironing`, `Packaging`), each with an enable/disable toggle persisted to `config/helperAssignmentRules`.
- Auto-assignment (`ops/functions/dispatch.js` `selectHelperForStage` + `ops/functions/index.js`) and client pool eligibility (`src/utils/helperEligibility.ts`) respect these toggles while preserving existing tier preference among enabled helpers and allowing manual supervisor override.

---

## Phase 18: Post-Release Operational Feedback Fixes (R23–R26)

### R23: Strict End-to-End Helper Assignment Rules Enforcement
- Keep all 5 stages (`tagging`, `getting_washed`, `getting_dried`, `getting_ironed`, `packaging`) individually toggleable per helper in Settings, with Wash & Dry defaulted ON for all helpers.
- **Backend Firestore Schema Fix**: `ops/functions/index.js` (`autoAssignTaggingOnPickup`, `autoAssignStage`, `drainWaitingOpsQueues`, `stageRoleGate`, `checkUnstartedMachineNudges`) must parse top-level phone maps in `config/helperAssignmentRules` (ignoring `updatedAt`/`updatedBy`, with legacy `.rules` fallback) rather than reading `data.rules`.
- **Backend `stageRoleGate` & Defaults Parity**: Enforce `helperAssignmentRules` inside `claim`/`acceptStep`/`startStep` (with supervisor/admin bypass) and unify `IRONING_PRIORITY_PHONES` in `ops/functions/dispatch.js` to `[SAMSUL_PHONE, ABDUR_PHONE]` matching client `src/utils/helperEligibility.ts`.
- **Client Enforcement & Cold-Start Safety**: Subscribe `useHelperRulesStore` in `RootNavigator.tsx` (unsubscribe on logout); gate `HelperAssignmentModal` until `helperRulesLoaded === true`; gate `getTopEligibleTask` step `0b` (`system_auto`) by `isHelperAllowedForStage` (preserving `0a` manual supervisor override); gate floor self-start in `OrderDetailScreen`.

### R24: Eliminate Background Siren Leaks After Accept
- **Zero Self-Claim FCM Boomerang**: `opsProcessing` `claim` (`ops/functions/index.js`) must only send `order_assignment` FCM when `targetUid !== auth.uid`.
- **Android Native Main-Thread Dismissal & Foreground Suppression**: Post `SpinzoOverlayModule.dismissOverlay()` onto `Looper.getMainLooper()` with a monotonic `overlayGeneration` guard so stale queued `showOverlay` calls never start audio after dismiss; cancel fallback notifications on dismiss; track `isAppInForeground` and `on_break` in `SpinzoOverlay` so `SpinzoMessagingService` suppresses native looping overlay/alarm when the app is active in foreground or helper is on break (unless supervisor override); cap native siren burst strictly to 1.5s without 45s fallback siren loops.
- **Prevent `expo-audio` Resurrection (`src/utils/alerts.ts`)**: Never reuse a single persistent 74s `alarm.mp3` player that ExoPlayer auto-resumes on `AUDIOFOCUS_GAIN` / foreground return; create short-lived player instances and destroy/release on `stopAlarmSoundOnly()` with generation guards.
- **Modal & Screen Silencing**: Set `shouldPlaySound: AppState.currentState !== 'active'` in `systemNotifications.ts`; add `locallyAcceptedIds` guard to `HelperAssignmentModal`; dismiss overlay & notifications immediately at the start of `handleAction` in `StageNudgeModal` and `WasherReminderModal`; silence alerts/overlay when accepting/starting/completing from `ProcessingScreen`, `OrderDetailScreen`, and `AppState` foreground resume.

### R25: Dynamic Hindi (`hi-IN`) Voice with Clear Phonetic Alphanumeric Tokens
- **Series & Multi-Token Extraction**: Support all store token formats (`108`, `B102`, `1A`, `1B108`, `P98`, `P108`, `T-42`, `#75`, `Token #23`, comma/slash multi-bag `"1A, B102"`, `"23, 24"`) across both `src/utils/voiceScripts.ts` and `ops/functions/dispatch.js` (100% parity), deduplicating rolled-up `tokensMap` entries while rejecting long random Firestore IDs.
- **Devanagari Phonetic Formatting**: Format Latin letters in tokens to natural Devanagari phonetics while preserving full numbers (`B102` → `बी 102`, `1A` → `1 ए`, `1B108` → `1 बी 108`, `P98` → `पी 98`, `P108` → `पी 108`), joining multiple tokens with `और` (`1 ए और बी 102`).
- **Clear Hindi Action Prompts**: Speak natural, unambiguous instructions for tagging, washer load/start/unload, detergent/softener, dryer load/start/unload, ironing (`नया आयरनिंग का ऑर्डर आया है`), packaging, and delivery.
- **Accurate Per-Load & Order Token Plumbing**: Fix `StageNudgeModal` and `WasherReminderModal` to match `p.id === processId` before falling back to `p.orderId`; pass `tokensMap` and parent-order fallbacks across backend FCM callers; write `tokenNumber` and `tokens` in `markOutForDelivery`; fix `SpinzoOverlayManager.kt` fallback voice to read `data["step"]`.

### R26: Synced Multi-Load Rider Bundle Count
- **Backend (`ops/functions/index.js`)**: Replace broken `db.doc('ops_process/' + orderId)` lookup in `syncDeliveryTask` (and mirror in `markOutForDelivery`) with canonical order-level `after.packagingProof?.bundles ?? after.opsDetails?.bundles`, falling back to summing `stages.packaging.qualityProof.bundles ?? stages.packaging.bundleCount` and collecting `bundleLabels` across all `ops_process` docs where `parentOrderId == orderId`.
- **Client (`src/utils/opsTasks.ts`, `src/store/opsStaffStore.ts`)**: Add tested `resolveDeliveryBundleCount(task, order)` prioritizing positive order-level aggregated bundles over stale `ops_delivery_tasks.bundleCount = 1`, and include aggregated bundle count in `opsStaffStore` change-detection signature so active deliveries immediately reflect the exact supervisor bundle count.


