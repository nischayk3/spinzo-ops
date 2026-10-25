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
    message: 'It has been 5+ minutes since this wash task was assigned. Are you still doing pre-stain treatment, or ready to load and start the washer?',
    snoozeLabel: 'Still Pre-staining (+5m)',
    actionLabel: 'Start Washing',
  },
  getting_washed_started: {
    step: 'getting_washed',
    phase: 'started',
    initialDelayMs: 35 * 60 * 1000, // 35 minutes wash cycle
    repeatIntervalMs: 5 * 60 * 1000,  // 5 minutes snooze
    title: 'Washing Cycle Complete',
    message: 'The 35-minute wash cycle has elapsed. Has the washing machine finished and been unloaded?',
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
    initialDelayMs: 45 * 60 * 1000, // 45 minutes dry cycle
    repeatIntervalMs: 5 * 60 * 1000,  // 5 minutes snooze
    title: 'Drying Cycle Complete',
    message: 'The 45-minute dry cycle has elapsed. Has the dryer finished and been unloaded?',
    snoozeLabel: 'Still running (+5m)',
    actionLabel: 'Complete & Unload',
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
  // Stage nudges are strictly for the assigned helper doing the operations.
  // Supervisors and admins must never receive or interfere with these reminder modals.
  if (isSupervisor || !stage.assignee || stage.assignee !== uid) return null;

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
 * Returns the first active nudge among all processes belonging to a user (or all processes for supervisors).
 * Completely silenced if the helper is actively doing hands-on work (tagging, ironing, packaging).
 */
export function getActiveStageNudge(
  processes: OpsProcess[],
  uid: string,
  now: number = Date.now(),
  role?: string
): ActiveStageNudge | null {
  // Supervisors and admins must never receive or operate on helper stage nudges
  if (role === 'supervisor' || role === 'admin') {
    return null;
  }

  // If helper is actively busy with hands-on work, NEVER disturb them with reminder alarms
  if (isHelperDoingHandsOn(processes, uid)) {
    return null;
  }

  for (const process of processes) {
    const nudge = getProcessNudge(process, uid, now, role);
    if (nudge) return nudge;
  }
  return null;
}
