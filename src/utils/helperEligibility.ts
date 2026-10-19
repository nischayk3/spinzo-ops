import { OpsProcess, currentStep, isDone, isHelperBusy, isMachineStep, isActivelyLoadingMachine, isHelperDoingHandsOn } from './opsProcess';
import { StoreResources } from '../store/storeResourcesStore';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ActiveHelperTask {
  orderId: string;
  step: string;
}

// ─── Staff Specialty Routing Phones & Roles ───────────────────────────────────

export const SAMSUL_PHONE = '+916369768237';
export const ABDUR_PHONE = '+917559105832';
export const ABDUL_PHONE = '+916900311761';

export const IRONING_PRIORITY_PHONES = [SAMSUL_PHONE, ABDUR_PHONE];

export function normalizePhone(raw?: string | null): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return raw.trim();
}

export function isIroningEligiblePhone(phone?: string | null): boolean {
  if (!phone) return false;
  const norm = normalizePhone(phone);
  return IRONING_PRIORITY_PHONES.some(p => normalizePhone(p) === norm);
}

// ─── Machine Capacity & Stage Buffers ──────────────────────────────────────────

/** Count how many processes globally are actively running a given step type. */
export function countRunningMachines(processes: OpsProcess[], stepType: string): number {
  return processes.filter(p => {
    const cur = currentStep(p);
    if (cur !== stepType) return false;
    const stage = p.stages[cur];
    // "Running" = startedAt exists but completedAt doesn't
    return !!stage?.startedAt && !stage?.completedAt;
  }).length;
}

/** Count total pending orders for a stage (waiting or running, not completed). */
export function countPendingStageOrders(processes: OpsProcess[], stepType: string): number {
  return processes.filter(p => {
    const cur = currentStep(p);
    if (cur !== stepType) return false;
    const stage = p.stages[cur];
    return !stage?.completedAt;
  }).length;
}

/** Check if the required machine/resource or buffer for a step is at capacity. */
export function isMachineOrBufferAtCapacity(
  processes: OpsProcess[],
  step: string,
  resources: StoreResources
): boolean {
  switch (step) {
    case 'getting_washed': {
      // Running capacity: max active running washers
      const running = countRunningMachines(processes, 'getting_washed');
      if (running >= resources.washers) return true;
      // Buffer rule: 2 pending orders per active washer (e.g. 2 washers -> 4 pending orders)
      const pending = countPendingStageOrders(processes, 'getting_washed');
      return pending >= (resources.washers * 2);
    }
    case 'getting_dried': {
      return countRunningMachines(processes, 'getting_dried') >= resources.dryers;
    }
    case 'getting_ironed': {
      // Running capacity: max active running ironing stations
      const running = countRunningMachines(processes, 'getting_ironed');
      if (running >= resources.ironingStations) return true;
      // Buffer rule: 2 pending orders per active iron station (e.g. 2 stations -> 4 pending orders)
      const pending = countPendingStageOrders(processes, 'getting_ironed');
      return pending >= (resources.ironingStations * 2);
    }
    default:
      return false; // tagging, packaging, prestain don't need machine buffers
  }
}

// ─── Task Priority (Machines first: washer and dryer must never sit empty) ─────

const STEP_PRIORITY: Record<string, number> = {
  getting_dried: 1,    // Machine priority: Load available dryer immediately
  getting_washed: 2,   // Machine priority: Load available washer immediately
  packaging: 3,        // Ready for packaging
  getting_ironed: 4,   // Bottleneck iron station
  prestain: 5,
  tagging: 6,          // New incoming work
};

function getStepPriority(step: string | null): number {
  return step ? (STEP_PRIORITY[step] ?? 99) : 99;
}

// Order states that mean no helper task should be offered for this order.
function isOrderTerminal(status?: string): boolean {
  return status === 'cancelled' || status === 'ready' || status === 'out_for_delivery' || status === 'delivered';
}

function getProcessTimestamp(p: OpsProcess): number {
  const cur = currentStep(p);
  const stage = cur ? p.stages?.[cur] : null;
  const queuedAt = (stage as any)?.queuedAt;
  if (queuedAt) {
    if (typeof queuedAt === 'number') return queuedAt;
    if (typeof queuedAt.toMillis === 'function') return queuedAt.toMillis();
  }
  const created = (p as any).createdAt;
  if (created) {
    if (typeof created === 'number') return created;
    if (typeof created.toMillis === 'function') return created.toMillis();
  }
  return 0;
}

