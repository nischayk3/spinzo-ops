# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

---

# SpinZo Ops — Tech Owner & Cross-Agent Engineering Guide

This file is the shared source of truth for **Antigravity** and **Claude Code** (`CLAUDE.md` imports `@AGENTS.md`). Both agents synchronize project specs, phases, and handoff state on disk via `.planning/`.

## 1. Tech Owner Operating Protocol (GSD Sync)

1. **State Lives on Disk (`.planning/`)**:
   - Before starting any feature batch or phase, read `.planning/STATE.md`, `.planning/ROADMAP.md`, and `.planning/REQUIREMENTS.md` (deep repo audit lives in `docs/STATE.md`).
   - After completing any phase or quick task, update `.planning/STATE.md` so switching between Antigravity and Claude Code is seamless.
2. **CodeGraph First**:
   - `.codegraph/` is indexed at the repo root. Always query `codegraph_explore` (or `codegraph explore "<symbols>"`) **before** grepping or reading files so call paths and store/callable boundaries are understood in one hop.
3. **Anti-Context-Rot Execution**:
   - Keep the primary thread in the **Tech Owner / Architect** role: clarify gray areas upfront, lock specs into `.planning/`, and delegate multi-file research or isolated implementation waves to fresh subagents rather than bloating one context window.
   - Do not over-engineer: follow existing Zustand + NativeWind + `lucide-react-native` patterns, add zero unnecessary packages, and preserve unrelated work in the git working tree unless asked to commit/clean up.
4. **Mandatory Verification Gate (Before Declaring Done)**:
   - `npx tsc --noEmit` (strict TypeScript + NativeWind JSX)
   - `npm run test` (Vitest unit suite across `src/**/*.test.ts`)
   - `node --check ops/functions/index.js ops/functions/dispatch.js` (whenever `ops/functions/` is touched)

---

## 2. Overview & Commands

SpinZo Ops is the internal store-operations app for the **Livfresh** laundry service. Staff (helpers, ironers, riders, supervisors) scan QR codes to clock shifts and process laundry orders through a `tagging → prestain → getting_washed → getting_dried → getting_ironed → packaging → done` pipeline.

Built with **Expo SDK 57** (React Navigation, no Expo Router), **TypeScript (strict)**, **NativeWind v4**, **Zustand**, and **dual Firebase SDKs** (`firebase` v12 Web SDK + `@react-native-firebase/*` on native). **Web is the primary dev/ops surface** (phone auth via reCAPTCHA works on web).

```sh
npm start            # start Expo dev server
npm run web          # run in browser (primary dev target — phone auth + reCAPTCHA works)
npm run ios          # run in iOS simulator
npm run android      # run on Android
npm run test         # vitest run (all src/**/*.test.ts)
npm run test:watch   # vitest watch mode
npx tsc --noEmit     # typecheck (strict mode, jsxImportSource: nativewind)
```

---

## 3. Architecture & Boundaries

### Entry & Navigation
- `index.ts` — Expo entry; registers with `@expo/metro-runtime`.
- `App.tsx` — wraps `ErrorBoundary` > `SafeAreaProvider` > `NavigationContainer` > `RootNavigator`.
- `src/navigation/RootNavigator.tsx` — auth-gated stack (`Login → NotInRoster → Permissions → Main tabs` + supervisor screens like `OperationsRecordSheet`). `RootStackParamList` is the shared route-type export. `AppTabs` conditionally renders tabs by `activeRole`. Mounts live Firestore listeners (`ops_staff`, `storeResources`, `orderFeed`, `ops_process`) and runs an auto-logout heartbeat (11:30 PM cutoff + stale-shift detection).

### Dual Firebase SDK Setup (Both Are Live)
- `src/config/firebase.ts` — Firebase Web SDK (`firebase` v12). Used on **web**.
- `src/config/firebase.native.ts` — `@react-native-firebase/*` SDK. Resolved automatically on **iOS/Android**.
- **Rule**: Both files must export the matching interface (`app`, `db`, `auth`, `functions`, `storage`, `onAuthStateChanged`, `signInWithPhoneNumber`, `signOut`, `ConfirmationResult`, and Firestore helpers). Stores always import from `../config/firebase` — never add a third Firebase config file. Phone numbers are prefixed with `+91` before OTP.

