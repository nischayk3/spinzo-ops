# SpinZo Ops — State of the Repository

**Generated:** 2026-10-31
**Language:** TypeScript strict, 26,560 LOC (src + ops/functions)
**Runtime:** Expo SDK 57, React Navigation (no Expo Router), React Native (targets web + iOS + Android)
**Auth:** Claude Code (routed via claude-code-router → experiential deepseek-v4.1-flash + other free providers)

---

## 1. Architecture

### Separation of concerns

- **`src/`** — Expo/RN app (entry, navigation, screens, stores, components, utils, types, config)
- **`ops/functions/`** — Firebase Cloud Functions (callables: `opsProcessing`, `supervisorActions`, `fetch_otp`, `dispatch.js`, `scratch.js`)
- **`modules/spinzo-overlay/`** — Native Android overlay Kotlin module (expo-module, FCM, wake lock, ring alerts)
- **`docs/`** — GSD superpowers specs (2 existing design docs)
- **`.claude/`** — Claude Code project config, hooks, plugins/cache (claude-mem, CodeGraph, GSD, superpowers)

### Firebase dual-SDK split

| Platform | SDK | File | Notes |
|---|---|---|---|
| Web | `firebase` JS v12 | `src/config/firebase.ts` | reCAPTCHA phone auth (works), offline persistence OFF by default |
| Native | `@react-native-firebase/*` | `src/config/firebase.native.ts` | Offline persistence ON by default; phone auth shows "requires Web Environment" alert |

Both export the same interface shape. Stored `firebase.ts` has 14 DB-based re-exports, `firebase.native.ts` has 20. The `.native.ts` boundary has no type-level guard.

### App entry → navigation → stores

```
index.ts → App.tsx → ErrorBoundary → SafeAreaProvider → NavigationContainer → RootNavigator
```

`RootNavigator` mounts all listeners on first render:
- `initializeAuth()` (authStore) — wires `onAuthStateChanged`, fetches roster, resolves role
- `useOpsStaffStore` initialize + `useOrderFeedStore` initialize + `useOpsProcessStore` initialize — Firestore `onSnapshot` listeners
- `setupNotificationChannels()` + `stopAlarm()` + `clearAssignmentNotifications()`

---

## 2. Zustand stores (8 total)

All are singleton modules using `create()`. The same pattern: module-level `let unsub: (()=>void) | null` for the Firestore listener, torn down in `reset()`.

| Store | Listeners | Purpose |
|---|---|---|
| **authStore** | 1 (`onAuthStateChanged`) | OTP flow, roster lookup, role resolution. No Firestore listener, but calls `fetchRoster()` and `fetchStaffName()` as side-effects. |
| **opsStaffStore** | 3 | `ops_staff/{uid}` doc, `ops_tasks` where assignee==uid, `ops_delivery_tasks` where assignee==uid. Audio alerts on new assignments. |
| **orderFeedStore** | 1 | `collectionGroup('orders')` — **unbounded**, every order in every store. Guards with `d.ref.path.startsWith('users/')`. |
| **opsProcessStore** | 1 | `ops_process` collection — all process records. Also holds all `opsProcessing` and `supervisorActions` callable wrappers. |
| **attendanceStore** | 0 | No Firestore listener. Shift lifecycle (clock in/out, lunch, breaks) via direct writes + local timers. |
| **storeResourcesStore** | 1 | `config/storeResources` doc (washer/dryer/iron counts). Minor: subscribes before unsubscribing old listener. |
| **staffRosterStore** | 1 | `ops_staff` where onShift==true. Used by Supervisor. |
| **washerReminderStore** | 0 | FCM-based washer-nudge tracking. |

---

## 3. Screens (14) by role

| Role | Screens |
|---|---|
| **supervisor** | DashboardScreen, FloorBoardScreen, CustomerDetailScreen, SupervisorDashboardScreen SettingsScreen, StaffAttendanceTable |
| **helper / iron** | DashboardScreen, ProcessingScreen, OrderDetailScreen, SettingsScreen |
| **rider** | DashboardScreen, PickupsScreen, DeliveriesScreen, SettingsScreen |
| **gate (auth)** | LoginScreen, NotInRosterScreen, PermissionsScreen |

### Modal overlays (12+)

- `GlobalAssignmentModal` — rider task announcements (pickups/deliveries)
- `HelperAssignmentModal` — helper/ironer step-task assignments
- `AssignRiderModal`, `CancelOrderModal`, `RescheduleModal` — supervisor
- `EditOrderModal`, `DeliveryVerification`, `FaceVerification` — verification
- `PackagingVerification`, `QualityVerification` — QC
- `FloatingTaskCard` — persistent task indicator
- `StageNudgeModal` — helper washer/dryer nudges
- `WasherReminderModal` — FCM-driven nudges

---

## 4. Processing pipeline

### Statuses (contracted with production app)

