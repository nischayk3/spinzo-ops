# Phase 4b — Figma-Aligned Helper Flow (Per-Stage Queues + Tagging + Home) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the single-helper order pipeline with the Figma's per-stage flow: helpers claim a **stage** of any order (tagging → prestain → wash → dry → fold; iron people claim ironing), with garment-count + label printing (TSPL for the TSC TE210) + per-garment QR registration for tagging, SLA countdowns, a per-stage timeline, and a helper **Home** (identity, online toggle gated by simulated face → store-QR → geolocation, today's performance).

**Architecture:** Reuse the deployed `ops_process` + `opsProcessing` callable, but change assignment from order-level to **stage-level** (`stages` map keyed by step). Production writes stay restricted: only `claim` (pickup_completed → `processing`) and `startStep` of a production step (writes `processingStep`) touch production, dual-write user+vendor. `tagging`/`prestain`/garment data live ops-only. Label QR payloads are `SPNZ:{orderId}:{seq}` — validated server-side on scan (belongs-to-order, in-count, not-duplicate).

**Tech Stack:** firebase-functions v7 (`https.onCall`), firebase-admin v13, Expo SDK 57 (expo-camera, expo-location), Zustand, React Navigation v7, NativeWind v4. Reuses `ops_tasks`/`ops_staff`/`ops_process`, the `opsProcessing` callable, and the existing `QRScanner` component. Printing: TSPL builder (pure) + a mock/printable-preview transport on web (JSPrintManager/qz-tray scaffolded but gated on availability), mock on native.

