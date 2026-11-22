import { OpsProcess, currentStep, isHelperDoingHandsOn } from './opsProcess';

export type StageNudgeStep = 'getting_washed' | 'getting_dried' | 'tagging' | 'packaging';
export type StageNudgePhase = 'accepted' | 'started' | 'hands_on';

export interface StageNudgeRule {
  step: StageNudgeStep;
  phase: StageNudgePhase;
  initialDelayMs: number;
  repeatIntervalMs: number;
  title: string;
  message: string;
  snoozeLabel: string;
  actionLabel: string;
}

export const STAGE_NUDGE_RULES: Record<string, StageNudgeRule> = {
  getting_washed_accepted: {
    step: 'getting_washed',
    phase: 'accepted',
    initialDelayMs: 5 * 60 * 1000, // 5 minutes grace window to walk over and start
    repeatIntervalMs: 5 * 60 * 1000, // 5 minutes repeating loop (no 2m spam)
    title: 'Washing Status Check',
    message: 'It has been 5+ minutes since this wash task was assigned. Are you still doing pre-stain treatment, or ready to load and start the washer?',
    snoozeLabel: 'Still Pre-staining (+5m)',
    actionLabel: 'Start Washing',
  },
  getting_washed_started: {
    step: 'getting_washed',
    phase: 'started',
    initialDelayMs: 36 * 60 * 1000, // 36 minutes wash cycle
    repeatIntervalMs: 5 * 60 * 1000,  // 5 minutes snooze
    title: 'Washing Cycle Complete',
    message: 'The 36-minute wash cycle has elapsed. Has the washing machine finished and been unloaded?',
    snoozeLabel: 'Still running (+5m)',
    actionLabel: 'Complete & Unload',
  },
  getting_dried_accepted: {
    step: 'getting_dried',
    phase: 'accepted',
    initialDelayMs: 5 * 60 * 1000,  // 5 minutes grace window
    repeatIntervalMs: 5 * 60 * 1000, // 5 minutes repeating loop (no 2m spam)
    title: 'Drying Status Check',
    message: 'It has been 5+ minutes since this drying task was assigned. Are you still transferring/sorting clothes, or ready to start the dryer?',
    snoozeLabel: 'Still transferring (+5m)',
    actionLabel: 'Start Drying',
  },
  getting_dried_started: {
    step: 'getting_dried',
    phase: 'started',
    initialDelayMs: 40 * 60 * 1000, // 40 minutes dry cycle
    repeatIntervalMs: 5 * 60 * 1000,  // 5 minutes snooze
    title: 'Drying Cycle Complete',
    message: 'The 40-minute dry cycle has elapsed. Has the dryer finished and been unloaded?',
    snoozeLabel: 'Still running (+5m)',
    actionLabel: 'Complete & Unload',
  },
  tagging_hands_on: {
    step: 'tagging',
    phase: 'hands_on',
    initialDelayMs: 10 * 60 * 1000, // 10 minutes initial reminder
    repeatIntervalMs: 5 * 60 * 1000, // 5 minutes repeating reminder
    title: 'Tagging Pending (10+ min)',
    message: 'It has been 10+ minutes since this tagging task was assigned. Please finish tagging garments and submit to keep the washers fed.',
    snoozeLabel: 'Still Tagging (+5m)',
    actionLabel: 'Open Order',
  },
  packaging_hands_on: {
    step: 'packaging',
    phase: 'hands_on',
    initialDelayMs: 10 * 60 * 1000, // 10 minutes initial reminder
    repeatIntervalMs: 5 * 60 * 1000, // 5 minutes repeating reminder
    title: 'Packaging Pending (10+ min)',
    message: 'It has been 10+ minutes since this packaging task was assigned. Please finish packing and mark the order ready for delivery.',
    snoozeLabel: 'Still Packaging (+5m)',
    actionLabel: 'Open Order',
  },
};

