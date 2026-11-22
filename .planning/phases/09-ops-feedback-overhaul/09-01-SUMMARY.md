# Phases 9–13 Summary — Team Operational Feedback Overhaul (`R15`–`R22`)

**Completed:** 2026-11-22
**Verification:**
- `npx tsc --noEmit`: PASS (0 errors)
- `npm run test`: PASS (17 test files, 221/221 tests)
- `node --check ops/functions/index.js ops/functions/dispatch.js`: PASS
- `node --test ops/functions/dispatch.test.js`: PASS (45/45 tests)

---

## Requirements Shipped

- **`R15` (Unassign Pickup & Delivery Hold + Stale Rider Field Cleanup)**:
  - `ops/functions/index.js`: `unassignPickup` and `unassignDelivery` now delete all stale rider name/phone/object fields (`riderId`, `riderName`, `pickupRider`, `deliveryRiderId`, `deliveryRiderName`, `deliveryRiderPhone`, `deliveryRider`) and set `manualHold: true` / `status: 'manual_hold'` (`manualDeliveryHold: true` on order doc). `syncDeliveryTask`, `drainScheduledRiderTasks`, and `onShiftCatchUp` skip manually held tasks until manual supervisor assignment or slot reschedule.
  - `src/screens/Supervisor/SupervisorDashboardScreen.tsx`: Delivery-stage cards resolve rider strictly from `deliveryRiderId`/`deliveryRiderName` (never stale pickup `riderName`) and clearly display `Not Assigned`.

- **`R16` (Delivery Auto-Assign Status Parity)**:
  - `ops/functions/index.js`: `syncDeliveryTask`, `drainScheduledRiderTasks`, `onShiftCatchUp`, and `markOutForDelivery` now immediately set `order.status = 'out_for_delivery'`, `outForDeliveryAt`, and `ops_delivery_tasks.status = 'out_for_delivery'` (matching manual `assignTaskToRider`).

- **`R17` (Wash 36m / Dry 40m / Detergent 3m / Softener 21m)**:
  - Unified across `ops/functions/dispatch.js`, `ops/functions/index.js`, `src/utils/stageNudges.ts`, `src/utils/lifecycleNotifications.ts`, `src/utils/alerts.ts`, `src/components/WasherReminderModal.tsx`, `src/components/FloatingTaskCard.tsx`, `src/screens/Helper/OrderDetailScreen.tsx`, and `src/screens/Settings/SettingsScreen.tsx`. Kept 30-min accidental-completion lock intact.

- **`R18` (Tagging & Packaging Reminders: 10m Initial + 5m Repeat)**:
  - Added `isHandsOnStageNudgeDue` in `ops/functions/dispatch.js` and extended `checkUnstartedMachineNudges` + `snoozeNudge` in `ops/functions/index.js`.
  - Extended `src/utils/stageNudges.ts` (exempting own tagging/packaging nudges from `isHelperDoingHandsOn`), `src/components/StageNudgeModal.tsx` (`Open Order` CTA), `src/utils/systemNotifications.ts`, and `src/store/opsProcessStore.ts`.

- **`R19` (Multi-Load >8kg Aggregation & Separate Per-Load Timing Stages)**:
  - Added `buildAggregatedOrderOpsFields` in `ops/functions/index.js` (`submitTagging`, `completeStep`, `completePackaging`, `persistOpsDetailsToOrder`) to sum `garmentCount` & `bundles`, merge `packagingPhotos`, collect `packagingVideos`, and preserve per-load `loadTimings`.
  - Added `src/utils/multiLoad.ts` (`aggregateMultiLoadOrder`) + unit tests and wired into `OrderDetailScreen.tsx` (combined totals, all load videos, separate per-load timing stage sections) and `FloorBoardScreen.tsx` (multi-load badge & aggregated totals).

- **`R20` (Tagging Pre-Existing Damage Report — Photo / Video)**:
  - Added `reportDamage` callable in `ops/functions/index.js` + `reportDamage` store action in `src/store/opsProcessStore.ts`.
  - Added `src/components/DamageReportModal.tsx` (Camera Photo + Record Video + optional note via `expo-image-picker` & `uploadMediaToStorage` under `damage_reports/{orderId}`), wired **Report** button in `OrderDetailScreen.tsx` Tagging headers, added **Pre-Existing Damage Reports** card on `OrderDetailScreen.tsx`, and added Damage badge on `FloorBoardScreen.tsx`.

- **`R21` (Floor Roster Deployment Multi-Order Centered Modal)**:
  - Added `src/utils/rosterTasks.ts` (`getHelperLiveTasks` returning ALL active assigned tasks) + unit tests and `src/components/Supervisor/SupervisorHelperTasksModal.tsx`.
  - Wired tappable helper & rider rows with live multi-order count badges in `SupervisorDashboardScreen.tsx`, and centered `SupervisorRiderRouteModal.tsx` cleanly.

- **`R22` (Settings Dynamic Helper Assignment Rules Matrix)**:
  - Added `src/store/helperRulesStore.ts` (`config/helperAssignmentRules`), updated `src/utils/helperEligibility.ts`, `src/screens/Helper/ProcessingScreen.tsx`, `src/components/HelperAssignmentModal.tsx`, `ops/functions/dispatch.js` (`isHelperAllowedForStage` + `selectHelperForStage`), and `ops/functions/index.js` (`autoAssignTaggingOnPickup`, `autoAssignStage`).
  - Built compact 5-column interactive **Assignment Rules** toggle matrix (`Tag | Wash | Dry | Iron | Pack`) in `src/screens/Settings/SettingsScreen.tsx` and tightened UI typography/density across `SettingsScreen.tsx`, `StaffAttendanceTable.tsx`, `RiderTaskCard.tsx`, `SupervisorDashboardScreen.tsx`, `FloorBoardScreen.tsx`, and `OrderDetailScreen.tsx`.

---

## Deployment Note
- Cloud Functions (`ops/functions/index.js` & `ops/functions/dispatch.js`) were modified and require Firebase deployment (`firebase deploy --only functions`) for backend changes (`R15`, `R16`, `R17`, `R18`, `R19`, `R20`, `R22`) to take effect in production.
