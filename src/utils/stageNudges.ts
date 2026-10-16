import { OpsProcess, currentStep } from './opsProcess';

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
    initialDelayMs: 10 * 60 * 1000, // 10 minutes
    repeatIntervalMs: 5 * 60 * 1000,  // 5 minutes snooze
    title: 'Washing Status Check',
    message: 'It has been 10+ minutes since you accepted this wash. Are you still doing pre-stain or ready to start?',
    snoozeLabel: 'Still doing pre-stain',
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
    initialDelayMs: 5 * 60 * 1000,  // 5 minutes
    repeatIntervalMs: 3 * 60 * 1000,  // 3 minutes snooze
    title: 'Drying Status Check',
    message: 'It has been 5+ minutes since you accepted this drying task. Are you still loading or ready to start?',
    snoozeLabel: 'Still loading',
    actionLabel: 'Start Drying',
  },
  getting_dried_started: {
    step: 'getting_dried',
    phase: 'started',
    initialDelayMs: 46 * 60 * 1000, // 46 minutes
    repeatIntervalMs: 3 * 60 * 1000,  // 3 minutes snooze
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

/**
 * Checks if a specific process has an active nudge due for a given staff user.
 */
export function getProcessNudge(
  process: OpsProcess,
  uid: string,
  now: number = Date.now()
): ActiveStageNudge | null {
  const cur = currentStep(process);
  if (cur !== 'getting_washed' && cur !== 'getting_dried') return null;

  const stage = process.stages?.[cur] as any;
  if (!stage) return null;

  // Must be assigned to this user (or allow check for active step)
  if (stage.assignee && stage.assignee !== uid) return null;

  // If already completed, no nudge
  if (stage.completedAt) return null;

  if (stage.startedAt) {
    const ruleKey = `${cur}_started`;
    const rule = STAGE_NUDGE_RULES[ruleKey];
    if (!rule) return null;

    const startMs = toMillis(stage.startedAt);
    if (!startMs) return null;

    const lastSnoozeMs = toMillis(stage.nudge?.started?.lastSnoozedAt);
    const isDue = lastSnoozeMs
      ? now >= lastSnoozeMs + rule.repeatIntervalMs
      : now >= startMs + rule.initialDelayMs;

    if (isDue) {
      return {
        processId: process.id,
        orderId: process.orderId,
        step: cur,
        phase: 'started',
        title: rule.title,
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

    const lastSnoozeMs = toMillis(stage.nudge?.accepted?.lastSnoozedAt);
    const isDue = lastSnoozeMs
      ? now >= lastSnoozeMs + rule.repeatIntervalMs
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
 */
export function getActiveStageNudge(
  processes: OpsProcess[],
  uid: string,
  now: number = Date.now()
): ActiveStageNudge | null {
  for (const process of processes) {
    const nudge = getProcessNudge(process, uid, now);
    if (nudge) return nudge;
  }
  return null;
}