export interface ActiveStageNudge {
  processId: string;
  orderId: string;
  step: StageNudgeStep;
  phase: StageNudgePhase;
  title: string;
  message: string;
  snoozeLabel: string;
  actionLabel: string;
  elapsedMinutes: number;
}

export function toMillis(ts: any): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  if (typeof ts._seconds === 'number') return ts._seconds * 1000;
  return 0;
}

const localSnoozeTimestamps = new Map<string, number>();

export function recordLocalSnooze(key: string, timestamp: number = Date.now()) {
  localSnoozeTimestamps.set(key, timestamp);
}

export function clearLocalSnooze(key: string) {
  localSnoozeTimestamps.delete(key);
}

/**
 * Checks if a specific process has an active nudge due for a given staff user.
 * If `workingHelperIds` is provided and the original assignee is NOT among currently
 * working helpers (e.g. went on lunch, short break, or clocked out), any working
 * floor helper (`role === 'helper' || role === 'iron'`) may receive the reminder.
 */
export function getProcessNudge(
  process: OpsProcess,
  uid: string,
  now: number = Date.now(),
  role?: string,
  workingHelperIds?: Set<string>
): ActiveStageNudge | null {
  const cur = currentStep(process);
  if (
    cur !== 'getting_washed' &&
    cur !== 'getting_dried' &&
    cur !== 'tagging' &&
    cur !== 'packaging'
  ) {
    return null;
  }

  const stage = process.stages?.[cur] as any;
  if (!stage) return null;

  const isSupervisor = role === 'supervisor' || role === 'admin';
  if (isSupervisor || !stage.assignee) return null;

  const isDirectAssignee = stage.assignee === uid;
  const isCoveringUnavailableAssignee =
    !isDirectAssignee &&
    (role === 'helper' || role === 'iron' || !role) &&
    Boolean(workingHelperIds && workingHelperIds.has(uid) && !workingHelperIds.has(stage.assignee));

  if (!isDirectAssignee && !isCoveringUnavailableAssignee) return null;

  // If already completed, no nudge
  if (stage.completedAt) return null;

  // Hands-on stages (tagging & packaging): 10m initial, 5m repeat anchored on assignedAt || acceptedAt
  if (cur === 'tagging' || cur === 'packaging') {
    const anchorTs = stage.assignedAt || stage.acceptedAt;
    if (!anchorTs) return null;

    const ruleKey = `${cur}_hands_on`;
    const rule = STAGE_NUDGE_RULES[ruleKey];
    if (!rule) return null;

    const anchorMs = toMillis(anchorTs);
    if (!anchorMs) return null;

    const nudgeKey = `${process.id || process.orderId}_${cur}_hands_on`;
    const lastSnoozeMs = toMillis(stage.nudge?.hands_on?.lastSnoozedAt);
    const localSnoozeMs = localSnoozeTimestamps.get(nudgeKey) || 0;
    const effectiveSnoozeMs = Math.max(lastSnoozeMs, localSnoozeMs);

    const isDue = effectiveSnoozeMs
      ? now >= effectiveSnoozeMs + rule.repeatIntervalMs
      : now >= anchorMs + rule.initialDelayMs;

    if (isDue) {
      return {
        processId: process.id,
        orderId: process.orderId,
        step: cur,
        phase: 'hands_on',
        title: rule.title,
        message: rule.message,
        snoozeLabel: rule.snoozeLabel,
        actionLabel: rule.actionLabel,
        elapsedMinutes: Math.max(1, Math.round((now - anchorMs) / 60000)),
      };
    }
    return null;
  }

  if (stage.startedAt) {
    const ruleKey = `${cur}_started`;
    const rule = STAGE_NUDGE_RULES[ruleKey];
    if (!rule) return null;

    const startMs = toMillis(stage.startedAt);
    if (!startMs) return null;

    const nudgeKey = `${process.id || process.orderId}_${cur}_started`;
    const lastSnoozeMs = toMillis(stage.nudge?.started?.lastSnoozedAt);
    const localSnoozeMs = localSnoozeTimestamps.get(nudgeKey) || 0;
    const effectiveSnoozeMs = Math.max(lastSnoozeMs, localSnoozeMs);

    const isDue = effectiveSnoozeMs
      ? now >= effectiveSnoozeMs + rule.repeatIntervalMs
      : now >= startMs + rule.initialDelayMs;

    if (isDue) {
      const helperTag = (isSupervisor && stage.assignee !== uid && stage.assigneeName) ? ` (${stage.assigneeName})` : '';
      return {
        processId: process.id,
        orderId: process.orderId,
        step: cur,
        phase: 'started',
        title: `${rule.title}${helperTag}`,
        message: rule.message,
        snoozeLabel: rule.snoozeLabel,
        actionLabel: rule.actionLabel,
        elapsedMinutes: Math.max(1, Math.round((now - startMs) / 60000)),
      };
    }
    return null;
  }

  const assignOrAcceptTs = stage.acceptedAt || stage.assignedAt;
  if (assignOrAcceptTs) {
    const ruleKey = `${cur}_accepted`;
    const rule = STAGE_NUDGE_RULES[ruleKey];
    if (!rule) return null;

    const acceptMs = toMillis(assignOrAcceptTs);
    if (!acceptMs) return null;

    const nudgeKey = `${process.id || process.orderId}_${cur}_accepted`;
    const lastSnoozeMs = toMillis(stage.nudge?.accepted?.lastSnoozedAt);
    const localSnoozeMs = localSnoozeTimestamps.get(nudgeKey) || 0;
    const effectiveSnoozeMs = Math.max(lastSnoozeMs, localSnoozeMs);

    const isDue = effectiveSnoozeMs
      ? now >= effectiveSnoozeMs + rule.repeatIntervalMs
      : now >= acceptMs + rule.initialDelayMs;

    if (isDue) {
      return {
        processId: process.id,
        orderId: process.orderId,
        step: cur,
        phase: 'accepted',
        title: rule.title,
        message: rule.message,
        snoozeLabel: rule.snoozeLabel,
        actionLabel: rule.actionLabel,
        elapsedMinutes: Math.max(1, Math.round((now - acceptMs) / 60000)),
      };
    }
    return null;
  }

  return null;
}

