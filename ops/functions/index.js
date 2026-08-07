const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onCall } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { pickRider, pickupGuard, normalizePhone, taskTransition, opsStepsForOrder, isProductionStep, firstProductionStep, parseGarmentQr, generateLabels } = require('./dispatch');

// Which steps a role may claim/start. Supervisors bypass; iron people take only
// ironing; helpers take everything except ironing (Phase 5 wires iron dispatch).
function stageRoleGate(step, role) {
  if (role === 'supervisor') return true;
  if (role === 'iron') return step === 'getting_ironed';
  return step !== 'getting_ironed'; // helper
}

admin.initializeApp();
const db = admin.firestore();
const TS = () => admin.firestore.FieldValue.serverTimestamp();

function pickupAddressFromOrder(order) {
  const a = order && order.address;
  if (!a) return '';
  return typeof a === 'string' ? a : (a.address || a.line1 || '');
}

async function selectRider() {
  // Authorized rider phones from the roster.
  let rosterPhones = {};
  const rosterSnap = await db.doc('config/opsStaff').get();
  if (rosterSnap.exists && rosterSnap.data().phones) rosterPhones = rosterSnap.data().phones;

  // On-shift riders: query by role (single-field), filter onShift in code.
  const riders = await db.collection('ops_staff').where('role', '==', 'rider').get();
  const candidates = [];
  for (const doc of riders.docs) {
    const d = doc.data();
    if (d.onShift !== true) continue;
    candidates.push({
      uid: doc.id,
      phone: d.phone || '',
      shiftStartAt: d.shiftStartAt && typeof d.shiftStartAt.toMillis === 'function' ? d.shiftStartAt.toMillis() : 0,
    });
  }
  if (candidates.length === 0) return null;

  // Pending task count per candidate (single-field query, filter status in code).
  const taskCounts = {};
  for (const c of candidates) {
    const tasks = await db.collection('ops_tasks').where('assignee', '==', c.uid).get();
    let pending = 0;
    tasks.forEach((t) => { if (t.data().status === 'pending') pending += 1; });
    taskCounts[c.uid] = pending;
  }

  return pickRider(candidates, taskCounts, rosterPhones);
}

function taskPayload(orderId, order, assignee, userId, vendorId) {
  return {
    orderId,
    userId,
    vendorId,
    assignee,
    status: 'pending',
    pickupAddress: pickupAddressFromOrder(order),
    pickupSlot: (order && order.pickupDetails) || null,
    tokenNumber: (order && order.tokenNumber) || null,
    pickupOTP: (order && order.pickupOTP) || null,
    assignedAt: TS(),
    createdAt: TS(),
  };
}

// Fires once per order (triggers only watch the user path, not the vendor mirror).
exports.autoAssignRider = onDocumentCreated('users/{userId}/orders/{orderId}', async (event) => {
  if (!event.data) return; // doc deleted before delivery
  const orderId = event.params.orderId;
  const order = event.data.data();

  const assignee = await selectRider();
  const userId = event.params.userId;
  const vendorId = order.vendorId || 'vendor_1';
  const payload = assignee
    ? taskPayload(orderId, order, assignee, userId, vendorId)
    : {
        orderId,
        userId,
        vendorId,
        status: 'pending',
        pickupAddress: pickupAddressFromOrder(order),
        pickupSlot: (order && order.pickupDetails) || null,
        tokenNumber: (order && order.tokenNumber) || null,
        pickupOTP: (order && order.pickupOTP) || null,
        createdAt: TS(),
      };

  // Atomic: re-read the task inside the tx so concurrent deliveries can't double-assign
  // or park an already-assigned order (triggers are at-least-once).
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(db.doc(`ops_tasks/${orderId}`));
    if (existing.exists) return;
    const queueExists = (await tx.get(db.doc(`ops_queue/${orderId}`))).exists;
    if (queueExists) return;
    tx.set(assignee ? db.doc(`ops_tasks/${orderId}`) : db.doc(`ops_queue/${orderId}`), payload);
  });
});

