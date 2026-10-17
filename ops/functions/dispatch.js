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
 * Check if a helper is currently hands-on busy.
 * A helper is hands-on busy if:
 * 1. They are doing tagging, ironing, packaging, or
 * 2. They have accepted washing/drying but haven't started it yet (startedAt is null).
 * Once a washer or dryer cycle is started, the helper is FREE.
 */
function isHelperHandsOnBusy(helperUid, liveProcesses) {
  if (!liveProcesses || liveProcesses.length === 0) return false;
  return liveProcesses.some(p => {
    const cur = p.steps ? p.steps[p.currentIndex] : p.status;
    if (!cur || p.status === 'done' || p.status === 'cancelled') return false;
    const stage = p.stages && p.stages[cur];
    if (!stage || stage.assignee !== helperUid || stage.completedAt) return false;

    // If machine step and already started, helper is FREE for other tasks
    if ((cur === 'getting_washed' || cur === 'getting_dried') && stage.startedAt) {
      return false;
    }
    // Any other assigned, uncompleted stage (including loading a machine) is hands-on busy
    return true;
  });
}

function getRunningMachines(step, liveProcesses) {
  if (!liveProcesses || liveProcesses.length === 0) return [];
  return liveProcesses.filter(p => {
    const cur = p.steps ? p.steps[p.currentIndex] : p.status;
    if (cur !== step) return false;
    const stage = p.stages && p.stages[cur];
    return !!stage?.startedAt && !stage?.completedAt;
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
 * - Tagging: 1st Abdul, fallback Abdur or Samsul
 * - Washing: Any free helper (requires available washer)
 * - Drying: Any free helper / previousAssignee (requires available dryer)
 * - Ironing: 1st Samsul (Station 1), 2nd Abdur (Station 2)
 * - Packaging: 1st Abdul, fallback Abdur or Samsul
 */
function selectHelperForStage(stage, onShiftHelpers, liveProcesses = [], resources = { washers: 2, dryers: 2, ironingStations: 2 }, options = {}) {
  const normalize = (p) => (p || '').replace(/\D/g, '').slice(-10);
  const helpers = (onShiftHelpers || []).filter(h => h && h.onShift === true);
  if (helpers.length === 0) {
    return { ok: false, error: 'no_helpers_on_shift', shouldQueue: true };
  }

  const freeHelpers = helpers.filter(h => !isHelperHandsOnBusy(h.uid, liveProcesses));

  const abdul = helpers.find(h => normalize(h.phone) === '6900311761');
  const samsul = helpers.find(h => normalize(h.phone) === '6369768237');
  const abdur = helpers.find(h => normalize(h.phone) === '7559105832');

  const freeAbdul = freeHelpers.find(h => normalize(h.phone) === '6900311761');
  const freeSamsul = freeHelpers.find(h => normalize(h.phone) === '6369768237');
  const freeAbdur = freeHelpers.find(h => normalize(h.phone) === '7559105832');

  // 1. TAGGING
  if (stage === 'tagging') {
    if (freeAbdul) return { ok: true, helper: freeAbdul };
    if (freeAbdur) return { ok: true, helper: freeAbdur };
    if (freeSamsul) return { ok: true, helper: freeSamsul };
    if (freeHelpers.length > 0) return { ok: true, helper: freeHelpers[0] };
    return { ok: true, helper: abdul || abdur || samsul || helpers[0] };
  }

  // 2. WASHING
  if (stage === 'getting_washed') {
    const maxWashers = resources.washers || 2;
    const runningWashers = getRunningMachines('getting_washed', liveProcesses);
    if (runningWashers.length >= maxWashers) {
      return { ok: false, error: 'washers_at_capacity', shouldQueue: true };
    }
    const machineName = allocateMachineName('getting_washed', liveProcesses, maxWashers);
    if (freeHelpers.length > 0) {
      return { ok: true, helper: freeHelpers[0], machineName };
    }
    return { ok: false, error: 'helpers_busy', shouldQueue: true };
  }

  // 3. DRYING
  if (stage === 'getting_dried') {
    const maxDryers = resources.dryers || 2;
    const runningDryers = getRunningMachines('getting_dried', liveProcesses);
    if (runningDryers.length >= maxDryers) {
      return { ok: false, error: 'dryers_at_capacity', shouldQueue: true };
    }
    const machineName = allocateMachineName('getting_dried', liveProcesses, maxDryers);
    if (options.previousAssignee) {
      const prev = freeHelpers.find(h => h.uid === options.previousAssignee);
      if (prev) return { ok: true, helper: prev, machineName };
    }
    if (freeHelpers.length > 0) {
      return { ok: true, helper: freeHelpers[0], machineName };
    }
    return { ok: false, error: 'helpers_busy', shouldQueue: true };
  }

  // 4. IRONING
  if (stage === 'getting_ironed') {
    const maxIrons = resources.ironingStations || 2;
    const runningIrons = getRunningMachines('getting_ironed', liveProcesses);
    if (runningIrons.length >= maxIrons) {
      return { ok: false, error: 'iron_stations_at_capacity', shouldQueue: true };
    }
    const isSamsulIroning = runningIrons.some(p => {
      const s = p.stages?.getting_ironed;
      return s && (s.assignee === samsul?.uid || normalize(s.assigneePhone) === '6369768237');
    });
    const isAbdurIroning = runningIrons.some(p => {
      const s = p.stages?.getting_ironed;
      return s && (s.assignee === abdur?.uid || normalize(s.assigneePhone) === '7559105832');
    });

    if (samsul && !isSamsulIroning && freeSamsul) {
      return { ok: true, helper: samsul, machineName: 'Iron Station 1' };
    }
    if (abdur && !isAbdurIroning && freeAbdur) {
      return { ok: true, helper: abdur, machineName: 'Iron Station 2' };
    }
    if (samsul && !isSamsulIroning) {
      return { ok: true, helper: samsul, machineName: 'Iron Station 1' };
    }
    if (abdur && !isAbdurIroning) {
      return { ok: true, helper: abdur, machineName: 'Iron Station 2' };
    }
    return { ok: false, error: 'iron_specialists_busy', shouldQueue: true };
  }

  // 5. PACKAGING
  if (stage === 'packaging') {
    if (freeAbdul) return { ok: true, helper: freeAbdul };
    if (freeAbdur) return { ok: true, helper: freeAbdur };
    if (freeSamsul) return { ok: true, helper: freeSamsul };
    if (freeHelpers.length > 0) return { ok: true, helper: freeHelpers[0] };
    return { ok: true, helper: abdul || abdur || samsul || helpers[0] };
  }

  return { ok: false, error: 'unknown_stage', shouldQueue: true };
}

module.exports = {
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