### State Management (Zustand Singletons in `src/store/`)
Stores own all Firestore `onSnapshot` listeners and Cloud Function callable wrappers; screens/components read and mutate via store hooks.

| Store | Responsibility |
|---|---|
| `authStore` | Phone OTP flow, `config/opsStaff` roster lookup, role resolution, `initializeAuth()`. |
| `opsStaffStore` | Real-time `ops_staff/{uid}`, rider `ops_tasks` (pickups) & `ops_delivery_tasks` (deliveries), audio alerts, `goOnShift`/`goOffShift`. |
| `orderFeedStore` | Realtime `collectionGroup('orders')` snapshot → `FeedOrder[]` (guarded by `users/` path prefix). Drives intake, Home dashboard, and FloorBoard. |
| `opsProcessStore` | `ops_process` listener + `opsProcessing` callables (claim, acceptStep, startStep, completeStep, scanGarment, printLabels, submitTagging, etc.) + `supervisorActions` callables (cancel, reschedule, assign rider/helper, verify delivery OTP). |
| `attendanceStore` | Shift lifecycle (clock in/out, lunch, breaks, fines) with live timers. Writes to `ops_attendance/{uid}/shifts/{date}`. |
| `storeResourcesStore` | Reads `config/storeResources` for washer/dryer/ironing station counts. |
| `staffRosterStore` | `ops_staff` where `onShift == true` (used by Supervisor views/modals). |
| `washerReminderStore` | FCM-based washer/machine nudge tracking. |

### Cloud Functions (`ops/functions/`)
- `ops/functions/index.js` — `opsProcessing`, `supervisorActions`, triggers, and dispatch orchestration.
- `ops/functions/dispatch.js`, `ops/functions/fetch_otp.js`, `ops/functions/scratch.js` — dispatch/split engine and helpers.
- Deployed separately via Firebase CLI; keep client payload types in `opsProcessStore` aligned with backend handlers.

### Production Data Contracts (DO NOT BREAK)
- **`ServiceType`** (shared with Livfresh customer app): `'wash_fold' | 'wash_iron' | 'ironing' | 'blanket_wash'` (plus any explicitly contracted add-on/shoe flows — verify before touching).
- **`OrderStatus`** (shared with Livfresh customer app): `'placed' | 'confirmed' | 'in_transit_to_store' | 'pickup_completed' | 'processing' | 'ready' | 'out_for_delivery' | 'delivered' | 'cancelled'`.
- **Processing steps**: `'getting_washed' | 'getting_dried' | 'getting_ironed'` plus `tagging` / `prestain` / `packaging` / `done` (`src/utils/opsProcess.ts`).

### Screens, Modals & Styling Conventions
- **Roles**:
  - `supervisor`: `SupervisorDashboardScreen` (via `DashboardScreen`), `FloorBoardScreen`, `OperationsRecordSheet`, `CustomerDetailScreen`, `StaffAttendanceTable`, `SettingsScreen`.
  - `helper` / `iron`: `DashboardScreen`, `ProcessingScreen`, `OrderDetailScreen`, `SettingsScreen`.
  - `rider`: `DashboardScreen`, `PickupsScreen`, `DeliveriesScreen`, `SettingsScreen` (+ `GlobalAssignmentModal`).
- **Key Modals**: `GlobalAssignmentModal`, `HelperAssignmentModal`, `AssignRiderModal`, `AssignHelperModal`, `CancelOrderModal`, `RescheduleModal`, `EditOrderModal`, `EmergencyOverrideModal`, `ResetMachineCycleModal`, `DeliveryVerification`, `FaceVerification`, `PackagingVerification`, `QualityVerification`, `StageNudgeModal`, `WasherReminderModal`.
- **Styling**: NativeWind v4 dark theme tokens in `tailwind.config.js` (`bgDark`, `bgSurface`, `bgSurfaceLight`, `textPrimary`, `textSecondary`, `textMuted`, `primary`, `warning`, `error`, `info`). Use theme classes rather than hardcoded hex where tokens exist. Never delete/rename `global.css`.
- **Icons & Fonts**: `lucide-react-native` exclusively; system default fonts.
- **Metro / Tests**: `metro.config.js` enables `.cjs` and disables `unstable_enablePackageExports` (Zustand v5 ESM fix). Vitest runs pure Node tests (`src/**/*.test.ts`) — extract complex business/filter/pricing rules into `src/utils/` with unit tests!
