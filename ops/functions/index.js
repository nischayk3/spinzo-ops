const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { pickRider, pickupGuard, normalizePhone, isAwaitingPickup, taskTransition, opsStepsForOrder, isProductionStep, firstProductionStep, parseGarmentQr, generateLabels, stepsForServiceType, splitOrderIntoServices, SERVICE_LABELS, checkPaymentGate, IRONING_PRIORITY_PHONES, isIroningEligible } = require('./dispatch');

// Which steps a role may claim/start. Supervisors bypass.
// Ironing stage priority: Samsul, Abdur. No ironing orders to New Helper.
function stageRoleGate(step, role, phone) {
  if (role === 'supervisor' || role === 'admin') return true;
  if (step === 'getting_ironed') {
    if (phone && isIroningEligible(phone)) return true;
    return false;
  }
  if (role === 'helper' || role === 'iron') return true;
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
  if (typeof a === 'string') return a;
  return a.formattedAddress || a.address || a.fullAddress || a.line1 || [a.houseNumber, a.building, a.street, a.area, a.city].filter(Boolean).join(', ') || '';
}

/**
 * Send high-priority FCM data message to staff member's device for native overlay/heads-up alert.
 * Payload MUST be DATA-ONLY (no top-level notification object) to ensure Android wakes up onMessageReceived in background.
 */
