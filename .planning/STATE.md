# SpinZo Ops — Active GSD Session State

**Last Updated:** 2026-11-05
**Active Sync:** Antigravity (Tech Owner) ↔ Claude Code (`@AGENTS.md` + `.planning/`)
**Deep Architecture & Risk Audit:** `docs/STATE.md`

---

## 1. Verification Baseline
- **TypeScript (`npx tsc --noEmit`)**: PASS (0 errors)
- **Unit Tests (`npm run test`)**: PASS (15 test files, 193/193 tests passing)
- **Cloud Functions (`node --check` + `node --test`)**: PASS (`ops/functions/index.js`, `ops/functions/dispatch.js`, 40/40 dispatch tests passing)

## 2. Recently Shipped Baseline
- **Phase 7 — Scheduled Rider Alerts, Break/Night Silencing & Premium Laundry Pipeline (`R8`–`R10`)**:
  - **Scheduled Rider Alerts (`R8`)**:
    - 20-minute pre-slot dispatch window (`isSlotDueForDispatch(..., 20)`) with robust date normalization (`DD/MM/YYYY`, `Today`, `Tomorrow`, ISO, Firestore Timestamps) in `ops/functions/dispatch.js` and `ops/functions/index.js`.
    - Fixed pickup ↔ delivery & reassignment ID collision via composite `taskAlertKey` (`pickup`/`delivery` + `orderId` + `assignedAt`) in `src/utils/opsTasks.ts`, `src/store/opsStaffStore.ts`, and `src/components/GlobalAssignmentModal.tsx` (plus looping siren `dramaticChime(true)` and delivery slot display).
    - Made `opsStaffStore.initialize(uid)` idempotent so navigating to `PickupsScreen` / `DeliveriesScreen` never resets initial snapshot state or swallows voice/popup alerts.
    - Fixed `onOpsTaskWritten` auto-heal early return suppressing FCM and added direct FCM dispatch on supervisor `assignTaskToRider` (including deliveries).
  - **Break / Lunch / Night Auto-Logout & Reminder Silencing (`R9`)**:
    - Synced `attendanceStatus` (`'working' | 'lunch' | 'short_break' | 'off'`) and `onBreak` (`boolean`) onto `ops_staff/{uid}` via `attendanceStore.ts` ↔ `opsStaffStore.ts`, with automatic queue catch-up (`onShiftCatchUp`) when returning from break.
    - Blocked auto-assignment to staff on `lunch`, `short_break`, or clocked out across `selectRider`, `selectHelperForStage`, `autoAssignTaggingOnPickup`, `autoAssignStage`, `getTopEligibleTask`, and `GlobalAssignmentModal`, while preserving **Supervisor manual override** (`isSupervisorPushedToMe`, `assignedBySupervisor: true`).
    - Eliminated night/off-shift/break wash & dry reminder spam across all 4 layers: server `checkUnstartedMachineNudges` & `sendFCMStageNudge` (`ops/functions/index.js`), local Expo notifications (`cancelAllStageNudgeTimers` on break/clockOut/logout), client modals (`StageNudgeModal`, `WasherReminderModal`, `useLifecycleNotifications`), and Android `SpinzoMessagingService.kt`.
    - Routed due mid-cycle washer/dryer/chemical nudges during store hours to available working floor helpers when the original assignee is on break/lunch (and allowed floor helpers to cover `startStep`, `completeStep`, and `snoozeNudge` on those machines).
  - **Premium Laundry 5-Step Pipeline (`R10`)**:
    - Updated `stepsForServiceType('premium_laundry')` and `getProcessingSteps` in `ops/functions/dispatch.js` to `tagging → getting_washed → getting_dried → getting_ironed → packaging`, plus transactional auto-healing in `submitTagging` & `completeStep` for any already-created `premium_laundry` `ops_process` docs.
  - > **Deploy Note**: Run `firebase deploy --only functions` to push `ops/functions/` live (immediately activates server-side 20m scheduled dispatch, night/break FCM silencing, floor-helper nudge routing, and `premium_laundry` ironing pipeline).
- **Supervisor & Ops Overhaul (`R1`–`R6`) & Pricing/Slot Fixes**:
  - Shipped in commits `24cf788` and `3ce6785`.

## 3. Active Focus
- Ready to commit/push and deploy Cloud Functions (`firebase deploy --only functions`) or take next ops batch.
