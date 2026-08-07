const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onCall } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { FieldPath } = require('firebase-admin/firestore');
const { pickRider, pickupGuard, normalizePhone } = require('./dispatch');

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

function taskPayload(orderId, order, assignee) {
  return {
    orderId,
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
  const payload = assignee
    ? taskPayload(orderId, order, assignee)
    : {
        orderId,
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
  if (taskSnap.exists) {
    const task = taskSnap.data();
    if (role === 'rider' && task.assignee && task.assignee !== auth.uid) {
      return { ok: false, error: 'unauthorized' };
    }
  } else if (role === 'rider') {
    // No task assigned to this order; only a supervisor may verify it.
    return { ok: false, error: 'unauthorized' };
  }

  // --- Find the user-path order doc (CG query returns up to 2 docs: user + vendor mirror).
  const q = await db.collectionGroup('orders').where(FieldPath.documentId(), '==', orderId).get();
  let userId = null;
  let order = null;
  for (const doc of q.docs) {
    if (doc.ref.path.startsWith('users/')) {
      userId = doc.data().userId || doc.ref.parent.parent.id;
      order = doc.data();
      break;
    }
  }
  if (!userId || !order) return { ok: false, error: 'not_found' };

  // --- Server-side OTP verify.
  if (String(otp) !== String(order.pickupOTP)) return { ok: false, error: 'invalid_otp' };

  const vendorId = order.vendorId || 'vendor_1';
  const now = admin.firestore.Timestamp.now();

  // --- Transaction: re-read + status guard + dual write + task flip.
  try {
    const result = await db.runTransaction(async (tx) => {
      const orderRef = db.doc(`users/${userId}/orders/${orderId}`);
      const snap = await tx.get(orderRef);
      if (!snap.exists) return { ok: false, error: 'not_found' };
      const current = snap.data();

      const guard = pickupGuard(current.status);
      if (guard === 'alreadyDone') return { ok: true, alreadyDone: true };
      if (guard === 'invalidState') return { ok: false, error: 'invalid_state' };

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
      tx.update(db.doc(`ops_tasks/${orderId}`), { status: 'picked_up', pickedUpAt: now });
      return { ok: true };
    });
    return result;
  } catch (err) {
    console.error('opsStatusSync failed', err);
    return { ok: false, error: 'server_error' };
  }
});
