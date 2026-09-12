export interface StageRecord {
  assignee?: string;
  assigneeName?: string;
  startedAt?: unknown;
  completedAt?: unknown;
  durationMs?: number;
}
export interface GarmentLabel { seq: number; qr: string; }
export interface GarmentRegistration { seq: number; qr?: string; scannedAt?: unknown; scannedBy?: string; }
export interface GarmentsRecord {
  count?: number;
  labelsPrintedAt?: unknown;
  labels?: GarmentLabel[];
  registered?: GarmentRegistration[];
  submittedAt?: unknown;
}
export interface OpsProcess {
  id: string;
  orderId: string;
  parentOrderId?: string;
  serviceType?: string;
  serviceLabel?: string;
  userId?: string;
  vendorId?: string;
  steps: string[];
  currentIndex: number;
  status: string;
  stages: Record<string, StageRecord>;
  garments: GarmentsRecord;
  claimedAt?: unknown;
  tokenNumber?: string;
  siblingCount?: number;
}

const LABELS: Record<string, string> = {
  tagging: 'Tagging',
  prestain: 'Pre-stain',
  getting_washed: 'Washing',
  getting_dried: 'Drying',
  getting_ironed: 'Ironing',
  iron_ready: 'Ready for iron',
  packaging: 'Packaging',
  done: 'Done',
};

export function stepLabel(step: string): string {
  return LABELS[step] || step;
}

const stepTimeRecord = (v: unknown): StageRecord => {
  if (v && typeof v === 'object') return v as StageRecord;
  return {};
};

export function parseOpsProcess(id: string, snapData: Record<string, any> | null | undefined): OpsProcess {
  const d = snapData ?? {};

  // Stages: prefer the new per-stage shape, fall back to legacy stepTimes, then to a plain assignee.
  let stages: Record<string, StageRecord> = {};
  if (d.stages && typeof d.stages === 'object') {
    stages = d.stages;
  } else if (d.stepTimes && typeof d.stepTimes === 'object') {
    stages = Object.fromEntries(
      Object.entries(d.stepTimes).map(([step, rec]) => [step, { assignee: d.assignee ?? undefined, ...stepTimeRecord(rec) }])
    );
  }
  if (d.assignee && Array.isArray(d.steps) && d.steps.includes('tagging') && !stages.tagging) {
    stages = { ...stages, tagging: { assignee: d.assignee } };
  }

  return {
    id,
    orderId: d.orderId ?? id,
    userId: d.userId ?? undefined,
    vendorId: d.vendorId ?? undefined,
    steps: Array.isArray(d.steps) ? d.steps : [],
    currentIndex: d.currentIndex ?? 0,
    status: d.status ?? 'tagging',
    stages,
    garments: d.garments ?? { labels: [], registered: [] },
    claimedAt: d.claimedAt ?? undefined,
    tokenNumber: d.tokenNumber ?? undefined,
    serviceType: d.serviceType ?? undefined,
    serviceLabel: d.serviceLabel ?? undefined,
    siblingCount: d.siblingCount ?? undefined,
  };
}

export function currentStep(p: OpsProcess): string | null {
  return p.steps[p.currentIndex] ?? null;
}

export function isDone(p: OpsProcess): boolean {
  return p.status === 'done';
}

export function stage(p: OpsProcess, step: string): StageRecord | undefined {
  return p.stages[step];
}

// A stage is claimable when it is the current step and not started.
export function stepQueue(p: OpsProcess, step: string): boolean {
  return currentStep(p) === step && !stage(p, step)?.startedAt;
}

export function myInProgress(p: OpsProcess, uid: string): boolean {
  const cur = currentStep(p);
  if (!cur || isDone(p)) return false;
  const s = stage(p, cur);
  return !!s?.assignee && s.assignee === uid && !s.completedAt;
}

export function currentStepLabel(p: Pick<OpsProcess, 'steps' | 'currentIndex' | 'status'>): string {
  const step = p.steps[p.currentIndex];
  return step ? stepLabel(step) : stepLabel(p.status);
}
