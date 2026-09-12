import { OpsProcess, currentStep, isDone, myInProgress } from './opsProcess';
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

// ─── Eligibility Check ─────────────────────────────────────────────────────────

/**
 * Check if a specific helper is eligible to receive a popup for a given process.
 * This function is pure — no side effects, no Firestore calls.
 */
export function isHelperEligible(
  process: OpsProcess,
  uid: string,
  role: string,
  activeTask: ActiveHelperTask | null,
  isBusyWithMachine: boolean,
  machineAtCapacity: boolean
): boolean {
  if (isDone(process) || process.status === 'cancelled') return false;

  const cur = currentStep(process);
  if (!cur) return false;

  const stage = process.stages[cur];

  // Already assigned to someone else → not my problem
  if (stage?.assignee && stage.assignee !== uid) return false;
  // Already assigned to me → no need to popup again
  if (stage?.assignee === uid) return false;

  // If I have a machine running (wash/dry started but not completed), suppress ALL popups
  if (isBusyWithMachine) return false;

  // If the MACHINE for this step is at capacity globally, don't show it to anyone
  if (machineAtCapacity) return false;

  // Role + state constraints
  switch (cur) {
    case 'tagging':
      if (activeTask) return false;
      return true;

    case 'getting_ironed':
      // Only iron specialists (or helpers/admins)
      if (role !== 'admin' && role !== 'iron' && role !== 'helper') return false;
      if (activeTask) return false;
      return true;

    case 'packaging':
      if (activeTask) return false;
      return true;

    case 'getting_washed':
    case 'getting_dried':
    case 'prestain':
      if (activeTask) return false;
      return true;

    case 'iron_ready':
      return false;

    default:
      return false;
  }
}

// ─── Main Entry Point ──────────────────────────────────────────────────────────

/**
 * Given all processes, all orders, the helper's identity and state, and the store's
 * resource config, returns the single most critical eligible task to show in the popup.
 *
 * Scalable: works correctly whether you have 1 washer or 10, 1 helper or 20.
 */
export function getTopEligibleTask(
  processes: OpsProcess[],
  orders: any[], // FeedOrder[]
  uid: string,
  role: string,
  activeTask: ActiveHelperTask | null,
  resources: StoreResources = { washers: 1, dryers: 1, ironingStations: 1 }
): OpsProcess | null {
  // ── Pre-compute helper's personal machine status ──
  const isBusyWithMachine = processes.some(p => {
    const cur = currentStep(p);
    if (!cur) return false;
    if (cur !== 'getting_washed' && cur !== 'getting_dried') return false;
    return myInProgress(p, uid);
  });

  // ── 1. Check for unclaimed orders that need tagging ──
  if (!activeTask && !isBusyWithMachine) {
    const claimedOrderIds = new Set(processes.map(p => p.orderId));
    const taggingOrders = orders.filter(o =>
      o.status === 'pickup_completed' && !claimedOrderIds.has(o.id)
    );
    if (taggingOrders.length > 0) {
      const o = taggingOrders[0];
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
  }

  // ── 2. Filter eligible processes (with global machine capacity check) ──
  const eligible = processes.filter(p => {
    const order = orders.find(o => o.id === p.orderId);
    if (order?.status === 'cancelled') return false;

    const cur = currentStep(p);
    const machineAtCapacity = cur ? isMachineAtCapacity(processes, cur, resources) : false;

    return isHelperEligible(p, uid, role, activeTask, isBusyWithMachine, machineAtCapacity);
  });

  if (eligible.length === 0) return null;

  // ── 3. Sort by priority: finish almost-done work first ──
  eligible.sort((a, b) => {
    const pa = getStepPriority(currentStep(a));
    const pb = getStepPriority(currentStep(b));
    return pa - pb;
  });

  return eligible[0];
}