/**
 * Returns the first active nudge among all processes belonging to a user.
 * Machine nudges are silenced if the helper is actively doing hands-on work (tagging, ironing, packaging),
 * while the helper's own tagging/packaging 10m+ reminder is exempt from suppression.
 */
export function getActiveStageNudge(
  processes: OpsProcess[],
  uid: string,
  now: number = Date.now(),
  role?: string,
  options?: {
    onShift?: boolean;
    onBreak?: boolean;
    workingHelperIds?: Set<string>;
  }
): ActiveStageNudge | null {
  // Supervisors and admins must never receive or operate on helper stage nudges
  if (role === 'supervisor' || role === 'admin') {
    return null;
  }

  // Never disturb helpers who are clocked out / off-shift or on lunch / short break
  if (options?.onShift === false || options?.onBreak === true) {
    return null;
  }

  const doingHandsOn = isHelperDoingHandsOn(processes, uid);

  for (const process of processes) {
    const nudge = getProcessNudge(process, uid, now, role, options?.workingHelperIds);
    if (!nudge) continue;

    // If helper is actively busy with hands-on work, silence machine/other reminders,
    // but exempt the helper's own tagging/packaging 10m+ reminder.
    if (doingHandsOn) {
      const isOwnHandsOnNudge =
        (nudge.step === 'tagging' || nudge.step === 'packaging') &&
        process.stages?.[nudge.step]?.assignee === uid;
      if (!isOwnHandsOnNudge) continue;
    }

    return nudge;
  }
  return null;
}
