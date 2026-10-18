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
 * True when an order still awaits pickup (placed/confirmed), or the status is
 * unknown. Used to reject pickups whose order has already progressed.
 * @param {string|undefined} status
 * @returns {boolean}
 */
function isAwaitingPickup(status) {
  return !status || status === 'placed' || status === 'confirmed';
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
  if (afterStatus === 'processing' && beforeStatus !== 'processing') {
    return { taskStatus: 'picked_up' };
  }
  if (afterStatus === 'ready' && beforeStatus !== 'ready') {
    return { cleanupProcess: true };
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


/**
 * Checks if an order requires payment before completion and whether it is satisfied.
 * @param {object} order - the order document data
 * @param {{ allowUnpaidDelivery?: boolean, role?: string }} options
 * @returns {{ allowed: boolean, reason?: string, message?: string, amount: number, overridden?: boolean }}
 */
function checkPaymentGate(order, options = {}) {
  const orderTotal = (order && order.billDetails && typeof order.billDetails.total === "number")
    ? order.billDetails.total
    : ((order && (order.total || order.finalAmount)) || 0);

  const isAllCredits = Array.isArray(order && order.items) && order.items.length > 0 && order.items.every(i => i && i.isCreditItem);
  const isCreditMode = order && (order.paymentMode === "credit" || order.paymentMethod === "credit");
  const requiresPayment = orderTotal > 0 && !isAllCredits && !isCreditMode;

  const paymentStatus = (order && order.paymentStatus ? String(order.paymentStatus) : "").toLowerCase().trim();
  const isPaid = paymentStatus === "paid";

  if (!requiresPayment || isPaid) {
    return { allowed: true, amount: orderTotal };
  }

  // If requires payment and not paid, check if explicit supervisor/admin override was given
  if (options.allowUnpaidDelivery && (options.role === "supervisor" || options.role === "admin")) {
    return { allowed: true, amount: orderTotal, overridden: true };
  }

  return {
    allowed: false,
    reason: "payment_required",
    message: "PAYMENT_REQUIRED: This order has not been paid yet. Ask the customer to pay in the SpinZo app before completing delivery.",
    amount: orderTotal
  };
}

/**
 * Ironing priority list:
 * 1. Samsul (+916369768237)
 * 2. Abdur (+917559105832)
 * No ironing orders to new helper!
 */
const ABDUL_PHONE = '+916900311761';
const SAMSUL_PHONE = '+916369768237';
const ABDUR_PHONE = '+917559105832';

const IRONING_PRIORITY_PHONES = [SAMSUL_PHONE, ABDUR_PHONE];

function isIroningEligible(phone, allowedList = IRONING_PRIORITY_PHONES) {
  if (!phone) return false;
  const p = normalizePhone(phone);
  return allowedList.map(normalizePhone).includes(p);
}

/**
 * Helper hands-on and machine loading definitions:
 * - A helper has an active hands-on task if they have an uncompleted tagging, ironing, or packaging task.
 * - A helper has an active machine-loading task if they are assigned washing/drying but haven't started it yet.
 * - Once started, washing and drying run unattended by the machine.
 */
function hasActiveHandsOnTask(helperUid, liveProcesses) {
  if (!liveProcesses || liveProcesses.length === 0) return false;
  return liveProcesses.some(p => {
    const cur = p.steps ? p.steps[p.currentIndex] : p.status;
    if (!cur || p.status === 'done' || p.status === 'cancelled') return false;
    const stage = p.stages && p.stages[cur];
    if (!stage || stage.assignee !== helperUid || stage.completedAt) return false;
    return cur === 'tagging' || cur === 'getting_ironed' || cur === 'packaging';
  });
}

function hasActiveMachineLoadingTask(helperUid, liveProcesses) {
  if (!liveProcesses || liveProcesses.length === 0) return false;
  return liveProcesses.some(p => {
    const cur = p.steps ? p.steps[p.currentIndex] : p.status;
    if (!cur || p.status === 'done' || p.status === 'cancelled') return false;
    const stage = p.stages && p.stages[cur];
    if (!stage || stage.assignee !== helperUid || stage.completedAt) return false;
    return (cur === 'getting_washed' || cur === 'getting_dried') && !stage.startedAt;
  });
}

function isHelperHandsOnBusy(helperUid, liveProcesses) {
  return hasActiveHandsOnTask(helperUid, liveProcesses) || hasActiveMachineLoadingTask(helperUid, liveProcesses);
}

function getRunningMachines(step, liveProcesses) {
  if (!liveProcesses || liveProcesses.length === 0) return [];
  // Machines remain occupied until explicitly marked completed or reset.
  // In a laundry operation, orders can exceed machine capacity (e.g. 12-13 kg in a 10 kg machine)
  // requiring 2 sequential lots in the same machine. No artificial timeout should evict the machine.
  return liveProcesses.filter(p => {
    const cur = p.steps ? p.steps[p.currentIndex] : p.status;
    if (cur !== step) return false;
    const stage = p.stages && p.stages[cur];
    if (!stage?.startedAt || stage?.completedAt) return false;
    return true;
  });
}

function allocateMachineName(step, liveProcesses, totalCapacity = 2) {
  const prefix = step === 'getting_washed' ? 'Washer' : step === 'getting_dried' ? 'Dryer' : 'Iron Station';
  const running = getRunningMachines(step, liveProcesses);
  const usedNames = new Set(running.map(p => p.stages?.[step]?.machineName).filter(Boolean));

  for (let i = 1; i <= totalCapacity; i++) {
    const candidate = `${prefix} ${i}`;
    if (!usedNames.has(candidate)) {
      return candidate;
    }
  }
  return `${prefix} 1`;
}

/**
 * Deterministic helper selection for store operations stages:
 * - Tagging: 1st Abdul, fallback Abdur or Samsul (only if completely free, else queue)
 * - Washing: Free helper or hands-on helper without pending machine load (requires available washer)
 * - Drying: Free helper or hands-on helper without pending machine load (requires available dryer)
 * - Ironing: 1st Samsul (Station 1), 2nd Abdur (Station 2) (only if free, else queue)
 * - Packaging: 1st Abdul, fallback Abdur or Samsul (only if completely free, else queue)
 */
function selectHelperForStage(stage, onShiftHelpers, liveProcesses = [], resources = { washers: 2, dryers: 2, ironingStations: 2 }, options = {}) {
  const normalize = (p) => (p || '').replace(/\D/g, '').slice(-10);
  const helpers = (onShiftHelpers || []).filter(h => h && h.onShift === true);
  if (helpers.length === 0) {
    return { ok: false, error: 'no_helpers_on_shift', shouldQueue: true };
  }

  // Helpers with NO active hands-on task and NO pending machine loading task
  const freeHelpers = helpers.filter(h => !isHelperHandsOnBusy(h.uid, liveProcesses));

  const abdul = helpers.find(h => normalize(h.phone) === '6900311761');
  const samsul = helpers.find(h => normalize(h.phone) === '6369768237');
  const abdur = helpers.find(h => normalize(h.phone) === '7559105832');

  const freeAbdul = freeHelpers.find(h => normalize(h.phone) === '6900311761');
  const freeSamsul = freeHelpers.find(h => normalize(h.phone) === '6369768237');
  const freeAbdur = freeHelpers.find(h => normalize(h.phone) === '7559105832');

  // 1. TAGGING (Hands-on: requires human hands. If all helpers busy, MUST queue!)
  if (stage === 'tagging') {
    if (freeAbdul) return { ok: true, helper: freeAbdul };
    if (freeAbdur) return { ok: true, helper: freeAbdur };
    if (freeSamsul) return { ok: true, helper: freeSamsul };
    if (freeHelpers.length > 0) return { ok: true, helper: freeHelpers[0] };
    return { ok: false, error: 'all_taggers_busy', shouldQueue: true };
  }

  // 2. WASHING (Machine step: takes ~60s to load & start, then machine runs alone)
  if (stage === 'getting_washed') {
    const maxWashers = resources.washers || 2;
    const runningWashers = getRunningMachines('getting_washed', liveProcesses);
    if (runningWashers.length >= maxWashers) {
      return { ok: false, error: 'washers_at_capacity', shouldQueue: true };
    }
    const machineName = allocateMachineName('getting_washed', liveProcesses, maxWashers);

    // Helpers who are NOT currently loading another machine (can only load 1 machine at a time)
    const canLoadHelpers = helpers.filter(h => !hasActiveMachineLoadingTask(h.uid, liveProcesses));
    if (canLoadHelpers.length === 0) {
      return { ok: false, error: 'all_helpers_loading_machines', shouldQueue: true };
    }

    // Priority:
    // 1. Truly free helper (no task at all)
    // 2. Tagging helper for this order (if not already loading another machine)
    // 3. Hands-on helper (Abdul, Abdur, Samsul) who can briefly load the drum and return to hands-on work
    const taggingHelper = options.taggingAssignee ? canLoadHelpers.find(h => h.uid === options.taggingAssignee) : null;
    const chosenHelper = freeHelpers[0]
      || (taggingHelper && taggingHelper.onShift ? taggingHelper : null)
      || freeAbdur || freeAbdul || freeSamsul
      || canLoadHelpers.find(h => normalize(h.phone) === '7559105832') // abdur
      || canLoadHelpers.find(h => normalize(h.phone) === '6900311761') // abdul
      || canLoadHelpers.find(h => normalize(h.phone) === '6369768237') // samsul
      || canLoadHelpers[0];

    if (chosenHelper) {
      return { ok: true, helper: chosenHelper, machineName };
    }
    return { ok: false, error: 'no_helpers_available', shouldQueue: true };
  }

  // 3. DRYING (Machine step: takes ~60s to transfer & start, then machine runs alone)
  if (stage === 'getting_dried') {
    const maxDryers = resources.dryers || 2;
    const runningDryers = getRunningMachines('getting_dried', liveProcesses);
    if (runningDryers.length >= maxDryers) {
      return { ok: false, error: 'dryers_at_capacity', shouldQueue: true };
    }
    const machineName = allocateMachineName('getting_dried', liveProcesses, maxDryers);

    const canLoadHelpers = helpers.filter(h => !hasActiveMachineLoadingTask(h.uid, liveProcesses));
    if (canLoadHelpers.length === 0) {
      return { ok: false, error: 'all_helpers_loading_machines', shouldQueue: true };
    }

    const prev = options.previousAssignee ? canLoadHelpers.find(h => h.uid === options.previousAssignee) : null;
    const chosenHelper = freeHelpers[0]
      || (prev && prev.onShift ? prev : null)
      || freeAbdur || freeAbdul || freeSamsul
      || canLoadHelpers.find(h => normalize(h.phone) === '7559105832') // abdur
      || canLoadHelpers.find(h => normalize(h.phone) === '6900311761') // abdul
      || canLoadHelpers.find(h => normalize(h.phone) === '6369768237') // samsul
      || canLoadHelpers[0];

    if (chosenHelper) {
      return { ok: true, helper: chosenHelper, machineName };
    }
    return { ok: false, error: 'no_helpers_available', shouldQueue: true };
  }

  // 4. IRONING (Hands-on: requires dedicated ironing specialist. If busy, MUST queue!)
  if (stage === 'getting_ironed') {
    const maxIrons = resources.ironingStations || 2;
    const runningIrons = getRunningMachines('getting_ironed', liveProcesses);
    if (runningIrons.length >= maxIrons) {
      return { ok: false, error: 'iron_stations_at_capacity', shouldQueue: true };
    }

    // Only assign if specialist is completely free from any hands-on task
    if (freeSamsul) {
      return { ok: true, helper: samsul, machineName: 'Iron Station 1' };
    }
    if (freeAbdur) {
      return { ok: true, helper: abdur, machineName: 'Iron Station 2' };
    }
    return { ok: false, error: 'iron_specialists_busy', shouldQueue: true };
  }

  // 5. PACKAGING (Hands-on: 1 order per person. If all helpers busy, MUST queue!)
  if (stage === 'packaging') {
    if (freeAbdul) return { ok: true, helper: freeAbdul };
    if (freeAbdur) return { ok: true, helper: freeAbdur };
    if (freeSamsul) return { ok: true, helper: freeSamsul };
    if (freeHelpers.length > 0) return { ok: true, helper: freeHelpers[0] };
    return { ok: false, error: 'all_packagers_busy', shouldQueue: true };
  }

  return { ok: false, error: 'unknown_stage', shouldQueue: true };
}

/**
 * Return current date string (YYYY-MM-DD) in IST (UTC+5:30) or specified timezone offset.
 * @param {number} offsetHours - default 5.5 (Asia/Kolkata)
 * @returns {string} YYYY-MM-DD
 */
function getTodayDateString(offsetHours = 5.5) {
  return new Date(Date.now() + (offsetHours * 3600 * 1000)).toISOString().split('T')[0];
}

/**
 * Determine if a delivery is due for rider dispatch today.
 * Deliveries are only due if the customer has scheduled a date, and that date
 * is on or before today's date (due today or overdue from a previous day).
 * Future dates (e.g. tomorrow) or unselected slots (null/undefined) are NOT due.
 * @param {string|null|undefined} deliveryDate - YYYY-MM-DD
 * @param {string} [todayStr] - optional reference date (YYYY-MM-DD)
 * @returns {boolean}
 */
function isDeliveryDueToday(deliveryDate, todayStr = getTodayDateString()) {
  if (!deliveryDate || typeof deliveryDate !== 'string') return false;
  const clean = deliveryDate.trim();
  if (!clean) return false;
  return clean <= todayStr;
}

module.exports = {
  getTodayDateString,
  isDeliveryDueToday,
  checkPaymentGate,
  pickRider,
  normalizePhone,
  pickupGuard,
  taskTransition,
  isAwaitingPickup,
  getProcessingSteps,
  nextStep,
  opsStepsForOrder,
  isProductionStep,
  firstProductionStep,
  parseGarmentQr,
  generateLabels,
  stepsForServiceType,
  splitOrderIntoServices,
  SERVICE_LABELS,
  ABDUL_PHONE,
  SAMSUL_PHONE,
  ABDUR_PHONE,
  IRONING_PRIORITY_PHONES,
  isIroningEligible,
  isHelperHandsOnBusy,
  getRunningMachines,
  allocateMachineName,
  selectHelperForStage,
};

