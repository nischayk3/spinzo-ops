const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onCall } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { pickRider, pickupGuard, normalizePhone, taskTransition, opsStepsForOrder, isProductionStep, firstProductionStep, parseGarmentQr, generateLabels } = require('./dispatch');

// Which steps a role may claim/start. Supervisors bypass; iron people take only
// ironing; helpers take everything except ironing (Phase 5 wires iron dispatch).
function stageRoleGate(step, role) {
  if (role === 'supervisor' || role === 'helper') return true;
  if (role === 'iron') return step === 'getting_ironed';
  return false;
}

admin.initializeApp();
const db = admin.firestore();
const TS = () => admin.firestore.FieldValue.serverTimestamp();

// Generate a random 4-digit OTP (matching production Livfresh generateOTP).
function generateOTP() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

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

exports.opsStatusSync = onCall({ cors: true, invoker: 'public' }, async (request) => {
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
  const action = data.action || 'verifyPickup'; // default to original behavior
  const otp = String(data.otp || '');
  const isDelivery = Boolean(data.isDelivery);

  if (!orderId || typeof orderId !== 'string') {
    return { ok: false, error: 'invalid_input' };
  }

  // --- Route by action ---
  if (action === 'acceptTask') {
    let targetTask = null;
    let collection = isDelivery ? 'ops_delivery_tasks' : 'ops_tasks';
    
    let docSnap = await db.doc(`${collection}/${orderId}`).get();
    if (docSnap.exists) {
      targetTask = docSnap.data();
    } else {
      // Fallback check to the other collection if not found
      const otherCollection = isDelivery ? 'ops_tasks' : 'ops_delivery_tasks';
      const otherSnap = await db.doc(`${otherCollection}/${orderId}`).get();
      if (otherSnap.exists) {
        targetTask = otherSnap.data();
        collection = otherCollection;
      }
    }
    
    if (!targetTask) return { ok: false, error: 'not_found' };
    if (targetTask.assignee !== auth.uid && role !== 'supervisor') return { ok: false, error: 'unauthorized' };
    if (targetTask.acceptedAt) return { ok: true, alreadyDone: true };

    try {
      await db.doc(`${collection}/${orderId}`).update({ acceptedAt: admin.firestore.Timestamp.now() });
      return { ok: true };
    } catch (err) {
      console.error('opsStatusSync acceptTask failed', err);
      return { ok: false, error: 'server_error' };
    }
  }

  // OTP is only required for pickup/store verification, not for acceptTask
  if ((action === 'verifyPickup' || action === 'verifyStoreOTP') && !/^\d{4}$/.test(otp)) {
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

  if (action === 'verifyStoreOTP') {
    const attempts = Number(task && task.otpAttempts) || 0;
    if (attempts >= MAX_OTP_ATTEMPTS) return { ok: false, error: 'locked' };

    const userId = task && task.userId;
    if (!userId) return { ok: false, error: 'not_found' };
    const orderSnap = await db.doc(`users/${userId}/orders/${orderId}`).get();
    if (!orderSnap.exists) return { ok: false, error: 'not_found' };
    const order = orderSnap.data();

    const vendorId = (task && task.vendorId) || order.vendorId || 'vendor_1';
    const now = admin.firestore.Timestamp.now();

    try {
      const result = await db.runTransaction(async (tx) => {
        const orderRef = db.doc(`users/${userId}/orders/${orderId}`);
        const snap = await tx.get(orderRef);
        if (!snap.exists) return { ok: false, error: 'not_found' };
        const current = snap.data();

        if (current.status === 'pickup_completed') return { ok: true, alreadyDone: true };
        if (current.status !== 'in_transit_to_store') return { ok: false, error: 'invalid_state' };

        if (String(otp) !== String(current.storeOTP)) {
          if (task) tx.update(db.doc(`ops_tasks/${orderId}`), { otpAttempts: admin.firestore.FieldValue.increment(1) });
          return { ok: false, error: 'invalid_otp' };
        }

        const updateData = { status: 'pickup_completed', updatedAt: now };
        tx.update(db.doc(`users/${userId}/orders/${orderId}`), updateData);
        tx.update(db.doc(`vendors/${vendorId}/orders/${orderId}`), updateData);
        
        if (task) {
          tx.update(db.doc(`ops_tasks/${orderId}`), {
            status: 'picked_up',
            otpAttempts: admin.firestore.FieldValue.delete(),
          });
        }
        return { ok: true };
      });
      return result;
    } catch (err) {
      console.error('opsStatusSync verifyStoreOTP failed', err);
      return { ok: false, error: 'server_error' };
    }
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
      const storeOTP = generateOTP();
      const updateData = {
        status: 'in_transit_to_store',
        pickupVerified: true,
        pickedUpAt: now,
        storeOTP,
        updatedAt: now,
      };
      const tokenNumber = data.tokenNumber || current.tokenNumber;
      if (tokenNumber) updateData.tokenNumber = tokenNumber;

      tx.update(db.doc(`users/${userId}/orders/${orderId}`), updateData);
      tx.update(db.doc(`vendors/${vendorId}/orders/${orderId}`), updateData);
      if (task) {
        tx.update(db.doc(`ops_tasks/${orderId}`), {
          status: 'in_transit_to_store',
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

// When an order becomes 'ready', create a delivery task for rider dispatch.
exports.syncDeliveryTask = onDocumentUpdated('users/{userId}/orders/{orderId}', async (event) => {
  if (!event.data) return;
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (!before || !after) return;
  // Only trigger when status changes TO 'ready'
  if (before.status === 'ready' || after.status !== 'ready') return;

  const orderId = event.params.orderId;
  const userId = event.params.userId;

  try {
    // Don't create if already exists
    const existing = await db.doc(`ops_delivery_tasks/${orderId}`).get();
    if (existing.exists) return;

    const deliveryAddress = pickupAddressFromOrder(after); // reuse same address helper
    await db.doc(`ops_delivery_tasks/${orderId}`).set({
      orderId,
      userId,
      vendorId: after.vendorId || 'vendor_1',
      type: 'delivery',
      status: 'pending', // waiting for supervisor to dispatch
      assignee: null,
      deliveryAddress,
      deliveryDate: after.deliveryDate || null,
      deliveryTime: after.deliveryTime || null,
      deliveryOTP: after.deliveryOTP || null,
      customerName: after.customerName || after.userName || '',
      customerPhone: after.customerPhone || after.userPhone || '',
      createdAt: TS(),
    });
  } catch (err) {
    console.error(`syncDeliveryTask failed for ${orderId}`, err);
  }
});

exports.opsProcessing = onCall({ cors: true, invoker: 'public' }, async (request) => {
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
  if (!['claim', 'startStep', 'completeStep', 'completePackaging', 'printLabels', 'scanGarment', 'unregisterGarment', 'submitTagging'].includes(action)) {
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
    // Claim assigns the tagging stage to the caller, so stageRoleGate applies here
    // too — iron-role users must not own tagging (helpers claim, supervisors bypass).
    if (!stageRoleGate(steps[0], role)) return { ok: false, error: 'unauthorized' };
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
    try {
      const result = await db.runTransaction(async (tx) => {
        const processSnap = await tx.get(processRef);
        if (!processSnap.exists) return { ok: false, error: 'not_found' };
        const process = processSnap.data();
        const step = process.steps[process.currentIndex];
        
        // Tagging completion goes only through submitTagging (enforces the garment
        // count/registration checks and sets garments.submittedAt).
        if (step === 'tagging') return { ok: false, error: 'use_submit' };
        
        // Packaging completion goes through completePackaging
        if (step === 'packaging') return { ok: false, error: 'use_complete_packaging' };
        
        const stage = process.stages && process.stages[step];
        if (!stage || stage.assignee !== auth.uid) return { ok: false, error: 'unauthorized' };
        if (!stage.startedAt) return { ok: false, error: 'invalid_state' };
        if (stage.completedAt) return { ok: false, error: 'already_completed' };

        const completedAt = now;
        const durationMs = Math.max(0, completedAt.toMillis() - stage.startedAt.toMillis());
        const nextIndex = process.currentIndex + 1;
        const nextStatus = nextIndex < process.steps.length ? process.steps[nextIndex] : 'done';

        tx.update(processRef, {
          stages: { 
            ...(process.stages || {}), 
            [step]: { ...stage, completedAt, durationMs } 
          },
          currentIndex: nextIndex,
          status: nextStatus,
        });

        // Mirror to production order if needed
        if (nextStatus === 'done') {
          const deliveryOTP = generateOTP();
          const updateData = { status: 'ready', readyAt: now, deliveryOTP };
          tx.update(orderRef, updateData);
          tx.update(db.doc(`vendors/${vendorId}/orders/${orderId}`), updateData);
        } else if (isProductionStep(nextStatus)) {
          const updateData = { processingStep: nextStatus, updatedAt: now };
          tx.update(orderRef, updateData);
          tx.update(db.doc(`vendors/${vendorId}/orders/${orderId}`), updateData);
        }

        return { ok: true, currentIndex: nextIndex, status: nextStatus };
      });
      return result;
    } catch (err) {
      console.error('opsProcessing completeStep failed', err);
      return { ok: false, error: 'server_error' };
    }
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
    // Belt-and-suspenders: drop any same-seq entry before appending so a concurrent
    // double-scan (stale snapshot past the pre-check) can't create a duplicate.
    await processRef.update({
      garments: {
        ...garments,
        registered: [...(garments.registered || []).filter(r => r.seq !== parsed.seq), { ...parsed, scannedAt: now, scannedBy: auth.uid }],
      },
    });
    return { ok: true, seq: parsed.seq };
  }

  if (action === 'unregisterGarment') {
    const seq = Number(data.seq);
    if (!Number.isInteger(seq) || seq < 1) return { ok: false, error: 'invalid_input' };
    const g = await taggingGate();
    if (!g.ok) return g;
    const garments = g.process.garments || {};
    await processRef.update({
      garments: { ...garments, registered: (garments.registered || []).filter(r => r.seq !== seq) },
    });
    return { ok: true };
  }

  if (action === 'submitTagging') {
    try {
      const result = await db.runTransaction(async (tx) => {
        const ps = await tx.get(processRef);
        if (!ps.exists) return { ok: false, error: 'not_found' };
        const p = ps.data();
        const tagStage = p.stages && p.stages.tagging;
        if (!tagStage || tagStage.assignee !== auth.uid) return { ok: false, error: 'unauthorized' };
        if (tagStage.completedAt) return { ok: false, error: 'already_submitted' };
        
        const garments = p.garments || {};
        const expected = garments.count || 0;
        const got = (garments.registered || []).length;
        if (expected === 0 || got < expected) return { ok: false, error: 'not_all_registered' };

        const completedAt = now;
        const durationMs = Math.max(0, completedAt.toMillis() - (tagStage.startedAt ? tagStage.startedAt.toMillis() : completedAt.toMillis()));
        const nextIndex = p.currentIndex + 1;
        const nextStatus = nextIndex < p.steps.length ? p.steps[nextIndex] : 'done';

        tx.update(processRef, {
          garments: { ...garments, submittedAt: now },
          stages: { 
            ...(p.stages || {}), 
            tagging: { ...tagStage, completedAt, durationMs } 
          },
          currentIndex: nextIndex,
          status: nextStatus,
        });

        // Mirror to production order if needed
        if (nextStatus === 'done') {
          const deliveryOTP = generateOTP();
          const updateData = { status: 'ready', readyAt: now, deliveryOTP };
          tx.update(orderRef, updateData);
          tx.update(db.doc(`vendors/${vendorId}/orders/${orderId}`), updateData);
        } else if (isProductionStep(nextStatus)) {
          const updateData = { processingStep: nextStatus, updatedAt: now };
          tx.update(orderRef, updateData);
          tx.update(db.doc(`vendors/${vendorId}/orders/${orderId}`), updateData);
        }

        return { ok: true, currentIndex: nextIndex, status: nextStatus };
      });
      return result;
    } catch (err) {
      console.error('opsProcessing submitTagging failed', err);
      return { ok: false, error: 'server_error' };
    }
  }

  if (action === 'completePackaging') {
    try {
      const result = await db.runTransaction(async (tx) => {
        const ps = await tx.get(processRef);
        if (!ps.exists) return { ok: false, error: 'not_found' };
        const process = ps.data();
        const step = process.steps[process.currentIndex];
        
        if (step !== 'packaging') return { ok: false, error: 'invalid_state' };
        
        const stage = process.stages && process.stages.packaging;
        if (!stage || stage.assignee !== auth.uid) return { ok: false, error: 'unauthorized' };
        if (!stage.startedAt) return { ok: false, error: 'invalid_state' };
        if (stage.completedAt) return { ok: false, error: 'already_completed' };

        const completedAt = now;
        const durationMs = Math.max(0, completedAt.toMillis() - stage.startedAt.toMillis());
        const nextIndex = process.currentIndex + 1;
        const nextStatus = nextIndex < process.steps.length ? process.steps[nextIndex] : 'done';

        const qualityMedia = data.qualityMedia || {};
        
        tx.update(processRef, {
          stages: {
            ...(process.stages || {}),
            packaging: { ...stage, completedAt, durationMs, qualityProof: qualityMedia },
          },
          currentIndex: nextIndex,
          status: nextStatus,
        });

        if (nextStatus === 'done') {
          const deliveryOTP = generateOTP();
          const updateData = { status: 'ready', readyAt: now, deliveryOTP };
          tx.update(orderRef, updateData);
          tx.update(db.doc(`vendors/${vendorId}/orders/${orderId}`), updateData);
        }

        return { ok: true, currentIndex: nextIndex, status: nextStatus };
      });
      return result;
    } catch (err) {
      console.error('opsProcessing completePackaging failed', err);
      return { ok: false, error: 'server_error' };
    }
  }

  return { ok: false, error: 'invalid_input' };
});

exports.supervisorActions = onCall({ cors: true, invoker: 'public' }, async (request) => {
  const auth = request.auth;
  if (!auth) return { ok: false, error: 'unauthorized' };
  const phone = normalizePhone(auth.token && auth.token.phone_number);
  if (!phone) return { ok: false, error: 'unauthorized' };

  const rosterSnap = await db.doc('config/opsStaff').get();
  const rosterPhones = rosterSnap.exists && rosterSnap.data().phones ? rosterSnap.data().phones : {};
  const role = rosterPhones[phone];

  const data = request.data || {};
  const { action, orderId, userId, vendorId = 'vendor_1' } = data;
  
  if (role !== 'supervisor' && !(role === 'rider' && action === 'verifyDeliveryOTP')) {
    return { ok: false, error: 'unauthorized' };
  }
  
  if (!orderId || !userId || !action) return { ok: false, error: 'invalid_input' };
  
  const orderRef = db.doc(`users/${userId}/orders/${orderId}`);
  const vendorRef = db.doc(`vendors/${vendorId}/orders/${orderId}`);
  const now = admin.firestore.Timestamp.now();

  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) return { ok: false, error: 'not_found' };
      const order = snap.data();

      // Ensure all reads happen before any writes
      const taskSnap = await tx.get(db.doc(`ops_tasks/${orderId}`));
      const queueSnap = await tx.get(db.doc(`ops_queue/${orderId}`));
      const delTaskRef = db.doc(`ops_delivery_tasks/${orderId}`);
      const delTaskSnap = await tx.get(delTaskRef);

      if (action === 'cancelOrder') {
        const { reason, note } = data;
        const updateData = {
          status: 'cancelled',
          isCancelled: true,
          cancellationReason: reason || 'Other',
          cancellationNote: note || '',
          cancelledAt: now,
          updatedAt: now,
        };
        tx.update(orderRef, updateData);
        tx.set(vendorRef, updateData, { merge: true });
        
        // Cleanup ops queue and process if needed
        if (taskSnap.exists) {
          tx.update(db.doc(`ops_tasks/${orderId}`), { status: 'cancelled' });
        } else if (queueSnap.exists) {
          tx.delete(db.doc(`ops_queue/${orderId}`));
        }
        
        return { ok: true, status: 'cancelled' };
      }

      if (action === 'reschedulePickup') {
        const { date, time } = data;
        if (!date || !time) return { ok: false, error: 'invalid_input' };
        
        if (order.status !== 'placed' && order.status !== 'confirmed') {
          return { ok: false, error: 'invalid_state' };
        }

        const updateData = {
          pickupDetails: {
            ...(order.pickupDetails || {}),
            type: 'scheduled',
            scheduledDate: date,
            scheduledTime: time,
          },
          updatedAt: now,
        };
        tx.update(orderRef, updateData);
        tx.set(vendorRef, updateData, { merge: true });
        
        // Also update ops task if it exists
        if (taskSnap.exists) {
          tx.update(db.doc(`ops_tasks/${orderId}`), { pickupSlot: updateData.pickupDetails });
        } else if (queueSnap.exists) {
          tx.update(db.doc(`ops_queue/${orderId}`), { pickupSlot: updateData.pickupDetails });
        }

        return { ok: true };
      }

      if (action === 'scheduleDelivery') {
        const { date, time } = data;
        if (!date || !time) return { ok: false, error: 'invalid_input' };
        
        const updateData = {
          deliveryDate: date,
          deliveryTime: time,
          deliveryScheduledAt: now,
          updatedAt: now,
        };
        tx.update(orderRef, updateData);
        tx.set(vendorRef, updateData, { merge: true });

        // Also update the delivery task if it exists (delTaskSnap read at top)
        if (delTaskSnap.exists) {
          tx.update(delTaskRef, { deliveryDate: date, deliveryTime: time });
        }

        return { ok: true };
      }

      if (action === 'markOutForDelivery') {
        if (order.status !== 'ready') return { ok: false, error: 'invalid_state' };
        if (!order.deliveryDate || !order.deliveryTime) {
          return { ok: false, error: 'delivery_not_scheduled' };
        }

        // Assign a rider
        const assignee = await selectRider();
        if (!assignee) return { ok: false, error: 'no_rider_available' };

        const updateData = {
          status: 'out_for_delivery',
          outForDeliveryAt: now,
          updatedAt: now,
        };
        tx.update(orderRef, updateData);
        tx.set(vendorRef, updateData, { merge: true });

        // Update delivery task (delTaskSnap/delTaskRef read at top)
        if (delTaskSnap.exists) {
          tx.update(delTaskRef, {
            assignee,
            status: 'out_for_delivery',
            assignedAt: now,
          });
        } else {
          tx.set(delTaskRef, {
            orderId,
            userId,
            vendorId,
            type: 'delivery',
            status: 'out_for_delivery',
            assignee,
            deliveryAddress: pickupAddressFromOrder(order),
            deliveryDate: order.deliveryDate,
            deliveryTime: order.deliveryTime,
            deliveryOTP: order.deliveryOTP || null,
            customerName: order.customerName || order.userName || '',
            customerPhone: order.customerPhone || order.userPhone || '',
            assignedAt: now,
            createdAt: now,
          });
        }

        return { ok: true, status: 'out_for_delivery' };
      }

      if (action === 'verifyDeliveryOTP') {
        if (order.status !== 'out_for_delivery') return { ok: false, error: 'invalid_state' };
        if (role === 'rider' && delTaskSnap.exists && delTaskSnap.data().assignee !== auth.uid) {
          return { ok: false, error: 'unauthorized' };
        }
        const { otp } = data;
        if (!otp || String(otp) !== String(order.deliveryOTP)) {
          return { ok: false, error: 'invalid_otp' };
        }

        const updateData = {
          status: 'delivered',
          deliveryVerified: true,
          deliveredAt: now,
          updatedAt: now,
        };
        tx.update(orderRef, updateData);
        tx.set(vendorRef, updateData, { merge: true });

        // Update delivery task (delTaskSnap/delTaskRef read at top)
        if (delTaskSnap.exists) {
          tx.update(delTaskRef, { status: 'delivered', deliveredAt: now });
        }

        return { ok: true, status: 'delivered' };
      }

      if (action === 'assignTaskToRider') {
        const { riderId, isDelivery } = data;
        if (!riderId) return { ok: false, error: 'invalid_input' };

        if (isDelivery) {
          if (order.status !== 'ready') return { ok: false, error: 'invalid_state' };
          if (!order.deliveryDate || !order.deliveryTime) return { ok: false, error: 'delivery_not_scheduled' };
          
          const updateData = { status: 'out_for_delivery', outForDeliveryAt: now, updatedAt: now };
          tx.update(orderRef, updateData);
          tx.set(vendorRef, updateData, { merge: true });

          if (delTaskSnap.exists) {
            tx.update(delTaskRef, { assignee: riderId, status: 'out_for_delivery', assignedAt: now });
          } else {
            tx.set(delTaskRef, {
              orderId, userId, vendorId, type: 'delivery', status: 'out_for_delivery',
              assignee: riderId, deliveryAddress: pickupAddressFromOrder(order),
              deliveryDate: order.deliveryDate, deliveryTime: order.deliveryTime,
              deliveryOTP: order.deliveryOTP || null, customerName: order.customerName || order.userName || '',
              customerPhone: order.customerPhone || order.userPhone || '', assignedAt: now, createdAt: now
            });
          }
          return { ok: true, status: 'out_for_delivery' };
        } else {
          // Pickup assignment
          if (order.status !== 'placed' && order.status !== 'confirmed') {
            return { ok: false, error: 'invalid_state' };
          }
          
          if (taskSnap.exists) {
            tx.update(db.doc(`ops_tasks/${orderId}`), { assignee: riderId, assignedAt: now, status: 'assigned' });
          } else if (queueSnap.exists) {
            tx.set(db.doc(`ops_tasks/${orderId}`), {
              ...queueSnap.data(), assignee: riderId, assignedAt: now, status: 'assigned'
            });
            tx.delete(db.doc(`ops_queue/${orderId}`));
          } else {
             return { ok: false, error: 'task_not_found' };
          }
          return { ok: true, status: 'assigned' };
        }
      }

      return { ok: false, error: 'invalid_action' };
    });
    return result;
  } catch (err) {
    console.error('supervisorActions failed', err);
    return { ok: false, error: 'server_error' };
  }
});