async function sendFCMOrderAssignment({
  staffId,
  orderId,
  taskType = 'pickup',
  customerName = '',
  address = '',
  slot = '',
  isInstant = false,
  stepName = '',
}) {
  if (!staffId) return;
  try {
    const staffDoc = await db.doc(`ops_staff/${staffId}`).get();
    if (!staffDoc.exists) {
      console.log(`[FCM] Staff doc not found for: ${staffId}`);
      return;
    }
    const staffData = staffDoc.data();
    const fcmToken = staffData.fcmToken;
    if (!fcmToken) {
      console.log(`[FCM] Staff ${staffId} has no fcmToken registered`);
      return;
    }

    const message = {
      token: fcmToken,
      data: {
        type: 'order_assignment',
        orderId: String(orderId || ''),
        taskType: String(taskType || 'pickup'),
        customerName: String(customerName || ''),
        address: String(address || ''),
        slot: String(slot || ''),
        isInstant: String(isInstant ? 'true' : 'false'),
        stepName: String(stepName || ''),
      },
      android: {
        priority: 'high',
        ttl: 60 * 1000,
      },
    };

    const response = await admin.messaging().send(message);
    console.log(`[FCM] Sent assignment push to ${staffId} for #${orderId}:`, response);
  } catch (err) {
    console.error(`[FCM] Failed to send assignment push to ${staffId}:`, err);
  }
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
  const addr = pickupAddressFromOrder(order);
  const total = (order && (order.totalAmount || (order.billDetails && order.billDetails.total) || order.cartTotal)) || 0;
  return {
    orderId,
    userId,
    vendorId,
    assignee,
    status: 'pending',
    customerName: (order && (order.customerName || order.userName)) || '',
    customerPhone: (order && (order.customerPhone || order.userPhone)) || '',
    pickupAddress: addr,
    pickupSlot: (order && order.pickupDetails) || null,
    tokenNumber: (order && order.tokenNumber) || null,
    tokens: (order && order.tokens) || null,
    pickupOTP: (order && order.pickupOTP) || null,
    items: (order && order.items) || [],
    totalAmount: total,
    paymentStatus: (order && (order.paymentStatus || order.paymentMethod)) || 'pending',
    paymentMode: (order && (order.paymentMode || order.paymentMethod)) || '',
    notes: (order && (order.notes || order.instruction)) || '',
    latitude: (order && (order.latitude || (order.address && order.address.latitude))) || null,
    longitude: (order && (order.longitude || (order.address && order.address.longitude))) || null,
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
  const vendorId = order.vendorId || 'default';
  const total = (order && (order.totalAmount || (order.billDetails && order.billDetails.total) || order.cartTotal)) || 0;
  const payload = assignee
    ? taskPayload(orderId, order, assignee, userId, vendorId)
    : {
        orderId,
        userId,
        vendorId,
        status: 'pending',
        customerName: (order && (order.customerName || order.userName)) || '',
        customerPhone: (order && (order.customerPhone || order.userPhone)) || '',
        pickupAddress: pickupAddressFromOrder(order),
        pickupSlot: (order && order.pickupDetails) || null,
        tokenNumber: (order && order.tokenNumber) || null,
        tokens: (order && order.tokens) || null,
        pickupOTP: (order && order.pickupOTP) || null,
        items: (order && order.items) || [],
        totalAmount: total,
        paymentStatus: (order && (order.paymentStatus || order.paymentMethod)) || 'pending',
        paymentMode: (order && (order.paymentMode || order.paymentMethod)) || '',
        notes: (order && (order.notes || order.instruction)) || '',
        latitude: (order && (order.latitude || (order.address && order.address.latitude))) || null,
        longitude: (order && (order.longitude || (order.address && order.address.longitude))) || null,
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

  if (assignee) {
    const isInstant = Boolean(order && order.pickupDetails && order.pickupDetails.isInstant);
    const slot = (order && order.pickupDetails && order.pickupDetails.type === 'instant')
      ? 'Instant Pickup'
      : (order && order.pickupDetails && order.pickupDetails.scheduledTime) || '';
    await sendFCMOrderAssignment({
      staffId: assignee,
      orderId,
      taskType: isInstant ? 'Instant Pickup' : 'Pickup',
      customerName: (order && (order.customerName || order.userName)) || '',
      address: pickupAddressFromOrder(order),
      slot,
      isInstant,
    });
  }
});

// When a rider goes on shift, claim any parked orders.
exports.onShiftCatchUp = onDocumentUpdated('ops_staff/{staffId}', async (event) => {
  if (!event.data) return; // doc deleted before delivery
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (!after) return;
  const wentOnShift = before && before.onShift !== true && after.onShift === true;
  if (!wentOnShift || after.role !== 'rider') return;

  // Reassign stale pickups: orders placed on a PREVIOUS day (or earlier) that are
  // still `pending` but whose original assignee is no longer on shift. This brings
  // scheduled pickups (e.g. placed 3 days ago for today) into the queue of the
  // rider(s) who are actually on shift now.
  const newRiderUid = event.params.staffId;
  const taskQuery = await db.collection('ops_tasks').where('status', 'in', ['pending', 'assigned']).limit(200).get();
  for (const taskDoc of taskQuery.docs) {
    const td = taskDoc.data();
    if (td.assignee === newRiderUid) continue;
    // If the original assignee is still on shift, leave it — don't steal their task.
    if (td.assignee) {
      const orig = await db.doc(`ops_staff/${td.assignee}`).get();
      if (orig.exists && orig.data().onShift === true) continue;
    }
    // ⚠️ STATE SYNC: don't re-point a pickup whose order has already progressed
    // past placed/confirmed (already picked up, processing, ready, …). Without
    // this, stale tasks are re-assigned to the newly on-shift rider.
    if (td.userId) {
      const orderSnap = await db.doc(`users/${td.userId}/orders/${taskDoc.id}`).get();
      if (orderSnap.exists && !isAwaitingPickup(orderSnap.data().status)) {
        await db.doc(`ops_tasks/${taskDoc.id}`).delete();
        continue;
      }
    }
    // Re-point the pending pickup to the newly on-shift rider.
    try {
      await db.doc(`ops_tasks/${taskDoc.id}`).update({
        assignee: newRiderUid,
        assignedAt: TS(),
      });
    } catch (err) {
      console.error(`onShiftCatchUp: reassign ${taskDoc.id} failed`, err);
    }
  }

  // Oldest parked orders first (top-level collection, single-field index — no composite index).
  const queue = await db.collection('ops_queue').orderBy('createdAt', 'asc').limit(50).get();
  const pending = queue.docs.filter((d) => d.data().status === 'pending');

  for (const entry of pending) {
    const orderId = entry.id;
    const data = entry.data();
    try {
      const userId = data.userId;
      // ⚠️ STATE SYNC: only assign a parked pickup to a rider if the order is
      // STILL waiting for pickup. A parked order that has already transitioned out of
      // placed/confirmed (pickup_completed/processing/ready/...) must NOT be offered
      // as a new pickup. Without this, old orders flood the rider queue on shift start.
      if (userId) {
        const orderSnap = await db.doc(`users/${userId}/orders/${orderId}`).get();
        if (orderSnap.exists && !isAwaitingPickup(orderSnap.data().status)) {
          // Pickup already done or order progressed — drop the stale parked entry.
          await db.doc(`ops_queue/${orderId}`).delete();
          continue;
        }
      }
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
          customerName: data.customerName || '',
          customerPhone: data.customerPhone || '',
          pickupAddress: data.pickupAddress || '',
          pickupSlot: data.pickupSlot || null,
          tokenNumber: data.tokenNumber || null,
          tokens: data.tokens || null,
          pickupOTP: data.pickupOTP || null,
          items: data.items || [],
          totalAmount: data.totalAmount || 0,
          paymentStatus: data.paymentStatus || 'pending',
          paymentMode: data.paymentMode || '',
          notes: data.notes || '',
          latitude: data.latitude || null,
          longitude: data.longitude || null,
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

// ─── Daily 11:30 PM force-logout for all staff ─────────────────────────────
// Clears onShift so that helpers/riders clock out even if their app is closed
// or the client-side heartbeat missed. Runs daily at 18:00 UTC = 11:30 PM IST.
exports.scheduleForceLogout = onSchedule('30 18 * * *', async () => {
  const batch = db.batch();
  const snap = await db.collection('ops_staff').where('onShift', '==', true).get();
  let count = 0;
  snap.forEach((doc) => {
    batch.set(doc.ref, { onShift: false, shiftEndAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    count++;
  });
  if (count > 0) {
    await batch.commit();
    console.log(`scheduleForceLogout: logged out ${count} staff member(s).`);
  } else {
    console.log('scheduleForceLogout: no staff currently on shift.');
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
    const rawId = String(orderId || '');
    const cleanId = rawId.includes('__') ? rawId.split('__')[0] : rawId;
    const taskId = String(data.taskId || '');

    const candidateIds = Array.from(new Set([rawId, cleanId, taskId].filter(Boolean)));
    const collections = isDelivery ? ['ops_delivery_tasks', 'ops_tasks'] : ['ops_tasks', 'ops_delivery_tasks'];

    let targetDocRef = null;
    let targetTask = null;

    for (const coll of collections) {
      for (const id of candidateIds) {
        const snap = await db.doc(`${coll}/${id}`).get();
        if (snap.exists) {
          targetDocRef = db.doc(`${coll}/${id}`);
          targetTask = snap.data();
          break;
        }
      }
      if (targetDocRef) break;
    }

    if (!targetDocRef || !targetTask) return { ok: false, error: 'not_found' };

    if (targetTask.assignee && targetTask.assignee !== auth.uid && role !== 'supervisor' && role !== 'admin') {
      return { ok: false, error: 'unauthorized' };
    }

    if (targetTask.acceptedAt) return { ok: true, alreadyDone: true };

    try {
      const updatePayload = {
        acceptedAt: admin.firestore.Timestamp.now(),
      };
      if (!targetTask.assignee) {
        updatePayload.assignee = auth.uid;
      }
      await targetDocRef.update(updatePayload);
      return { ok: true };
    } catch (err) {
      console.error('opsStatusSync acceptTask failed', err);
      return { ok: false, error: 'server_error' };
    }
  }

  if (action === 'updatePickupMeta') {
    const isUrgent = typeof data.isUrgent === 'boolean' ? data.isUrgent : undefined;
    const pickupNote = typeof data.pickupNote === 'string' ? data.pickupNote.trim() : undefined;

    const taskRef = db.doc(`ops_tasks/${orderId}`);
    const taskSnap = await taskRef.get();
    if (!taskSnap.exists && role !== 'supervisor') return { ok: false, error: 'not_found' };

    const task = taskSnap.exists ? taskSnap.data() : null;
    if (task && role === 'rider' && task.assignee && task.assignee !== auth.uid) {
      return { ok: false, error: 'unauthorized' };
    }

    const now = admin.firestore.Timestamp.now();
    const taskPatch = {};
    const orderPatch = {};

    if (isUrgent !== undefined) {
      taskPatch.isUrgent = isUrgent;
      orderPatch['opsMeta.isUrgent'] = isUrgent;
      orderPatch['opsMeta.urgentUpdatedAt'] = now;
      orderPatch['opsMeta.urgentUpdatedBy'] = auth.uid;
    }
    if (pickupNote !== undefined) {
      taskPatch.pickupNote = pickupNote;
      orderPatch['opsMeta.pickupNote'] = pickupNote;
      orderPatch['opsMeta.pickupNoteUpdatedAt'] = now;
      orderPatch['opsMeta.pickupNoteUpdatedBy'] = auth.uid;
    }

    if (taskSnap.exists && Object.keys(taskPatch).length > 0) {
      await taskRef.set(taskPatch, { merge: true });
    }

    const userId = task?.userId || data.userId;
    if (userId && Object.keys(orderPatch).length > 0) {
      const orderRef = db.doc(`users/${userId}/orders/${orderId}`);
      await orderRef.set(orderPatch, { merge: true });
      const vendorId = task?.vendorId || data.vendorId || 'default';
      await db.doc(`vendors/${vendorId}/orders/${orderId}`).set(orderPatch, { merge: true });
    }
    return { ok: true, isUrgent, pickupNote };
  }

  // OTP is only required for pickup/store verification, not for acceptTask or updatePickupMeta
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

    const vendorId = order.vendorId || (task && task.vendorId) || 'default';
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
        tx.set(db.doc(`vendors/${vendorId}/orders/${orderId}`), updateData, { merge: true });
        
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

  const vendorId = order.vendorId || (task && task.vendorId) || 'default';
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
      const tokenList = data.tokens && typeof data.tokens === 'object'
        ? Object.values(data.tokens).filter(Boolean)
        : [];
      const allTokensString = tokenList.length > 0 ? tokenList.join(', ') : '';
      const tokenNumber = allTokensString || data.tokenNumber || current.tokenNumber;
      if (tokenNumber) updateData.tokenNumber = tokenNumber;
      if (data.tokens && typeof data.tokens === 'object') {
        updateData.tokens = data.tokens;
      }

      tx.update(db.doc(`users/${userId}/orders/${orderId}`), updateData);
      tx.set(db.doc(`vendors/${vendorId}/orders/${orderId}`), updateData, { merge: true });
      if (task) {
        const taskUpdate = {
          status: 'in_transit_to_store',
          pickedUpAt: now,
          otpAttempts: admin.firestore.FieldValue.delete(),
        };
        if (tokenNumber) taskUpdate.tokenNumber = tokenNumber;
        if (data.tokens && typeof data.tokens === 'object') taskUpdate.tokens = data.tokens;
        tx.update(db.doc(`ops_tasks/${orderId}`), taskUpdate);
      }
      return { ok: true };
    });
    return result;
  } catch (err) {
    console.error('opsStatusSync failed', err);
    return { ok: false, error: 'server_error' };
  }
});

async function persistOpsDetailsToOrder(orderId, optUserId, optVendorId) {
  try {
    const processDocs = await db.collection('ops_process')
      .where('parentOrderId', '==', orderId).get();
    if (processDocs.empty) return;

    let userId = optUserId;
    let vendorId = optVendorId;
    let combinedGarmentCount = 0;
    let combinedRegisteredGarments = [];
    const allQualityPhotos = [];
    const stageTimings = {};
    let packagingProof = null;

    processDocs.forEach(d => {
      const p = d.data();
      if (!userId && p.userId) userId = p.userId;
      if (!vendorId && p.vendorId) vendorId = p.vendorId;

      if (p.garments) {
        if (p.garments.count) combinedGarmentCount += (p.garments.count || 0);
        if (Array.isArray(p.garments.registered)) {
          combinedRegisteredGarments.push(...p.garments.registered);
        }
      }

      if (p.stages) {
        Object.keys(p.stages).forEach(step => {
          const s = p.stages[step];
          if (!s) return;
          stageTimings[step] = {
            ...(stageTimings[step] || {}),
            ...s,
          };
          if (step === 'packaging' && s.qualityProof) {
            packagingProof = s.qualityProof;
            if (Array.isArray(s.qualityProof.photos)) {
              allQualityPhotos.push(...s.qualityProof.photos);
            }
          }
        });
      }
    });

    if (!userId) {
      const tSnap = await db.doc(`ops_tasks/${orderId}`).get();
      if (tSnap.exists) {
        userId = tSnap.data().userId;
        if (!vendorId) vendorId = tSnap.data().vendorId;
      }
    }

    if (!userId) {
      const qSnap = await db.doc(`ops_queue/${orderId}`).get();
      if (qSnap.exists) {
        userId = qSnap.data().userId;
        if (!vendorId) vendorId = qSnap.data().vendorId;
      }
    }

    if (!userId) {
      const cg = await db.collectionGroup('orders')
        .where(admin.firestore.FieldPath.documentId(), '==', orderId)
        .limit(1)
        .get();
      if (!cg.empty) {
        const od = cg.docs[0].data();
        userId = od.userId || (cg.docs[0].ref.parent && cg.docs[0].ref.parent.parent && cg.docs[0].ref.parent.parent.id);
        if (!vendorId) vendorId = od.vendorId;
      }
    }

    if (userId) {
      const opsUpdate = {
        updatedAt: TS(),
      };
      if (combinedGarmentCount > 0) {
        opsUpdate.garmentCount = combinedGarmentCount;
        opsUpdate.registeredGarmentsCount = combinedRegisteredGarments.length;
      }
      if (combinedRegisteredGarments.length > 0) {
        opsUpdate.opsGarments = combinedRegisteredGarments;
      }
      if (allQualityPhotos.length > 0) {
        opsUpdate.qualityPhotos = allQualityPhotos;
        opsUpdate.packagingPhotos = allQualityPhotos;
        opsUpdate.proofUrl = allQualityPhotos[0];
      }
      if (packagingProof) {
        opsUpdate.packagingProof = packagingProof;
      }
      if (Object.keys(stageTimings).length > 0) {
        opsUpdate.stageTimings = stageTimings;
      }
      opsUpdate.opsDetails = {
        garmentCount: combinedGarmentCount,
        registeredGarmentsCount: combinedRegisteredGarments.length,
        qualityPhotos: allQualityPhotos,
        packagingPhotos: allQualityPhotos,
        packagingProof: packagingProof || null,
        stageTimings,
      };

      const uOrderRef = db.doc(`users/${userId}/orders/${orderId}`);
      await uOrderRef.set(opsUpdate, { merge: true });
      if (vendorId) {
        await db.doc(`vendors/${vendorId}/orders/${orderId}`).set(opsUpdate, { merge: true });
      }
    }
  } catch (err) {
    console.error(`persistOpsDetailsToOrder(${orderId}) failed:`, err);
  }
}

async function deleteProcessDocs(orderId, userId, vendorId) {
  try {
    await persistOpsDetailsToOrder(orderId, userId, vendorId);
    const processDocs = await db.collection('ops_process')
      .where('parentOrderId', '==', orderId).get();
    const batch = db.batch();
    processDocs.forEach((d) => batch.delete(d.ref));
    if (!processDocs.empty) await batch.commit();
  } catch (err) {
    console.error(`deleteProcessDocs(${orderId}) failed`, err);
  }
}

async function autoAssignTaggingOnPickup(orderId, order, userId, vendorId) {
  try {
    let serviceGroups = splitOrderIntoServices(order);
    if (!serviceGroups || serviceGroups.length === 0) {
      const sType = order.serviceType || 'wash_fold';
      serviceGroups = [{ serviceType: sType, label: SERVICE_LABELS[sType] || 'Wash & Fold' }];
    }

    // Check if ops_process already exists
    const existingSnap = await db.collection('ops_process')
      .where('orderId', '==', orderId)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      console.log(`[AutoAssignTagging] Process docs already exist for ${orderId}`);
      return;
    }

    // Find on-shift helpers from ops_staff
    const staffSnap = await db.collection('ops_staff')
      .where('onShift', '==', true)
      .where('role', '==', 'helper')
      .get();

    const onShiftHelpers = [];
    staffSnap.forEach(d => {
      onShiftHelpers.push({ uid: d.id, ...d.data() });
    });

    // Helper selection with preferences:
    // Primary for tagging: Abdul (+916900311761)
    // Fallback 1: Abdur (+917559105832)
    // Fallback 2: Samsul (+916369768237)
    let selectedHelper = null;
    const normalize = (p) => (p || '').replace(/\D/g, '').slice(-10);

    const abdul = onShiftHelpers.find(h => normalize(h.phone) === '6900311761');
    const abdur = onShiftHelpers.find(h => normalize(h.phone) === '7559105832');
    const samsul = onShiftHelpers.find(h => normalize(h.phone) === '6369768237');

    if (abdul) {
      selectedHelper = abdul;
    } else if (abdur) {
      selectedHelper = abdur;
    } else if (samsul) {
      selectedHelper = samsul;
    } else if (onShiftHelpers.length > 0) {
      selectedHelper = onShiftHelpers[0];
    }

    const now = TS();
    const tokens = order.tokens || {};

    // Create process docs for all services
    const batch = db.batch();
    for (const group of serviceGroups) {
      const processId = `${orderId}__${group.serviceType}`;
      const steps = stepsForServiceType(group.serviceType);
      const pRef = db.doc(`ops_process/${processId}`);

      batch.set(pRef, {
        id: processId,
        orderId,
        parentOrderId: orderId,
        serviceType: group.serviceType,
        serviceLabel: group.label,
        userId: userId || order.userId || '',
        vendorId: vendorId || order.vendorId || 'default',
        steps,
        currentIndex: 0,
        status: steps[0],
        tokenNumber: tokens[group.serviceType] || order.tokenNumber || '',
        siblingCount: serviceGroups.length,
        stages: {
          tagging: {
            assignee: selectedHelper ? selectedHelper.uid : null,
            assigneeName: selectedHelper ? (selectedHelper.name || '') : '',
            queuedAt: now,
            assignedAt: selectedHelper ? now : null,
            assignedBy: selectedHelper ? 'system_auto' : null,
          }
        },
        garments: { count: null, labelsPrintedAt: null, labels: [], registered: [], submittedAt: null },
        createdAt: now,
        customerName: order.customerName || '',
      });
    }

    if (selectedHelper) {
      const staffRef = db.doc(`ops_staff/${selectedHelper.uid}`);
      batch.update(staffRef, {
        activeHelperTask: { orderId, step: 'tagging' }
      });
    }

    await batch.commit();
    console.log(`[AutoAssignTagging] Auto-created ops_process and assigned ${orderId} to ${selectedHelper ? selectedHelper.name : 'unassigned'}`);

    if (selectedHelper) {
      await sendFCMOrderAssignment({
        staffId: selectedHelper.uid,
        orderId,
        taskType: 'step',
        customerName: order.customerName || '',
        stepName: 'tagging',
      });
    }
  } catch (err) {
    console.error(`[AutoAssignTagging] Failed for ${orderId}:`, err);
  }
}

// Keep the rider's task/queue in sync when an order's status changes elsewhere
// (e.g. canceled, or pickup_completed via the admin panel instead of opsStatusSync),
// or when an order is deleted entirely from the main Livfresh admin panel.
exports.syncTaskFromOrder = onDocumentWritten('users/{userId}/orders/{orderId}', async (event) => {
  if (!event.data) return;

  const orderId = event.params.orderId;

  // If the order document was deleted from the main app/admin panel, clean up ops tasks
  if (!event.data.after.exists) {
    console.log(`[OrderDeleted] Order ${orderId} was deleted. Cleaning up ops tasks.`);
    try {
      const taskRef = db.doc(`ops_tasks/${orderId}`);
      const snap = await taskRef.get();
      if (snap.exists && snap.data().status !== 'cancelled') {
        await taskRef.update({ status: 'cancelled', cancelledAt: TS() });
      }
      await Promise.allSettled([
        db.doc(`ops_queue/${orderId}`).delete(),
        db.doc(`ops_delivery_tasks/${orderId}`).delete(),
        db.doc(`ops_process/${orderId}`).delete(),
        deleteProcessDocs(orderId),
      ]);
    } catch (err) {
      console.error(`syncTaskFromOrder cleanup on delete failed for ${orderId}:`, err);
    }
    return;
  }

  if (!event.data.before.exists) return; // creation is handled by autoAssignRider
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (!before || !after) return;

  const trans = taskTransition(before.status, after.status);
  if (!trans) return;

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
      // Cancel tasks in any non-cancelled state (not just 'pending') so that
      // orders cancelled from the main admin panel are properly cleaned up
      // even if the rider has already picked them up.
      if (snap.exists && snap.data().status !== 'cancelled') {
        await taskRef.update({
          status: trans.taskStatus,
          ...(trans.taskStatus === 'picked_up' ? { pickedUpAt: TS() } : { cancelledAt: TS() }),
        });
      }
    } catch (err) {
      console.error(`syncTaskFromOrder failed for ${orderId}`, err);
    }
  }

  const userId = event.params.userId;
  const vendorId = after?.vendorId || before?.vendorId;

  // Auto-assign tagging order to helpers on reaching pickup_completed
  if (trans.taskStatus === 'picked_up' || (after.status === 'pickup_completed' && before.status !== 'pickup_completed')) {
    await autoAssignTaggingOnPickup(orderId, after, userId, vendorId);
  }

    // Clean up delivery tasks when an order is cancelled.
    if (trans.dropQueue) {
      try {
        const delTaskRef = db.doc(`ops_delivery_tasks/${orderId}`);
        const delSnap = await delTaskRef.get();
        if (delSnap.exists) {
          await delTaskRef.delete();
        }
      } catch (err) {
        console.error(`syncTaskFromOrder: delivery task delete failed for ${orderId}`, err);
      }

      // Also clean up any ops_process docs for this order.
      await deleteProcessDocs(orderId, userId, vendorId);
    }

    if (trans.dropProcess) {
      try {
        const delTaskRef = db.doc(`ops_delivery_tasks/${orderId}`);
        const delSnap = await delTaskRef.get();
        if (delSnap.exists) {
          await delTaskRef.update({ status: 'delivered', deliveredAt: TS() });
        }
      } catch (err) {
        console.error(`syncTaskFromOrder: delivery task update failed for ${orderId}`, err);
      }
      
      try {
        await db.doc(`ops_queue/${orderId}`).delete();
      } catch (err) {}

      await deleteProcessDocs(orderId, userId, vendorId);
    }

    if (trans.cleanupProcess) {
      // Order became 'ready': remove any stuck ops_process docs so helpers stop
      // being offered tagging/processing steps for an already-finished order.
      // Do NOT touch the delivery task — syncDeliveryTask creates it as 'pending'.
      await deleteProcessDocs(orderId, userId, vendorId);
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
    const processSnap = await db.doc(`ops_process/${orderId}`).get();
    const bundleCount = processSnap.exists ? processSnap.data().stages?.packaging?.bundleCount || 1 : 1;
    const bundleLabels = processSnap.exists ? processSnap.data().stages?.packaging?.bundleLabels || [] : [];

    await db.doc(`ops_delivery_tasks/${orderId}`).set({
      orderId,
      userId,
      vendorId: after.vendorId || 'default',
      type: 'delivery',
      status: 'pending', // waiting for supervisor to dispatch
      assignee: null,
      deliveryAddress,
      deliveryDate: after.deliveryDate || null,
      deliveryTime: after.deliveryTime || null,
      deliveryOTP: after.deliveryOTP || null,
      customerName: after.customerName || after.userName || '',
      customerPhone: after.customerPhone || after.userPhone || '',
      bundleCount,
      bundleLabels,
      tokenNumber: after.tokenNumber || null,
      tokens: after.tokens || null,
      createdAt: TS(),
    });
  } catch (err) {
    console.error(`syncDeliveryTask failed for ${orderId}`, err);
  }
});

exports.opsProcessing = onCall({ cors: true, invoker: 'public' }, async (request) => {
  try {
    const auth = request.auth;
    if (!auth) return { ok: false, error: 'unauthorized' };
    const phone = normalizePhone(auth.token && auth.token.phone_number);
    if (!phone) return { ok: false, error: 'unauthorized' };

    const rosterSnap = await db.doc('config/opsStaff').get();
    const rosterPhones = rosterSnap.exists && rosterSnap.data().phones ? rosterSnap.data().phones : {};
    let role = rosterPhones[phone];
    if (!role) {
      const staffDoc = await db.doc(`ops_staff/${auth.uid}`).get();
      if (staffDoc.exists) {
        role = staffDoc.data().role;
      }
    }
    if (role !== 'helper' && role !== 'iron' && role !== 'supervisor' && role !== 'rider' && role !== 'admin') return { ok: false, error: 'unauthorized' };

    const data = request.data || {};
    const orderId = data.orderId;
    const action = data.action;
    if (!orderId || typeof orderId !== 'string') return { ok: false, error: 'invalid_input' };
    if (!['claim', 'acceptStep', 'startStep', 'completeStep', 'completePackaging', 'printLabels', 'scanGarment', 'tagAllGarments', 'unregisterGarment', 'submitTagging', 'printBundleLabels', 'editOrder', 'markChemicalAdded', 'snoozeNudge'].includes(action)) {
      return { ok: false, error: 'invalid_input' };
    }

    // Riders may only use editOrder via this endpoint; all other actions are helper/supervisor/iron only.
    if (role === 'rider' && action !== 'editOrder') {
      return { ok: false, error: 'unauthorized' };
    }

    // Sanitize orderId and processId (handling composite IDs like orderId__wash_fold)
    let realOrderId = orderId;
    if (realOrderId.includes('__')) {
      realOrderId = realOrderId.split('__')[0];
    }
    const processId = data.processId || orderId;
    const processRef = db.doc(`ops_process/${processId}`);
    const processSnap = await processRef.get();

    let taskSnap = await db.doc(`ops_tasks/${realOrderId}`).get();
    if (!taskSnap.exists && realOrderId !== orderId) {
      taskSnap = await db.doc(`ops_tasks/${orderId}`).get();
    }
    const task = taskSnap.exists ? taskSnap.data() : null;
    let userId = (data.userId && typeof data.userId === 'string' ? data.userId : null) || (task && task.userId);
    let vendorId = (data.vendorId && typeof data.vendorId === 'string' ? data.vendorId : null);

    if (processSnap.exists) {
      const pd = processSnap.data();
      if (pd.orderId && !pd.orderId.includes('__')) realOrderId = pd.orderId;
      if (pd.parentOrderId && !pd.parentOrderId.includes('__')) realOrderId = pd.parentOrderId;
      if (!userId) userId = pd.userId;
      if (!vendorId && pd.vendorId) vendorId = pd.vendorId;
    }

    // Fallback 1: try ops_queue (parked orders awaiting pickup or helper claim)
    if (!userId) {
      let queueSnap = await db.doc(`ops_queue/${realOrderId}`).get();
      if (!queueSnap.exists && realOrderId !== orderId) {
        queueSnap = await db.doc(`ops_queue/${orderId}`).get();
      }
      if (queueSnap.exists) {
        const qd = queueSnap.data();
        userId = qd.userId;
        if (!vendorId && qd.vendorId) vendorId = qd.vendorId;
      }
    }

    // Fallback 2: collectionGroup search across orders if task/process docs were not present
    if (!userId) {
      try {
        const cgSnap = await db.collectionGroup('orders')
          .where(admin.firestore.FieldPath.documentId(), '==', realOrderId)
          .limit(1)
          .get();
        if (!cgSnap.empty) {
          const orderDoc = cgSnap.docs[0];
          const od = orderDoc.data();
          userId = od.userId || (orderDoc.ref.parent && orderDoc.ref.parent.parent && orderDoc.ref.parent.parent.id);
          if (!vendorId && od.vendorId) vendorId = od.vendorId;
        }
      } catch (e) {
        console.warn('collectionGroup fallback for realOrderId failed:', e);
      }
    }

    // For snoozeNudge, we operate directly on ops_process document and don't strictly require userId
    if (!userId && action === 'snoozeNudge') {
      userId = 'ops_internal';
    }

    if (!userId) return { ok: false, error: 'not_found' };

    const orderRef = db.doc(`users/${userId}/orders/${realOrderId}`);
    if (!vendorId) {
      const orderSnap = await orderRef.get();
      if (orderSnap.exists && orderSnap.data().vendorId) {
        vendorId = orderSnap.data().vendorId;
      }
    }
    if (!vendorId && task && task.vendorId) vendorId = task.vendorId;
    if (!vendorId) vendorId = 'default';
    const now = admin.firestore.Timestamp.now();

    // ── Edit Order ──────────────────────────────────────────────────────────
    // Allows riders/supervisors to modify order items (weight, piece count) before processing.
    if (action === 'editOrder') {
    const { items, totalAmount, billDetails } = data;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return { ok: false, error: 'invalid_input' };
    }

    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return { ok: false, error: 'not_found' };
    const order = orderSnap.data();

    // Only allow edits before processing starts (placed, confirmed, in_transit_to_store, pickup_completed)
    const editableStatuses = ['placed', 'confirmed', 'in_transit_to_store', 'pickup_completed'];
    if (!editableStatuses.includes(order.status)) {
      return { ok: false, error: 'order_already_processing' };
    }

    try {
      const updateData = {
        items,
        totalAmount: totalAmount || order.totalAmount,
        billDetails: billDetails || order.billDetails,
        updatedAt: admin.firestore.Timestamp.now(),
        lastEditedBy: auth.uid,
      };
      await orderRef.update(updateData);
      // Also update the vendor mirror
      await db.doc(`vendors/${vendorId}/orders/${orderId}`).set(updateData, { merge: true });
      return { ok: true };
    } catch (err) {
      console.error('opsProcessing editOrder failed', err);
      return { ok: false, error: 'server_error' };
    }
  }

  if (action === 'claim') {
    // Claim = start the tagging stage. A helper claiming an order begins tagging it.
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return { ok: false, error: 'not_found' };
    const order = orderSnap.data();
    if (order.status !== 'pickup_completed') return { ok: false, error: 'invalid_state' };

    // Get tokens assigned at pickup (map: serviceType → tokenNumber)
    const tokens = order.tokens || {};

    // Split into service groups
    const serviceGroups = splitOrderIntoServices(order);
    const prodStep = firstProductionStep(opsStepsForOrder(order)); // For backwards compatibility

    try {
      const result = await db.runTransaction(async (tx) => {
        const orderFresh = (await tx.get(orderRef)).data();
        if (orderFresh.status !== 'pickup_completed') return { ok: false, error: 'invalid_state' };

        // Check none already claimed
        for (const group of serviceGroups) {
          const processId = `${orderId}__${group.serviceType}`;
          const snap = await tx.get(db.doc(`ops_process/${processId}`));
          if (snap.exists) return { ok: false, error: 'already_claimed' };
        }

        const staffSnap = await tx.get(db.doc(`ops_staff/${auth.uid}`));
        const name = staffSnap.exists ? staffSnap.data().name || '' : '';

        // Create N process docs
        for (const group of serviceGroups) {
          const processId = `${orderId}__${group.serviceType}`;
          const steps = stepsForServiceType(group.serviceType);
          
          if (!stageRoleGate(steps[0], role, phone)) {
             // Rollback/error if helper role is unauthorized for tagging
             throw new Error('unauthorized');
          }

          tx.set(db.doc(`ops_process/${processId}`), {
            id: processId,
            orderId,
            parentOrderId: orderId,
            serviceType: group.serviceType,
            serviceLabel: group.label,
            userId,
            vendorId,
            steps,
            currentIndex: 0,
            status: steps[0],
            tokenNumber: tokens[group.serviceType] || data.tokenNumber || order.tokenNumber || '',
            siblingCount: serviceGroups.length,
            stages: { [steps[0]]: { assignee: auth.uid, assigneeName: name, acceptedAt: now, startedAt: now, queuedAt: now } },
            garments: { count: null, labelsPrintedAt: null, labels: [], registered: [], submittedAt: null },
            claimedAt: now,
          });
        }

        // Update customer order to 'processing'
        const updateData = { 
          status: 'processing', 
          updatedAt: now, 
          subProcessCount: serviceGroups.length 
        };
        if (prodStep) updateData.processingStep = prodStep;
        
        tx.update(orderRef, updateData);
        tx.set(db.doc(`vendors/${vendorId}/orders/${orderId}`), updateData, { merge: true });
        
        return { ok: true };
      });
      return result;
    } catch (err) {
      if (err.message === 'unauthorized') return { ok: false, error: 'unauthorized' };
      console.error('opsProcessing claim failed', err);
      return { ok: false, error: 'server_error' };
    }
  }

  if (action === 'acceptStep') {
    const processSnap = await processRef.get();
    if (!processSnap.exists) return { ok: false, error: 'not_found' };
    const process = processSnap.data();
    const step = process.steps[process.currentIndex];
    if (!step) return { ok: false, error: 'invalid_state' };
    if (!stageRoleGate(step, role, phone)) return { ok: false, error: 'unauthorized' };

    const stage = process.stages && process.stages[step];
    if (stage && stage.assignee && stage.assignee !== auth.uid) return { ok: false, error: 'already_claimed' };

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
        if (s && s.assignee && s.assignee !== auth.uid) return { ok: false, error: 'already_claimed' };

        const isMachineTask = step === 'getting_washed' || step === 'getting_dried';
        tx.update(processRef, {
          stages: {
            ...(fresh.stages || {}),
            [step]: { 
              ...(s || {}), 
              assignee: auth.uid, 
              assigneeName: name, 
              acceptedAt: now, 
              queuedAt: s?.queuedAt || now,
              ...(isMachineTask ? {} : { startedAt: s?.startedAt || now }) 
            },
          },
        });

        return { ok: true };
      });
      return result;
    } catch (err) {
      console.error('opsProcessing acceptStep failed', err);
      return { ok: false, error: 'server_error' };
    }
  }

  if (action === 'startStep') {
    const processSnap = await processRef.get();
    if (!processSnap.exists) return { ok: false, error: 'not_found' };
    const process = processSnap.data();
    const steps = Array.isArray(process.steps) ? process.steps : [];
    const step = steps[process.currentIndex];
    if (!step) return { ok: false, error: 'invalid_state' };
    if (!stageRoleGate(step, role, phone)) return { ok: false, error: 'unauthorized' };

    const stage = process.stages && process.stages[step];
    if (stage && stage.startedAt) return { ok: true, status: 'already_started', step };

    const staffSnap = await db.doc(`ops_staff/${auth.uid}`).get();
    const name = staffSnap.exists ? staffSnap.data().name || '' : '';

    try {
      const result = await db.runTransaction(async (tx) => {
        const freshSnap = await tx.get(processRef);
        if (!freshSnap.exists) return { ok: false, error: 'not_found' };
        const fresh = freshSnap.data();
        const fSteps = Array.isArray(fresh.steps) ? fresh.steps : [];
        const freshStep = fSteps[fresh.currentIndex];
        if (freshStep !== step) return { ok: false, error: 'invalid_state' };
        const s = fresh.stages && fresh.stages[step];
        if (s && s.startedAt) return { ok: true, status: 'already_started', step };
        // A stage owned by another helper (e.g. supervisor reassigned it) can't be started by me.
        if (s && s.assignee && s.assignee !== auth.uid && role !== 'supervisor' && role !== 'admin') return { ok: false, error: 'already_claimed' };

        // Validate the order status BEFORE issuing any write for production steps
        if (isProductionStep(step)) {
          const orderFreshSnap = await tx.get(orderRef);
          if (orderFreshSnap.exists) {
            const orderFresh = orderFreshSnap.data();
            if (orderFresh && orderFresh.status && orderFresh.status !== 'processing') {
              return { ok: false, error: 'invalid_state' };
            }
          }
        }

        // Machine capacity guard: washers, dryers, and irons cannot exceed physical store limits
        if (['getting_washed', 'getting_dried', 'getting_ironed'].includes(step)) {
          const resSnap = await tx.get(db.doc('config/storeResources'));
          const resData = resSnap.exists ? resSnap.data() : {};
          const maxCapacity = step === 'getting_washed'
            ? (resData.washers ?? 2)
            : step === 'getting_dried'
              ? (resData.dryers ?? 2)
              : (resData.ironingStations ?? 2);

          const activeSnap = await tx.get(
            db.collection('ops_process').where('status', '==', step)
          );
          let runningCount = 0;
          activeSnap.forEach((doc) => {
            if (doc.id === processRef.id) return;
            const d = doc.data();
            const st = d.stages && d.stages[step];
            if (st && st.startedAt && !st.completedAt) {
              runningCount += 1;
            }
          });

          if (runningCount >= maxCapacity && role !== 'admin') {
            const stepTitle = step === 'getting_washed' ? 'washers' : step === 'getting_dried' ? 'dryers' : 'ironing stations';
            return {
              ok: false,
              error: 'machine_capacity_reached',
              message: `All ${maxCapacity} ${stepTitle} are currently running. Wait for an active cycle to complete before starting another.`
            };
          }
        }

        // Keep the existing owner (a supervisor pressing Start for a helper must not steal it).
        tx.update(processRef, {
          stages: {
            ...(fresh.stages || {}),
            [step]: {
              ...(s || {}),
              assignee: (s && s.assignee) || auth.uid,
              assigneeName: (s && s.assignee) ? (s.assigneeName || '') : name,
              acceptedAt: (s && s.acceptedAt) || now,
              queuedAt: s?.queuedAt || now,
              startedAt: now,
            },
          },
        });

        // Production processingStep is written ONLY for production steps
        if (isProductionStep(step)) {
          const updateData = { processingStep: step, updatedAt: now };
          tx.set(orderRef, updateData, { merge: true });
          tx.set(db.doc(`vendors/${vendorId}/orders/${realOrderId}`), updateData, { merge: true });
        }
        return { ok: true, step };
      });
      return result;
    } catch (err) {
      console.error('opsProcessing startStep failed', err);
      return { ok: false, error: 'server_error', message: err?.message || String(err) };
    }
  }

  if (action === 'completeStep') {
    try {
      const result = await db.runTransaction(async (tx) => {
        const processSnap = await tx.get(processRef);
        if (!processSnap.exists) return { ok: false, error: 'not_found' };
        const process = processSnap.data();
        const steps = Array.isArray(process.steps) ? process.steps : [];
        const step = steps[process.currentIndex];
        
        // Tagging completion goes only through submitTagging (enforces the garment
        // count/registration checks and sets garments.submittedAt).
        if (step === 'tagging') return { ok: false, error: 'use_submit' };
        
        // Packaging completion goes through completePackaging
        if (step === 'packaging') return { ok: false, error: 'use_complete_packaging' };
        
        const stage = process.stages && process.stages[step];
        // Allow the assigned helper OR any supervisor/admin to complete the step
        if (!stage || (stage.assignee !== auth.uid && role !== 'supervisor' && role !== 'admin')) {
          return { ok: false, error: 'unauthorized' };
        }
        if (!stage.startedAt) return { ok: false, error: 'invalid_state' };
        if (stage.completedAt) return { ok: true, status: 'already_completed', step };

        const isMachine = step === 'getting_washed' || step === 'getting_dried';
        const startedAtMs = stage.startedAt ? (typeof stage.startedAt.toMillis === 'function' ? stage.startedAt.toMillis() : new Date(stage.startedAt).getTime()) : completedAt.toMillis();
        const durationSec = Math.max(0, (now.toMillis() - startedAtMs) / 1000);

        // Accidental completion guard: minimum 30 minutes (1800s) for wash/dry cycles
        if (isMachine && durationSec < 1800 && role !== 'supervisor' && role !== 'admin' && !data.forceOverride) {
          return { ok: false, error: 'cycle_in_progress', message: 'Machine cycle is still running. Minimum 30 minutes required before unload.' };
        }

        const completedAt = now;
        const acceptedAtMs = stage.acceptedAt ? (typeof stage.acceptedAt.toMillis === 'function' ? stage.acceptedAt.toMillis() : new Date(stage.acceptedAt).getTime()) : startedAtMs;

        const durationMs = Math.max(0, completedAt.toMillis() - startedAtMs);
        const acceptToCompleteMs = Math.max(0, completedAt.toMillis() - acceptedAtMs);
        const acceptToCompleteMin = Math.round(acceptToCompleteMs / 60000);
        const startToCompleteMin = Math.round(durationMs / 60000);

        const nextIndex = (process.currentIndex || 0) + 1;
        const nextStatus = nextIndex < steps.length ? steps[nextIndex] : 'done';

        // NOTE: In Firestore transactions, ALL READS MUST EXECUTE BEFORE ANY WRITES.
        // If this order has split processes and is completing to 'done', read all sibling processes now.
        const siblingCount = process.siblingCount || 1;
        const parentId = process.parentOrderId || realOrderId;
        let allProcessesSnap = null;
        if (nextStatus === 'done' && siblingCount > 1) {
          allProcessesSnap = await tx.get(
            db.collection('ops_process').where('parentOrderId', '==', parentId)
          );
        }

        // --- BEGIN WRITES ---
        tx.update(processRef, {
          stages: { 
            ...(process.stages || {}), 
            [step]: { 
              ...stage, 
              completedAt, 
              durationMs,
              acceptToCompleteMin,
              startToCompleteMin,
            },
            ...(nextStatus !== 'done' ? {
              [nextStatus]: {
                ...(process.stages?.[nextStatus] || {}),
                queuedAt: completedAt,
              }
            } : {})
          },
          currentIndex: nextIndex,
          status: nextStatus,
        });

        // Clear activeHelperTask for the helper who completed this step
        if (stage.assignee) {
          try {
            tx.update(db.doc(`ops_staff/${stage.assignee}`), {
              activeHelperTask: admin.firestore.FieldValue.delete()
            });
          } catch (e) {
            console.warn('Could not clear activeHelperTask on staff doc', e);
          }
        }

        // Dual-write to ops_stage_metrics for permanent historical tracking
        const todayStr = new Date(completedAt.toMillis() + (5.5 * 3600 * 1000)).toISOString().split('T')[0];
        const metricRef = db.doc(`ops_stage_metrics/${processRef.id}__${step}`);
        tx.set(metricRef, {
          processId: processRef.id,
          orderId: process.orderId || realOrderId,
          parentOrderId: process.parentOrderId || realOrderId,
          step,
          serviceType: process.serviceType || 'wash_fold',
          serviceLabel: process.serviceLabel || '',
          assignee: stage.assignee || auth.uid,
          assigneeName: stage.assigneeName || name,
          acceptedAt: stage.acceptedAt || stage.startedAt || completedAt,
          startedAt: stage.startedAt || completedAt,
          completedAt,
          acceptToCompleteMin,
          startToCompleteMin,
          durationMs,
          dateKey: todayStr,
          createdAt: completedAt,
        }, { merge: true });

        // Attach step timing directly to the customer & vendor order docs
        const stepTiming = {
          assignee: stage.assignee || auth.uid,
          assigneeName: stage.assigneeName || name,
          acceptedAt: stage.acceptedAt || stage.startedAt || completedAt,
          startedAt: stage.startedAt || completedAt,
          completedAt,
          acceptToCompleteMin,
          startToCompleteMin,
          durationMs,
          ...(stage.detergentAddedAt ? { detergentAddedAt: stage.detergentAddedAt } : {}),
          ...(stage.softenerAddedAt ? { softenerAddedAt: stage.softenerAddedAt } : {}),
        };
        const orderOpsStepUpdate = {
          [`opsDetails.stageTimings.${step}`]: stepTiming,
          [`stageTimings.${step}`]: stepTiming,
          updatedAt: now,
        };
        tx.set(orderRef, orderOpsStepUpdate, { merge: true });
        tx.set(db.doc(`vendors/${vendorId}/orders/${realOrderId}`), orderOpsStepUpdate, { merge: true });

        // Mirror to production order if needed
        if (nextStatus === 'done') {
          if (siblingCount <= 1) {
            const deliveryOTP = generateOTP();
            const updateData = { status: 'ready', readyAt: now, deliveryOTP };
            tx.set(orderRef, updateData, { merge: true });
            tx.set(db.doc(`vendors/${vendorId}/orders/${realOrderId}`), updateData, { merge: true });
          } else {
            const allDone = (allProcessesSnap ? allProcessesSnap.docs : []).every(d => {
              if (d.id === processRef.id) return true;
              return d.data().status === 'done';
            });
            
            if (allDone) {
              const deliveryOTP = generateOTP();
              const updateData = { status: 'ready', readyAt: now, deliveryOTP };
              tx.set(orderRef, updateData, { merge: true });
              tx.set(db.doc(`vendors/${vendorId}/orders/${realOrderId}`), updateData, { merge: true });
            }
          }
        } else if (isProductionStep(nextStatus)) {
          const updateData = { processingStep: nextStatus, updatedAt: now };
          tx.set(orderRef, updateData, { merge: true });
          tx.set(db.doc(`vendors/${vendorId}/orders/${realOrderId}`), updateData, { merge: true });
        }

        return { ok: true, currentIndex: nextIndex, status: nextStatus };
      });
      return result;
    } catch (err) {
      console.error('opsProcessing completeStep failed', err);
      return { ok: false, error: 'server_error', message: err?.message || String(err) };
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

  if (action === 'printBundleLabels') {
    const count = Number(data.count);
    if (!Number.isInteger(count) || count < 1 || count > 500) return { ok: false, error: 'invalid_input' };
    const ps = await processRef.get();
    if (!ps.exists) return { ok: false, error: 'not_found' };
    const process = ps.data();
    const stage = process.stages && process.stages.packaging;
    if (!stage || (stage.assignee !== auth.uid && role !== 'supervisor' && role !== 'admin')) return { ok: false, error: 'unauthorized' };

    const bundleLabels = [];
    for (let seq = 1; seq <= count; seq++) {
      bundleLabels.push({ seq, qr: `SPNZ_BDL:${orderId}:${seq}` });
    }

    await processRef.update({
      'stages.packaging.bundleLabelsPrintedAt': now,
      'stages.packaging.bundleLabels': bundleLabels,
      'stages.packaging.bundleCount': count,
    });
    return { ok: true, count, labels: bundleLabels };
  }

  if (action === 'scanGarment') {
    const qr = String(data.qr || '');
    const parsed = parseGarmentQr(qr, orderId);
    if (!parsed) return { ok: false, error: 'not_this_order' };

    try {
      const result = await db.runTransaction(async (tx) => {
        const ps = await tx.get(processRef);
        if (!ps.exists) return { ok: false, error: 'not_found' };
        const p = ps.data();
        const tagStage = p.stages && p.stages.tagging;
        if (!tagStage || tagStage.assignee !== auth.uid) return { ok: false, error: 'unauthorized' };
        if (tagStage.completedAt) return { ok: false, error: 'already_submitted' };

        const garments = p.garments || {};
        if (parsed.seq < 1 || parsed.seq > (garments.count || 0)) return { ok: false, error: 'not_in_count' };
        if ((garments.registered || []).some(r => r.seq === parsed.seq)) {
          return { ok: true, seq: parsed.seq, alreadyRegistered: true };
        }

        tx.update(processRef, {
          garments: {
            ...garments,
            registered: [...(garments.registered || []).filter(r => r.seq !== parsed.seq), { ...parsed, scannedAt: now, scannedBy: auth.uid }],
          },
        });
        return { ok: true, seq: parsed.seq };
      });
      return result;
    } catch (err) {
      console.error('opsProcessing scanGarment failed', err);
      return { ok: false, error: 'server_error' };
    }
  }

  if (action === 'tagAllGarments') {
    try {
      const result = await db.runTransaction(async (tx) => {
        const ps = await tx.get(processRef);
        if (!ps.exists) return { ok: false, error: 'not_found' };
        const p = ps.data();
        const tagStage = p.stages && p.stages.tagging;
        if (!tagStage || tagStage.assignee !== auth.uid) return { ok: false, error: 'unauthorized' };
        if (tagStage.completedAt) return { ok: false, error: 'already_submitted' };

        const garments = p.garments || {};
        const count = garments.count || 0;
        if (count < 1) return { ok: false, error: 'no_count' };

        const existing = garments.registered || [];
        const existingSeqs = new Set(existing.map(r => r.seq));
        const allRegistered = [...existing];
        for (let seq = 1; seq <= count; seq++) {
          if (!existingSeqs.has(seq)) {
            allRegistered.push({
              orderId,
              seq,
              qr: `SPNZ:${orderId}:${seq}`,
              scannedAt: now,
              scannedBy: auth.uid,
            });
          }
        }

        tx.update(processRef, {
          garments: {
            ...garments,
            registered: allRegistered,
          },
        });
        return { ok: true, count: allRegistered.length };
      });
      return result;
    } catch (err) {
      console.error('opsProcessing tagAllGarments failed', err);
      return { ok: false, error: 'server_error' };
    }
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
        const startedAtMs = tagStage.startedAt ? (typeof tagStage.startedAt.toMillis === 'function' ? tagStage.startedAt.toMillis() : new Date(tagStage.startedAt).getTime()) : completedAt.toMillis();
        const acceptedAtMs = tagStage.acceptedAt ? (typeof tagStage.acceptedAt.toMillis === 'function' ? tagStage.acceptedAt.toMillis() : new Date(tagStage.acceptedAt).getTime()) : startedAtMs;

        const durationMs = Math.max(0, completedAt.toMillis() - startedAtMs);
        const acceptToCompleteMs = Math.max(0, completedAt.toMillis() - acceptedAtMs);
        const acceptToCompleteMin = Math.round(acceptToCompleteMs / 60000);
        const startToCompleteMin = Math.round(durationMs / 60000);

        const nextIndex = p.currentIndex + 1;
        const nextStatus = nextIndex < p.steps.length ? p.steps[nextIndex] : 'done';

        tx.update(processRef, {
          garments: { ...garments, submittedAt: now },
          stages: { 
            ...(p.stages || {}), 
            tagging: { 
              ...tagStage, 
              completedAt, 
              durationMs,
              acceptToCompleteMin,
              startToCompleteMin,
            },
            ...(nextStatus !== 'done' ? {
              [nextStatus]: {
                ...(p.stages?.[nextStatus] || {}),
                queuedAt: completedAt,
              }
            } : {})
          },
          currentIndex: nextIndex,
          status: nextStatus,
        });

        // Clear activeHelperTask for the helper who completed tagging
        if (tagStage.assignee) {
          try {
            tx.update(db.doc(`ops_staff/${tagStage.assignee}`), {
              activeHelperTask: admin.firestore.FieldValue.delete()
            });
          } catch (e) {
            console.warn('Could not clear activeHelperTask on staff doc', e);
          }
        }

        // Dual-write to ops_stage_metrics for permanent historical tracking
        const todayStr = new Date(completedAt.toMillis() + (5.5 * 3600 * 1000)).toISOString().split('T')[0];
        const metricRef = db.doc(`ops_stage_metrics/${processRef.id}__tagging`);
        tx.set(metricRef, {
          processId: processRef.id,
          orderId: p.orderId || orderId,
          parentOrderId: p.parentOrderId || orderId,
          step: 'tagging',
          serviceType: p.serviceType || 'wash_fold',
          serviceLabel: p.serviceLabel || '',
          assignee: tagStage.assignee || auth.uid,
          assigneeName: tagStage.assigneeName || name,
          acceptedAt: tagStage.acceptedAt || tagStage.startedAt || completedAt,
          startedAt: tagStage.startedAt || completedAt,
          completedAt,
          acceptToCompleteMin,
          startToCompleteMin,
          durationMs,
          dateKey: todayStr,
          createdAt: completedAt,
        }, { merge: true });

        // Attach garment count and tagging stage timing directly to customer & vendor order docs
        const taggingTiming = {
          assignee: tagStage.assignee || auth.uid,
          assigneeName: tagStage.assigneeName || name,
          acceptedAt: tagStage.acceptedAt || tagStage.startedAt || completedAt,
          startedAt: tagStage.startedAt || completedAt,
          completedAt,
          acceptToCompleteMin,
          startToCompleteMin,
          durationMs,
        };
        const orderOpsTaggingUpdate = {
          garmentCount: expected,
          registeredGarmentsCount: got,
          'opsDetails.garmentCount': expected,
          'opsDetails.registeredGarmentsCount': got,
          'opsDetails.stageTimings.tagging': taggingTiming,
          'stageTimings.tagging': taggingTiming,
          updatedAt: now,
        };
        tx.set(orderRef, orderOpsTaggingUpdate, { merge: true });
        tx.set(db.doc(`vendors/${vendorId}/orders/${orderId}`), orderOpsTaggingUpdate, { merge: true });

        // Mirror to production order if needed
        if (nextStatus === 'done') {
          const siblingCount = p.siblingCount || 1;
          
          if (siblingCount <= 1) {
            const deliveryOTP = generateOTP();
            const updateData = { status: 'ready', readyAt: now, deliveryOTP };
            tx.update(orderRef, updateData);
            tx.set(db.doc(`vendors/${vendorId}/orders/${orderId}`), updateData, { merge: true });
          } else {
            const parentId = p.parentOrderId || orderId;
            const allProcesses = await tx.get(
              db.collection('ops_process').where('parentOrderId', '==', parentId)
            );
            
            const allDone = allProcesses.docs.every(d => {
              if (d.id === processRef.id) return true;
              return d.data().status === 'done';
            });
            
            if (allDone) {
              const deliveryOTP = generateOTP();
              const updateData = { status: 'ready', readyAt: now, deliveryOTP };
              tx.update(orderRef, updateData);
              tx.set(db.doc(`vendors/${vendorId}/orders/${orderId}`), updateData, { merge: true });
            }
          }
        } else if (isProductionStep(nextStatus)) {
          const updateData = { processingStep: nextStatus, updatedAt: now };
          tx.update(orderRef, updateData);
          tx.set(db.doc(`vendors/${vendorId}/orders/${orderId}`), updateData, { merge: true });
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
        // Allow the assigned helper OR any supervisor/admin to complete the step
        if (!stage || (stage.assignee !== auth.uid && role !== 'supervisor' && role !== 'admin')) {
          return { ok: false, error: 'unauthorized' };
        }
        if (!stage.startedAt) return { ok: false, error: 'invalid_state' };
        if (stage.completedAt) return { ok: false, error: 'already_completed' };

        const completedAt = now;
        const startedAtMs = stage.startedAt ? (typeof stage.startedAt.toMillis === 'function' ? stage.startedAt.toMillis() : new Date(stage.startedAt).getTime()) : completedAt.toMillis();
        const acceptedAtMs = stage.acceptedAt ? (typeof stage.acceptedAt.toMillis === 'function' ? stage.acceptedAt.toMillis() : new Date(stage.acceptedAt).getTime()) : startedAtMs;

        const durationMs = Math.max(0, completedAt.toMillis() - startedAtMs);
        const acceptToCompleteMs = Math.max(0, completedAt.toMillis() - acceptedAtMs);
        const acceptToCompleteMin = Math.round(acceptToCompleteMs / 60000);
        const startToCompleteMin = Math.round(durationMs / 60000);

        const nextIndex = process.currentIndex + 1;
        const nextStatus = nextIndex < process.steps.length ? process.steps[nextIndex] : 'done';

        const qualityMedia = data.qualityMedia || {};
        
        let allDone = false;
        if (nextStatus === 'done') {
          const siblingCount = process.siblingCount || 1;
          if (siblingCount > 1) {
            const parentId = process.parentOrderId || orderId;
            const allProcesses = await tx.get(
              db.collection('ops_process').where('parentOrderId', '==', parentId)
            );
            
            allDone = allProcesses.docs.every(d => {
              if (d.id === processRef.id) return true;
              return d.data().status === 'done';
            });
          }
        }
        
        tx.update(processRef, {
          stages: {
            ...(process.stages || {}),
            packaging: { 
              ...stage, 
              completedAt, 
              durationMs, 
              acceptToCompleteMin,
              startToCompleteMin,
              qualityProof: qualityMedia 
            },
          },
          currentIndex: nextIndex,
          status: nextStatus,
        });

        // Clear activeHelperTask for the helper who completed packaging
        if (stage.assignee) {
          try {
            tx.update(db.doc(`ops_staff/${stage.assignee}`), {
              activeHelperTask: admin.firestore.FieldValue.delete()
            });
          } catch (e) {
            console.warn('Could not clear activeHelperTask on staff doc', e);
          }
        }

        // Dual-write to ops_stage_metrics for permanent historical tracking
        const todayStr = new Date(completedAt.toMillis() + (5.5 * 3600 * 1000)).toISOString().split('T')[0];
        const metricRef = db.doc(`ops_stage_metrics/${processRef.id}__packaging`);
        tx.set(metricRef, {
          processId: processRef.id,
          orderId: process.orderId || orderId,
          parentOrderId: process.parentOrderId || orderId,
          step: 'packaging',
          serviceType: process.serviceType || 'wash_fold',
          serviceLabel: process.serviceLabel || '',
          assignee: stage.assignee || auth.uid,
          assigneeName: stage.assigneeName || name,
          acceptedAt: stage.acceptedAt || stage.startedAt || completedAt,
          startedAt: stage.startedAt || completedAt,
          completedAt,
          acceptToCompleteMin,
          startToCompleteMin,
          durationMs,
          dateKey: todayStr,
          createdAt: completedAt,
        }, { merge: true });

        // Attach packaging photos, packagingProof, and stage timing directly to customer & vendor order docs
        const packagingPhotosList = Array.isArray(qualityMedia.photos) ? qualityMedia.photos : [];
        const packagingTiming = {
          assignee: stage.assignee || auth.uid,
          assigneeName: stage.assigneeName || name,
          acceptedAt: stage.acceptedAt || stage.startedAt || completedAt,
          startedAt: stage.startedAt || completedAt,
          completedAt,
          acceptToCompleteMin,
          startToCompleteMin,
          durationMs,
          ...(qualityMedia.bundles ? { bundles: qualityMedia.bundles } : {}),
        };

        const orderOpsPackagingUpdate = {
          qualityPhotos: packagingPhotosList,
          packagingPhotos: packagingPhotosList,
          ...(packagingPhotosList.length > 0 ? { proofUrl: packagingPhotosList[0] } : {}),
          packagingProof: qualityMedia,
          'opsDetails.qualityPhotos': packagingPhotosList,
          'opsDetails.packagingPhotos': packagingPhotosList,
          'opsDetails.packagingProof': qualityMedia,
          'opsDetails.stageTimings.packaging': packagingTiming,
          'stageTimings.packaging': packagingTiming,
          updatedAt: now,
        };
        tx.set(orderRef, orderOpsPackagingUpdate, { merge: true });
        tx.set(db.doc(`vendors/${vendorId}/orders/${orderId}`), orderOpsPackagingUpdate, { merge: true });

        if (nextStatus === 'done') {
          const siblingCount = process.siblingCount || 1;
          if (siblingCount <= 1 || allDone) {
            const deliveryOTP = generateOTP();
            const updateData = { status: 'ready', readyAt: now, deliveryOTP };
            tx.update(orderRef, updateData);
            tx.set(db.doc(`vendors/${vendorId}/orders/${orderId}`), updateData, { merge: true });
          }
        }

        return { ok: true, currentIndex: nextIndex, status: nextStatus };
      });
      return result;
    } catch (err) {
      console.error('opsProcessing completePackaging failed', err);
      return { ok: false, error: `server_error: ${err.message}` };
    }
  }

  if (action === 'markChemicalAdded') {
    const chemical = data.chemical;
    if (chemical !== 'detergent' && chemical !== 'softener') return { ok: false, error: 'invalid_input' };
    const ps = await processRef.get();
    if (!ps.exists) return { ok: false, error: 'not_found' };
    const process = ps.data();
    const cur = process.steps && process.steps[process.currentIndex];
    if (cur !== 'getting_washed') return { ok: false, error: 'invalid_state' };
    const field = chemical === 'detergent' ? 'stages.getting_washed.detergentAddedAt' : 'stages.getting_washed.softenerAddedAt';
    await processRef.update({
      [field]: now,
    });
    return { ok: true, chemical };
  }

  if (action === 'snoozeNudge') {
    const { phase, step } = data; // phase: 'accepted' | 'started'
    if (!phase || !step) return { ok: false, error: 'invalid_input' };
    const ps = await processRef.get();
    if (!ps.exists) return { ok: true, status: 'not_found', phase, step };
    const p = ps.data();
    const steps = Array.isArray(p.steps) ? p.steps : [];
    const cur = steps[p.currentIndex];
    if (cur !== step) {
      // Step already progressed to next stage, smoothly acknowledge
      return { ok: true, status: 'already_progressed', phase, step };
    }

    const stageData = (p.stages && p.stages[step]) || {};
    if (stageData.assignee && stageData.assignee !== auth.uid && role !== 'supervisor' && role !== 'admin') {
      return { ok: false, error: 'unauthorized' };
    }

    if (phase === 'accepted' && stageData.startedAt) {
      return { ok: true, status: 'already_started', phase, step };
    }
    if (phase === 'started' && stageData.completedAt) {
      return { ok: true, status: 'already_completed', phase, step };
    }

    await processRef.set({
      stages: {
        [step]: {
          nudge: {
            [phase]: {
              lastSnoozedAt: now,
              snoozeCount: admin.firestore.FieldValue.increment(1),
            }
          }
        }
      }
    }, { merge: true });
    return { ok: true, phase, step };
  }

  return { ok: false, error: 'invalid_input' };
  } catch (outerErr) {
    console.error('opsProcessing unhandled error:', outerErr);
    return { ok: false, error: 'server_error', message: outerErr?.message || String(outerErr) };
  }
});

