const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const { pickRider } = require('./dispatch');

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
