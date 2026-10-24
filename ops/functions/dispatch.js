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
const LOAD_BASED_SERVICES = new Set(['wash_fold', 'wash_iron', 'premium_laundry']);
const MACHINE_CAPACITY_KG = 8;

/**
 * Split an order's items into service groups for internal order splitting.
 * Each group becomes its own ops_process doc.
 * 
 * For weight-based services (Wash & Fold, Wash & Iron, Premium Laundry):
 * If the order has multiple loads (either via token keys like wash_fold__L1,
 * or based on weight > 8kg), each load becomes its own independent ops_process doc!
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
    const type = item.serviceType || 'wash_fold';

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
 * Ironing priority list:
 * 1. Samsul (+916369768237)
 * 2. Abdur (+917559105832)
 * No ironing orders to new helper!
 */
const ABDUL_PHONE = '+916900311761';
const SAMSUL_PHONE = '+916369768237';
const ABDUR_PHONE = '+917559105832';

// All three store helpers are authorized for ironing operations
// (Samuel primary on Station 1; Abdur/Abdul on Station 2 on overflow)
const IRONING_PRIORITY_PHONES = [SAMSUL_PHONE, ABDUR_PHONE, ABDUL_PHONE];

function isIroningEligible(phone, allowedList = IRONING_PRIORITY_PHONES) {
  if (!phone) return false;
  const p = normalizePhone(phone);
  return allowedList.map(normalizePhone).includes(p);
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

/**
 * Deterministic, balanced helper selection for store operations stages:
 * - Tagging: Free floor helper (Abdul or Abdur, least loaded) -> Samsul (if free & no iron) -> else QUEUE!
 * - Washing: 2 Washers max. Free helper (least loaded) -> Floor helper doing tagging/packaging (60s load) -> Samsul (if not ironing) -> else QUEUE!
 * - Drying: 2 Dryers max. 1st previousAssignee (unloaded washer) -> Free helper -> Floor helper -> else QUEUE!
 * - Ironing: 2 Stations max. Station 1 dedicated to Samsul; Station 2 to Abdur/Abdul on pipeline overflow. If busy -> QUEUE!
 * - Packaging: Free floor helper (Abdul or Abdur, least loaded) -> Samsul (if free & no iron) -> else QUEUE!
 */
function selectHelperForStage(stage, onShiftHelpers, liveProcesses = [], resources = { washers: 2, dryers: 2, ironingStations: 2 }, options = {}) {
  const normalize = (p) => (p || '').replace(/\D/g, '').slice(-10);
  const helpers = (onShiftHelpers || []).filter(h => h && h.onShift === true);
  if (helpers.length === 0) {
    return { ok: false, error: 'no_helpers_on_shift', shouldQueue: true };
  }

  const workloads = getHelperWorkload(liveProcesses);

  // Helper roles
  const isFloorHelper = (h) => {
    const p = normalize(h.phone);
    return p === '6900311761' || p === '7559105832';
  };
  const isSamsul = (h) => normalize(h.phone) === '6369768237';

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

    const freeFloor = sortByLeastLoaded(freeHelpers.filter(isFloorHelper));
    const freeSamsul = (!hasPendingIron) ? freeHelpers.find(isSamsul) : null;

    // In tie-break (both total=0), floor helper takes tagging; if floor helper is busy or has more tasks, Samsul takes it
    if (freeFloor.length > 0 && (!freeSamsul || (workloads[freeFloor[0].uid]?.total || 0) <= (workloads[freeSamsul.uid]?.total || 0))) {
      return { ok: true, helper: freeFloor[0] };
    }
    if (freeSamsul) {
      return { ok: true, helper: freeSamsul };
    }
    if (freeFloor.length > 0) {
      return { ok: true, helper: freeFloor[0] };
    }

    // ALL helpers busy with hands-on tasks -> MUST QUEUE! (Never overload Abdul or anyone)
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
    // 1. Completely free helper (least loaded among Abdul, Abdur, Samsul)
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

    // Station 2 (or Station 1 if Samsul busy): Abdur (Priority 2 iron specialist), then Abdul
    const availableStation = !occupiedStationNames.has('Iron Station 1') ? 'Iron Station 1' : (!occupiedStationNames.has('Iron Station 2') ? 'Iron Station 2' : null);
    if (availableStation) {
      const freeAbdur = freeHelpers.find(h => normalize(h.phone) === '7559105832');
      const freeAbdul = freeHelpers.find(h => normalize(h.phone) === '6900311761');
      const candidate = freeAbdur || freeAbdul || sortByLeastLoaded(freeHelpers.filter(isFloorHelper))[0];
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

    const freeFloor = sortByLeastLoaded(freeHelpers.filter(isFloorHelper));
    const freeSamsul = (!hasPendingIron) ? freeHelpers.find(isSamsul) : null;

    if (freeFloor.length > 0 && (!freeSamsul || (workloads[freeFloor[0].uid]?.total || 0) <= (workloads[freeSamsul.uid]?.total || 0))) {
      return { ok: true, helper: freeFloor[0] };
    }
    if (freeSamsul) {
      return { ok: true, helper: freeSamsul };
    }
    if (freeFloor.length > 0) {
      return { ok: true, helper: freeFloor[0] };
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
function isSlotDueForDispatch(slotObj, leadTimeMinutes = 15, options = {}) {
  if (!slotObj) return true; // fallback: unslotted orders dispatch immediately

  // 1. Instant pickups always due
  if (slotObj.isInstant === true || slotObj.type === 'instant') {
    return true;
  }

  // Extract scheduled date
  const dateStr = (slotObj.scheduledDate || slotObj.deliveryDate || '').trim();
  if (!dateStr) return true; // no date specified -> dispatch immediately

  // IST Reference Date
  const todayStr = options.todayStr || getTodayDateString();

  // 2. Overdue from a previous day
  if (dateStr < todayStr) return true;

  // 3. Scheduled for tomorrow or later
  if (dateStr > todayStr) return false;

  // 4. Scheduled for today: check time slot
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
 * - Washing nominal cycle: 35 minutes
 * - Drying nominal cycle: 45 minutes
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

  // Cycle durations: 35m for washing, 45m for drying
  const CYCLE_MS = step === 'getting_washed' ? 35 * 60 * 1000 : 45 * 60 * 1000;
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

module.exports = {
  isMachineNudgeDue,
  isMachineUnloadNudgeDue,
  getTodayDateString,
  isDeliveryDueToday,
  parseSlotStartMinutes,
  isSlotDueForDispatch,
  isOrderEditable,
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
  getOccupiedMachines,
  allocateMachineName,
  selectHelperForStage,
  LOAD_BASED_SERVICES,
  MACHINE_CAPACITY_KG,
};