exports.supervisorActions = onCall({ cors: true, invoker: 'public' }, async (request) => {
  const auth = request.auth;
  if (!auth) return { ok: false, error: 'unauthorized' };
  let phone = normalizePhone(auth.token && auth.token.phone_number);
  let role = null;

  const staffDoc = await db.doc(`ops_staff/${auth.uid}`).get();
  if (staffDoc.exists) {
    const sd = staffDoc.data();
    if (sd.role) role = sd.role;
    if (!phone && sd.phone) phone = normalizePhone(sd.phone);
  }

  const rosterSnap = await db.doc('config/opsStaff').get();
  const rosterPhones = rosterSnap.exists && rosterSnap.data().phones ? rosterSnap.data().phones : {};
  if (phone && rosterPhones[phone]) {
    role = rosterPhones[phone];
  }

  const data = request.data || {};
  const { action, orderId, vendorId: reqVendorId } = data;
  let userId = data.userId;
  
  if (role !== 'supervisor' && role !== 'admin' && !(role === 'rider' && action === 'verifyDeliveryOTP')) {
    return { ok: false, error: 'unauthorized' };
  }

  if (action === 'backfillOpsTasks') {
    if (role !== 'supervisor' && role !== 'admin') {
      return { ok: false, error: 'unauthorized' };
    }
    const tasksSnap = await db.collection('ops_tasks')
      .where('status', 'in', ['pending', 'assigned', 'in_transit_to_store'])
      .get();
    let updatedCount = 0;
    for (const tDoc of tasksSnap.docs) {
      const td = tDoc.data();
      const targetOrderId = td.orderId || tDoc.id;
      let targetUserId = td.userId;
      let orderData = null;

      if (targetUserId) {
        const oSnap = await db.doc(`users/${targetUserId}/orders/${targetOrderId}`).get();
        if (oSnap.exists) orderData = oSnap.data();
      }
      if (!orderData) {
        const cgSnap = await db.collectionGroup('orders').where('id', '==', targetOrderId).limit(1).get();
        if (!cgSnap.empty) {
          orderData = cgSnap.docs[0].data();
          if (!targetUserId) targetUserId = orderData.userId || (cgSnap.docs[0].ref.parent && cgSnap.docs[0].ref.parent.parent && cgSnap.docs[0].ref.parent.parent.id);
        }
      }

      if (orderData) {
        const total = (orderData.totalAmount || (orderData.billDetails && orderData.billDetails.total) || orderData.cartTotal) || 0;
        const patch = {
          customerName: orderData.customerName || orderData.userName || '',
          customerPhone: orderData.customerPhone || orderData.userPhone || '',
          pickupAddress: pickupAddressFromOrder(orderData),
          items: orderData.items || [],
          totalAmount: total,
          paymentStatus: orderData.paymentStatus || orderData.paymentMethod || 'pending',
          paymentMode: orderData.paymentMode || orderData.paymentMethod || '',
          notes: orderData.notes || orderData.instruction || '',
          latitude: orderData.latitude || (orderData.address && orderData.address.latitude) || null,
          longitude: orderData.longitude || (orderData.address && orderData.address.longitude) || null,
        };
        if (targetUserId && !td.userId) patch.userId = targetUserId;
        await tDoc.ref.set(patch, { merge: true });
        updatedCount += 1;
      }
    }
    return { ok: true, updatedCount };
  }

  if (!orderId || !action) return { ok: false, error: 'invalid_input' };

  if (!userId) {
    const delSnap = await db.doc(`ops_delivery_tasks/${orderId}`).get();
    if (delSnap.exists && delSnap.data().userId) userId = delSnap.data().userId;
  }
  if (!userId) {
    const taskSnap = await db.doc(`ops_tasks/${orderId}`).get();
    if (taskSnap.exists && taskSnap.data().userId) userId = taskSnap.data().userId;
  }
  if (!userId) {
    const qSnap = await db.doc(`ops_queue/${orderId}`).get();
    if (qSnap.exists && qSnap.data().userId) userId = qSnap.data().userId;
  }
  if (!userId) {
    const procSnap = await db.doc(`ops_process/${orderId}`).get();
    if (procSnap.exists && procSnap.data().userId) userId = procSnap.data().userId;
  }
  if (!userId) {
    try {
      const cgSnap = await db.collectionGroup('orders')
        .where(admin.firestore.FieldPath.documentId(), '==', orderId)
        .limit(1)
        .get();
      if (!cgSnap.empty) {
        const od = cgSnap.docs[0].data();
        userId = od.userId || (cgSnap.docs[0].ref.parent && cgSnap.docs[0].ref.parent.parent && cgSnap.docs[0].ref.parent.parent.id);
      }
    } catch (e) {
      console.warn('collectionGroup fallback in supervisorActions failed:', e);
    }
  }

  if (!userId) return { ok: false, error: 'invalid_input' };
  
  const orderRef = db.doc(`users/${userId}/orders/${orderId}`);
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

      const vendorId = reqVendorId || order.vendorId || (taskSnap.exists && taskSnap.data().vendorId) || 'default';
      const vendorRef = db.doc(`vendors/${vendorId}/orders/${orderId}`);

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
        
        // Cleanup ops task/queue and delivery task
        if (taskSnap.exists) {
          tx.update(db.doc(`ops_tasks/${orderId}`), { status: 'cancelled', cancelledAt: now });
        }
        if (queueSnap.exists) {
          tx.delete(db.doc(`ops_queue/${orderId}`));
        }
        // Clean up delivery task if one exists
        if (delTaskSnap.exists) {
          tx.delete(delTaskRef);
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
        const deliveryDate = order.deliveryDate || new Date().toISOString().split('T')[0];
        const deliveryTime = order.deliveryTime || 'Immediate';
        if (!order.deliveryDate || !order.deliveryTime) {
          tx.update(orderRef, { deliveryDate, deliveryTime, deliveryScheduledAt: now, updatedAt: now });
          tx.set(vendorRef, { deliveryDate, deliveryTime, deliveryScheduledAt: now, updatedAt: now }, { merge: true });
        }

        // Assign a rider
        const assignee = await selectRider();
        if (!assignee) return { ok: false, error: 'no_rider_available' };

        // Do not change order status yet, keep it 'ready' until pickup
        // Update delivery task to 'assigned'
        if (delTaskSnap.exists) {
          tx.update(delTaskRef, {
            assignee,
            status: 'assigned',
            assignedAt: now,
            deliveryDate,
            deliveryTime,
          });
        } else {
          tx.set(delTaskRef, {
            orderId,
            userId,
            vendorId,
            type: 'delivery',
            status: 'assigned',
            assignee,
            deliveryAddress: pickupAddressFromOrder(order),
            deliveryDate,
            deliveryTime,
            deliveryOTP: order.deliveryOTP || null,
            customerName: order.customerName || order.userName || '',
            customerPhone: order.customerPhone || order.userPhone || '',
            assignedAt: now,
            createdAt: now,
          });
        }

        return { ok: true, status: 'assigned' };
      }

      if (action === 'pickupDelivery') {
        if (order.status !== 'ready') return { ok: false, error: 'invalid_state' };
        if (role === 'rider' && delTaskSnap.exists && delTaskSnap.data().assignee !== auth.uid) {
          return { ok: false, error: 'unauthorized' };
        }
        
        const updateData = {
          status: 'out_for_delivery',
          outForDeliveryAt: now,
          updatedAt: now,
        };
        tx.update(orderRef, updateData);
        tx.set(vendorRef, updateData, { merge: true });

        if (delTaskSnap.exists) {
          tx.update(delTaskRef, { status: 'out_for_delivery', pickedUpAt: now });
        }
        return { ok: true, status: 'out_for_delivery' };
      }

      if (action === 'verifyDeliveryOTP') {
        if (order.status !== 'out_for_delivery') return { ok: false, error: 'invalid_state' };
        if (role === 'rider' && delTaskSnap.exists && delTaskSnap.data().assignee !== auth.uid) {
          return { ok: false, error: 'unauthorized' };
        }
        const { otp, proofUrl, allowUnpaidDelivery } = data;
        if (!otp || String(otp) !== String(order.deliveryOTP)) {
          return { ok: false, error: 'invalid_otp' };
        }

        // ⚠️ Payment Gate: Order must be paid before delivery completion
        const paymentCheck = checkPaymentGate(order, { allowUnpaidDelivery, role });
        if (!paymentCheck.allowed) {
          return {
            ok: false,
            error: paymentCheck.reason,
            message: paymentCheck.message,
            amount: paymentCheck.amount,
          };
        }

        const updateData = {
          status: 'delivered',
          deliveryVerified: true,
          deliveredAt: now,
          updatedAt: now,
          ...(proofUrl ? { deliveryProofUrl: proofUrl } : {}),
        };
        tx.update(orderRef, updateData);
        tx.set(vendorRef, updateData, { merge: true });

        // Update delivery task (delTaskSnap/delTaskRef read at top)
        if (delTaskSnap.exists) {
          tx.update(delTaskRef, { 
            status: 'delivered', 
            deliveredAt: now,
            ...(proofUrl ? { proofUrl } : {})
          });
        }

        return { ok: true, status: 'delivered' };
      }

      if (action === 'assignTaskToRider') {
        const { riderId, isDelivery } = data;
        if (!riderId) return { ok: false, error: 'invalid_input' };

        if (isDelivery) {
          if (order.status !== 'ready' && order.status !== 'out_for_delivery') {
            return { ok: false, error: 'invalid_state' };
          }
          const deliveryDate = order.deliveryDate || new Date().toISOString().split('T')[0];
          const deliveryTime = order.deliveryTime || 'Immediate';
          
          const updateData = {
            status: 'out_for_delivery',
            outForDeliveryAt: now,
            updatedAt: now,
            deliveryRiderId: riderId,
            riderId: riderId,
            ...(!order.deliveryDate || !order.deliveryTime ? { deliveryDate, deliveryTime, deliveryScheduledAt: now } : {}),
          };
          tx.update(orderRef, updateData);
          tx.set(vendorRef, updateData, { merge: true });

          const total = (order && (order.totalAmount || (order.billDetails && order.billDetails.total) || order.cartTotal)) || 0;

          if (delTaskSnap.exists) {
            tx.update(delTaskRef, {
              assignee: riderId,
              status: 'out_for_delivery',
              assignedAt: now,
              deliveryDate,
              deliveryTime,
              acceptedAt: admin.firestore.FieldValue.delete(),
              customerName: order.customerName || order.userName || delTaskSnap.data().customerName || '',
              customerPhone: order.customerPhone || order.userPhone || delTaskSnap.data().customerPhone || '',
              deliveryAddress: pickupAddressFromOrder(order) || delTaskSnap.data().deliveryAddress || '',
              totalAmount: total || delTaskSnap.data().totalAmount || 0,
              items: (order && order.items) || delTaskSnap.data().items || [],
              tokenNumber: order.tokenNumber || delTaskSnap.data().tokenNumber || null,
              tokens: order.tokens || delTaskSnap.data().tokens || null,
            });
          } else {
            tx.set(delTaskRef, {
              orderId, userId, vendorId, type: 'delivery', status: 'out_for_delivery',
              assignee: riderId, deliveryAddress: pickupAddressFromOrder(order),
              deliveryDate, deliveryTime,
              deliveryOTP: order.deliveryOTP || null,
              customerName: order.customerName || order.userName || '',
              customerPhone: order.customerPhone || order.userPhone || '',
              totalAmount: total,
              items: (order && order.items) || [],
              tokenNumber: order.tokenNumber || null,
              tokens: order.tokens || null,
              assignedAt: now, createdAt: now,
            });
          }
          return { ok: true, status: 'out_for_delivery' };
        } else {
          // Pickup assignment
          if (order.status !== 'placed' && order.status !== 'confirmed') {
            return { ok: false, error: 'invalid_state' };
          }
          
          tx.update(orderRef, { riderId: riderId, updatedAt: now });
          tx.set(vendorRef, { riderId: riderId, updatedAt: now }, { merge: true });

          if (taskSnap.exists) {
            tx.update(db.doc(`ops_tasks/${orderId}`), {
              assignee: riderId,
              assignedAt: now,
              status: 'assigned',
              acceptedAt: admin.firestore.FieldValue.delete(),
            });
          } else if (queueSnap.exists) {
            tx.set(db.doc(`ops_tasks/${orderId}`), {
              ...queueSnap.data(), assignee: riderId, assignedAt: now, status: 'assigned'
            });
            tx.delete(db.doc(`ops_queue/${orderId}`));
          } else {
            // Manual pickup assignment with no existing task/queue — create one.
            const total = (order && (order.totalAmount || (order.billDetails && order.billDetails.total) || order.cartTotal)) || 0;
            tx.set(db.doc(`ops_tasks/${orderId}`), {
              orderId, userId, vendorId, assignee: riderId, status: 'assigned',
              customerName: (order && (order.customerName || order.userName)) || '',
              customerPhone: (order && (order.customerPhone || order.userPhone)) || '',
              pickupAddress: pickupAddressFromOrder(order),
              pickupSlot: order.pickupDetails || null,
              tokenNumber: order.tokenNumber || null,
              tokens: order.tokens || null,
              pickupOTP: order.pickupOTP || null,
              items: (order && order.items) || [],
              totalAmount: total,
              paymentStatus: (order && (order.paymentStatus || order.paymentMethod)) || 'pending',
              paymentMode: (order && (order.paymentMode || order.paymentMethod)) || '',
              notes: (order && (order.notes || order.instruction)) || '',
              latitude: (order && (order.latitude || (order.address && order.address.latitude))) || null,
              longitude: (order && (order.longitude || (order.address && order.address.longitude))) || null,
              assignedAt: now, createdAt: now,
            });
          }
          return { ok: true, status: 'assigned' };
        }
      }

      if (action === 'unassignPickup') {
        if (order.status !== 'placed' && order.status !== 'confirmed') {
          return { ok: false, error: 'invalid_state' };
        }
        tx.update(orderRef, { riderId: admin.firestore.FieldValue.delete(), updatedAt: now });
        tx.set(vendorRef, { riderId: admin.firestore.FieldValue.delete(), updatedAt: now }, { merge: true });

        // Move the pickup out of a rider's queue and park it for later assignment.
        if (taskSnap.exists) {
          tx.delete(db.doc(`ops_tasks/${orderId}`));
        }
        if (!queueSnap.exists) {
          tx.set(db.doc(`ops_queue/${orderId}`), {
            orderId, userId, vendorId, status: 'pending',
            pickupAddress: pickupAddressFromOrder(order),
            pickupSlot: order.pickupDetails || null,
            tokenNumber: order.tokenNumber || null,
            pickupOTP: order.pickupOTP || null,
            createdAt: now,
          });
        }
        return { ok: true, status: 'parked' };
      }

      if (action === 'unassignDelivery') {
        if (order.status !== 'ready' && order.status !== 'out_for_delivery') {
          return { ok: false, error: 'invalid_state' };
        }
        // Move the delivery out of the rider's queue and return order to 'ready'
        const updateData = {
          status: 'ready',
          updatedAt: now,
          outForDeliveryAt: admin.firestore.FieldValue.delete(),
          deliveryRiderId: admin.firestore.FieldValue.delete(),
          riderId: admin.firestore.FieldValue.delete(),
        };
        tx.update(orderRef, updateData);
        tx.set(vendorRef, updateData, { merge: true });

        if (delTaskSnap.exists) {
          tx.update(delTaskRef, {
            assignee: null,
            status: 'pending',
            assignedAt: admin.firestore.FieldValue.delete(),
            acceptedAt: admin.firestore.FieldValue.delete(),
            pickedUpAt: admin.firestore.FieldValue.delete(),
          });
        }
        return { ok: true, status: 'unassigned' };
      }

      // ── Helper step assignment (mirror of rider assign/unassign, per process step) ──
      // Only the CURRENT step's owner changes; progress (startedAt, garments, …) is kept
      // so a half-done stage can be handed over. Unassigning returns it to the open pool
      // where the global HelperAssignmentModal offers it to the next free helper.
      if (action === 'assignStepToHelper' || action === 'unassignStep') {
        const { processId, helperId } = data;
        if (!processId || typeof processId !== 'string') return { ok: false, error: 'invalid_input' };
        const pRef = db.doc(`ops_process/${processId}`);
        const pSnap = await tx.get(pRef);
        if (!pSnap.exists) return { ok: false, error: 'not_found' };
        const p = pSnap.data();
        const step = p.steps[p.currentIndex];
        const s = (p.stages && p.stages[step]) || {};
        if (!step || p.status === 'done' || s.completedAt) return { ok: false, error: 'invalid_state' };

        // eslint-disable-next-line no-unused-vars
        const { assignee, assigneeName, assignedBy, assignedAt, acceptedAt, ...progress } = s;

        if (action === 'unassignStep') {
          if (!assignee && !s.startedAt) return { ok: true, status: 'unassigned' };
          const isMachine = step === 'getting_washed' || step === 'getting_dried' || step === 'getting_ironed';
          const shouldClearStart = Boolean(data.clearStartedAt) || !isMachine;
          const updateStage = shouldClearStart
            ? (({ startedAt, detergentAddedAt, softenerAddedAt, ...rest }) => rest)(progress)
            : progress;
          tx.update(pRef, { [`stages.${step}`]: updateStage });

          if (assignee) {
            try {
              const hRef = db.doc(`ops_staff/${assignee}`);
              tx.update(hRef, { activeHelperTask: admin.firestore.FieldValue.delete() });
            } catch (e) {
              console.warn('Could not clear activeHelperTask on staff doc', e);
            }
          }
          return { ok: true, status: 'unassigned' };
        }

        if (!helperId || typeof helperId !== 'string') return { ok: false, error: 'invalid_input' };
        const hSnap = await tx.get(db.doc(`ops_staff/${helperId}`));
        const h = hSnap.exists ? hSnap.data() : null;
        if (!h || h.onShift !== true || h.role === 'rider') return { ok: false, error: 'helper_unavailable' };

        // acceptedAt is cleared so the new helper gets the popup and must acknowledge.
        tx.update(pRef, {
          [`stages.${step}`]: { ...progress, assignee: helperId, assigneeName: h.name || '', assignedBy: auth.uid, assignedAt: now },
        });
        return { ok: true, status: 'assigned' };
      }

      return { ok: false, error: 'invalid_action' };
    });
    if (result.ok && action === 'assignStepToHelper') {
      try {
        const { processId, helperId } = data;
        const pSnap = await db.doc(`ops_process/${processId}`).get();
        if (pSnap.exists) {
          const p = pSnap.data();
          await sendFCMOrderAssignment({
            staffId: helperId,
            orderId: p.orderId || processId,
            taskType: 'step',
            customerName: p.customerName || '',
            stepName: p.steps[p.currentIndex] || '',
          });
        }
      } catch (err) {
        console.error('assignStepToHelper FCM push error', err);
      }
    }

    // After a successful cancel, clean up ops_process docs (outside the tx since
    // it requires a collection query by parentOrderId).
    if (result.ok && action === 'cancelOrder') {
      try {
        await deleteProcessDocs(orderId, userId, reqVendorId || 'default');
      } catch (err) {
        console.error(`supervisorActions: process cleanup failed for ${orderId}`, err);
      }
    }

    return result;
  } catch (err) {
    console.error('supervisorActions failed', err);
    return { ok: false, error: 'server_error' };
  }
});

