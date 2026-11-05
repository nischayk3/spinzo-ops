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