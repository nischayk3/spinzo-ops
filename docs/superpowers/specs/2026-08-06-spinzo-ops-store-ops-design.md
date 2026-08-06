# SpinZo Ops — Store Operations System

**Date:** 2026-08-06
**Status:** Design approved (foundation + phase plan). Building incrementally, one phase at a time.
**Companion codebases:**
- Production customer/admin app: `/Users/nischaykumar/Desktop/Developer/Livfresh.nosync` (Firebase project `spin-it-a135a`)
- Ops app (boilerplate): `/Users/nischaykumar/Desktop/Developer/spinzo-ops.nosync`

## Executive summary

We are building the store-operations system ("SpinZo Ops") on top of the existing Livfresh production Firebase backend. Staff (riders, helpers, iron men, supervisor) use the ops app and a web supervisor panel to take an order from "placed" through pickup → intake/tagging → washing → drying → ironing → folding → packaging → proof → ready → delivery, with auto-assignment to staff, loud/voice alerts, OTP-verified pickup and delivery, and full per-step tracking.

**Non-negotiable constraint:** the production app and its data must never be hampered. The ops app is read-mostly; every production state change flows through exactly one writer — an ops cloud function.

---

## Part A — Foundation (build first, then layers)

### A1. Production-safety boundary

- The ops client and supervisor panel are **read-mostly** clients. They never write a production collection directly.
- Every production state change is written by exactly one **Ops Cloud Function** (`opsStatusSync`).
- Only these fields ever mirror back to production `users/.../orders` and `vendors/.../orders`:
  - `status` — `pickup_completed`, `processing`, `ready`, `out_for_delivery`, `delivered`, `cancelled`
  - `processingStep` — only while status is `processing`
  - `pickupVerified` / `deliveryVerified` + `pickedUpAt` / `deliveredAt` — set by OTP verification
  - `deliveryOTP` is **not** copied; kept ops-side only.
- Everything else (per-step timestamps/durations, assignments, garment counts, tags, proof media) lives **ops-side** under `ops/` and never touches production.

### A1b. Staff authentication

- Staff sign in with **Firebase phone OTP** into the ops app (same pattern as the production admin login, which works on web and native).
- The ops app uses its **own auth instance / Firebase app** for ops staff — separate from the customer app and the admin app's `'Admin'` instance. This keeps sessions isolated and lets the roster (`ops/staff`) key off the verified phone number.
- The roster (`ops/staff/{staffId}`) is created/updated by an ops function when a verified phone number matches a staff entry; the staff member's role (`rider/helper/iron/supervisor`) is read from that roster.

### A2. Dedicated ops backend

- New cloud functions in the **same Firebase project** (`spin-it-a135a`) — required so they can write `users/.../orders` / `vendors/.../orders` with the Admin SDK and read `config/adminPhones`.
- Deployed as a **separate codebase** `ops/functions/` so it can never tangle with the production `functions/`.
- Same billing / Firestore / Storage. New deploy surface is only the ops triggers.

### A3. New ops collections (all under `ops/`)

| Collection | Purpose | Written by |
|---|---|---|
| `ops/staff/{staffId}` | Roster: uid, role (`rider/helper/iron/supervisor`), name, phone, **on-shift state + current load** | Ops cloud functions |
| `ops/orders/{orderId}` | Per-order tracking: steps + per-step timestamps/durations, **assignments**, garment count, tags, proof media, `deliveryOTP` | Ops cloud functions |
| `ops/tasks/{taskId}` | Dispatch tasks (pickup/delivery), linked to order + staff | Ops cloud functions |

### A4. Delivery OTP — the security fix

- Production stores `deliveryOTP` plaintext on the order and pushes it in the notification body. The ops system fixes this:
  - `deliveryOTP` is generated **inside the ops cloud function** and stored **only** in `ops/orders/{orderId}`.
  - Delivery verification compares it **server-side** and sets `deliveryVerified` + `deliveredAt`. The customer never self-verifies.
- `pickupOTP` stays as-is (production already stores it; the customer shares it by design).

### A5. New Firestore indexes

- Composite indexes for `ops/orders` and `ops/tasks` queries, declared in an ops `firestore.indexes.json`.
- **No changes to production indexes.**

### A6. Storage