**Design source:** `/Users/nischaykumar/Downloads/Laundry Operations Helper App` (Figma export): `Home.tsx` (online toggle → FaceVerification → QRScanner → Today's Performance), `OrderDetail.tsx` (Print Garment Labels → Scan Garment QR → Submit Tagged Garments), `TaskList.tsx` (per-stage SLA countdowns + Pending/In-Progress counts), `OrderTimeline.tsx` (per-stage helper, start/end, durations), `packaging-verify-garments.tsx` (belongs-to-order validation semantics).

---

## Current state (deployed, to be reworked)

- `ops/functions/index.js` → `opsProcessing` actions: `claim | startStep | completeStep | advanceStep`. `claim` creates `ops_process/{orderId}` with `{ steps, currentIndex:0, status:'tagging', stepTimes:{}, assignee }` (whole-order assignee) and writes production `{status:'processing', processingStep:steps[0]}`.
- `src/store/opsProcessStore.ts` → subscribes `ops_process where assignee == uid`.
- `src/screens/Helper/ProcessingScreen.tsx` → claimable list + per-order stepper.

**What changes:** `assignee` moves into a per-step `stages` map. `claim` = start tagging. `stepTimes` → `stages`. `advanceStep` is removed (production `processingStep` advances inside `startStep` of a production step). The app subscribes to **all** `ops_process` docs and derives per-stage queues + my in-progress.

---

## Data model — `ops_process/{orderId}` (new shape)

```js
{
  orderId, userId, vendorId,
  // tagging + prestain (ops-only) prepended to the production steps.
  // Ironing-only orders skip prestain: ['tagging','getting_ironed'].
  steps: ['tagging','prestain','getting_washed','getting_folded'],
  currentIndex: 0,
  status: 'tagging',            // == steps[currentIndex]; 'done' when past the end
  stages: {                     // keyed by step value
    tagging:        { assignee, assigneeName, startedAt, completedAt, durationMs },
    prestain:       { assignee, assigneeName, startedAt, completedAt, durationMs },
    getting_washed: { assignee, assigneeName, startedAt, completedAt, durationMs },
    getting_folded: { assignee, assigneeName, startedAt, completedAt, durationMs }
  },
  garments: {                   // tagging-stage data (ops-only)
    count: 12,                  // total garments entered at print time
    labelsPrintedAt: <ts>,      // set when labels are generated
    labels: [{ seq: 1, qr: 'SPNZ:<orderId>:1' }, ...],   // generated payloads
    registered: [{ seq: 1, qr: 'SPNZ:<orderId>:1', scannedAt, scannedBy }],  // scanned
    submittedAt: <ts>
  },
  claimedAt: <ts>
}
```

**Production `processingStep` contract (never broken):** only `getting_washed | getting_dried | getting_folded | getting_ironed`. `tagging`/`prestain` are NEVER written to production. On claim and during ops-only stages, production `processingStep` = the first production step.

---

## Tasks

### Task 1: Pure pipeline helpers — `ops/functions/dispatch.js` (TDD)

**Files:**
- Modify: `ops/functions/dispatch.js`
- Test: `ops/functions/dispatch.test.js`

- [ ] **Step 1: Write failing tests** for the new pure helpers.

```js
const { opsStepsForOrder, isProductionStep, firstProductionStep, parseGarmentQr, generateLabels } = require('./dispatch');

test('opsStepsForOrder: wash_fold -> tagging, prestain, wash, fold', () => {
  assert.deepEqual(opsStepsForOrder({ items: [{ serviceType: 'wash_fold' }] }), ['tagging','prestain','getting_washed','getting_folded']);
});
test('opsStepsForOrder: ironing only -> tagging, ironing (no prestain)', () => {
  assert.deepEqual(opsStepsForOrder({ items: [{ serviceType: 'ironing' }] }), ['tagging','getting_ironed']);
});
test('opsStepsForOrder: empty -> tagging, prestain, wash, fold', () => {
  assert.deepEqual(opsStepsForOrder({}), ['tagging','prestain','getting_washed','getting_folded']);
});
test('isProductionStep: true only for the 4 contract values', () => {
  for (const s of ['getting_washed','getting_dried','getting_folded','getting_ironed']) assert.equal(isProductionStep(s), true);
  assert.equal(isProductionStep('tagging'), false);
  assert.equal(isProductionStep('prestain'), false);
});
test('firstProductionStep: skips tagging/prestain', () => {
  assert.equal(firstProductionStep(['tagging','prestain','getting_washed','getting_folded']), 'getting_washed');
  assert.equal(firstProductionStep(['tagging','getting_ironed']), 'getting_ironed');
});
test('parseGarmentQr: valid payload for this order', () => {
  assert.deepEqual(parseGarmentQr('SPNZ:abc123:3', 'abc123'), { seq: 3 });
});
test('parseGarmentQr: rejects other order / bad shape', () => {
  assert.equal(parseGarmentQr('SPNZ:other:3', 'abc123'), null);
  assert.equal(parseGarmentQr('SPNZ:abc123', 'abc123'), null);
  assert.equal(parseGarmentQr('garbage', 'abc123'), null);
});
test('generateLabels: N labels, sequential seq, belongs to order', () => {
  const labels = generateLabels('abc123', 3);
  assert.equal(labels.length, 3);
  assert.deepEqual(labels.map(l => l.qr), ['SPNZ:abc123:1','SPNZ:abc123:2','SPNZ:abc123:3']);
});
```

- [ ] **Step 2: Run** `node --test` in `ops/functions/` — expect FAIL (helpers undefined).
- [ ] **Step 3: Implement** in `ops/functions/dispatch.js`:

```js
// Ops-only stages prepended to the production pipeline. Prestain is skipped for
// ironing-only orders (no wash/dry stage to inspect before).
function opsStepsForOrder(order) {
  const prod = getProcessingSteps(order);
  const onlyIroning = prod.length === 1 && prod[0] === 'getting_ironed';
  return onlyIroning ? ['tagging', ...prod] : ['tagging', 'prestain', ...prod];
}

const PRODUCTION_STEPS = new Set(['getting_washed', 'getting_dried', 'getting_folded', 'getting_ironed']);

function isProductionStep(step) {
  return PRODUCTION_STEPS.has(step);
}

// First step that is part of the production processingStep contract.
function firstProductionStep(steps) {
  return (steps || []).find(isProductionStep) || null;
}

// Parse a garment label QR. Returns { seq } when it belongs to this order.
function parseGarmentQr(qr, orderId) {
  if (typeof qr !== 'string') return null;
  const m = qr.match(/^SPNZ:(.+):(\d+)$/);
  if (!m || m[1] !== orderId) return null;
  return { seq: parseInt(m[2], 10) };
}

// Generate N label payloads for an order (server-controlled, so scanning can be
// validated against the stored list).
function generateLabels(orderId, count) {
  const n = Math.max(1, Math.floor(Number(count)) || 0);
  const out = [];
  for (let seq = 1; seq <= n; seq += 1) out.push({ seq, qr: `SPNZ:${orderId}:${seq}` });
  return out;
}
```

- [ ] **Step 4: Run** `node --test` — expect PASS.
- [ ] **Step 5: Commit** `feat(functions): ops-only tagging/prestain pipeline + garment QR helpers`

### Task 2: Rework `opsProcessing` callable — per-stage claim + tagging actions — `ops/functions/index.js`

**Files:**
- Modify: `ops/functions/index.js`

- [ ] **Step 1: Add helper imports + role/stage gate.** Pull `opsStepsForOrder, isProductionStep, firstProductionStep, parseGarmentQr, generateLabels` from `./dispatch`.

```js
// Which steps a role may claim/start.
function stageRoleGate(step, role) {
  if (role === 'supervisor') return true;
  if (role === 'iron') return step === 'getting_ironed';
  return step !== 'getting_ironed'; // helper: all except ironing
}
```

- [ ] **Step 2: Rework the role gate** in `opsProcessing` — helpers and iron people both allowed:

```js
const role = rosterPhones[phone];
if (role !== 'helper' && role !== 'iron' && role !== 'supervisor') return { ok: false, error: 'unauthorized' };
```

- [ ] **Step 3: Rework `claim`** (idempotent, tx, dual-write). `claim` now also starts the tagging stage:

```js
if (action === 'claim') {
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) return { ok: false, error: 'not_found' };
  const order = orderSnap.data();
  if (order.status !== 'pickup_completed') return { ok: false, error: 'invalid_state' };

  const steps = opsStepsForOrder(order);
  const prodStep = firstProductionStep(steps);

  try {
    const result = await db.runTransaction(async (tx) => {
      const processRef = db.doc(`ops_process/${orderId}`);
      const processSnap = await tx.get(processRef);
      if (processSnap.exists) return { ok: false, error: 'already_claimed' };

      const orderFresh = (await tx.get(orderRef)).data();
      if (orderFresh.status !== 'pickup_completed') return { ok: false, error: 'invalid_state' };

      const staff = await tx.get(db.doc(`ops_staff/${auth.uid}`));
      const name = staff.exists ? staff.data().name || '' : '';

      tx.set(processRef, {
        orderId,
        userId,
        vendorId,
        steps,
        currentIndex: 0,
        status: steps[0],
        stages: { [steps[0]]: { assignee: auth.uid, assigneeName: name, startedAt: now } },
        garments: { count: null, labelsPrintedAt: null, labels: [], registered: [], submittedAt: null },
        claimedAt: now,
      });

      const updateData = { status: 'processing', updatedAt: now };
      if (prodStep) updateData.processingStep = prodStep;
      tx.update(orderRef, updateData);
      tx.update(db.doc(`vendors/${vendorId}/orders/${orderId}`), updateData);
      return { ok: true };
    });
    return result;
  } catch (err) {
    console.error('opsProcessing claim failed', err);
    return { ok: false, error: 'server_error' };
  }
}
```

- [ ] **Step 4: Add `startStep` (replaces the old whole-order start + the advanceStep production write).** The current step must be unstarted; the caller must pass `stageRoleGate`. Writing production `processingStep` only for production steps, guarded to `processing` status, dual-write.

```js
if (action === 'startStep') {
  const processSnap = await processRef.get();
  if (!processSnap.exists) return { ok: false, error: 'not_found' };
  const process = processSnap.data();
  const step = process.steps[process.currentIndex];
  if (!step) return { ok: false, error: 'invalid_state' };
  if (!stageRoleGate(step, role)) return { ok: false, error: 'unauthorized' };

  const stage = process.stages && process.stages[step];
  if (stage && stage.startedAt) return { ok: false, error: 'already_started' };

  const staff = await db.doc(`ops_staff/${auth.uid}`).get();
  const name = staff.exists ? staff.data().name || '' : '';

  try {
    const result = await db.runTransaction(async (tx) => {
      const freshSnap = await tx.get(processRef);
      if (!freshSnap.exists) return { ok: false, error: 'not_found' };
      const fresh = freshSnap.data();
      const freshStep = fresh.steps[fresh.currentIndex];
      if (freshStep !== step) return { ok: false, error: 'invalid_state' };
      const s = fresh.stages && fresh.stages[step];
      if (s && s.startedAt) return { ok: false, error: 'already_started' };

      tx.update(processRef, {
        stages: {
          ...(fresh.stages || {}),
          [step]: { assignee: auth.uid, assigneeName: name, startedAt: now },
        },
      });

      if (isProductionStep(step)) {
        const orderFresh = (await tx.get(orderRef)).data();
        if (orderFresh.status !== 'processing') return { ok: false, error: 'invalid_state' };
        const updateData = { processingStep: step, updatedAt: now };
        tx.update(orderRef, updateData);
        tx.update(db.doc(`vendors/${vendorId}/orders/${orderId}`), updateData);
      }
      return { ok: true, step };
    });
    return result;
  } catch (err) {
    console.error('opsProcessing startStep failed', err);
    return { ok: false, error: 'server_error' };
  }
}
```

- [ ] **Step 5: Rework `completeStep`.** Caller must be the stage assignee. Advance `currentIndex`/`status`. No production write here (production `processingStep` moves when the NEXT step starts).

```js
if (action === 'completeStep') {
  const processSnap = await processRef.get();
  if (!processSnap.exists) return { ok: false, error: 'not_found' };
  const process = processSnap.data();
  const step = process.steps[process.currentIndex];
  const stage = process.stages && process.stages[step];
  if (!stage || stage.assignee !== auth.uid) return { ok: false, error: 'unauthorized' };
  if (!stage.startedAt) return { ok: false, error: 'invalid_state' };
  if (stage.completedAt) return { ok: false, error: 'already_completed' };

  const completedAt = now;
  const durationMs = Math.max(0, completedAt.toMillis() - stage.startedAt.toMillis());
  const nextIndex = process.currentIndex + 1;
  const nextStatus = nextIndex < process.steps.length ? process.steps[nextIndex] : 'done';

  await processRef.update({
    stages: { ...process.stages, [step]: { ...stage, completedAt, durationMs } },
    currentIndex: nextIndex,
    status: nextStatus,
  });
  return { ok: true, currentIndex: nextIndex, status: nextStatus };
}
```

- [ ] **Step 6: Add tagging actions** — `printLabels`, `scanGarment`, `unregisterGarment`, `submitTagging`. All operate on the caller's own tagging stage; role helper/supervisor.

```js
const taggingGate = async () => {
  const ps = await processRef.get();
  if (!ps.exists) return { ok: false, error: 'not_found', process: null };
  const p = ps.data();
  const tagStage = p.stages && p.stages.tagging;
  if (!tagStage || tagStage.assignee !== auth.uid) return { ok: false, error: 'unauthorized', process: p };
  if (tagStage.completedAt) return { ok: false, error: 'already_submitted', process: p };
  return { ok: true, process: p };
};

if (action === 'printLabels') {
  const count = Number(data.garmentCount);
  if (!Number.isInteger(count) || count < 1 || count > 500) return { ok: false, error: 'invalid_input' };
  const g = await taggingGate();
  if (!g.ok) return g;
  const labels = generateLabels(orderId, count);
  await processRef.update({
    garments: {
      ...g.process.garments,
      count,
      labelsPrintedAt: now,
      labels,
      registered: [],
    },
  });
  return { ok: true, count, labels };
}

if (action === 'scanGarment') {
  const qr = String(data.qr || '');
  const g = await taggingGate();
  if (!g.ok) return g;
  const parsed = parseGarmentQr(qr, orderId);
  if (!parsed) return { ok: false, error: 'not_this_order' };
  const garments = g.process.garments || {};
  if (parsed.seq < 1 || parsed.seq > (garments.count || 0)) return { ok: false, error: 'not_in_count' };
  if ((garments.registered || []).some(r => r.seq === parsed.seq)) return { ok: false, error: 'already_registered' };
  await processRef.update({
    garments: {
      ...garments,
      registered: [...(garments.registered || []), { ...parsed, scannedAt: now, scannedBy: auth.uid }],
    },
  });
  return { ok: true, seq: parsed.seq };
}

if (action === 'unregisterGarment') {
  const seq = Number(data.seq);
  const g = await taggingGate();
  if (!g.ok) return g;
  const garments = g.process.garments || {};
  await processRef.update({
    garments: { ...garments, registered: (garments.registered || []).filter(r => r.seq !== seq) },
  });
  return { ok: true };
}

if (action === 'submitTagging') {
  const g = await taggingGate();
  if (!g.ok) return g;
  const garments = g.process.garments || {};
  const expected = garments.count || 0;
  const got = (garments.registered || []).length;
  if (expected === 0 || got < expected) return { ok: false, error: 'not_all_registered' };

  const tagStage = g.process.stages.tagging;
  const completedAt = now;
  const durationMs = Math.max(0, completedAt.toMillis() - (tagStage.startedAt ? tagStage.startedAt.toMillis() : completedAt.toMillis()));
  const nextIndex = g.process.currentIndex + 1;
  const nextStatus = nextIndex < g.process.steps.length ? g.process.steps[nextIndex] : 'done';

  await processRef.update({
    garments: { ...garments, submittedAt: now },
    stages: { ...g.process.stages, tagging: { ...tagStage, completedAt, durationMs } },
    currentIndex: nextIndex,
    status: nextStatus,
  });
  return { ok: true, currentIndex: nextIndex, status: nextStatus };
}
```

- [ ] **Step 7: Remove the old `startStep`/`completeStep`/`advanceStep` bodies and the action-list check** — replace with the new action set `['claim','startStep','completeStep','printLabels','scanGarment','unregisterGarment','submitTagging']`.
- [ ] **Step 8: `syncTaskFromOrder`** — also delete `ops_process/{orderId}` when an order is cancelled (so a cancelled order can't be claimed/worked).

```js
// inside syncTaskFromOrder, when trans.dropQueue:
try { await db.doc(`ops_process/${orderId}`).delete(); } catch (err) { console.error(`syncTaskFromOrder: process delete failed for ${orderId}`, err); }
```

- [ ] **Step 9:** `require`-load check: `node -e "require('./index.js')"` from `ops/functions/` (guard: run from repo root, not `ops/functions`). Commit `feat(functions): per-stage opsProcessing + tagging actions`.

### Task 3: Ops app model — `opsProcess`, `sla`, `labelPrint`, `storeGeo`, `timeline` (vitest)

**Files:**
- Modify: `src/utils/opsProcess.ts`
- Create: `src/utils/sla.ts`, `src/utils/labelPrint.ts`, `src/utils/storeGeo.ts`, `src/utils/opsTimeline.ts`
- Test: `src/utils/*.test.ts` (vitest)

- [ ] **Step 1: Extend `src/utils/opsProcess.ts`.** New `OpsProcess` shape (`stages`, `garments`), tolerant parse (falls back to old `stepTimes`/`assignee`), and stage-queue derivations.

```ts
export interface StageRecord {
  assignee?: string;
  assigneeName?: string;
  startedAt?: unknown;
  completedAt?: unknown;
  durationMs?: number;
}
export interface GarmentLabel { seq: number; qr: string; }
export interface GarmentRegistration extends GarmentLabel { scannedAt?: unknown; scannedBy?: string; }
export interface GarmentsRecord {
  count?: number;
  labelsPrintedAt?: unknown;
  labels?: GarmentLabel[];
  registered?: GarmentRegistration[];
  submittedAt?: unknown;
}
export interface OpsProcess {
  id: string;
  orderId: string;
  userId?: string;
  vendorId?: string;
  steps: string[];
  currentIndex: number;
  status: string;
  stages: Record<string, StageRecord>;
  garments: GarmentsRecord;
  claimedAt?: unknown;
}

export function parseOpsProcess(id: string, snapData: Record<string, any> | null | undefined): OpsProcess {
  const d = snapData ?? {};
  return {
    id,
    orderId: d.orderId ?? id,
    userId: d.userId ?? undefined,
    vendorId: d.vendorId ?? undefined,
    steps: Array.isArray(d.steps) ? d.steps : [],
    currentIndex: d.currentIndex ?? 0,
    status: d.status ?? 'tagging',
    stages: d.stages ?? (d.stepTimes ? mapLegacyStepTimes(d.stepTimes, d.assignee) : {}),
    garments: d.garments ?? { labels: [], registered: [] },
    claimedAt: d.claimedAt ?? undefined,
  };
}

function mapLegacyStepTimes(stepTimes: Record<string, any>, assignee?: string): Record<string, StageRecord> {
  const out: Record<string, StageRecord> = {};
  for (const [k, v] of Object.entries(stepTimes || {})) {
    out[k] = { assignee, ...(v as StageRecord) };
  }
  return out;
}

export const currentStep = (p: OpsProcess): string | null => p.steps[p.currentIndex] ?? null;
export const isDone = (p: OpsProcess): boolean => p.status === 'done';
export const stage = (p: OpsProcess, step: string): StageRecord | undefined => p.stages[step];

// A stage is claimable when it is the current step and not started.
export const stepQueue = (p: OpsProcess, step: string): boolean =>
  currentStep(p) === step && !stage(p, step)?.startedAt;

export const myInProgress = (p: OpsProcess, uid: string): boolean => {
  const cur = currentStep(p);
  if (!cur || isDone(p)) return false;
  const s = stage(p, cur);
  return !!s?.assignee && s.assignee === uid && !s.completedAt;
};
```

- [ ] **Step 2: Create `src/utils/sla.ts`** — per-stage SLA + tone (design: ≤30m red, ≤60m orange, else green).

```ts
export const STAGE_SLA_MINUTES: Record<string, number> = {
  tagging: 30,
  prestain: 20,
  getting_washed: 45,
  getting_dried: 60,
  getting_folded: 30,
  getting_ironed: 45,
};

export type SlaTone = 'muted' | 'error' | 'warning' | 'ok';

export function slaRemainingMinutes(startedAt: unknown, slaMinutes: number): number {
  if (!startedAt) return slaMinutes;
  let ms: number;
  if (typeof (startedAt as any).toDate === 'function') ms = (startedAt as any).toDate().getTime();
  else if (typeof (startedAt as any).seconds === 'number') ms = (startedAt as any).seconds * 1000;
  else ms = new Date(startedAt as any).getTime();
  if (Number.isNaN(ms)) return slaMinutes;
  const elapsedMin = (Date.now() - ms) / 60000;
  return Math.max(0, slaMinutes - elapsedMin);
}

export function slaTone(remaining: number, done: boolean): SlaTone {
  if (done) return 'muted';
  if (remaining <= 30) return 'error';
  if (remaining <= 60) return 'warning';
  return 'ok';
}
```

- [ ] **Step 3: Create `src/utils/labelPrint.ts`** — TSPL builder for the TSC TE210 (203 dpi = 8 dots/mm) + a mock/printable transport.

```ts
import { Platform } from 'react-native';
import { GarmentLabel } from './opsProcess';

export interface LabelMeta { orderShort: string; }

const CRLF = '\r\n';
const DPI = 203;

const mm = (mm: number) => Math.round((mm / 25.4) * DPI);

export function buildTSPL(labels: GarmentLabel[], meta: LabelMeta, opts?: { widthMm?: number; heightMm?: number }): string {
  const w = mm(opts?.widthMm ?? 40);
  const h = mm(opts?.heightMm ?? 25);
  const lines: string[] = [];
  lines.push(`SIZE ${w} dots,${h} dots`);
  lines.push('GAP 3 mm,0');
  lines.push('DIRECTION 1');
  for (const label of labels) {
    lines.push('CLS');
    lines.push(`TEXT 60,60,"3",0,1,1,"#${meta.orderShort} #${label.seq}"`);
    lines.push(`QRCODE 60,150,M,4,A,0,"${label.qr}"`);
    lines.push('PRINT 1,1');
  }
  return lines.join(CRLF);
}

// Mock transport now; JSPrintManager/qz-tray can be slotted in behind the same
// signature once a store PC bridge is available.
export async function printGarmentLabels(labels: GarmentLabel[], meta: LabelMeta): Promise<{ ok: boolean; mock: boolean; tspl?: string }> {
  const tspl = buildTSPL(labels, meta);
  if (Platform.OS === 'web') {
    const w = window as any;
    if (w.JSPM && w.JSPM.WSStatus) {
      // TODO(bridge): send `tspl` to the store-PC JSPrintManager/qz-tray bridge.
      // Fall through to the printable preview below until the bridge exists.
    }
    openLabelPreview(tspl, labels, meta);
  }
  return { ok: true, mock: true, tspl };
}

function openLabelPreview(_tspl: string, labels: GarmentLabel[], meta: LabelMeta): void {
  if (typeof window === 'undefined') return;
  const rows = labels
    .map(l => `<div style="margin:12px 0;padding:16px;border:1px solid #999;font-family:monospace;font-size:12px">#${meta.orderShort} #${l.seq} &mdash; ${l.qr}</div>`)
    .join('');
  const win = window.open('', '_blank');
  win?.document.write(`<html><body style="font-family:sans-serif"><h3>Garment Labels (${labels.length})</h3>${rows}<script>setTimeout(()=>window.print(),300)</script></body></html>`);
  win?.document.close();
}
```

- [ ] **Step 4: Create `src/utils/storeGeo.ts`** — haversine + radius check (pure, web-safe via expo-location polyfill).

```ts
export interface LatLng { latitude: number; longitude: number; }

export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export const isWithinRadiusMeters = (user: LatLng, store: LatLng, radiusMeters: number): boolean =>
  haversineMeters(user, store) <= radiusMeters;
```

- [ ] **Step 5: Create `src/utils/opsTimeline.ts`** — build per-stage timeline entries from a process (design OrderTimeline).

```ts
import { OpsProcess, stage } from './opsProcess';

export interface TimelineEntry {
  step: string;
  label: string;
  assigneeName?: string;
  startedAt?: unknown;
  completedAt?: unknown;
  durationMs?: number;
  skipped: boolean;
}

export function opsTimeline(p: OpsProcess, stepLabelFn: (s: string) => string): TimelineEntry[] {
  return p.steps.map(step => {
    const s = stage(p, step);
    return {
      step,
      label: stepLabelFn(step),
      assigneeName: s?.assigneeName,
      startedAt: s?.startedAt,
      completedAt: s?.completedAt,
      durationMs: s?.durationMs,
      skipped: !s?.startedAt,
    };
  });
}
```

- [ ] **Step 6: Write vitest tests** for `sla` (remaining/tone), `labelPrint.buildTSPL` (contains SIZE/QRCODE/PRINT, count of PRINT lines == label count), `storeGeo` (haversine ≈ known distance, radius true/false), `opsProcess` (parse new shape + legacy fallback + stepQueue/myInProgress).
- [ ] **Step 7: Run** `npm test` (app) — PASS. Per-file `tsc --noEmit` on the changed utils. Commit `feat(app): ops model for per-stage pipeline, SLA, label TSPL, store geo`.

### Task 4: Rework `opsProcessStore` — all-processes subscription + new actions

**Files:**
- Modify: `src/store/opsProcessStore.ts`

- [ ] **Step 1: Change the subscription** from `where('assignee','==',uid)` to all `ops_process` docs (per-stage queues need visibility across the store; read is gated by `isOpsStaff` rules). Keep the uid arg for `myInProgress` derivation.

```ts
unsub = onSnapshot(
  collection(db, 'ops_process'),
  (snap) => {
    const list: OpsProcess[] = [];
    snap.forEach((d) => list.push(parseOpsProcess(d.id, d.data())));
    set({ processes: list, isLoading: false });
  },
  (err) => set({ error: String(err), isLoading: false })
);
```

- [ ] **Step 2: Extend the state + actions.** Add `processes`, keep `myProcesses` (derived via `myInProgress`), add `claim(orderId)`, `startStep(orderId)`, `completeStep(orderId)`, `printLabels(orderId, garmentCount)`, `scanGarment(orderId, qr)`, `unregisterGarment(orderId, seq)`, `submitTagging(orderId)`. All call `opsProcessing` (same `httpsCallable`) with the new action names; keep the `OpsProcessingResult` return shape and add a `labels?: GarmentLabel[]` payload for `printLabels`.

```ts
export type OpsProcessingResult =
  | { ok: true; currentIndex?: number; status?: string; step?: string; count?: number; labels?: GarmentLabel[]; seq?: number }
  | { ok: false; error: string };

printLabels: async (orderId, garmentCount) => {
  try {
    const res = await callOps()({ orderId, action: 'printLabels', garmentCount });
    return res.data;
  } catch (e: any) { return { ok: false, error: e?.message || 'request_failed' }; }
},
scanGarment: async (orderId, qr) => {
  try {
    const res = await callOps()({ orderId, action: 'scanGarment', qr });
    return res.data;
  } catch (e: any) { return { ok: false, error: e?.message || 'request_failed' }; }
},
unregisterGarment: async (orderId, seq) => {
  try {
    const res = await callOps()({ orderId, action: 'unregisterGarment', seq });
    return res.data;
  } catch (e: any) { return { ok: false, error: e?.message || 'request_failed' }; }
},
submitTagging: async (orderId) => {
  try {
    const res = await callOps()({ orderId, action: 'submitTagging' });
    return res.data;
  } catch (e: any) { return { ok: false, error: e?.message || 'request_failed' }; }
},
```

- [ ] **Step 3:** `reset()` clears `processes` too. Per-file `tsc --noEmit`. Commit `feat(app): all-process subscription + tagging actions in opsProcessStore`.

### Task 5: Processing screen rework — stage queues, Order Detail (tagging), SLA, timeline

**Files:**
- Modify: `src/screens/Helper/ProcessingScreen.tsx`
- Create: `src/screens/Helper/OrderDetailScreen.tsx`
- Modify: `src/navigation/RootNavigator.tsx` (add OrderDetail modal screen)

- [ ] **Step 1: ProcessingScreen → stage tabs + queues.** Top: a horizontal stage chip row derived from the store's active steps (`tagging`, `prestain`, `getting_washed`, `getting_dried`, `getting_folded`, `getting_ironed`). For each stage show **Pending** (orders where `stepQueue(p, step)` and the step passes `stageRoleGate` for the active role) and **In Progress** (my in-progress orders). Tapping a pending order navigates to `OrderDetail` (opens the Order Detail screen); in-progress orders open too.

```tsx
const STAGES: { step: string; roles: ShiftRole[] }[] = [
  { step: 'tagging', roles: ['helper', 'supervisor'] },
  { step: 'prestain', roles: ['helper', 'supervisor'] },
  { step: 'getting_washed', roles: ['helper', 'supervisor'] },
  { step: 'getting_dried', roles: ['helper', 'supervisor'] },
  { step: 'getting_folded', roles: ['helper', 'supervisor'] },
  { step: 'getting_ironed', roles: ['iron', 'supervisor'] },
];
```

- [ ] **Step 2: OrderDetailScreen (navigation modal)** — mirrors the Figma OrderDetail:
  - Header: order short id, customer, service summary, weight/items if available.
  - **Tagging stage** (`currentStep === 'tagging'`): garments section — if `garments.count == null`: numeric input for "Total Garments Received" + **Print Labels** → `printLabels` → `printGarmentLabels(labels)`; if printed: **Scan Garment QR** (opens existing `QRScanner` modal, `actionType="garment"`) → `scanGarment(qr)`; list of `registered` with **remove** (`unregisterGarment`); sticky **Submit Tagged Garments (N)** → `submitTagging`.
  - **Other stages / prestain**: a `startStep`/`completeStep` button for the current step (mirrors current behavior), disabled until the previous stage is complete.
  - **Timeline**: `opsTimeline(process)` rendered with per-stage duration + assignee (design OrderTimeline).
- [ ] **Step 3: Add `OrderDetail` to `RootNavigator`** as a modal `Stack.Screen` (above `Main`), params `{ orderId: string }`. ProcessingScreen reads the order from `orderFeedStore` and the process from `opsProcessStore`; fall back to `#orderId.slice(-6)`.
- [ ] **Step 4:** Per-file `tsc --noEmit`. Commit `feat(app): stage queues + OrderDetail tagging screen`.

### Task 6: Helper Home — identity, online toggle (face → store-QR → geo), performance

**Files:**
- Create: `src/screens/Helper/HomeScreen.tsx`
- Create: `src/components/FaceVerification.tsx` (simulated, mirroring the Figma)
- Modify: `src/navigation/RootNavigator.tsx`
- Modify: `src/store/opsStaffStore.ts` (extend `goOnShift` to record `storeId`/`geoVerifiedAt`; add `fetchStore`)

- [ ] **Step 1: `FaceVerification.tsx`** — simulated capture: `expo-camera` `CameraView` preview + oval guide + capture → preview → Submit (no recognition). Mirrors `FaceVerification.tsx` in the Figma export.
- [ ] **Step 2: `HomeScreen.tsx`** — identity (name from `ops_staff`/roster, ID = phone), **Online/Offline toggle**. Going online runs the gates in sequence: (1) **Face** capture, (2) **Store QR** scan (QR content `SPNZ-STORE:<storeId>`; looks up `config/opsStores`), (3) **Geo** check via `expo-location` (`requestForegroundPermissionsAsync` + `getCurrentPositionAsync`; `installWebGeolocationPolyfill` on web; `isWithinRadiusMeters` against the store's `lat/lng/radiusMeters`). On all pass → `goOnShift(uid,'helper',phone,name,{storeId, geoVerifiedAt})`. Going offline → `goOffShift(uid)`.
- [ ] **Step 3: `opsStaffStore.goOnShift`** — accept an optional `extra` object and merge into the staff doc (`storeId`, `geoVerifiedAt`, `verifiedAt`). Add `fetchStore(storeId)` helper reading `config/opsStores/{storeId}` (return `{ name, lat, lng, radiusMeters }`).
- [ ] **Step 4: Today's Performance** — compute from completed processes: `ordersCompleted` = processes with `isDone`, `avgProcessingTime` = mean of sum of `stages[step].durationMs`. Shift hours = `staffDoc.shiftStartAt` → now.
- [ ] **Step 5: Add a Home tab** for `helper`/`iron` roles as the first tab; keep Processing tab for helpers (iron role sees Home + Settings; ironing queue is reached via Home → Processing only for helpers — iron people use the Processing tab too). Update `RootNavigator.AppTabs`.
- [ ] **Step 6:** Per-file `tsc --noEmit`. Commit `feat(app): helper Home with face/store-QR/geo online gate`.

### Task 7: Rules, config seed, deploy, E2E (needs user)

**Files:**
- Modify (production repo `/Users/nischaykumar/Desktop/Developer/Livfresh.nosync`): `firestore.rules`
- Seed: `config/opsStores/{storeId}`, `config/opsStaff` roles (helper + iron)

- [ ] **Step 1: Firestore rules** — add `config/opsStores` (read ops staff, write admin). The specific `match /config/opsStores` block overrides the broader `config/{configId}` rule.

```
match /config/opsStores {
  allow read: if isOpsStaff();
  allow write: if isAdmin();
}
```

- [ ] **Step 2: Seed config** — `config/opsStores/` doc `{ name: 'Livfresh Store', lat, lng, radiusMeters }` (get real store coords from the user) and add `helper`/`iron` phones to `config/opsStaff.phones`.
- [ ] **Step 3: Deploy** — `firebase deploy --only functions:ops` (ops repo) and `firebase deploy --only firestore:rules` (production repo). Guard: only the ops functions + rules.
- [ ] **Step 4: E2E (happy path)** — login helper → Home online gate (face → store QR → geo) → place real order in customer app → rider picks up → helper sees order in Tagging queue → claim → enter garment count → Print Labels (preview) → scan each printed QR → Submit Tagged Garments → order moves to Prestain queue → another helper starts/completes Prestain → Wash → Dry → Fold; production `processingStep` advances; supervisor Floor Board shows the step.
- [ ] **Step 5: E2E (negatives)** — scan a QR from another order (`not_this_order`), scan the same label twice (`already_registered`), submit before all registered (`not_all_registered`), claim a non-`pickup_completed` order (`invalid_state`), a helper claiming `getting_ironed` (`unauthorized`), iron role claiming a wash step (`unauthorized`).

---

## Verification

- `node --test` (ops functions) green — includes new `opsStepsForOrder`, `isProductionStep`, `firstProductionStep`, `parseGarmentQr`, `generateLabels`.
- `npm test` (app) green — `sla`, `labelPrint`, `storeGeo`, `opsProcess`.
- Per-file `tsc --noEmit` clean on all changed files (repo-wide `tsc` crash is a pre-existing toolchain bug).
- E2E above, happy path + negatives.

## Risks / notes

- **Production safety:** `claim` is the only action that moves `pickup_completed → processing`; `startStep` writes `processingStep` only for the 4 contract values, guarded to `processing` status, dual-write user+vendor. `tagging`/`prestain`/garment data live ops-only. **No change to the production order doc shape.**
- **Existing ops_process docs from Phase 4** are single-assignee; the app's parse falls back to legacy `stepTimes`/`assignee`, but the per-stage actions expect the new shape. For a clean E2E, delete stale `ops_process/{orderId}` docs before testing (via the console or a `node` script using Admin SDK).
- **Prestain is ops-only** and appears for every non-ironing-only order. It can be dropped later if the store doesn't want the step — it's just a value in `steps`.
- **Label printing is mock now** (printable preview on web). Real TE210 printing needs a store-PC bridge (JSPrintManager/qz-tray) — scaffolded in `printGarmentLabels` behind the same signature.
- **Geolocation on web** needs browser permission; inside a store GPS may drift — `radiusMeters` should be generous (e.g. 150–300m) and the store QR + role gate are the primary controls; geo is a soft corroboration.
- **`iron_ready` status is dropped** — the ironing stage appears directly in the `getting_ironed` queue for iron-role helpers (Phase 5 iron dispatch is separate).
- **Cancel safety:** `syncTaskFromOrder` now also deletes `ops_process` on cancel.