// ─── Busy / Push Helpers ───────────────────────────────────────────────────────

/** A supervisor pushed this stage to me and I haven't acknowledged it yet. */
export function isPushedToMe(p: OpsProcess, uid: string): boolean {
  const cur = currentStep(p);
  const s = cur ? p.stages[cur] : undefined;
  return !!s && s.assignee === uid && !!s.assignedBy && !s.acceptedAt && !s.completedAt;
}

/**
 * `ops_staff.activeHelperTask` is only trusted while the claim/accept write hasn't
 * reached our snapshot yet. Once the process reflects reality (or a supervisor
 * reassigned it) the field is stale and must not keep the helper busy.
 */
function isAcceptInFlight(processes: OpsProcess[], orders: any[], task: ActiveHelperTask | null): boolean {
  if (!task) return false;
  const forOrder = processes.filter(p => p.orderId === task.orderId);
  if (forOrder.length === 0) {
    return orders.some(o => o.id === task.orderId && o.status === 'pickup_completed'); // claim in flight
  }
  return forOrder.some(p => currentStep(p) === task.step && !p.stages[task.step]?.assignee);
}

// ─── Eligibility Check ─────────────────────────────────────────────────────────

/**
 * Can a FREE helper be offered this process? Pure — no side effects.
 * (The busy gate lives in getTopEligibleTask.)
 */
export function isHelperEligible(
  process: OpsProcess,
  role: string,
  machineAtCapacity: boolean,
  phone?: string | null
): boolean {
  if (isDone(process) || process.status === 'cancelled') return false;

  const cur = currentStep(process);
  if (!cur || !(cur in STEP_PRIORITY)) return false; // unknown step / iron_ready

  // Already owned by someone (incl. me) → not an open offer
  if (process.stages[cur]?.assignee) return false;

  // The machine or buffer for this step is full store-wide → don't offer to anyone
  if (machineAtCapacity) return false;

  // Ironing Orders: Strictly gated to authorized specialists (Samsul & Abdur)
  // New helper and other unauthorized phone numbers are blocked.
  if (cur === 'getting_ironed') {
    if (role === 'admin') return true;
    if (!phone || !isIroningEligiblePhone(phone)) return false;
  }

  return true;
}

// ─── Main Entry Point ──────────────────────────────────────────────────────────

/**
 * Given all processes, all orders, the helper's identity and state, and the store's
 * resource config, returns the single most critical task to show in the popup.
 *
 * Availability model:
 *   Accept → BUSY (loading) → Start machine → FREE (machine runs) → later Unload & Complete.
 *   Hands-on steps (tagging, ironing, packaging) keep the helper busy until completed.
 *
 * Rules:
 *   - Machine Priority: Washer and Dryer never sit idle.
 *   - Packaging Overflow: If > 3 packaging orders pending, 4th triggers instant assignment of oldest packaging order.
 *   - Machine Buffers: 2 pending orders per active washer, 2 per active iron station.
 *   - Ironing Priority: Priority 1 Samsul (+916369768237), Priority 2 Abdur (+917559105832), block New Helper.
 */
