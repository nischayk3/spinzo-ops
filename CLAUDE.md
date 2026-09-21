# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Overview

SpinZo Ops is the internal store-operations app for the Livfresh laundry service. Staff (helpers, ironers, riders, supervisors) scan QR codes to clock shifts, then process laundry orders through a tagging → washing → drying → ironing → packaging → ready pipeline.

Built with Expo SDK 57 (Expo Router-free, React Navigation), TypeScript (strict), NativeWind v4, Zustand, and **both** Firebase Web SDK (web target) and `@react-native-firebase/*` (native builds). The web target is the primary dev surface since phone auth works there.

## Commands

```sh
npm start            # start Expo dev server
npm run web          # run in browser (primary dev target — phone auth + reCAPTCHA works)
npm run ios          # run in iOS simulator
npm run android      # run on Android
npm run test         # vitest run (all src/**/*.test.ts)
npm run test:watch   # vitest watch mode
npx tsc --noEmit     # typecheck (strict mode, jsxImportSource: nativewind)
```

## Architecture

### Entry & Navigation

- **index.ts** — Expo entry; registers with `@expo/metro-runtime`.
- **App.tsx** — wraps `ErrorBoundary` > `SafeAreaProvider` > `NavigationContainer` > `RootNavigator`.
- **`src/navigation/RootNavigator.tsx`** — auth-gated stack (Login → NotInRoster → Permissions → Main tabs). `RootStackParamList` is the shared route-type export. The `AppTabs` bottom nav conditionally shows floor/orders/pickups/deliveries tabs based on `activeRole`. On mount, initializes live Firestore listeners for ops_staff, store resources, order feed, and ops_process (all via Zustand stores). Includes an auto-logout heartbeat (11:30 PM cutoff + stale-shift detection).

### Firebase Architecture

**Dual SDK setup — both are live:**

- **`src/config/firebase.ts`** — Firebase Web SDK (`firebase` v12). Imports used by all stores on **web target**. Exports a unified interface: `app`, `db`, `auth`, `functions`, `storage`, and re-exports all Firestore/Auth functions.
- **`src/config/firebase.native.ts`** — `@react-native-firebase/*` SDK. Same export shape. Used on **native builds** (iOS/Android) — the module bundler resolves `.native.ts` automatically.

Both files export the same interface: `{ auth, db, functions, storage, app, onAuthStateChanged, signInWithPhoneNumber, signOut, ConfirmationResult }` plus Firestore utilities. Stores import from `../config/firebase` and get the correct SDK per platform.

**Phone auth**: Web uses `RecaptchaVerifier`. Native uses `@react-native-firebase/auth`. Phone numbers are prefixed with `+91` before sending OTP.

### State Management (Zustand stores — all in `src/store/`)

Stores are singletons created with `create()`. They own all data fetching (Firestore `onSnapshot` listeners) and callable invocations — screens and components read/write via store hooks.

| Store | Responsibility |
|---|---|
| **authStore** | Firebase phone-auth (OTP flow), roster lookup, user profile. `initializeAuth()` wires `onAuthStateChanged`; fetches role from `config/opsStaff` doc. |
| **opsStaffStore** | Real-time `ops_staff/{uid}` doc, `ops_tasks` query (rider pickups), `ops_delivery_tasks` query (rider deliveries). Audio alerts on new assignments. `goOnShift`/`goOffShift` sync status. |
| **orderFeedStore** | `collectionGroup('orders')` realtime snapshot → `FeedOrder[]`. Used by intake screen and supervisor floor board. |
| **opsProcessStore** | `ops_process` collection listener + all `opsProcessing` callable invocations (claim, acceptStep, startStep, completeStep, scanGarment, printLabels, submitTagging, etc.) and `supervisorActions` callable (cancel, reschedule, assign rider, verify delivery OTP). |
| **attendanceStore** | Shift lifecycle (clock in/out, lunch, short breaks) with live timers and limits (2h lunch, 10min breaks, max 3 breaks). Writes to `ops_attendance/{uid}/shifts/{date}`. |
| **storeResourcesStore** | Reads `config/storeResources` doc for washer/dryer/ironing station counts (affects workflow step generation). |

### Cloud Functions

- **`ops/functions/index.js`** (`~1320 lines`) — main backend logic: `opsProcessing` (claim/step/scans/tagging/packaging/labels), `supervisorActions` (cancel/reschedule/assign), dispatch logic, and `fetch_otp`.
- **`ops/functions/dispatch.js`**, **`ops/functions/fetch_otp.js`**, **`ops/functions/scratch.js`** — supporting tools.
- Deployed via Firebase CLI. The callables are called directly from `opsProcessStore`.

### Data contracts

**Service types** (`ServiceType`): `'wash_fold' | 'wash_iron' | 'ironing' | 'blanket_wash'` — production contract shared with Livfresh customer app. Do NOT change.

**Order statuses** (`OrderStatus`): `'placed' | 'confirmed' | 'in_transit_to_store' | 'pickup_completed' | 'processing' | 'ready' | 'out_for_delivery' | 'delivered' | 'cancelled'` — also contracted. The ops app reads via `collectionGroup('orders')`.

**Processing steps**: `'getting_washed' | 'getting_ironed' | 'getting_dried'` plus tagging/prestain/packaging/done — defined in `utils/opsProcess.ts` step labels.

### Screens by role

| Role | Tabs / Screens |
|---|---|
| **supervisor** | Dashboard (with supervisory controls), Floor Board (order queue with management), Settings |
| **helper / iron** | Dashboard, Processing (pipeline UI with step-by-step workflow), Settings |
| **rider** | Dashboard, Pickups, Deliveries, Settings (plus `GlobalAssignmentModal` overlay) |

### Component modals

- `GlobalAssignmentModal` — overlays for riders (new task announcements)
- `HelperAssignmentModal` — overlays for helpers/ironers (step-task assignments)
- `AssignRiderModal`, `CancelOrderModal`, `RescheduleModal` — supervisor actions
- `EditOrderModal`, `DeliveryVerification`, `FaceVerification`, `PackagingVerification`, `QualityVerification` — verification/override modals
- `FloatingTaskCard` — persistent task indicator
- `WorkflowSteps` — shared pipeline step component
- `QRScanner` — expo-camera barcode scanner used for garment tag scanning

### Styling

NativeWind/Tailwind with a custom dark theme in `tailwind.config.js`. Key custom tokens: `bgDark`, `bgSurface`, `bgSurfaceLight`, `textPrimary`, `textSecondary`, `textMuted`, `primary` (green), `warning`, `error`, `info`. Use these classes — not raw hex — in components.

### Metro config

- `metro.config.js` enables `.cjs` extension (Firebase v12 support) and disables `unstable_enablePackageExports` (Zustand v5 ESM compat fix).
- Reanimated Babel plugin + NativeWind Babel plugin in `babel.config.js`.

## UI / pattern library

- All icons: `lucide-react-native` (consistent with existing usage — check imports before picking alternatives)
- Fonts: system default (no custom fonts loaded)

## Gotchas

- **Both Firebase Web SDK and native `@react-native-firebase/*` are installed.** The `.native.ts` extension resolves for native; stores import from `src/config/firebase`. Don't add another firebase config file.
- **Phone auth works only on web** (reCAPTCHA). Native path shows an "requires Web Environment" alert. Always test auth flows in browser.
- **No test runner for components** — vitest only runs `src/**/*.test.ts` (node environment). No lint setup.
- **Global CSS** (`global.css`) is the NativeWind entry point — don't rename or delete.