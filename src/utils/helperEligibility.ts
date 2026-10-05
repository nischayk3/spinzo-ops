import { OpsProcess, currentStep, isDone, isHelperBusy } from './opsProcess';
import { StoreResources } from '../store/storeResourcesStore';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ActiveHelperTask {
  orderId: string;
  step: string;
}

// ─── Machine Capacity (scalable: works for 1 washer or 10) ─────────────────────

/** Count how many processes globally are actively running a given step type. */
function countRunningMachines(processes: OpsProcess[], stepType: string): number {
  return processes.filter(p => {
    const cur = currentStep(p);
    if (cur !== stepType) return false;
    const stage = p.stages[cur];
    // "Running" = startedAt exists but completedAt doesn't
    return !!stage?.startedAt && !stage?.completedAt;
  }).length;
}

/** Check if the required machine/resource for a step is at capacity. */
function isMachineAtCapacity(
  processes: OpsProcess[],
  step: string,
  resources: StoreResources
): boolean {
  switch (step) {
    case 'getting_washed':
      return countRunningMachines(processes, 'getting_washed') >= resources.washers;
    case 'getting_dried':
      return countRunningMachines(processes, 'getting_dried') >= resources.dryers;
    case 'getting_ironed':
      return countRunningMachines(processes, 'getting_ironed') >= resources.ironingStations;
    default:
      return false; // tagging, packaging, prestain don't need machines
  }
}

// ─── Task Priority (finish what's almost done first) ───────────────────────────

const STEP_PRIORITY: Record<string, number> = {
  packaging: 1,        // Almost done → free up shelf space
  getting_ironed: 2,   // Bottleneck resource
  getting_dried: 3,    // Machine-dependent
  getting_washed: 4,   // Machine-dependent
  prestain: 5,
  tagging: 6,          // New incoming work → lowest priority
};

function getStepPriority(step: string | null): number {
  return step ? (STEP_PRIORITY[step] ?? 99) : 99;
}

// Order states that mean no helper task should be offered for this order.
function isOrderTerminal(status?: string): boolean {
  return status === 'cancelled' || status === 'ready' || status === 'out_for_delivery' || status === 'delivered';
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
  machineAtCapacity: boolean
): boolean {
  if (isDone(process) || process.status === 'cancelled') return false;

  const cur = currentStep(process);
  if (!cur || !(cur in STEP_PRIORITY)) return false; // unknown step / iron_ready

  // Already owned by someone (incl. me) → not an open offer
  if (process.stages[cur]?.assignee) return false;

  // The machine for this step is full store-wide → don't offer to anyone
  if (machineAtCapacity) return false;

  // Only iron specialists (or helpers/admins)
  if (cur === 'getting_ironed' && role !== 'admin' && role !== 'iron' && role !== 'helper') return false;
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
 * Scalable: works correctly whether you have 1 washer or 10, 1 helper or 20.
 */
export function getTopEligibleTask(
  processes: OpsProcess[],
  orders: any[], // FeedOrder[]
  uid: string,
  role: string,
  activeTask: ActiveHelperTask | null,
  resources: StoreResources = { washers: 1, dryers: 1, ironingStations: 1 },
  onShift = true
): OpsProcess | null {
  // ✅ SHIFT GATE: an off-shift helper (not clocked in via QR) must NOT be shown
  // — or be able to receive — any task. This is the fix for helpers receiving
  // orders without clocking in.
  if (!onShift) return null;

  // Ignore processes whose order is already finished/cancelled.
  const live = processes.filter(p => !isOrderTerminal(orders.find(o => o.id === p.orderId)?.status));

  // ── Busy gate: hands-on work in progress (a running machine does NOT count) ──
  if (isHelperBusy(live, uid) || isAcceptInFlight(live, orders, activeTask)) return null;

  // ── 0. Supervisor-assigned tasks always surface so the helper acknowledges them ──
  const pushed = live.find(p => isPushedToMe(p, uid));
  if (pushed) return pushed;

  // ── 1. Check for unclaimed orders that need tagging ──
  const claimedOrderIds = new Set(processes.map(p => p.orderId));
  const o = orders.find(x => x.status === 'pickup_completed' && !claimedOrderIds.has(x.id));
  if (o) {
    return {
      id: o.id,
      orderId: o.id,
      userId: o.userId,
      vendorId: o.vendorId,
      steps: ['tagging'],
      currentIndex: 0,
      status: 'tagging',
      stages: {},
      garments: { labels: [], registered: [] },
    };
  }

  // ── 2. Filter eligible processes (with global machine capacity check) ──
  const eligible = live.filter(p => {
    const cur = currentStep(p);
    // A started-but-unassigned stage (supervisor unassigned it mid-run) already
    // occupies its machine — don't count it against itself.
    const atCapacity = !!cur && !p.stages[cur]?.startedAt && isMachineAtCapacity(live, cur, resources);
    return isHelperEligible(p, role, atCapacity);
  });

  if (eligible.length === 0) return null;

  // ── 3. Sort by priority: finish almost-done work first ──
  eligible.sort((a, b) => getStepPriority(currentStep(a)) - getStepPriority(currentStep(b)));

  return eligible[0];
}