```
placed → confirmed → in_transit_to_store → pickup_completed → processing
→ ready → out_for_delivery → delivered — or — cancelled
```

### Processing steps (ops-side)

```
tagging → prestain → getting_washed → getting_dried → getting_ironed
→ packaging → done
```

### Service types (contracted)

`wash_fold | wash_iron | ironing | blanket_wash`

### Step allocation by store role (ProcessingScreen.tsx)

- STAGE_ORDER: `getting_washed` → `getting_dried` → `getting_ironed` → `packaging`
- HELPER_TABS: all except `getting_ironed`
- `canStartStage()` in ProcessingScreen.tsx gates access by role

---

## 5. Cloud Functions

| File | Lines | Purpose |
|---|---|---|
| `ops/functions/index.js` | ~1320 | All `opsProcessing` callables + `supervisorActions` + dispatch logic |
| `ops/functions/dispatch.js` | - | Order dispatch/split logic |
| `ops/functions/fetch_otp.js` | - | OTP generation |
| `ops/functions/scratch.js` | - | Scratch/misc |

---

## 6. Tooling stack

### Active (used this session or loaded at start)

| Tool | Purpose | Status |
|---|---|---|
| **CodeGraph** | SQLite code-knowledge-graph MCP — local, read-only, indexed | Working |
| **claude-mem** v15.6.0 | Background observer captures sessions → Chroma + SQLite | **REPAIRED this session** — was broken for 27 days (1504 consecutive failures). Two bugs fixed: (1) missing `~/.claude-mem/.env` (credentials stripped by blocklist), (2) `CLAUDE_MEM_OBSERVER_THINKING` default `disabled`→400 from router |
| **claude-code-router** | Proxies Claude Code → free/cheap upstreams via `127.0.0.1:3456` | Working but fragile. Known CCR #1378 thinking-reasoning bug. 8 provider keys in plaintext (mode 644) |

### Installed but usage uncertain

| Tool | Stars/Scale | Risk Level |
|---|---|---|
| **GSD plugin suite** | ~60k stars, 40+ commands | Medium — high process overhead for single-session work; known quality drop by Plan 03-04 |
| **Superpowers skills** | Marketing + dev workflow | Low-Medium — marginally skimmable at 1% confidence |
| **Marketing skills** (seo, copywriting, cro, etc.) | ~30+ skills | Low — skipped unless invoked; bloat if auto-loaded |

### Not present

| Element | Notes |
|---|---|
| No component test runner | vitest only runs `src/**/*.test.ts` (node), no RNTL |
| No Sentry | Zero field crash visibility |
| No EAS Update staged rollouts | No written rollback procedure |
| No Firestore security rules audit | Likely permissive or absent on ops collections |
| No offline-idempotency tests | Write path around queue ordering and retry is untested |
| No feature flags / remote config | No kill-switch for a bad code path without a build |

---

## 7. Structural risks (prioritized)

1. **Unbounded `collectionGroup('orders')` listener** — every order mutation fans out to every connected staff device. No `storeId` filter, no pagination. Highest cost/blast radius.

2. **Routed AI tooling fragility** — the main agentic loop runs through CCR → free/cheap upstreams. Evidence from this session: `WebSearch` also fails with the same 400, and silent tool-arg corruption is a documented CCR pattern (#1397). The main loop's failure mode on non-Claude models is silent corruption, not a clean error.

3. **claude-mem was silently broken for 27 days** — no alarm, no dashboard, no dead-man's-switch. The `doctor` command is pull-based. This exact problem is now fixed but the monitoring gap remains.

4. **Native platform is a second-class citizen** — phone auth doesn't work on native ("requires Web Environment" alert), offline persistence defaults differ (web=OFF, native=ON), and workload on native has never been tested. RNFirebase v26 requires New Architecture/TurboModules.

5. **No component tests** — the React Navigation + Zustand + Firestore listener architecture has zero test coverage. Only pure utils have vitest tests.

6. **`.claude-code-router/config.json` world-readable** — 8 provider API keys at mode 644. Security concern.

7. **Plugin stack overhead** — every installed skill adds always-loaded metadata. Aztec rule of thumb: 4-6 active plugins before diminishing returns; this project has ~80+.

---

## 8. Quick fix list (from this session)

| Priority | Fix | File(s) |
|---|---|---|
| P0 | Created `~/.claude-mem/.env` (chmod 600) | `~/.claude-mem/.env` |
| P0 | Set `CLAUDE_MEM_OBSERVER_THINKING=omit` (was `disabled`, which 400s) | `~/.claude-mem/settings.json` |
| P1 | Add a dead-man's-switch heartbeat for claude-mem observer health | Hook + healthchecks.io |
| P1 | `chmod 600 ~/.claude-code-router/config.json` | `~/.claude-code-router/config.json` |
| P2 | Fix the thinking round-trip upstream in clean-thinking.js (CCR #1378) | `~/.claude-code-router/plugins/clean-thinking.js` |