// When a rider goes on shift, claim any parked orders.
exports.onShiftCatchUp = onDocumentUpdated('ops_staff/{staffId}', async (event) => {
  if (!event.data) return; // doc deleted before delivery
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (!after) return;
  const wentOnShift = before && before.onShift !== true && after.onShift === true;
  if (!wentOnShift || after.role !== 'rider') return;

  // Oldest parked orders first (top-level collection, single-field index — no composite index).
  const queue = await db.collection('ops_queue').orderBy('createdAt', 'asc').limit(50).get();
  const pending = queue.docs.filter((d) => d.data().status === 'pending');

  for (const entry of pending) {
    const orderId = entry.id;
    const data = entry.data();
    try {
      const assignee = await selectRider();
      if (!assignee) continue; // still no eligible rider; leave parked
      await db.runTransaction(async (tx) => {
        const taskRef = db.doc(`ops_tasks/${orderId}`);
        const taskSnap = await tx.get(taskRef);
        if (taskSnap.exists) {
          tx.delete(entry.ref);
          return;
        }
        tx.set(taskRef, {
          orderId,
          userId: data.userId || null,
          vendorId: data.vendorId || null,
          assignee,
          status: 'pending',
          pickupAddress: data.pickupAddress || '',
          pickupSlot: data.pickupSlot || null,
          tokenNumber: data.tokenNumber || null,
          pickupOTP: data.pickupOTP || null,
          assignedAt: TS(),
          createdAt: data.createdAt || TS(),
        });
        tx.delete(entry.ref);
      });
    } catch (err) {
      console.error(`catch-up failed for ${orderId}`, err);
    }
  }
});

// Max failed OTP attempts per order before verification is locked.
const MAX_OTP_ATTEMPTS = 5;

exports.opsStatusSync = onCall(async (request) => {
  // --- Auth: must be a logged-in ops staff phone user with role rider or supervisor.
  const auth = request.auth;
  if (!auth) return { ok: false, error: 'unauthorized' };
  const phone = normalizePhone(auth.token && auth.token.phone_number);
  if (!phone) return { ok: false, error: 'unauthorized' };

  const rosterSnap = await db.doc('config/opsStaff').get();
  const rosterPhones = rosterSnap.exists && rosterSnap.data().phones ? rosterSnap.data().phones : {};
  const role = rosterPhones[phone];
  if (role !== 'rider' && role !== 'supervisor') return { ok: false, error: 'unauthorized' };

  // --- Input validation.
  const data = request.data || {};
  const orderId = data.orderId;
  const otp = String(data.otp || '');
  if (!orderId || typeof orderId !== 'string' || !/^\d{4}$/.test(otp)) {
    return { ok: false, error: 'invalid_input' };
  }

  // --- Soft assignee gate: riders may only verify their own task; supervisors bypass.
  const taskSnap = await db.doc(`ops_tasks/${orderId}`).get();
  let task = null;
  if (taskSnap.exists) {
    task = taskSnap.data();
    if (role === 'rider' && task.assignee && task.assignee !== auth.uid) {
      return { ok: false, error: 'unauthorized' };
    }
  } else if (role === 'rider') {
    // No task assigned to this order; only a supervisor may verify it.
    return { ok: false, error: 'unauthorized' };
  }

  // --- Rate-limit: fail closed on repeated wrong OTPs (fail-open if no counter yet).
  const attempts = Number(task && task.otpAttempts) || 0;
  if (attempts >= MAX_OTP_ATTEMPTS) return { ok: false, error: 'locked' };

  // --- Resolve the order via the task's userId (task docs carry it from Phase 3).
  // A direct doc read avoids the collection-group documentId lookup, which the
  // Admin SDK rejects for bare ids.
  const userId = task && task.userId;
  if (!userId) return { ok: false, error: 'not_found' };
  const orderSnap = await db.doc(`users/${userId}/orders/${orderId}`).get();
  if (!orderSnap.exists) return { ok: false, error: 'not_found' };
  const order = orderSnap.data();

  const vendorId = (task && task.vendorId) || order.vendorId || 'vendor_1';
  const now = admin.firestore.Timestamp.now();

  // --- Transaction: re-read + status guard + OTP re-verify + dual write + task flip.
  try {
    const result = await db.runTransaction(async (tx) => {
      const orderRef = db.doc(`users/${userId}/orders/${orderId}`);
      const snap = await tx.get(orderRef);
      if (!snap.exists) return { ok: false, error: 'not_found' };
      const current = snap.data();

      const guard = pickupGuard(current.status);
      if (guard === 'alreadyDone') return { ok: true, alreadyDone: true };
      if (guard === 'invalidState') return { ok: false, error: 'invalid_state' };

      // Re-verify the OTP against the freshly-read doc inside the tx (no stale-OTP race).
      if (String(otp) !== String(current.pickupOTP)) {
        if (task) {
          tx.update(db.doc(`ops_tasks/${orderId}`), { otpAttempts: admin.firestore.FieldValue.increment(1) });
        }
        return { ok: false, error: 'invalid_otp' };
      }

      // The assigned rider always has a task doc; if none exists (supervisor verifying a
      // parked order), proceed without the task flip rather than aborting the whole write.
      const updateData = {
        status: 'pickup_completed',
        pickupVerified: true,
        pickedUpAt: now,
        updatedAt: now,
      };
      const tokenNumber = data.tokenNumber || current.tokenNumber;
      if (tokenNumber) updateData.tokenNumber = tokenNumber;

      tx.update(db.doc(`users/${userId}/orders/${orderId}`), updateData);
      tx.update(db.doc(`vendors/${vendorId}/orders/${orderId}`), updateData);
      if (task) {
        tx.update(db.doc(`ops_tasks/${orderId}`), {
          status: 'picked_up',
          pickedUpAt: now,
          otpAttempts: admin.firestore.FieldValue.delete(),
        });
      }
      return { ok: true };
    });
    return result;
  } catch (err) {
    console.error('opsStatusSync failed', err);
    return { ok: false, error: 'server_error' };
  }
});

