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
  if (afterStatus === 'delivered' && beforeStatus !== 'delivered') {
    return { taskStatus: 'delivered', dropProcess: true };
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
    return ['getting_washed', 'getting_dried'];
  }
  const serviceTypes = order.items.map((item) => item.serviceType);
  const onlyIroning = serviceTypes.every((type) => type === 'ironing');
  if (onlyIroning) return ['getting_ironed'];

  const steps = [];
  const needsWash = serviceTypes.some((type) =>
    type === 'wash_fold' || type === 'wash_iron' || type === 'blanket_wash' ||
    type === 'premium_laundry' || type === 'dry_clean' || type === 'shoe_clean');
  if (needsWash) steps.push('getting_washed');
  
  // Anything that is washed must be dried.
  const needsDry = needsWash;
  const needsIron = serviceTypes.some((type) => type === 'wash_iron' || type === 'ironing' || type === 'dry_clean');
  
  if (needsDry) steps.push('getting_dried');
  if (needsIron) steps.push('getting_ironed');
  
  if (steps.length === 0) return ['getting_washed', 'getting_dried'];
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

// Ops-only stages prepended to the production pipeline.
function opsStepsForOrder(order) {
  const prod = getProcessingSteps(order);
  return ['tagging', ...prod, 'packaging'];
}

const PRODUCTION_STEPS = new Set(['getting_washed', 'getting_dried', 'getting_ironed']);

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
const MAX_LABELS = 500;

function generateLabels(orderId, count) {
  const n = Math.min(MAX_LABELS, Math.max(1, Math.floor(Number(count)) || 0));
  const out = [];
  for (let seq = 1; seq <= n; seq += 1) out.push({ seq, qr: `SPNZ:${orderId}:${seq}` });
  return out;
}

// ─── Multi-Service Order Splitting ─────────────────────────────────────────────

const SERVICE_LABELS = {
  wash_fold: 'Wash & Fold',
  wash_iron: 'Wash & Iron',
  ironing: 'Steam Iron',
  blanket_wash: 'Blanket Wash',
  blanket_wash_single: 'Blanket Wash (Single)',
  blanket_wash_double: 'Blanket Wash (Double)',
  shoe_clean: 'Shoe Clean',
  dry_clean: 'Dry Clean',
  premium_laundry: 'Premium Laundry',
};

/**
 * Compute the processing steps for a SINGLE service type.
 * Each service type has its own independent pipeline.
 */
function stepsForServiceType(serviceType) {
  switch (serviceType) {
    case 'wash_fold':
    case 'premium_laundry':
      return ['tagging', 'getting_washed', 'getting_dried', 'packaging'];
    case 'wash_iron':
      return ['tagging', 'getting_washed', 'getting_dried', 'getting_ironed', 'packaging'];
    case 'ironing':
      return ['tagging', 'getting_ironed', 'packaging'];
    case 'blanket_wash':
    case 'blanket_wash_single':
    case 'blanket_wash_double':
    case 'shoe_clean':
      return ['tagging', 'getting_washed', 'getting_dried', 'packaging'];
    case 'dry_clean':
      return ['tagging', 'getting_washed', 'getting_dried', 'packaging'];
    default:
      return ['tagging', 'getting_washed', 'getting_dried', 'packaging'];
  }
}

/**
 * Split an order's items into service groups for internal order splitting.
 * Each group becomes its own ops_process doc.
 * 
 * Special handling:
 * - blanket_wash with blanketType: 'single' and 'double' → separate groups
 * - Credit items (isCreditItem) are grouped by their serviceType like normal
 */
function splitOrderIntoServices(order) {
  const items = (order && order.items) || [];
  if (items.length === 0) {
    return [{ serviceType: 'wash_fold', label: 'Wash & Fold', items: [] }];
  }

  const groups = {};

  for (const item of items) {
    const type = item.serviceType || 'wash_fold';

    // Special: blanket_wash with specific blanketType → split into single/double
    if (type === 'blanket_wash' && item.blanketType) {
      const key = `blanket_wash_${item.blanketType}`;
      if (!groups[key]) groups[key] = { serviceType: key, label: SERVICE_LABELS[key] || `Blanket Wash (${item.blanketType})`, items: [] };
      groups[key].items.push(item);
    } else {
      if (!groups[type]) groups[type] = { serviceType: type, label: SERVICE_LABELS[type] || type, items: [] };
      groups[type].items.push(item);
    }
  }

  return Object.values(groups);
}

module.exports = { pickRider, normalizePhone, pickupGuard, taskTransition, getProcessingSteps, nextStep, opsStepsForOrder, isProductionStep, firstProductionStep, parseGarmentQr, generateLabels, stepsForServiceType, splitOrderIntoServices, SERVICE_LABELS };
