import { OpsProcess, stage, stepLabel } from './opsProcess';

export interface TimelineEntry {
  step: string;
  label: string;
  assigneeName?: string;
  startedAt?: unknown;
  completedAt?: unknown;
  durationMs?: number;
  skipped: boolean;
  reached: boolean;
}

export function opsTimeline(p: OpsProcess, stepLabelFn: (s: string) => string = stepLabel): TimelineEntry[] {
  return p.steps.map((step, index) => {
    const s = stage(p, step);
    const reached = index < p.currentIndex;
    return {
      step,
      label: stepLabelFn(step),
      assigneeName: s?.assigneeName,
      startedAt: s?.startedAt,
      completedAt: s?.completedAt,
      durationMs: s?.durationMs,
      // A reached stage that never started was skipped (e.g. a step the pipeline
      // derived but the store opted out of); unreached stages are merely pending.
      skipped: reached && !s?.startedAt,
      reached,
    };
  });
}