// Universal safety net: fires whenever an ops_tasks is written/assigned to a rider
exports.onOpsTaskWritten = onDocumentWritten('ops_tasks/{orderId}', async (event) => {
  if (!event.data) return;
  const before = event.data.before ? event.data.before.data() : null;
  const after = event.data.after ? event.data.after.data() : null;
  if (!after) return; // deleted

  // Auto-heal missing customer details directly onto ops_tasks:
  if (!after.customerName || !after.customerPhone || !after.pickupAddress || !after.items) {
    try {
      const orderId = event.params.orderId;
      let userId = after.userId;
      let order = null;
      if (userId) {
        const snap = await db.doc(`users/${userId}/orders/${orderId}`).get();
        if (snap.exists) order = snap.data();
      }
      if (!order) {
        const cgSnap = await db.collectionGroup('orders').where('id', '==', orderId).limit(1).get();
        if (!cgSnap.empty) {
          order = cgSnap.docs[0].data();
          userId = userId || order.userId || (cgSnap.docs[0].ref.parent && cgSnap.docs[0].ref.parent.parent && cgSnap.docs[0].ref.parent.parent.id);
        }
      }
      if (order) {
        const total = (order.totalAmount || (order.billDetails && order.billDetails.total) || order.cartTotal) || 0;
        const patch = {};
        if (!after.customerName) patch.customerName = order.customerName || order.userName || '';
        if (!after.customerPhone) patch.customerPhone = order.customerPhone || order.userPhone || '';
        if (!after.pickupAddress) patch.pickupAddress = pickupAddressFromOrder(order);
        if (!after.items && order.items) patch.items = order.items;
        if (typeof after.totalAmount !== 'number') patch.totalAmount = total;
        if (!after.paymentStatus) patch.paymentStatus = order.paymentStatus || order.paymentMethod || 'pending';
        if (!after.paymentMode) patch.paymentMode = order.paymentMode || order.paymentMethod || '';
        if (!after.notes && (order.notes || order.instruction)) patch.notes = order.notes || order.instruction || '';
        if (!after.tokens && order.tokens) patch.tokens = order.tokens;
        if (!after.latitude && (order.latitude || (order.address && order.address.latitude))) {
          patch.latitude = order.latitude || (order.address && order.address.latitude);
        }
        if (!after.longitude && (order.longitude || (order.address && order.address.longitude))) {
          patch.longitude = order.longitude || (order.address && order.address.longitude);
        }
        if (userId && !after.userId) patch.userId = userId;

        if (Object.keys(patch).length > 0) {
          await db.doc(`ops_tasks/${orderId}`).set(patch, { merge: true });
          // Merge write will trigger onOpsTaskWritten again with fully enriched data
          return;
        }
      }
    } catch (e) {
      console.warn('onOpsTaskWritten auto-heal error:', e);
    }
  }

  const newAssignee = after.assignee;
  const oldAssignee = before ? before.assignee : null;

  // Only trigger if assignee was newly set or changed, and task is pending/assigned
  if (newAssignee && newAssignee !== oldAssignee && (after.status === 'pending' || after.status === 'assigned')) {
    const isInstant = Boolean(after.pickupSlot && after.pickupSlot.isInstant);
    const slot = (after.pickupSlot && after.pickupSlot.type === 'instant')
      ? 'Instant Pickup'
      : (after.pickupSlot && after.pickupSlot.scheduledTime) || '';
    await sendFCMOrderAssignment({
      staffId: newAssignee,
      orderId: event.params.orderId,
      taskType: isInstant ? 'Instant Pickup' : 'Pickup',
      customerName: after.customerName || '',
      address: after.pickupAddress || '',
      slot,
      isInstant,
    });
  }
});

