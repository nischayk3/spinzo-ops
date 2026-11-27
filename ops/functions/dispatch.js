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

function isStaffAvailableForAutoAssign(staff) {
  if (!staff || staff.onShift !== true) return false;
  if (staff.onBreak === true) return false;
  if (
    staff.attendanceStatus === 'lunch' ||
    staff.attendanceStatus === 'short_break' ||
    staff.attendanceStatus === 'off'
  ) {
    return false;
  }
  return true;
}

/**
 * Great-circle Haversine distance in meters between two { lat, lng } points.
 * Returns Infinity if either point lacks valid numeric coordinates.
 */
function haversineMeters(a, b) {
  if (!a || !b) return Infinity;
  const lat1 = Number(a.lat ?? a.latitude);
  const lng1 = Number(a.lng ?? a.longitude);
  const lat2 = Number(b.lat ?? b.latitude);
  const lng2 = Number(b.lng ?? b.longitude);
  if (!Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)) {
    return Infinity;
  }
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Pick the best on-shift rider from eligible candidates.
 * When `orderGeo` ({ lat, lng }) is provided, scores riders using spatial-batching
 * (load penalty + capacity overflow + proximity + 1.2km cluster batching bonus).
 * When `orderGeo` is null/omitted, falls back to least-busy + earliest shift start.
 * @param {Array<{uid: string, phone?: string, shiftStartAt?: number, onShift?: boolean, onBreak?: boolean, attendanceStatus?: string, lastLocation?: object, location?: object}>} candidates
 * @param {Record<string, number>} taskCounts - pending task count keyed by uid
 * @param {Record<string, string>} rosterPhones - config/opsStaff.phones map (full E.164 -> role)
 * @param {{ lat?: number, lng?: number, latitude?: number, longitude?: number } | null} [orderGeo]
 * @param {Record<string, Array<{ lat?: number, lng?: number, latitude?: number, longitude?: number }>> | null} [riderStopCoords]
 * @returns {string|null} selected uid, or null if none eligible
 */
function pickRider(candidates, taskCounts, rosterPhones, orderGeo = null, riderStopCoords = null) {
  const roster = rosterPhones || {};
  const eligible = candidates.filter((c) => {
    if (!c || c.onShift === false || c.onBreak === true) return false;
    if (
      c.attendanceStatus === 'lunch' ||
      c.attendanceStatus === 'short_break' ||
      c.attendanceStatus === 'off'
    ) {
      return false;
    }
    const phone = normalizePhone(c.phone || '');
    return phone !== '' && roster[phone] === 'rider';
  });
  if (eligible.length === 0) return null;

  const hasOrderGeo = Boolean(
    orderGeo &&
    Number.isFinite(Number(orderGeo.lat ?? orderGeo.latitude)) &&
    Number.isFinite(Number(orderGeo.lng ?? orderGeo.longitude))
  );

  if (!hasOrderGeo) {
    eligible.sort((a, b) => {
      const ta = taskCounts[a.uid] || 0;
      const tb = taskCounts[b.uid] || 0;
      if (ta !== tb) return ta - tb;
      return (a.shiftStartAt || 0) - (b.shiftStartAt || 0);
    });
    return eligible[0].uid;
  }

  const scoreFor = (c) => {
    const taskCount = taskCounts[c.uid] || 0;
    const stops = (riderStopCoords && Array.isArray(riderStopCoords[c.uid])) ? riderStopCoords[c.uid] : [];
    let minStopDist = Infinity;
    for (const s of stops) {
      const d = haversineMeters(orderGeo, s);
      if (d < minStopDist) minStopDist = d;
    }
    let minDistMeters = minStopDist;
    const riderLoc = c.lastLocation || c.location || null;
    if (riderLoc) {
      const locDist = haversineMeters(orderGeo, riderLoc);
      if (locDist < minDistMeters) minDistMeters = locDist;
    }
    const proximityCost = Number.isFinite(minDistMeters) ? minDistMeters : 10000;
    let score = taskCount * 1800 + proximityCost;
    if (taskCount >= 5) {
      score += 10000;
    }
    if (minStopDist <= 1200 && taskCount < 5) {
      score -= 1500;
    }
    return score;
  };

  const scored = eligible.map((c) => ({
    candidate: c,
    score: scoreFor(c),
    taskCount: taskCounts[c.uid] || 0,
    shiftStartAt: c.shiftStartAt || 0,
  }));

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    if (a.taskCount !== b.taskCount) return a.taskCount - b.taskCount;
    return a.shiftStartAt - b.shiftStartAt;
  });

  return scored[0].candidate.uid;
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
  const onlyShoeClean = serviceTypes.every((type) => type === 'shoe_clean');
  if (onlyShoeClean) return [];

  const steps = [];
  const needsWash = serviceTypes.some((type) =>
    type === 'wash_fold' || type === 'wash_iron' || type === 'blanket_wash' ||
    type === 'premium_laundry' || type === 'dry_clean');
  if (needsWash) steps.push('getting_washed');
  
  // Anything that is washed must be dried.
  const needsDry = needsWash;
  const needsIron = serviceTypes.some((type) =>
    type === 'wash_iron' || type === 'premium_laundry' || type === 'ironing' || type === 'dry_clean');
  
  if (needsDry) steps.push('getting_dried');
  if (needsIron) steps.push('getting_ironed');
  
  if (steps.length === 0) return [];
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
      return ['tagging', 'getting_washed', 'getting_dried', 'packaging'];
    case 'wash_iron':
    case 'premium_laundry':
      return ['tagging', 'getting_washed', 'getting_dried', 'getting_ironed', 'packaging'];
    case 'ironing':
      return ['tagging', 'getting_ironed', 'packaging'];
    case 'blanket_wash':
    case 'blanket_wash_single':
    case 'blanket_wash_double':
      return ['tagging', 'getting_washed', 'getting_dried', 'packaging'];
    case 'shoe_clean':
      return ['tagging', 'packaging'];
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
const LOAD_BASED_SERVICES = new Set(['wash_fold', 'wash_iron', 'premium_laundry', 'blanket_wash']);
const MACHINE_CAPACITY_KG = 8;

/**
 * Case-insensitively resolve a token value from an order's tokens map.
 * Handles both lowercase ('wash_fold__l1') and uppercase ('wash_fold__L1') keys seamlessly.
 */
function resolveToken(tokens, key) {
  if (!tokens || typeof tokens !== 'object' || !key) return '';
  if (tokens[key]) return String(tokens[key]).trim();
  const lowerKey = key.toLowerCase();
  for (const [k, v] of Object.entries(tokens)) {
    if (k.toLowerCase() === lowerKey && v) {
      return String(v).trim();
    }
  }
  return '';
}

/**
 * Split an order's items into service groups for internal order splitting.
 * Each group becomes its own ops_process doc.
 * 
 * For weight-based services (Wash & Fold, Wash & Iron, Premium Laundry, Blanket Wash):
 * If the order has multiple loads (either via token keys like wash_fold__L1,
 * or based on weight > 8kg, or multiple blankets), each load becomes its own independent ops_process doc!
 * 
 * Special handling:
 * - blanket_wash with blanketType: 'single' and 'double' → separate groups
 * - Credit items (isCreditItem) are grouped by their serviceType like normal
 */