// Keep the rider's task/queue in sync when an order's status changes elsewhere
// (e.g. canceled, or pickup_completed via the admin panel instead of opsStatusSync).
exports.syncTaskFromOrder = onDocumentUpdated('users/{userId}/orders/{orderId}', async (event) => {
  if (!event.data) return;
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (!before || !after) return;

  const trans = taskTransition(before.status, after.status);
  if (!trans) return;

  const orderId = event.params.orderId;

  if (trans.dropQueue) {
    try {
      await db.doc(`ops_queue/${orderId}`).delete();
    } catch (err) {
      // Best-effort; a leftover queue entry is harmless (re-checked on catch-up).
      console.error(`syncTaskFromOrder: queue delete failed for ${orderId}`, err);
    }
    try {
      await db.doc(`ops_process/${orderId}`).delete();
    } catch (err) {
      console.error(`syncTaskFromOrder: process delete failed for ${orderId}`, err);
    }
  }

  if (trans.taskStatus) {
    try {
      const taskRef = db.doc(`ops_tasks/${orderId}`);
      const snap = await taskRef.get();
      if (snap.exists && snap.data().status === 'pending') {
        await taskRef.update({
          status: trans.taskStatus,
          ...(trans.taskStatus === 'picked_up' ? { pickedUpAt: TS() } : { cancelledAt: TS() }),
        });
      }
    } catch (err) {
      console.error(`syncTaskFromOrder failed for ${orderId}`, err);
    }
  }
});

