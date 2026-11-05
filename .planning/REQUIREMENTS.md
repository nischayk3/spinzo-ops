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