export function getTopEligibleTask(
  processes: OpsProcess[],
  orders: any[], // FeedOrder[]
  uid: string,
  role: string,
  activeTask: ActiveHelperTask | null,
  resources: StoreResources = { washers: 1, dryers: 1, ironingStations: 1 },
  onShift = true,
  phone?: string | null
): OpsProcess | null {
  // Ignore processes whose order is already finished/cancelled.
  const live = processes.filter(p => !isOrderTerminal(orders.find(o => o.id === p.orderId)?.status));

  // ── 0. Supervisor-assigned tasks ALWAYS surface so the helper acknowledges them ──
  const pushed = live.find(p => isPushedToMe(p, uid));
  if (pushed) return { ...pushed, isPushedToMe: true };

  // ✅ SHIFT GATE: an off-shift helper (not clocked in via QR) must NOT be auto-offered
  if (!onShift) return null;

  // ── RULE: Packaging Overflow Rule ──
  // If > 3 packaging orders pending (i.e. 4 or more), 4th arrival triggers instant
  // assignment of the 1st (oldest) packaging order to next available helper, looping continuously.
  const pendingPackaging = live.filter(
    p => currentStep(p) === 'packaging' && !p.stages.packaging?.assignee && !p.stages.packaging?.completedAt
  );

  if (pendingPackaging.length > 3) {
    // Sort oldest first
    pendingPackaging.sort((a, b) => getProcessTimestamp(a) - getProcessTimestamp(b));
    const oldestPackaging = pendingPackaging[0];
    if (!isHelperBusy(live, uid) && !isActivelyLoadingMachine(live, uid) && !isAcceptInFlight(live, orders, activeTask)) {
      return oldestPackaging;
    }
  }

  // ── 1. Filter eligible processes (with global machine capacity and buffer checks) ──
  const eligible = live.filter(p => {
    const cur = currentStep(p);
    const atCapacity = !!cur && !p.stages[cur]?.startedAt && isMachineOrBufferAtCapacity(live, cur, resources);
    return isHelperEligible(p, role, atCapacity, phone);
  });

  // Sort by priority: getting_dried (1) -> getting_washed (2) -> packaging (3) -> getting_ironed (4)...
  eligible.sort((a, b) => {
    const pA = getStepPriority(currentStep(a));
    const pB = getStepPriority(currentStep(b));
    if (pA !== pB) return pA - pB;
    // Tie-break: oldest first
    return getProcessTimestamp(a) - getProcessTimestamp(b);
  });

  // ── Specialist Preference Ranking ──
  // Abdul: Primary for Tagging and Packaging
  // Samsul: Primary for Ironing
  // Abdur: Secondary for Ironing (station 2) / Tagging fallback
  const normPhone = normalizePhone(phone);
  const isAbdul = normPhone === normalizePhone(ABDUL_PHONE);
  const isSamsul = normPhone === normalizePhone(SAMSUL_PHONE);
  const isAbdur = normPhone === normalizePhone(ABDUR_PHONE);

  // Check for unclaimed orders that need tagging
  const claimedOrderIds = new Set(processes.map(p => p.orderId));
  const o = orders.find(x => x.status === 'pickup_completed' && !claimedOrderIds.has(x.id));
  const taggingProcess: OpsProcess | null = o ? {
    id: o.id,
    orderId: o.id,
    userId: o.userId,
    vendorId: o.vendorId,
    steps: ['tagging'],
    currentIndex: 0,
    status: 'tagging',
    stages: {},
    garments: { labels: [], registered: [] },
  } : null;

  // ── 2. Machine Priority: Washer & Dryer should NEVER remain empty! ──
  // Surfaced to free helpers via full modal, or to hands-on helpers via non-intrusive floating banner.
  const machineProcess = eligible.find(p => isMachineStep(currentStep(p)));
  if (machineProcess) {
    if (!isActivelyLoadingMachine(live, uid) && !isAcceptInFlight(live, orders, activeTask)) {
      return machineProcess;
    }
  }

  // ── 3. Busy gate: hands-on work in progress for non-machine tasks ──
  if (isHelperBusy(live, uid) || isAcceptInFlight(live, orders, activeTask)) return null;

  // ── 4. Equal Three-Helper Task Routing (Abdul, Abdur, Samsool) ──
  const ironProcess = eligible.find(p => currentStep(p) === 'getting_ironed');
  // If ironing is available and helper is Samsul, he takes it as primary specialist
  if (isSamsul && ironProcess) {
    return ironProcess;
  }

  // All three helpers (Abdul, Abdur, Samsool) are equally eligible for Tagging and Packaging!
  if (taggingProcess) return taggingProcess;
  const packagingProcess = eligible.find(p => currentStep(p) === 'packaging');
  if (packagingProcess) return packagingProcess;

  // With 2 iron stations, Abdur or Abdul can also operate Station 2 on pipeline overflow:
  if (ironProcess && (resources.ironingStations || 1) >= 2) {
    return ironProcess;
  }

  // ── 5. Standard Priority Fallback ──
  return eligible[0] || null;
}