function splitOrderIntoServices(order) {
  const items = (order && order.items) || [];
  if (items.length === 0) {
    return [{ processKey: 'wash_fold', serviceType: 'wash_fold', label: 'Wash & Fold', tokenKey: 'wash_fold', loadIndex: 1, loadCount: 1, items: [] }];
  }

  const tokens = (order && order.tokens) || {};
  const serviceGroups = {};

  for (const item of items) {
    const rawType = item.serviceType || item.serviceId || 'wash_fold';
    const type = rawType.toLowerCase().includes('wash_fold') || rawType.toLowerCase().includes('wash & fold') ? 'wash_fold' :
                 rawType.toLowerCase().includes('wash_iron') || rawType.toLowerCase().includes('wash & iron') ? 'wash_iron' :
                 rawType.toLowerCase().includes('premium_laundry') || rawType.toLowerCase().includes('premium laundry') ? 'premium_laundry' :
                 rawType.toLowerCase().includes('blanket') ? 'blanket_wash' :
                 rawType;

    // Special: blanket_wash with specific blanketType → split into single/double
    if (type === 'blanket_wash' && item.blanketType) {
      const key = `blanket_wash_${item.blanketType}`;
      if (!serviceGroups[key]) serviceGroups[key] = { serviceType: key, label: SERVICE_LABELS[key] || `Blanket Wash (${item.blanketType})`, items: [] };
      serviceGroups[key].items.push(item);
    } else {
      if (!serviceGroups[type]) serviceGroups[type] = { serviceType: type, label: SERVICE_LABELS[type] || type, items: [] };
      serviceGroups[type].items.push(item);
    }
  }

  const result = [];

  for (const group of Object.values(serviceGroups)) {
    const type = group.serviceType;
    if (LOAD_BASED_SERVICES.has(type)) {
      // 1. Check if rider tagged loads directly (e.g. wash_fold__L1, wash_fold__L2)
      const tokenKeys = Object.keys(tokens).filter(k => k.toLowerCase().startsWith(`${type.toLowerCase()}__l`));

      let loadCount = 1;
      if (tokenKeys.length > 0) {
        loadCount = tokenKeys.length;
      } else {
        const totalWeight = group.items.reduce((sum, it) => sum + Number(it.weight || (it.unit === 'kg' && it.quantity ? it.quantity : 0)), 0);
        if (totalWeight > MACHINE_CAPACITY_KG) {
          loadCount = Math.max(1, Math.ceil(totalWeight / MACHINE_CAPACITY_KG));
        } else if (type === 'blanket_wash') {
          const totalBlankets = group.items.reduce((sum, it) => sum + ((it.singleBlanketCount || 0) + (it.doubleBlanketCount || 0) || it.blanketQuantity || it.quantity || 0), 0);
          if (totalBlankets > 1) {
            loadCount = Math.max(1, Math.ceil((totalBlankets * 5) / MACHINE_CAPACITY_KG));
          }
        }
      }

      if (loadCount > 1) {
        for (let l = 1; l <= loadCount; l++) {
          result.push({
            processKey: `${type}__L${l}`,
            serviceType: type,
            label: `${SERVICE_LABELS[type] || type} (Load ${l}/${loadCount})`,
            tokenKey: `${type}__L${l}`,
            loadIndex: l,
            loadCount: loadCount,
            items: group.items,
          });
        }
      } else {
        result.push({
          processKey: type,
          serviceType: type,
          label: SERVICE_LABELS[type] || type,
          tokenKey: type,
          loadIndex: 1,
          loadCount: 1,
          items: group.items,
        });
      }
    } else {
      result.push({
        processKey: type,
        serviceType: type,
        label: group.label,
        tokenKey: type,
        loadIndex: 1,
        loadCount: 1,
        items: group.items,
      });
    }
  }

  return result;
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
 * Helper routing phone constants:
 * - Tagging & Packaging Primary (Tier 1): Abdul (+916900311761), Tahirul (+919707275674)
 * - Ironing Priority: 1. Samsul (+916369768237), 2. Abdur (+917559105832), 3. Abdul (overflow)
 * - Tahirul is strictly blocked from Ironing.
 */
const ABDUL_PHONE = '+916900311761';
const TAHIRUL_PHONE = '+919707275674';
const SAMSUL_PHONE = '+916369768237';
const ABDUR_PHONE = '+917559105832';

// Authorized helpers for ironing operations (matches client src/utils/helperEligibility.ts)
// (Samsul primary on Station 1; Abdur on Station 2 on overflow — others require helperAssignmentRules override)
const IRONING_PRIORITY_PHONES = [SAMSUL_PHONE, ABDUR_PHONE];

function isIroningEligible(phone, allowedList = IRONING_PRIORITY_PHONES) {
  if (!phone) return false;
  const p = normalizePhone(phone);
  return allowedList.map(normalizePhone).includes(p);
}

/**
 * Extract the per-phone helper stage rule map from a Firestore `config/helperAssignmentRules` doc.
 * Supports both legacy nested `{ rules: { "+91...": { ... } } }` and current top-level flat map
 * `{ "+91...": { tagging: true, ... }, updatedAt, updatedBy }`.
 * @param {Record<string, any> | null | undefined} data
 * @returns {Record<string, Record<string, boolean>> | null}
 */
function extractHelperRulesFromDoc(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.rules && typeof data.rules === 'object' && !Array.isArray(data.rules)) {
    return Object.keys(data.rules).length > 0 ? data.rules : null;
  }
  const extracted = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === 'updatedAt' || k === 'updatedBy') continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.toMillis !== 'function') {
      extracted[k] = v;
    }
  }
  return Object.keys(extracted).length > 0 ? extracted : null;
}

/**
 * Check if a helper is allowed to be auto-assigned to a given processing stage,
 * consulting dynamic `config/helperAssignmentRules` overrides first and falling back
 * to default eligibility (ironing restricted to IRONING_PRIORITY_PHONES, all other stages allowed).
 * @param {string} phone
 * @param {string} stage - 'tagging' | 'getting_washed' | 'getting_dried' | 'getting_ironed' | 'packaging'
 * @param {Record<string, Record<string, boolean>> | null | undefined} helperRules
 * @returns {boolean}
 */
function isHelperAllowedForStage(phone, stage, helperRules) {
  if (helperRules && typeof helperRules === 'object' && phone) {
    const e164 = normalizePhone(phone);
    const last10 = String(phone).replace(/\D/g, '').slice(-10);
    const rule = (e164 && helperRules[e164]) || (last10 && helperRules[last10]) || helperRules[phone];
    if (rule && typeof rule[stage] === 'boolean') {
      return rule[stage];
    }
  }
  return stage === 'getting_ironed' ? isIroningEligible(phone) : true;
}

/**
 * Compute real-time helper workload and task breakdown from live processes.
 * - handsOn: active uncompleted tagging, ironing, or packaging task (capacity = 1)
 * - machineLoad: assigned washing/drying task awaiting 'Start' (capacity = 1)
 * - total: total active live processes assigned to this helper
 */
function getHelperWorkload(liveProcesses) {
  const workloads = {};
  (liveProcesses || []).forEach(p => {
    const cur = p.steps ? p.steps[p.currentIndex] : p.status;
    if (!cur || p.status === 'done' || p.status === 'cancelled') return;
    const stage = p.stages && p.stages[cur];
    if (!stage || !stage.assignee || stage.completedAt) return;
    const uid = stage.assignee;
    if (!workloads[uid]) {
      workloads[uid] = { total: 0, handsOn: 0, machineLoad: 0, isIroning: false };
    }
    workloads[uid].total += 1;
    if (cur === 'tagging' || cur === 'packaging') {
      workloads[uid].handsOn += 1;
    } else if (cur === 'getting_ironed') {
      workloads[uid].handsOn += 1;
      workloads[uid].isIroning = true;
    } else if ((cur === 'getting_washed' || cur === 'getting_dried') && !stage.startedAt) {
      workloads[uid].machineLoad += 1;
    }
  });
  return workloads;
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
  // Machines physically running with startedAt set and not yet completed
  return liveProcesses.filter(p => {
    const cur = p.steps ? p.steps[p.currentIndex] : p.status;
    if (cur !== step) return false;
    const stage = p.stages && p.stages[cur];
    if (!stage?.startedAt || stage?.completedAt) return false;
    return true;
  });
}