exports.opsProcessing = onCall(async (request) => {
  const auth = request.auth;
  if (!auth) return { ok: false, error: 'unauthorized' };
  const phone = normalizePhone(auth.token && auth.token.phone_number);
  if (!phone) return { ok: false, error: 'unauthorized' };

  const rosterSnap = await db.doc('config/opsStaff').get();
  const rosterPhones = rosterSnap.exists && rosterSnap.data().phones ? rosterSnap.data().phones : {};
  const role = rosterPhones[phone];
  if (role !== 'helper' && role !== 'iron' && role !== 'supervisor') return { ok: false, error: 'unauthorized' };

  const data = request.data || {};
  const orderId = data.orderId;
  const action = data.action;
  if (!orderId || typeof orderId !== 'string') return { ok: false, error: 'invalid_input' };
  if (!['claim', 'startStep', 'completeStep', 'printLabels', 'scanGarment', 'unregisterGarment', 'submitTagging'].includes(action)) {
    return { ok: false, error: 'invalid_input' };
  }

  const taskSnap = await db.doc(`ops_tasks/${orderId}`).get();
  const task = taskSnap.exists ? taskSnap.data() : null;
  const userId = task && task.userId;
  const vendorId = (task && task.vendorId) || 'vendor_1';
  if (!userId) return { ok: false, error: 'not_found' };

  const orderRef = db.doc(`users/${userId}/orders/${orderId}`);
  const processRef = db.doc(`ops_process/${orderId}`);
  const now = admin.firestore.Timestamp.now();

  if (action === 'claim') {
    // Claim = start the tagging stage. A helper claiming an order begins tagging it.
    // Idempotent and atomic: the process doc existence + fresh order status are
    // re-checked inside the transaction.
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return { ok: false, error: 'not_found' };
    const order = orderSnap.data();
    if (order.status !== 'pickup_completed') return { ok: false, error: 'invalid_state' };

    const steps = opsStepsForOrder(order);
    const prodStep = firstProductionStep(steps);

    try {
      const result = await db.runTransaction(async (tx) => {
        const processSnap = await tx.get(processRef);
        if (processSnap.exists) return { ok: false, error: 'already_claimed' };

        const orderFresh = (await tx.get(orderRef)).data();
        if (orderFresh.status !== 'pickup_completed') return { ok: false, error: 'invalid_state' };

        const staffSnap = await tx.get(db.doc(`ops_staff/${auth.uid}`));
        const name = staffSnap.exists ? staffSnap.data().name || '' : '';

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

        // tagging/prestain are ops-only; only the first production step reaches the
        // customer-facing processingStep contract.
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

  if (action === 'startStep') {
    const processSnap = await processRef.get();
    if (!processSnap.exists) return { ok: false, error: 'not_found' };
    const process = processSnap.data();
    const step = process.steps[process.currentIndex];
    if (!step) return { ok: false, error: 'invalid_state' };
    if (!stageRoleGate(step, role)) return { ok: false, error: 'unauthorized' };

    const stage = process.stages && process.stages[step];
    if (stage && stage.startedAt) return { ok: false, error: 'already_started' };

    const staffSnap = await db.doc(`ops_staff/${auth.uid}`).get();
    const name = staffSnap.exists ? staffSnap.data().name || '' : '';

    try {
      const result = await db.runTransaction(async (tx) => {
        const freshSnap = await tx.get(processRef);
        if (!freshSnap.exists) return { ok: false, error: 'not_found' };
        const fresh = freshSnap.data();
        const freshStep = fresh.steps[fresh.currentIndex];
        if (freshStep !== step) return { ok: false, error: 'invalid_state' };
        const s = fresh.stages && fresh.stages[step];
        if (s && s.startedAt) return { ok: false, error: 'already_started' };

        // Validate the order status BEFORE issuing any write. In Firestore,
        // returning an error from a tx callback still commits writes already
        // issued — only throwing aborts the whole tx. So for production steps,
        // re-read the order and reject here if it's no longer processing, so a
        // failed startStep never leaves the stage started.
        if (isProductionStep(step)) {
          const orderFresh = (await tx.get(orderRef)).data();
          if (orderFresh.status !== 'processing') return { ok: false, error: 'invalid_state' };
        }

        tx.update(processRef, {
          stages: {
            ...(fresh.stages || {}),
            [step]: { assignee: auth.uid, assigneeName: name, startedAt: now },
          },
        });

        // Production processingStep is written ONLY for production steps, and only
        // while the order is still in the processing status. tagging/prestain never
        // leak into the production contract.
        if (isProductionStep(step)) {
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

  // Tagging actions operate on the caller's own tagging stage (assigned at claim).
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
        ...(g.process.garments || {}),
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

  return { ok: false, error: 'invalid_input' };
});
