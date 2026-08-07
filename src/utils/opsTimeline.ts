import { OpsProcess, stage } from './opsProcess';

export interface TimelineEntry {
  step: string;
  label: string;
  assigneeName?: string;
  startedAt?: unknown;
  completedAt?: unknown;
  durationMs?: number;
  skipped: boolean;
}

export function opsTimeline(p: OpsProcess, stepLabelFn: (s: string) => string): TimelineEntry[] {
  return p.steps.map(step => {
    const s = stage(p, step);
    return {
      step,
      label: stepLabelFn(step),
      assigneeName: s?.assigneeName,
      startedAt: s?.startedAt,
      completedAt: s?.completedAt,
      durationMs: s?.durationMs,
      skipped: !s?.startedAt,
    };
  });
}