// One-shot HTTP endpoint to heal and enrich all active ops_tasks immediately
exports.healOpsTasks = onRequest({ cors: true, invoker: 'public' }, async (req, res) => {
  try {
    // 1. Get all riders
    const ridersSnap = await db.collection('ops_staff').where('role', '==', 'rider').get();
    const riderIds = ridersSnap.docs.map(d => d.id);
    
    // Also include any other staff uids found
    const allStaffSnap = await db.collection('ops_staff').get();
    const allStaffIds = allStaffSnap.docs.map(d => d.id);

    const tasksToHeal = new Map();

    // Query tasks assigned to each staff member
    for (const uid of allStaffIds) {
      const staffTasks = await db.collection('ops_tasks').where('assignee', '==', uid).get();
      staffTasks.forEach(d => {
        const td = d.data();
        if (td.status === 'pending' || td.status === 'assigned' || td.status === 'in_transit_to_store') {
          tasksToHeal.set(d.id, { ref: d.ref, data: td });
        }
      });
    }

    // Also check ops_queue
    const queueSnap = await db.collection('ops_queue').get();
    queueSnap.forEach(d => {
      const td = d.data();
      if (td.status === 'pending') {
        tasksToHeal.set(d.id, { ref: d.ref, data: td });
      }
    });

    let updatedCount = 0;
    const details = [];

    for (const [taskId, { ref: tRef, data: td }] of tasksToHeal.entries()) {
      const targetOrderId = td.orderId || taskId;
      let targetUserId = td.userId;
      let orderData = null;

      if (targetUserId) {
        const oSnap = await db.doc(`users/${targetUserId}/orders/${targetOrderId}`).get();
        if (oSnap.exists) {
          orderData = oSnap.data();
        } else {
          // List user orders and check by document ID (case-insensitive or matching suffix)
          const userOrdersSnap = await db.collection(`users/${targetUserId}/orders`).get();
          for (const uDoc of userOrdersSnap.docs) {
            if (uDoc.id.toLowerCase() === targetOrderId.toLowerCase() || uDoc.id.toUpperCase().endsWith(targetOrderId.toUpperCase().slice(-6))) {
              orderData = uDoc.data();
              break;
            }
          }
        }
      }

      if (!orderData) {
        // Search vendor orders
        const vendorsSnap = await db.collection('vendors').get();
        for (const vDoc of vendorsSnap.docs) {
          const voSnap = await db.doc(`vendors/${vDoc.id}/orders/${targetOrderId}`).get();
          if (voSnap.exists) {
            orderData = voSnap.data();
            if (!targetUserId && orderData.userId) targetUserId = orderData.userId;
            break;
          }
        }
      }

      if (orderData) {
        const total = (orderData.totalAmount || (orderData.billDetails && orderData.billDetails.total) || orderData.cartTotal) || 0;
        const patch = {
          customerName: orderData.customerName || orderData.userName || '',
          customerPhone: orderData.customerPhone || orderData.userPhone || '',
          pickupAddress: pickupAddressFromOrder(orderData),
          items: orderData.items || [],
          totalAmount: total,
          paymentStatus: orderData.paymentStatus || orderData.paymentMethod || 'pending',
          paymentMode: orderData.paymentMode || orderData.paymentMethod || '',
          notes: orderData.notes || orderData.instruction || '',
          latitude: orderData.latitude || (orderData.address && orderData.address.latitude) || null,
          longitude: orderData.longitude || (orderData.address && orderData.address.longitude) || null,
        };
        if (orderData.tokens && !td.tokens) patch.tokens = orderData.tokens;
        if (targetUserId && !td.userId) patch.userId = targetUserId;
        await tRef.set(patch, { merge: true });
        updatedCount += 1;
        details.push({ orderId: targetOrderId, customerName: patch.customerName, phone: patch.customerPhone, address: patch.pickupAddress });
      } else {
        details.push({ orderId: targetOrderId, error: 'order_not_found', userId: targetUserId });
      }
    }

    res.json({ ok: true, foundPending: tasksToHeal.size, updatedCount, details });
  } catch (err) {
    console.error('healOpsTasks error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Universal safety net: fires whenever an ops_delivery_tasks is assigned to a rider
exports.onDeliveryTaskWritten = onDocumentWritten('ops_delivery_tasks/{orderId}', async (event) => {
  if (!event.data) return;
  const before = event.data.before ? event.data.before.data() : null;
  const after = event.data.after ? event.data.after.data() : null;
  if (!after) return;

  const newAssignee = after.assignee;
  const oldAssignee = before ? before.assignee : null;

  if (newAssignee && newAssignee !== oldAssignee && (after.status === 'assigned' || after.status === 'out_for_delivery')) {
    await sendFCMOrderAssignment({
      staffId: newAssignee,
      orderId: event.params.orderId,
      taskType: 'delivery',
      customerName: after.customerName || '',
      address: after.deliveryAddress || '',
      slot: `${after.deliveryDate || ''} ${after.deliveryTime || ''}`.trim(),
      isInstant: false,
    });
  }
});
