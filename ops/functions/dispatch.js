// Pure dispatch helpers. No firebase imports — unit-testable with `node --test`.

/** Normalize a phone number to full E.164 (+91XXXXXXXXXX). */
function normalizePhone(phone) {
  if (typeof phone !== 'string') return '';
  const p = phone.trim();
  if (!p) return '';
  if (p.startsWith('+')) return p.replace(/[^+\d]/g, '');
  const digits = p.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return '';
}

/**
 * Pick the least-busy on-shift rider from eligible candidates.
 * @param {Array<{uid: string, phone?: string, shiftStartAt?: number}>} candidates
 * @param {Record<string, number>} taskCounts - pending task count keyed by uid
 * @param {Record<string, string>} rosterPhones - config/opsStaff.phones map (full E.164 -> role)
 * @returns {string|null} selected uid, or null if none eligible
 */
function pickRider(candidates, taskCounts, rosterPhones) {
  const roster = rosterPhones || {};
  const eligible = candidates.filter((c) => {
    const phone = normalizePhone(c.phone || '');
    return phone !== '' && roster[phone] === 'rider';
  });
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    const ta = taskCounts[a.uid] || 0;
    const tb = taskCounts[b.uid] || 0;
    if (ta !== tb) return ta - tb;
    return (a.shiftStartAt || 0) - (b.shiftStartAt || 0);
  });
  return eligible[0].uid;
}

/**
 * Guard what statuses may transition to pickup_completed.
 * @param {string} status - the current order status
 * @returns {'ok'|'alreadyDone'|'invalidState'}
 */
function pickupGuard(status) {
  if (status === 'pickup_completed') return 'alreadyDone';
  if (status === 'placed' || status === 'confirmed') return 'ok';
  return 'invalidState';
}

/**
 * Map an order status transition to the ops-side task/queue action.
 * @param {string} beforeStatus
 * @param {string} afterStatus
 * @returns {{ taskStatus: string, dropQueue?: boolean } | null}
 */
function taskTransition(beforeStatus, afterStatus) {
  if (afterStatus === 'cancelled' && beforeStatus !== 'cancelled') {
    return { taskStatus: 'cancelled', dropQueue: true };
  }
  if (afterStatus === 'pickup_completed' && beforeStatus !== 'pickup_completed') {
    return { taskStatus: 'picked_up' };
  }
  return null;
}

/**
 * Compute the processing step sequence for an order, mirroring production's
 * AdminOrdersScreen.getOrderProcessingSteps exactly.
 * @param {{ items?: Array<{ serviceType?: string }> }} order
 * @returns {string[]}
 */
function getProcessingSteps(order) {
  if (!order || !order.items || order.items.length === 0) {
    return ['getting_washed', 'getting_folded'];
  }
  const serviceTypes = order.items.map((item) => item.serviceType);
  const onlyIroning = serviceTypes.every((type) => type === 'ironing');
  if (onlyIroning) return ['getting_ironed'];

  const steps = [];
  const needsWash = serviceTypes.some((type) =>
    type === 'wash_fold' || type === 'wash_iron' || type === 'blanket_wash' ||
    type === 'premium_laundry' || type === 'dry_clean' || type === 'shoe_clean');
  if (needsWash) steps.push('getting_washed');
  const needsDry = serviceTypes.some((type) => type === 'blanket_wash' || type === 'shoe_clean' || type === 'dry_clean');
  const needsFold = serviceTypes.some((type) => type === 'wash_fold' || type === 'premium_laundry');
  const needsIron = serviceTypes.some((type) => type === 'wash_iron' || type === 'ironing');
  if (needsDry) steps.push('getting_dried');
  if (needsFold) steps.push('getting_folded');
  if (needsIron) steps.push('getting_ironed');
  if (steps.length === 0) return ['getting_washed', 'getting_folded'];
  return steps;
}

/**
 * Return the next step after `current`, or null when the sequence is complete.
 * @param {string} current
 * @param {string[]} steps
 * @returns {string|null}
 */
function nextStep(current, steps) {
  const i = steps.indexOf(current);
  if (i === -1) return steps[0] || null;
  return steps[i + 1] || null;
}

module.exports = { pickRider, normalizePhone, pickupGuard, taskTransition, getProcessingSteps, nextStep };