- Proof media lives under `ops_media/{orderId}/...` (new prefix; no collision with production `orders/` or `ready_proofs/`).
- Storage rules restrict to **ops staff + supervisor only** (unlike production's "any authenticated user").

### A7. Production read access — one reversible rule

- Add a read-only `isOpsStaff()` rule to production `firestore.rules` so ops phones can listen to the realtime order feed.
- Applied **read-only** to the `orders` collection-group and `users/{userId}` (name/phone enrichment).
- Roster lives in `config/opsStaff` (list of uids), separate from `config/adminPhones`.
- This is the **single production change** we make; it is additive and reversible.

### A8. Delivery OTP vs production `deliveryOTP`

The production order already has a `deliveryOTP` field (used by the current admin panel). To avoid ambiguity:
- The ops system treats the production `deliveryOTP` field as **not authoritative** for ops flows.
- The ops function stores its own authoritative `deliveryOTP` under `ops/orders/{orderId}`.
- If the admin panel ever reads production `deliveryOTP`, it may see a stale value — acceptable, and we can migrate later.

---

## Part B — Build phases

Each phase is independently testable by placing a **real order** in the production customer app against the real Firebase backend.

### Phase 1 — Intake + realtime visibility
- **Goal:** A real order placed in production appears live in the ops app and supervisor panel.
- **Scope:**
  - Ops backend deployed with the `isOpsStaff` read-only rule and `config/opsStaff` seeded with staff uids.
  - Ops app (native) reads the realtime `collectionGroup('orders')` feed; orders appear in an intake queue.
  - Supervisor web panel shows the same live feed (read-only board).
  - Order card shows: id, status, customer, service types + items, pickup slot, address, token.
- **Deliverables:** ops backend deploy; ops app intake screen; supervisor panel read-only board; staff onboarding to `config/opsStaff`.
- **Test:** Place a real order in the customer app → it appears in the ops app + supervisor panel within seconds.

### Phase 2 — Dispatch + loud/voice alerts
- **Goal:** When an order is placed, an on-shift rider is auto-assigned (least-busy) and alerted loudly; staff hear "new order" voice/sound.
- **Scope:**
  - `ops/staff` on-shift state (rider taps "Go on shift" / "Go off shift").
  - Auto-assign function: least-busy on-shift rider for the pickup task.
  - Loud/voice alerts: foreground TTS + custom notification sound; background/killed custom sound file.
  - Rider's app shows "You're assigned pickup for order #X" with the pickup address.
- **Deliverables:** on-shift toggle; auto-assign function; alert engine; rider assignment view.
- **Test:** Two riders on shift → place an order → exactly one rider is assigned and both get loud/voice alert (assigned one gets the pickup detail).

### Phase 3 — Pickup + OTP verification
- **Goal:** Rider reaches customer, verifies pickup OTP, order moves to `pickup_completed`.
- **Scope:**
  - Rider "Arrived at pickup" + "Verify pickup OTP" flow (reads customer-shared OTP).
  - `opsStatusSync` compares OTP server-side, sets `pickupVerified` + `pickedUpAt`, moves order to `pickup_completed`.
  - Rider marks "Clothes picked up" → order enters the store floor queue.
- **Deliverables:** pickup OTP flow; server-side verification; status transition.
- **Test:** Place order, share OTP to rider, verify → order shows `pickup_completed` in ops + production.

### Phase 4 — Helper pipeline: tagging → washing → drying
- **Goal:** A helper walks the order through intake/tagging, washing, drying, each step tracked.
- **Scope:**
  - Helper "Start intake" → counts garments → prints tags (see printing, Phase 7) → "Tagging done".
  - Auto-assign a helper to the order (or self-claim).
  - Per-step lifecycle: start/complete, timestamps + durations recorded ops-side.
  - Step progression: tagging → washing → drying.
- **Deliverables:** helper pipeline UI; per-step tracking; helper auto-assignment.
- **Test:** Place order → helper claims → counts garments → moves through tagging/washing/drying → each step recorded.

### Phase 5 — Ironing dispatch + ironing-only flow
- **Goal:** Orders needing ironing are assigned to an iron man; ironing-only orders flow straight through.
- **Scope:**
  - Auto-assign an iron man when an order reaches the ironing step (least-busy on-shift iron man).
  - Ironing-only orders (`ironing` service type): intake/tagging → assigned directly to an iron man (no wash/dry).
  - Iron man "Start ironing" / "End ironing"; per-step tracking.
- **Deliverables:** iron-man assignment; ironing-only pipeline; ironing step tracking.
- **Test:** A wash-and-iron order reaches the ironing step → an iron man is assigned; an ironing-only order skips wash/dry and goes straight to ironing.

### Phase 6 — Packaging → proof → ready → delivery OTP
- **Goal:** Packaging, photo/video proof, mark ready, delivery with OTP.
- **Scope:**
  - Packaging step (start/complete).
  - Photo/video proof capture + upload to `ops_media/` (native, fixed from the production web-only bug).
  - Mark ready → production status `ready`.
  - Delivery: auto-assign rider, verify delivery OTP server-side, order → `delivered`.
- **Deliverables:** packaging UI; proof upload; ready transition; delivery OTP flow.
- **Test:** Complete packaging → capture proof → mark ready → assign delivery rider → verify delivery OTP → `delivered`.

### Phase 7 — Supervisor web panel + label printing
- **Goal:** Supervisor monitor + garment tag printing.
- **Scope:**
  - Full live floor board: all orders, all staff, per-step live status, alerts.
  - Tag printing: supervisor web panel renders barcode label → prints to a **computer-connected** TSC TE210 label printer (ZPL over USB) — no Bluetooth/New-Architecture risk.
  - (In-app Bluetooth printing to TSC TE210 is a phase-2 extension after the hardware is validated.)
- **Deliverables:** supervisor panel; label-printing flow; printer setup.
- **Test:** Supervisor sees full floor; prints a tag from the panel; helper attaches with tag gun.

---

## Part C — How we build, test, and iterate

### Build/test loop
- Build one phase at a time, in order (each phase is independently testable).
- Test by placing a **real order** in the production customer app against the real backend.
- The ops app is a **custom dev build** (custom sounds + native modules), so development uses `expo-dev-client`; Expo Go is not supported for the full experience.

### Principles
- Never write a production collection from the ops client.
- Only the ops function writes production status.
- Ops data lives under `ops/` and is fully separate.
- One production change: the read-only `isOpsStaff` rule.
- Reversible: any phase can be torn down without touching production order integrity.

---

## Part D — Open items / to confirm during build

- Exact TSC TE210 connectivity for the supervisor-panel print flow (USB vs network).
- Which staff uids to seed into `config/opsStaff` (roster).
- Confirm the `ironing` service type covers both "only iron" and "steam iron" (production uses `ironing`).
- Whether the ops app and supervisor panel are two separate Expo projects (recommended) or one project with a web target.
- How the ops app and supervisor panel each authenticate (resolved: both use Firebase phone OTP into the ops app's own auth instance, with role from `ops/staff`).
