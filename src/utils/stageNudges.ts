import { OpsProcess, currentStep, isHelperDoingHandsOn } from './opsProcess';

export interface StageNudgeRule {
  step: 'getting_washed' | 'getting_dried';
  phase: 'accepted' | 'started';
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
    message: 'It has been 5+ minutes since this wash task was assigned. Please load the machine and tap Start Washing.',
    snoozeLabel: 'Still loading (+5m)',
    actionLabel: 'Start Washing',
  },
  getting_washed_started: {
    step: 'getting_washed',
    phase: 'started',
    initialDelayMs: 37 * 60 * 1000, // 37 minutes
    repeatIntervalMs: 5 * 60 * 1000,  // 5 minutes snooze
    title: 'Washing Cycle Check',
    message: 'The 37-minute wash cycle has elapsed. Has the washing machine finished?',
    snoozeLabel: 'Still running',
    actionLabel: 'Complete Washing',
  },
  getting_dried_accepted: {
    step: 'getting_dried',
    phase: 'accepted',
    initialDelayMs: 5 * 60 * 1000,  // 5 minutes grace window
    repeatIntervalMs: 5 * 60 * 1000, // 5 minutes repeating loop (no 2m spam)
    title: 'Drying Status Check',
    message: 'It has been 5+ minutes since this drying task was assigned. Please transfer clothes and tap Start Drying.',
    snoozeLabel: 'Still loading (+5m)',
    actionLabel: 'Start Drying',
  },
  getting_dried_started: {
    step: 'getting_dried',
    phase: 'started',
    initialDelayMs: 46 * 60 * 1000, // 46 minutes
    repeatIntervalMs: 5 * 60 * 1000,  // 5 minutes snooze
    title: 'Drying Cycle Check',
    message: 'The 46-minute dry cycle has elapsed. Has the dryer finished?',
    snoozeLabel: 'Still running',
    actionLabel: 'Complete Drying',
  },
};

export interface ActiveStageNudge {
  processId: string;
  orderId: string;
  step: 'getting_washed' | 'getting_dried';
  phase: 'accepted' | 'started';
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
 */
export function getProcessNudge(
  process: OpsProcess,
  uid: string,
  now: number = Date.now(),
  role?: string
): ActiveStageNudge | null {
  const cur = currentStep(process);
  if (cur !== 'getting_washed' && cur !== 'getting_dried') return null;

  const stage = process.stages?.[cur] as any;
  if (!stage) return null;

  const isSupervisor = role === 'supervisor' || role === 'admin';

  // Must be assigned to this specific user (unassigned tasks in queue must NEVER nudge helpers!)
  if (!stage.assignee || (stage.assignee !== uid && !isSupervisor)) return null;

  // If already completed, no nudge
  if (stage.completedAt) return null;

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

  if (stage.acceptedAt) {
    const ruleKey = `${cur}_accepted`;
    const rule = STAGE_NUDGE_RULES[ruleKey];
    if (!rule) return null;

    const acceptMs = toMillis(stage.acceptedAt);
    if (!acceptMs) return null;

    const nudgeKey = `${process.id || process.orderId}_${cur}_accepted`;
    const lastSnoozeMs = toMillis(stage.nudge?.accepted?.lastSnoozedAt);
    const localSnoozeMs = localSnoozeTimestamps.get(nudgeKey) || 0;
    const effectiveSnoozeMs = Math.max(lastSnoozeMs, localSnoozeMs);

    const isDue = effectiveSnoozeMs
      ? now >= effectiveSnoozeMs + rule.repeatIntervalMs
      : now >= acceptMs + rule.initialDelayMs;

    if (isDue) {
      const helperTag = (isSupervisor && stage.assignee !== uid && stage.assigneeName) ? ` (${stage.assigneeName})` : '';
      const customMsg = (isSupervisor && stage.assignee !== uid && stage.assigneeName)
        ? `It has been 5+ minutes since ${stage.assigneeName} was assigned this task. Did they start the machine?`
        : rule.message;

      return {
        processId: process.id,
        orderId: process.orderId,
        step: cur,
        phase: 'accepted',
        title: `${rule.title}${helperTag}`,
        message: customMsg,
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
 * Returns the first active nudge among all processes belonging to a user (or all processes for supervisors).
 * Completely silenced if the helper is actively doing hands-on work (tagging, ironing, packaging).
 */
export function getActiveStageNudge(
  processes: OpsProcess[],
  uid: string,
  now: number = Date.now(),
  role?: string
): ActiveStageNudge | null {
  // If helper is actively busy with hands-on work, NEVER disturb them with reminder alarms
  if (role !== 'supervisor' && role !== 'admin' && isHelperDoingHandsOn(processes, uid)) {
    return null;
  }

  for (const process of processes) {
    const nudge = getProcessNudge(process, uid, now, role);
    if (nudge) return nudge;
  }
  return null;
}
