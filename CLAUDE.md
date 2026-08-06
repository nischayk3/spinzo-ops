# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Overview

SpinZo Ops is the internal store-operations app for the Livfresh laundry service. Helpers/riders scan QR codes to clock shifts, then process laundry orders through an in-store pipeline (tagging → washing → drying → ironing → folding → packaging → ready). Built with Expo SDK 57 + Expo Router-free React Navigation, TypeScript (strict), NativeWind v4, Zustand, and the Firebase Web SDK.

## Commands

```sh
npm start          # start Expo dev server
npm run web        # run in browser (primary dev target — phone auth works here)
npm run ios        # run in iOS simulator
npm run android    # run on Android
npx tsc --noEmit   # typecheck (tsconfig is strict)
```

There is no test or lint setup. The web target is the only one where the full auth flow (phone OTP + reCAPTCHA) works.

## Architecture

- **App.tsx / index.ts** — Expo entry; wraps `NavigationContainer` around `RootNavigator`.
- **`src/navigation/RootNavigator.tsx`** — auth-gated stack. Reads `isLoggedIn` / `activeRole` from the auth store: not logged in → `Login`; logged in but no role → `SelectRole`; otherwise → `Main` (bottom tabs: Home/Queue/Payout/Settings) plus an `OrderDetail` modal. Exports `RootStackParamList`, which screens use to type routes.
- **`src/store/*`** — all state is Zustand. Screens read/write state via stores; they don't own data fetching.
  - **authStore** — Firebase phone-auth (OTP). `initializeAuth` wires `onAuthStateChanged`; `requestOTP`/`verifyOTP` handle the flow. Note the web-only reCAPTCHA verifier and the `+91` phone prefix.
  - **orderStore** — the core domain logic. A realtime `collectionGroup('orders')` listener drives `orders`. `getOrderPipeline(items)` computes the per-order step list from service types (ironing-only skips wash/dry/fold; `wash_*`/`blanket_wash` add washing+drying). Step lifecycle is `startTagging` / `completeTagging` / `startStep` / `completeStep`, each writing timestamps and durations. **Every write is a `dualWrite`** to both `users/{userId}/orders/{orderId}` and `vendors/{vendorId}/orders/{orderId}`.
  - **attendanceStore** — QR-scan-driven shift clock in/out, breaks, lunch. In-memory only (not persisted or synced).
- **`src/screens/`** — Auth (Login, SelectRole), Attendance (clock-in + live timer), Queue (tabbed order list + `OrderDetail` modal with the pipeline UI).
- **`src/components/QRScanner.tsx`** — expo-camera barcode scanner; handles camera permission + web camera.
- **`src/types/index.ts`** — shared domain types (ShiftRole, UserProfile, ServiceType, OrderStatus).

## Data / sync contract

Order statuses, processing sub-steps, and service types are **production contracts shared with the Livfresh customer app and admin panel** — do not change their string values. The ops app reads orders via `collectionGroup('orders')` filtered to `pickup_completed` / `processing` / `ready`, so a status outside that set will drop an order from the queue.

## Gotchas

- **Native Firebase is not installed.** `package.json` has only the `firebase` (web) SDK. `src/services/firebase.ts` and `src/services/firebase.native.ts` (which requires uninstalled `@react-native-firebase/*`) are orphaned — the stores actually import from `src/config/firebase.ts`, which duplicates `firebaseConfig`. Keep edits in `src/config/firebase.ts`.
- **Phone auth works only on web.** The native path shows an "requires Web Environment" alert, so test auth flows in the browser.
- **Styling is NativeWind/Tailwind** with a custom dark theme in `tailwind.config.js` (`bgDark`, `bgSurface`, `bgSurfaceLight`, `textPrimary`, `textSecondary`, `textMuted`, `primary` green, `warning`, `error`, `info`). Use these classes rather than raw hex in components.
- Reanimated's Babel plugin is already configured in `babel.config.js`; don't re-add it.