function getOccupiedMachines(step, liveProcesses) {
  if (!liveProcesses || liveProcesses.length === 0) return [];
  // Machine slot is occupied if physically running OR currently assigned to a helper to load
  return liveProcesses.filter(p => {
    const cur = p.steps ? p.steps[p.currentIndex] : p.status;
    if (cur !== step) return false;
    const stage = p.stages && p.stages[cur];
    if (stage?.completedAt) return false;
    return Boolean(stage?.startedAt || stage?.assignee);
  });
}

function allocateMachineName(step, liveProcesses, totalCapacity = 2) {
  const prefix = step === 'getting_washed' ? 'Washer' : step === 'getting_dried' ? 'Dryer' : 'Iron Station';
  const occupied = getOccupiedMachines(step, liveProcesses);
  const usedNames = new Set(occupied.map(p => p.stages?.[step]?.machineName).filter(Boolean));

  for (let i = 1; i <= totalCapacity; i++) {
    const candidate = `${prefix} ${i}`;
    if (!usedNames.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

const WASH_REQUIRING_SERVICES = new Set([
  'wash_fold',
  'wash_iron',
  'blanket_wash',
  'blanket_wash_single',
  'blanket_wash_double',
  'premium_laundry',
  'dry_clean',
]);

function isWashRequiringService(serviceType) {
  return typeof serviceType === 'string' && WASH_REQUIRING_SERVICES.has(serviceType);
}

/**
 * Deterministic, balanced helper selection for store operations stages:
 * - Tagging: Tier 1 Primary floor helpers (Abdul & Tahirul, least loaded) -> Tier 2 Abdur -> Tier 3 Samsul (if free & no iron) -> else QUEUE!
 * - Washing: 2 Washers max. Previous assignee -> Free helper (least loaded) -> Busy helper (60s micro-load) -> else QUEUE!
 * - Drying: 2 Dryers max. Previous assignee (unloaded washer) -> Free helper (least loaded) -> Busy helper (60s micro-load) -> else QUEUE!
 * - Ironing: 2 Stations max. Station 1 dedicated to Samsul; Station 2 to Abdur/Abdul on overflow. Tahirul blocked. If busy -> QUEUE!
 * - Packaging: Tier 1 Primary floor helpers (Abdul & Tahirul, least loaded) -> Tier 2 Abdur -> Tier 3 Samsul (if free & no iron) -> else QUEUE!
 */
function selectHelperForStage(stage, onShiftHelpers, liveProcesses = [], resources = { washers: 2, dryers: 2, ironingStations: 2 }, options = {}, helperRules = null) {
  const normalize = (p) => (p || '').replace(/\D/g, '').slice(-10);
  const effectiveRules = helperRules || (options && options.helperRules) || null;
  const helpers = (onShiftHelpers || []).filter(
    (h) => isStaffAvailableForAutoAssign(h) && isHelperAllowedForStage(h.phone, stage, effectiveRules)
  );
  if (helpers.length === 0) {
    return { ok: false, error: 'no_helpers_on_shift', shouldQueue: true };
  }

  const workloads = getHelperWorkload(liveProcesses);

  // Helper roles
  const isSamsul = (h) => normalize(h.phone) === '6369768237';
  const isAbdur = (h) => normalize(h.phone) === '7559105832';
  // Tier 1 primary floor helpers: Abdul, Tahirul, and any future non-iron-specialist helper
  const isPrimaryFloorHelper = (h) => {
    const p = normalize(h.phone);
    return p === '6900311761' || p === '9707275674' || (!isSamsul(h) && !isAbdur(h));
  };

  // Completely free helpers (0 hands-on tasks, 0 machine loading tasks)
  const freeHelpers = helpers.filter(h => {
    const wl = workloads[h.uid] || { handsOn: 0, machineLoad: 0 };
    return wl.handsOn === 0 && wl.machineLoad === 0;
  });

  // Sort candidates by total assigned workload ascending (least loaded first)
  const sortByLeastLoaded = (list) => {
    return [...list].sort((a, b) => {
      const wa = workloads[a.uid]?.total || 0;
      const wb = workloads[b.uid]?.total || 0;
      return wa - wb;
    });
  };

  // 1. TAGGING (Hands-on: strict capacity = 1 order per person)
  if (stage === 'tagging') {
    const hasPendingIron = liveProcesses.some(p => {
      const cur = p.steps ? p.steps[p.currentIndex] : p.status;
      return cur === 'getting_ironed' && !p.stages?.[cur]?.completedAt;
    });

    // Tier 1: Primary floor helpers (Abdul & Tahirul, least-loaded first)
    const freePrimary = sortByLeastLoaded(freeHelpers.filter(isPrimaryFloorHelper));
    if (freePrimary.length > 0) {
      return { ok: true, helper: freePrimary[0] };
    }

    // Tier 2 & 3 fallback when primary floor helpers are busy: Abdur -> Samsul (if no iron pending)
    const freeAbdur = freeHelpers.find(isAbdur);
    const freeSamsul = (!hasPendingIron) ? freeHelpers.find(isSamsul) : null;

    if (freeAbdur && (!freeSamsul || (workloads[freeAbdur.uid]?.total || 0) <= (workloads[freeSamsul.uid]?.total || 0))) {
      return { ok: true, helper: freeAbdur };
    }
    if (freeSamsul) {
      return { ok: true, helper: freeSamsul };
    }
    if (freeAbdur) {
      return { ok: true, helper: freeAbdur };
    }

    // Drum-Buffer-Rope Washer Starvation Override:
    // If all eligible helpers are hands-on busy, this order requires a washer,
    // a washer is empty, AND no getting_washed orders are already waiting in queue,
    // temporarily pull a packaging helper (first) or ironing helper (second) to tag & feed the washer.
    if (isWashRequiringService(options?.serviceType)) {
      const maxWashers = (resources && resources.washers) || 2;
      const occupiedWashers = getOccupiedMachines('getting_washed', liveProcesses);
      const hasWaitingWashQueue = (liveProcesses || []).some((p) => {
        const cur = p.steps ? p.steps[p.currentIndex] : p.status;
        if (cur !== 'getting_washed' || p.status === 'done' || p.status === 'cancelled') return false;
        const stg = p.stages && p.stages.getting_washed;
        if (stg && stg.completedAt) return false;
        return !stg || !stg.startedAt;
      });

      if (occupiedWashers.length < maxWashers && !hasWaitingWashQueue) {
        const activeStepsForHelper = (uid) => {
          const active = new Set();
          (liveProcesses || []).forEach((p) => {
            const cur = p.steps ? p.steps[p.currentIndex] : p.status;
            if (!cur || p.status === 'done' || p.status === 'cancelled') return;
            const stg = p.stages && p.stages[cur];
            if (stg && stg.assignee === uid && !stg.completedAt) {
              if (cur === 'tagging' || cur === 'getting_ironed' || cur === 'packaging') {
                active.add(cur);
              }
            }
          });
          return active;
        };

        const pullableHelpers = helpers.filter((h) => {
          if ((workloads[h.uid]?.machineLoad || 0) > 0) return false;
          const active = activeStepsForHelper(h.uid);
          return !active.has('tagging');
        });

        const packagingCandidates = sortByLeastLoaded(
          pullableHelpers.filter((h) => activeStepsForHelper(h.uid).has('packaging'))
        );
        if (packagingCandidates.length > 0) {
          return { ok: true, helper: packagingCandidates[0], isStarvationOverride: true };
        }

        const ironingCandidates = sortByLeastLoaded(
          pullableHelpers.filter((h) => activeStepsForHelper(h.uid).has('getting_ironed'))
        );
        if (ironingCandidates.length > 0) {
          return { ok: true, helper: ironingCandidates[0], isStarvationOverride: true };
        }
      }
    }

    // ALL helpers busy with hands-on tasks -> MUST QUEUE! (Never overload anyone)
    return { ok: false, error: 'all_taggers_busy', shouldQueue: true };
  }

  // 2. WASHING (Machine step: 2 Washers max)
  if (stage === 'getting_washed') {
    const maxWashers = resources.washers || 2;
    const occupiedWashers = getOccupiedMachines('getting_washed', liveProcesses);
    if (occupiedWashers.length >= maxWashers) {
      return { ok: false, error: 'washers_at_capacity', shouldQueue: true };
    }
    const machineName = allocateMachineName('getting_washed', liveProcesses, maxWashers);
    if (!machineName) {
      return { ok: false, error: 'no_washers_available', shouldQueue: true };
    }

    // Helpers who are NOT currently loading another machine (can only load 1 machine at a time)
    const canLoadHelpers = helpers.filter(h => {
      const wl = workloads[h.uid] || { machineLoad: 0 };
      return wl.machineLoad === 0;
    });
    if (canLoadHelpers.length === 0) {
      return { ok: false, error: 'all_helpers_loading_machines', shouldQueue: true };
    }

    // Priority:
    // 1. Helper who just finished tagging this order (holding the wet/tagged basket right now!)
    const prev = options.previousAssignee ? canLoadHelpers.find(h => h.uid === options.previousAssignee) : null;
    if (prev) {
      const isHandsOn = (workloads[prev.uid]?.handsOn || 0) > 0;
      return { ok: true, helper: prev, machineName, isMicroTask: isHandsOn };
    }

    // 2. Completely free helper (least loaded among Abdul, Abdur, Samsul)
    const freeAvailable = sortByLeastLoaded(canLoadHelpers.filter(h => {
      const wl = workloads[h.uid] || { handsOn: 0 };
      return wl.handsOn === 0;
    }));
    if (freeAvailable.length > 0) {
      return { ok: true, helper: freeAvailable[0], machineName, isMicroTask: false };
    }

    // 2. Any hands-on busy helper (Abdul tagging, Abdur packaging, or Samsul ironing) - 60s load keeps 40m machine spinning!
    // Balanced by least-loaded so all 3 helpers share machine loading and unloading equally.
    const busyCanLoad = sortByLeastLoaded(canLoadHelpers);
    if (busyCanLoad.length > 0) {
      return { ok: true, helper: busyCanLoad[0], machineName, isMicroTask: true };
    }
    return { ok: false, error: 'no_helpers_available', shouldQueue: true };
  }

  // 3. DRYING (Machine step: 2 Dryers max)
  if (stage === 'getting_dried') {
    const maxDryers = resources.dryers || 2;
    const occupiedDryers = getOccupiedMachines('getting_dried', liveProcesses);
    if (occupiedDryers.length >= maxDryers) {
      return { ok: false, error: 'dryers_at_capacity', shouldQueue: true };
    }
    const machineName = allocateMachineName('getting_dried', liveProcesses, maxDryers);
    if (!machineName) {
      return { ok: false, error: 'no_dryers_available', shouldQueue: true };
    }

    const canLoadHelpers = helpers.filter(h => {
      const wl = workloads[h.uid] || { machineLoad: 0 };
      return wl.machineLoad === 0;
    });
    if (canLoadHelpers.length === 0) {
      return { ok: false, error: 'all_helpers_loading_machines', shouldQueue: true };
    }

    // Priority for Drying:
    // 1. The helper who just unloaded the washer (they are holding the wet basket right now!)
    const prev = options.previousAssignee ? canLoadHelpers.find(h => h.uid === options.previousAssignee) : null;
    if (prev) {
      const isHandsOn = (workloads[prev.uid]?.handsOn || 0) > 0;
      return { ok: true, helper: prev, machineName, isMicroTask: isHandsOn };
    }

    // 2. Completely free helper (least loaded among all 3)
    const freeAvailable = sortByLeastLoaded(canLoadHelpers.filter(h => {
      const wl = workloads[h.uid] || { handsOn: 0 };
      return wl.handsOn === 0;
    }));
    if (freeAvailable.length > 0) {
      return { ok: true, helper: freeAvailable[0], machineName, isMicroTask: false };
    }

    // 3. Any hands-on busy helper (Abdul, Abdur, or Samsul), balanced by least loaded
    const busyCanLoad = sortByLeastLoaded(canLoadHelpers);
    if (busyCanLoad.length > 0) {
      return { ok: true, helper: busyCanLoad[0], machineName, isMicroTask: true };
    }
    return { ok: false, error: 'no_helpers_available', shouldQueue: true };
  }

  // 4. IRONING (Hands-on: 2 Stations max)
  if (stage === 'getting_ironed') {
    const maxIrons = resources.ironingStations || 2;
    const runningIrons = getRunningMachines('getting_ironed', liveProcesses);
    if (runningIrons.length >= maxIrons) {
      return { ok: false, error: 'iron_stations_at_capacity', shouldQueue: true };
    }

    const occupiedStationNames = new Set(
      getOccupiedMachines('getting_ironed', liveProcesses)
        .map(p => p.stages?.getting_ironed?.machineName)
        .filter(Boolean)
    );

    const samsul = helpers.find(isSamsul);
    const freeSamsul = freeHelpers.find(isSamsul);

    // Station 1: Preferred for Samsul (The Iron Specialist)
    if (!occupiedStationNames.has('Iron Station 1') && freeSamsul) {
      return { ok: true, helper: samsul, machineName: 'Iron Station 1', isMicroTask: false };
    }

    // Station 2 (or Station 1 if Samsul busy): Abdur (Priority 2 iron specialist), then Abdul (strictly ironing-eligible only)
    const availableStation = !occupiedStationNames.has('Iron Station 1') ? 'Iron Station 1' : (!occupiedStationNames.has('Iron Station 2') ? 'Iron Station 2' : null);
    if (availableStation) {
      const freeAbdur = freeHelpers.find(h => normalize(h.phone) === '7559105832');
      const freeAbdul = freeHelpers.find(h => normalize(h.phone) === '6900311761');
      const candidate = freeAbdur || freeAbdul || sortByLeastLoaded(freeHelpers.filter(h => isHelperAllowedForStage(h.phone, 'getting_ironed', effectiveRules)))[0];
      if (candidate) {
        return { ok: true, helper: candidate, machineName: availableStation, isMicroTask: false };
      }
      if (freeSamsul) {
        return { ok: true, helper: samsul, machineName: availableStation, isMicroTask: false };
      }
    }

    // Both stations running or specialists busy -> MUST QUEUE!
    return { ok: false, error: 'iron_specialists_busy', shouldQueue: true };
  }

  // 5. PACKAGING (Hands-on: strict capacity = 1 order per person)
  if (stage === 'packaging') {
    const hasPendingIron = liveProcesses.some(p => {
      const cur = p.steps ? p.steps[p.currentIndex] : p.status;
      return cur === 'getting_ironed' && !p.stages?.[cur]?.completedAt;
    });

    // Tier 1: Primary floor helpers (Abdul & Tahirul, least-loaded first)
    const freePrimary = sortByLeastLoaded(freeHelpers.filter(isPrimaryFloorHelper));
    if (freePrimary.length > 0) {
      return { ok: true, helper: freePrimary[0] };
    }

    // Tier 2 & 3 fallback when primary floor helpers are busy: Abdur -> Samsul (if no iron pending)
    const freeAbdur = freeHelpers.find(isAbdur);
    const freeSamsul = (!hasPendingIron) ? freeHelpers.find(isSamsul) : null;

    if (freeAbdur && (!freeSamsul || (workloads[freeAbdur.uid]?.total || 0) <= (workloads[freeSamsul.uid]?.total || 0))) {
      return { ok: true, helper: freeAbdur };
    }
    if (freeSamsul) {
      return { ok: true, helper: freeSamsul };
    }
    if (freeAbdur) {
      return { ok: true, helper: freeAbdur };
    }

    // ALL helpers busy with hands-on tasks -> MUST QUEUE!
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
 * Normalize a scheduled/delivery date value into YYYY-MM-DD (IST) so string comparisons
 * against todayStr work reliably across ISO strings, DD/MM/YYYY, Today/Tomorrow, and Timestamps.
 * @param {any} rawDate
 * @param {string} [todayStr]
 * @returns {string|null}
 */
function normalizeSlotDateString(rawDate, todayStr = getTodayDateString()) {
  if (!rawDate) return null;

  // Firestore Timestamp / Date object
  if (typeof rawDate === 'object') {
    const ms = typeof rawDate.toMillis === 'function'
      ? rawDate.toMillis()
      : typeof rawDate.seconds === 'number'
        ? rawDate.seconds * 1000
        : typeof rawDate._seconds === 'number'
          ? rawDate._seconds * 1000
          : rawDate instanceof Date
            ? rawDate.getTime()
            : NaN;
    if (!Number.isNaN(ms)) {
      return new Date(ms + (5.5 * 3600 * 1000)).toISOString().split('T')[0];
    }
    return null;
  }

  if (typeof rawDate !== 'string') return null;
  const clean = rawDate.trim();
  if (!clean) return null;

  const lower = clean.toLowerCase();
  if (lower === 'today') return todayStr;
  if (lower === 'tomorrow') {
    const base = new Date(`${todayStr}T00:00:00Z`);
    if (!Number.isNaN(base.getTime())) {
      base.setUTCDate(base.getUTCDate() + 1);
      return base.toISOString().split('T')[0];
    }
  }

  // Exact YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = clean.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    const dd = dmyMatch[1].padStart(2, '0');
    const mm = dmyMatch[2].padStart(2, '0');
    const yyyy = dmyMatch[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  // ISO datetime string (e.g. 2026-10-20T14:30:00.000Z) or human date string
  const parsedMs = Date.parse(clean);
  if (!Number.isNaN(parsedMs)) {
    return new Date(parsedMs + (5.5 * 3600 * 1000)).toISOString().split('T')[0];
  }

  return clean;
}

/**
 * Determine if a delivery is due for rider dispatch today.
 * Deliveries are only due if the customer has scheduled a date, and that date
 * is on or before today's date (due today or overdue from a previous day).
 * Future dates (e.g. tomorrow) or unselected slots (null/undefined) are NOT due.
 * @param {any} deliveryDate - YYYY-MM-DD (or Timestamp / DD/MM/YYYY / Today / Tomorrow)
 * @param {string} [todayStr] - optional reference date (YYYY-MM-DD)
 * @returns {boolean}
 */
function isDeliveryDueToday(deliveryDate, todayStr = getTodayDateString()) {
  const normalized = normalizeSlotDateString(deliveryDate, todayStr);
  if (!normalized) return false;
  return normalized <= todayStr;
}

/**
 * Parse the starting time of a time slot string into minutes from midnight (0 - 1439).
 * Supports:
 * - "20:00 - 21:00" -> 1200
 * - "08:00 - 09:00" -> 480
 * - "8:00 PM - 9:00 PM" -> 1200
 * - "8:00 AM - 9:00 AM" -> 480
 * - "8:00 - 9:00 PM" -> 1200
 * - "12:00 PM - 1:00 PM" -> 720
 * - "12:00 AM" -> 0
 * @param {string|null|undefined} slotText
 * @returns {number|null} minutes from midnight, or null if unparseable
 */
function parseSlotStartMinutes(slotText) {
  if (!slotText || typeof slotText !== 'string') return null;
  const lower = slotText.toLowerCase().trim();
  if (!lower || lower.includes('instant') || lower.includes('immediate') || lower === 'anytime') {
    return 0;
  }

  // Extract the start portion (before dash, en-dash, or 'to')
  const parts = lower.split(/[-–—]| to /);
  const startPart = parts[0].trim();

  // Check if meridiem (am/pm) exists in the end part if not in startPart (e.g. "8 - 9 pm" or "8:00 - 9:00 pm")
  let assumedMeridiem = null;
  if (!startPart.includes('am') && !startPart.includes('pm')) {
    const endPart = parts[1] || '';
    if (endPart.includes('pm')) assumedMeridiem = 'pm';
    else if (endPart.includes('am')) assumedMeridiem = 'am';
  }

  // Match hour and optional minute and optional am/pm
  const match = startPart.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match[3] || assumedMeridiem;

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  return hour * 60 + minute;
}

/**
 * Determine if a pickup or delivery task is due for rider dispatch.
 * 
 * Rules:
 * 1. Instant orders (isInstant: true or type === 'instant') are ALWAYS due immediately.
 * 2. If no scheduled date is specified, it's due immediately.
 * 3. Overdue dates (date < todayStr): ALWAYS due immediately.
 * 4. Future dates (date > todayStr, e.g. tomorrow): NOT due yet.
 * 5. Today (date === todayStr):
 *    - If no time slot or 'Anytime': due immediately.
 *    - If time slot specified (e.g. 20:00 - 21:00):
 *      Calculates difference between slot start time and current IST time.
 *      If (slotStartMinutes - currentMinutesIST) <= leadTimeMinutes, it is DUE!
 *      Otherwise it is NOT due yet (held for later dispatch).
 *
 * @param {object|null|undefined} slotObj - e.g. { scheduledDate, scheduledTime, isInstant, type } or { deliveryDate, deliveryTime }
 * @param {number} [leadTimeMinutes=75] - advance dispatch window (default 75 mins, i.e. 1h 15m)
 * @param {object} [options] - for testing / deterministic time
 * @param {string} [options.todayStr]
 * @param {number} [options.currentMinutesIST]
 * @returns {boolean}
 */
function isSlotDueForDispatch(slotObj, leadTimeMinutes = 20, options = {}) {
  if (!slotObj) return true; // fallback: unslotted orders dispatch immediately

  // 1. Instant pickups always due
  if (slotObj.isInstant === true || slotObj.type === 'instant') {
    return true;
  }

  // IST Reference Date
  const todayStr = options.todayStr || getTodayDateString();

  // Extract and normalize scheduled date
  const rawDate = slotObj.scheduledDate || slotObj.deliveryDate || '';
  const dateStr = normalizeSlotDateString(rawDate, todayStr);
  if (!dateStr) return true; // no date specified -> dispatch immediately

  // 2. Overdue from a previous day
  if (dateStr < todayStr) return true;

  // 3. Scheduled for tomorrow or later
  if (dateStr > todayStr) return false;

  // 4. Express 6–8h orders scheduled for today dispatch immediately upon placement
  if (slotObj.isExpress === true || slotObj.turnaroundMode === 'express_6_8h') {
    return true;
  }

  // 5. Scheduled for today: check time slot
  const timeStr = slotObj.scheduledTime || slotObj.deliveryTime || slotObj.deliverySlot || slotObj.time || '';
  if (!timeStr || typeof timeStr !== 'string' || !timeStr.trim() || timeStr.toLowerCase() === 'anytime') {
    return true; // no specific slot constraint for today
  }

  const slotStartMinutes = parseSlotStartMinutes(timeStr);
  if (slotStartMinutes === null) {
    return true; // if slot cannot be parsed, fail open so order isn't stuck
  }

  // Get current IST time in minutes from midnight
  let currentMinutesIST;
  if (typeof options.currentMinutesIST === 'number') {
    currentMinutesIST = options.currentMinutesIST;
  } else {
    const istDate = new Date(Date.now() + (5.5 * 3600 * 1000));
    currentMinutesIST = istDate.getUTCHours() * 60 + istDate.getUTCMinutes();
  }

  const diffMinutes = slotStartMinutes - currentMinutesIST;

  // If slot start is within leadTimeMinutes (or already started/past), dispatch now!
  return diffMinutes <= leadTimeMinutes;
}

/**
 * Determine if an order is in an editable state (pre-processing or active tagging stage).
 * @param {object} order
 * @param {Array<object>} [processes]
 * @returns {boolean}
 */
function isOrderEditable(order, processes = []) {
  if (!order || !order.status) return false;
  const preProcessingStatuses = ['placed', 'confirmed', 'in_transit_to_store', 'pickup_completed'];
  if (preProcessingStatuses.includes(order.status)) return true;

  if (order.status === 'processing') {
    if (order.processingStep === 'tagging') return true;
    if (Array.isArray(processes) && processes.length > 0) {
      return processes.some(p => p.status === 'tagging' || !p.stages?.tagging?.completedAt);
    }
  }

  return false;
}

// ── Express pricing (mirrors client editPricing.ts / Livfresh CartScreen) ──
const EXPRESS_MULTIPLIER = 1.55;
const EXPRESS_ELIGIBLE_SERVICES = ['wash_fold', 'wash_iron', 'premium_laundry', 'blanket_wash', 'ironing'];

/** Standard (non-express) price for an express-eligible, non-credit line, or null if not eligible. */
function standardLinePrice(item) {
  const sid = String((item && (item.serviceId || item.serviceType)) || '').toLowerCase();
  if (!item || item.isCreditItem || !EXPRESS_ELIGIBLE_SERVICES.includes(sid)) return null;
  if (sid === 'wash_fold') {
    const ironing = item.ironingEnabled && item.ironingCount ? item.ironingCount * 18 : 0;
    return (item.weight || 5) * 85 + ironing;
  }
  if (sid === 'wash_iron') return (item.weight || 5) * 140;
  if (sid === 'premium_laundry') return (item.weight || 5) * 200;
  if (sid === 'blanket_wash') return (item.singleBlanketCount || 0) * 299 + (item.doubleBlanketCount || 0) * 399;
  // ironing: light ₹10 / medium ₹30 / heavy ₹50
  const total = item.ironingCount || item.clothesCount || item.quantity || 0;
  const medium = Math.max(0, Math.min(item.mediumCount || 0, total));
  const heavy = Math.max(0, Math.min(item.heavyCount || 0, total - medium));
  return (total - medium - heavy) * 10 + medium * 30 + heavy * 50;
}

/**
 * Enforce 1.55x Express pricing on edited items. Returns repriced items plus
 * recomputed itemTotal / total (keeping the existing delivery fee and discount).
 */
function applyExpressPricing(items, billDetails = {}) {
  const priced = (items || []).map((it) => {
    const std = standardLinePrice(it);
    if (std === null) return it;
    return { ...it, isExpress: true, totalPrice: Math.round(std * EXPRESS_MULTIPLIER) };
  });
  const itemTotal = priced.reduce((s, it) => s + (Number(it && it.totalPrice) || 0), 0);
  const deliveryFee = Number(billDetails.deliveryFee) || 0;
  const discount = Number(billDetails.discount) || 0;
  const total = Math.max(0, itemTotal + deliveryFee - discount);
  return { items: priced, itemTotal, total };
}

/**
 * Determines whether a 5-minute unstarted machine nudge notification is due for a stage.
 * Checks whether helper accepted the stage >= 5 minutes ago and has not yet started the machine.
 * Respects snooze and server push suppression windows (5 minutes).
 * @param {object} stageData - e.g. stages.getting_washed or stages.getting_dried
 * @param {'getting_washed' | 'getting_dried'} step
 * @param {number} nowMs - current timestamp in ms
 * @returns {boolean}
 */
function isMachineNudgeDue(stageData, step, nowMs = Date.now()) {
  if (!stageData || !stageData.assignee) return false;
  if (step !== 'getting_washed' && step !== 'getting_dried') return false;
  // If machine was already started or completed, no nudge
  if (stageData.startedAt || stageData.completedAt) return false;

  const relevantTime = stageData.acceptedAt || stageData.assignedAt;
  const acceptedMs = relevantTime
    ? (typeof relevantTime.toMillis === 'function'
      ? relevantTime.toMillis()
      : (typeof relevantTime === 'number' ? relevantTime : new Date(relevantTime).getTime()))
    : 0;
  if (!acceptedMs) return false;

  const DELAY_MS = 5 * 60 * 1000; // 5 minutes grace window
  const REPEAT_MS = 5 * 60 * 1000; // 5 minutes snooze / repeat interval

  // Check last snooze timestamp
  const lastSnoozeMs = stageData.nudge?.accepted?.lastSnoozedAt
    ? (typeof stageData.nudge.accepted.lastSnoozedAt.toMillis === 'function'
      ? stageData.nudge.accepted.lastSnoozedAt.toMillis()
      : (typeof stageData.nudge.accepted.lastSnoozedAt === 'number' ? stageData.nudge.accepted.lastSnoozedAt : new Date(stageData.nudge.accepted.lastSnoozedAt).getTime()))
    : 0;

  // Check last sent timestamp (suppression window to avoid spamming every minute)
  const lastSentMs = stageData.nudge?.accepted?.lastSentAt
    ? (typeof stageData.nudge.accepted.lastSentAt.toMillis === 'function'
      ? stageData.nudge.accepted.lastSentAt.toMillis()
      : (typeof stageData.nudge.accepted.lastSentAt === 'number' ? stageData.nudge.accepted.lastSentAt : new Date(stageData.nudge.accepted.lastSentAt).getTime()))
    : 0;

  const effectiveWindowMs = Math.max(lastSnoozeMs, lastSentMs);

  if (effectiveWindowMs > 0) {
    return nowMs >= effectiveWindowMs + REPEAT_MS;
  }

  return nowMs >= acceptedMs + DELAY_MS;
}

/**
 * Checks if a started wash or dry machine stage has finished running
 * and is waiting to be unloaded (not yet completed).
 * - Washing nominal cycle: 36 minutes
 * - Drying nominal cycle: 40 minutes
 * - Repeat/snooze suppression: 5 minutes
 * 
 * @param {object} stageData
 * @param {string} step
 * @param {number} nowMs
 * @returns {boolean}
 */
function isMachineUnloadNudgeDue(stageData, step, nowMs = Date.now()) {
  if (!stageData || !stageData.assignee) return false;
  if (step !== 'getting_washed' && step !== 'getting_dried') return false;
  // Must be started and not yet completed
  if (!stageData.startedAt || stageData.completedAt) return false;

  const startedMs = stageData.startedAt
    ? (typeof stageData.startedAt.toMillis === 'function'
      ? stageData.startedAt.toMillis()
      : (typeof stageData.startedAt === 'number' ? stageData.startedAt : new Date(stageData.startedAt).getTime()))
    : 0;
  if (!startedMs) return false;

  // Cycle durations: 36m for washing, 40m for drying
  const CYCLE_MS = step === 'getting_washed' ? 36 * 60 * 1000 : 40 * 60 * 1000;
  const REPEAT_MS = 5 * 60 * 1000; // 5m repeat interval

  // Check last snooze timestamp
  const lastSnoozeMs = stageData.nudge?.started?.lastSnoozedAt
    ? (typeof stageData.nudge.started.lastSnoozedAt.toMillis === 'function'
      ? stageData.nudge.started.lastSnoozedAt.toMillis()
      : (typeof stageData.nudge.started.lastSnoozedAt === 'number' ? stageData.nudge.started.lastSnoozedAt : new Date(stageData.nudge.started.lastSnoozedAt).getTime()))
    : 0;

  // Check last sent timestamp
  const lastSentMs = stageData.nudge?.started?.lastSentAt
    ? (typeof stageData.nudge.started.lastSentAt.toMillis === 'function'
      ? stageData.nudge.started.lastSentAt.toMillis()
      : (typeof stageData.nudge.started.lastSentAt === 'number' ? stageData.nudge.started.lastSentAt : new Date(stageData.nudge.started.lastSentAt).getTime()))
    : 0;

  const effectiveWindowMs = Math.max(lastSnoozeMs, lastSentMs);

  if (effectiveWindowMs > 0) {
    return nowMs >= effectiveWindowMs + REPEAT_MS;
  }

  return nowMs >= startedMs + CYCLE_MS;
}

/**
 * Determines whether a hands-on stage (tagging / packaging) reminder is due.
 * Fires 10 minutes after assignment/acceptance, then repeats every 5 minutes
 * until completed, respecting snooze (`snoozedUntil` / `lastSnoozedAt`) and `lastSentAt`.
 * @param {object} stageData
 * @param {'tagging' | 'packaging'} step
 * @param {number} nowMs
 * @returns {boolean}
 */
function isHandsOnStageNudgeDue(stageData, step, nowMs = Date.now()) {
  if (!stageData || !stageData.assignee) return false;
  if (step !== 'tagging' && step !== 'packaging') return false;
  if (stageData.completedAt) return false;

  const toMs = (t) => (!t ? 0 : typeof t.toMillis === 'function' ? t.toMillis() : typeof t === 'number' ? t : new Date(t).getTime());
  const anchorMs = toMs(stageData.assignedAt || stageData.acceptedAt);
  if (!anchorMs) return false;

  const DELAY_MS = 10 * 60 * 1000; // 10 minutes initial grace
  const REPEAT_MS = 5 * 60 * 1000; // 5 minutes repeat interval

  const snoozedUntilMs = toMs(stageData.nudge?.hands_on?.snoozedUntil);
  if (snoozedUntilMs > 0 && nowMs < snoozedUntilMs) return false;

  const lastSnoozedMs = toMs(stageData.nudge?.hands_on?.lastSnoozedAt);
  const lastSentMs = toMs(stageData.nudge?.hands_on?.lastSentAt);
  const effectiveWindowMs = Math.max(lastSnoozedMs, lastSentMs);

  if (effectiveWindowMs > 0) {
    return nowMs >= effectiveWindowMs + REPEAT_MS;
  }

  return nowMs >= anchorMs + DELAY_MS;
}

/**
 * Returns which washer chemical milestone is due for a running wash stage, or null.
 * Mirrors client lifecycleNotifications: detergent @3m, softener @21m (softener wins if both due).
 * Re-sends every 2 minutes (via nudge.<chemical>.lastSentAt) until the chemical is marked added.
 */
function washerChemicalNudgeDue(stageData, nowMs = Date.now()) {
  if (!stageData || !stageData.assignee || !stageData.startedAt || stageData.completedAt) return null;
  const toMs = (t) => (!t ? 0 : typeof t.toMillis === 'function' ? t.toMillis() : typeof t === 'number' ? t : new Date(t).getTime());
  const startedMs = toMs(stageData.startedAt);
  if (!startedMs) return null;

  const REPEAT_MS = 2 * 60 * 1000;
  const milestones = [
    { chemical: 'softener', atMs: 21 * 60 * 1000, addedAt: stageData.softenerAddedAt },
    { chemical: 'detergent', atMs: 3 * 60 * 1000, addedAt: stageData.detergentAddedAt },
  ];
  for (const m of milestones) {
    if (m.addedAt || nowMs < startedMs + m.atMs) continue;
    const lastSentMs = toMs(stageData.nudge?.[m.chemical]?.lastSentAt);
    return !lastSentMs || nowMs >= lastSentMs + REPEAT_MS ? m.chemical : null;
  }
  return null;
}

const HINDI_LETTER_MAP = {
  A: 'ए',
  B: 'बी',
  C: 'सी',
  D: 'डी',
  E: 'ई',
  F: 'एफ',
  G: 'जी',
  H: 'एच',
  I: 'आई',
  J: 'जे',
  K: 'के',
  L: 'एल',
  M: 'एम',
  N: 'एन',
  O: 'ओ',
  P: 'पी',
  Q: 'क्यू',
  R: 'आर',
  S: 'एस',
  T: 'टी',
  U: 'यू',
  V: 'वी',
  W: 'डब्ल्यू',
  X: 'एक्स',
  Y: 'वाई',
  Z: 'ज़ेड',
};

const SINGLE_TOKEN_REGEX =
  /^(?:[A-Za-z]{1,2}-?\d{1,5}[A-Za-z]?|\d{1,5}(?:-?[A-Za-z]{1,2}\d{0,5})?(?:-[A-Za-z0-9]{1,2})?)$/;

function cleanSingleToken(raw) {
  if (raw === null || raw === undefined) return '';
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  if (typeof raw === 'number' && !Number.isFinite(raw)) return '';

  const str = String(raw)
    .trim()
    .replace(/^[#\s]+/, '')
    .replace(/^token[\s#:.-]*/i, '')
    .replace(/^[#\s]+/, '')
    .replace(/^t[-\s]+/i, '')
    .replace(/^[#\s]+/, '')
    .trim();

  if (!str || str.length > 8) return '';
  if (!SINGLE_TOKEN_REGEX.test(str)) return '';
  return str.toUpperCase();
}

function parseTokenList(raw) {
  if (raw === null || raw === undefined) return [];
  if (typeof raw === 'number') {
    const single = cleanSingleToken(raw);
    return single ? [single] : [];
  }
  if (typeof raw !== 'string') return [];

  const parts = raw.split(/[,/;&]+|\s+और\s+/);
  const out = [];
  const seen = new Set();
  for (const part of parts) {
    const cleaned = cleanSingleToken(part);
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      out.push(cleaned);
    }
  }
  return out;
}

/**
 * Extract an ordered, deduplicated list of clean alphanumeric/numeric tokens
 * from a raw token string/number or a tokens map (handling rolled-up values).
 * @param {unknown} rawToken
 * @param {Record<string, unknown>|null|undefined} [tokensMap]
 * @returns {string[]}
 */
function extractCleanTokens(rawToken, tokensMap) {
  const direct = parseTokenList(rawToken);
  if (direct.length > 0) return direct;

  if (tokensMap && typeof tokensMap === 'object') {
    const out = [];
    const seen = new Set();
    for (const val of Object.values(tokensMap)) {
      for (const tok of parseTokenList(val)) {
        if (!seen.has(tok)) {
          seen.add(tok);
          out.push(tok);
        }
      }
    }
    return out;
  }
  return [];
}

/**
 * Extract a clean comma-separated token string from a raw token value or a tokens map.
 * @param {unknown} rawToken
 * @param {Record<string, unknown>|null|undefined} [tokensMap]
 * @returns {string}
 */
function extractCleanTokenNumber(rawToken, tokensMap) {
  return extractCleanTokens(rawToken, tokensMap).join(', ');
}

/**
 * Convert a single alphanumeric token to phonetic Devanagari Hindi speech
 * so hi-IN TTS pronounces letter prefixes clearly (e.g. "B102" -> "बी 102", "1B108" -> "1 बी 108").
 * @param {string|number|null|undefined} token
 * @returns {string}
 */
function formatTokenForHindiSpeech(token) {
  if (token === null || token === undefined) return '';
  const str = String(token).trim();
  if (!str) return '';
  const runs = str.match(/[A-Za-z]|\d+/g);
  if (!runs || runs.length === 0) return '';
  return runs
    .map((part) => (/^[A-Za-z]$/.test(part) ? (HINDI_LETTER_MAP[part.toUpperCase()] || part.toUpperCase()) : part))
    .join(' ');
}

/**
 * Join multiple spoken Hindi tokens naturally with "और".
 * @param {string[]} tokens
 * @returns {string}
 */
function formatTokensForHindiSpeech(tokens) {
  const spokenList = (tokens || []).map(formatTokenForHindiSpeech).filter(Boolean);
  if (spokenList.length === 0) return '';
  if (spokenList.length === 1) return spokenList[0];
  if (spokenList.length === 2) return `${spokenList[0]} और ${spokenList[1]}`;
  return `${spokenList.slice(0, -1).join(', ')} और ${spokenList[spokenList.length - 1]}`;
}

/**
 * Build canonical Devanagari Hindi (hi-IN) TTS prompt for staff FCM voice alerts.
 * @param {{ kind?: string, step?: string, phase?: string, tokenNumber?: unknown, tokensMap?: Record<string, unknown>|null, isExpress?: boolean, locality?: string }} [opts]
 * @returns {string}
 */
function buildHindiVoicePrompt({ kind, step, phase, tokenNumber, tokensMap, isExpress, locality } = {}) {
  const tokens = extractCleanTokens(tokenNumber, tokensMap);
  const spoken = formatTokensForHindiSpeech(tokens);

  if (kind === 'new_order') {
    return 'नया ऑर्डर आया है';
  }

  if (kind === 'pickup') {
    const base = isExpress ? 'एक्सप्रेस पिकअप आया है' : 'नया पिकअप आया है';
    const shortLoc = typeof locality === 'string' ? locality.trim() : '';
    const locUpper = shortLoc.toUpperCase();
    if (shortLoc && shortLoc.length <= 25 && locUpper !== 'LOCAL' && locUpper !== 'STORE') {
      return `${base}, ${shortLoc}`;
    }
    return base;
  }

  if (kind === 'delivery') {
    if (spoken) return `टोकन ${spoken} की डिलीवरी के लिए जाना है`;
    return isExpress ? 'एक्सप्रेस डिलीवरी के लिए जाना है' : 'नई डिलीवरी आई है';
  }

  if (kind === 'idle_alert') {
    return step === 'getting_dried' ? 'ड्रायर खाली है, कपड़े डालिए' : 'वॉशर खाली है, कपड़े डालिए';
  }

  if (kind === 'nudge') {
    if (phase === 'detergent') return spoken ? `टोकन ${spoken} में डिटर्जेंट डालिए` : 'वॉशर में डिटर्जेंट डालिए';
    if (phase === 'softener') return spoken ? `टोकन ${spoken} में सॉफ्टनर डालिए` : 'वॉशर में सॉफ्टनर डालिए';
    if (step === 'getting_washed' && phase === 'accepted') {
      return spoken ? `टोकन ${spoken} का वॉशर चालू करिए` : 'वॉशर चालू करिए';
    }
    if (step === 'getting_washed' && phase === 'started') {
      return spoken ? `टोकन ${spoken} को वॉशर से निकालिए` : 'वॉशर से कपड़े निकालिए';
    }
    if (step === 'getting_dried' && phase === 'accepted') {
      return spoken ? `टोकन ${spoken} का ड्रायर चालू करिए` : 'ड्रायर चालू करिए';
    }
    if (step === 'getting_dried' && phase === 'started') {
      return spoken ? `टोकन ${spoken} को ड्रायर से निकालिए` : 'ड्रायर से कपड़े निकालिए';
    }
    if (step === 'tagging') {
      return spoken ? `टोकन ${spoken} की टैगिंग जल्दी पूरी करिए` : 'टैगिंग जल्दी पूरी करिए';
    }
    if (step === 'packaging') {
      return spoken ? `टोकन ${spoken} की पैकेजिंग जल्दी पूरी करिए` : 'पैकेजिंग जल्दी पूरी करिए';
    }
    return spoken ? `टोकन ${spoken} का नया काम आया है` : 'नया काम आया है';
  }

  // kind === 'helper_assignment' (or default)
  if (step === 'tagging') {
    return spoken ? `टोकन ${spoken} की टैगिंग करनी है` : 'टैगिंग करनी है';
  }
  if (step === 'getting_washed') {
    return spoken ? `टोकन ${spoken} को वॉशर में डालिए` : 'कपड़े वॉशर में डालिए';
  }
  if (step === 'getting_dried') {
    return spoken ? `टोकन ${spoken} को ड्रायर में डालिए` : 'कपड़े ड्रायर में डालिए';
  }
  if (step === 'getting_ironed') {
    return spoken ? `टोकन ${spoken} का नया आयरनिंग का ऑर्डर आया है` : 'नया आयरनिंग का ऑर्डर आया है';
  }
  if (step === 'packaging') {
    return spoken ? `टोकन ${spoken} की पैकेजिंग करनी है` : 'पैकेजिंग करनी है';
  }
  return spoken ? `टोकन ${spoken} का नया काम आया है` : 'नया काम आया है';
}

module.exports = {
  isMachineNudgeDue,
  isMachineUnloadNudgeDue,
  isHandsOnStageNudgeDue,
  washerChemicalNudgeDue,
  extractCleanTokens,
  extractCleanTokenNumber,
  formatTokenForHindiSpeech,
  formatTokensForHindiSpeech,
  buildHindiVoicePrompt,
  extractHelperRulesFromDoc,
  getTodayDateString,
  normalizeSlotDateString,
  isDeliveryDueToday,
  parseSlotStartMinutes,
  isSlotDueForDispatch,
  isStaffAvailableForAutoAssign,
  isOrderEditable,
  applyExpressPricing,
  EXPRESS_MULTIPLIER,
  checkPaymentGate,
  haversineMeters,
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
  TAHIRUL_PHONE,
  SAMSUL_PHONE,
  ABDUR_PHONE,
  IRONING_PRIORITY_PHONES,
  isIroningEligible,
  isHelperAllowedForStage,
  isHelperHandsOnBusy,
  getRunningMachines,
  getOccupiedMachines,
  allocateMachineName,
  isWashRequiringService,
  selectHelperForStage,
  LOAD_BASED_SERVICES,
  MACHINE_CAPACITY_KG,
  resolveToken,
};


