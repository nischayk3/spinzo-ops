export interface OpsProcess {
  id: string;
  orderId: string;
  userId?: string;
  vendorId?: string;
  assignee?: string;
  steps: string[];
  currentIndex: number;
  status: string;
  stepTimes: Record<string, { startedAt?: unknown; completedAt?: unknown; durationMs?: number }>;
  claimedAt?: unknown;
}

const LABELS: Record<string, string> = {
  tagging: 'Tagging',
  getting_washed: 'Washing',
  getting_dried: 'Drying',
  getting_folded: 'Folding',
  getting_ironed: 'Ironing',
  iron_ready: 'Ready for iron',
  done: 'Done',
};

export function stepLabel(step: string): string {
  return LABELS[step] || step;
}

export function parseOpsProcess(id: string, snapData: Record<string, any> | null | undefined): OpsProcess {
  const d = snapData ?? {};
  return {
    id,
    orderId: d.orderId ?? id,
    userId: d.userId ?? undefined,
    vendorId: d.vendorId ?? undefined,
    assignee: d.assignee ?? undefined,
    steps: Array.isArray(d.steps) ? d.steps : [],
    currentIndex: d.currentIndex ?? 0,
    status: d.status ?? 'tagging',
    stepTimes: d.stepTimes ?? {},
    claimedAt: d.claimedAt ?? undefined,
  };
}

export function currentStepLabel(p: Pick<OpsProcess, 'steps' | 'currentIndex' | 'status'>): string {
  const step = p.steps[p.currentIndex];
  return step ? stepLabel(step) : stepLabel(p.status);
}
