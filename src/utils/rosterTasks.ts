import { currentStep, isMachineStep, stepLabel } from './opsProcess';

export interface HelperLiveTaskItem {
  processId: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  stage: string;
  stageLabel: string;
  tokens: string[];
  machineName?: string;
  startedAt?: any;
  assignedAt?: any;
  isRunningMachine: boolean;
  serviceLabel?: string;
}

function digitsLast10(phone?: unknown): string {
  if (typeof phone !== 'string' && typeof phone !== 'number') return '';
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function toTimestampMs(ts: any): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts?.toMillis === 'function') return ts.toMillis();
  if (typeof ts?.seconds === 'number') return ts.seconds * 1000;
  if (typeof ts?._seconds === 'number') return ts._seconds * 1000;
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function extractTokens(proc: any): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const add = (val: unknown) => {
    if (val === null || val === undefined) return;
    const str = String(val).trim();
    if (!str || seen.has(str)) return;
    seen.add(str);
    result.push(str);
  };

  if (Array.isArray(proc?.tokens)) {
    for (const t of proc.tokens) add(t);
  }
  add(proc?.tokenNumber);
  return result;
}

function matchesHelper(
  stageRec: any,
  uids: Set<string>,
  helperNameLower: string,
  helperPhoneLast10: string
): boolean {
  if (!stageRec || typeof stageRec !== 'object') return false;

  const assignee = typeof stageRec.assignee === 'string' ? stageRec.assignee.trim() : '';
  if (assignee && uids.has(assignee)) return true;

  if (helperPhoneLast10) {
    const assigneePhone10 = digitsLast10(stageRec.assigneePhone);
    if (assigneePhone10 && assigneePhone10 === helperPhoneLast10) return true;
    const assigneeAsPhone10 = digitsLast10(assignee);
    if (assigneeAsPhone10 && assigneeAsPhone10 === helperPhoneLast10) return true;
  }

  if (helperNameLower) {
    const assigneeName =
      typeof stageRec.assigneeName === 'string' ? stageRec.assigneeName.trim().toLowerCase() : '';
    if (assigneeName && assigneeName === helperNameLower) return true;
  }

  return false;
}

function taskPriority(item: HelperLiveTaskItem): number {
  if (item.isRunningMachine) return 0;
  if (!isMachineStep(item.stage)) return 1;
  return 2;
}

export function getHelperLiveTasks(
  helper: { uid?: string; id?: string; name?: string; phone?: string },
  processes: any[]
): HelperLiveTaskItem[] {
  if (!helper || !Array.isArray(processes) || processes.length === 0) return [];

  const uids = new Set<string>();
  if (typeof helper.uid === 'string' && helper.uid.trim()) uids.add(helper.uid.trim());
  if (typeof helper.id === 'string' && helper.id.trim()) uids.add(helper.id.trim());

  const helperNameLower = typeof helper.name === 'string' ? helper.name.trim().toLowerCase() : '';
  const helperPhoneLast10 = digitsLast10(helper.phone);

  if (uids.size === 0 && !helperNameLower && !helperPhoneLast10) return [];

  const dedupe = new Set<string>();
  const items: HelperLiveTaskItem[] = [];

  for (const proc of processes) {
    if (!proc || typeof proc !== 'object') continue;
    if (proc.status === 'done') continue;

    const processId = String(proc.id || proc.orderId || '');
    const rawOrderId = String(proc.parentOrderId || proc.orderId || proc.id || '');
    const orderId = rawOrderId.includes('__') ? rawOrderId.split('__')[0] : rawOrderId;
    const orderNumber =
      typeof proc.orderNumber === 'string' && proc.orderNumber.trim()
        ? proc.orderNumber.trim()
        : orderId.slice(-6).toUpperCase();
    const customerName =
      (typeof proc.customerName === 'string' && proc.customerName.trim()) ||
      (typeof proc.customer?.name === 'string' && proc.customer.name.trim()) ||
      'Customer';
    const tokens = extractTokens(proc);
    const serviceLabel =
      typeof proc.serviceLabel === 'string' && proc.serviceLabel.trim() ? proc.serviceLabel.trim() : undefined;

    const stagesObj: Record<string, any> = proc.stages && typeof proc.stages === 'object' ? proc.stages : {};
    const candidateStageKeys: string[] = [];

    const cur =
      (Array.isArray(proc.steps) && typeof proc.currentIndex === 'number' ? currentStep(proc) : null) ||
      (typeof proc.status === 'string' ? proc.status : null);

    if (cur && cur !== 'done') {
      candidateStageKeys.push(cur);
    }

    for (const key of Object.keys(stagesObj)) {
      if (key !== 'done' && !candidateStageKeys.includes(key)) {
        candidateStageKeys.push(key);
      }
    }

    for (const stageKey of candidateStageKeys) {
      const stageRec = stagesObj[stageKey];
      if (!stageRec || stageRec.completedAt) continue;
      if (!matchesHelper(stageRec, uids, helperNameLower, helperPhoneLast10)) continue;

      const dedupeKey = `${processId}::${stageKey}`;
      if (dedupe.has(dedupeKey)) continue;
      dedupe.add(dedupeKey);

      const isRunningMachine = isMachineStep(stageKey) && Boolean(stageRec.startedAt);

      items.push({
        processId,
        orderId,
        orderNumber,
        customerName,
        stage: stageKey,
        stageLabel: stepLabel(stageKey),
        tokens,
        machineName: typeof stageRec.machineName === 'string' && stageRec.machineName.trim() ? stageRec.machineName.trim() : undefined,
        startedAt: stageRec.startedAt ?? undefined,
        assignedAt: stageRec.assignedAt ?? stageRec.acceptedAt ?? undefined,
        isRunningMachine,
        serviceLabel,
      });
    }
  }

  items.sort((a, b) => {
    const pDiff = taskPriority(a) - taskPriority(b);
    if (pDiff !== 0) return pDiff;

    const aTime = toTimestampMs(a.startedAt ?? a.assignedAt);
    const bTime = toTimestampMs(b.startedAt ?? b.assignedAt);
    if (aTime && bTime && aTime !== bTime) return aTime - bTime;
    if (aTime && !bTime) return -1;
    if (!aTime && bTime) return 1;

    return a.processId.localeCompare(b.processId) || a.stage.localeCompare(b.stage);
  });

  return items;
}
