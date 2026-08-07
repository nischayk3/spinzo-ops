export const STAGE_SLA_MINUTES: Record<string, number> = {
  tagging: 30,
  prestain: 20,
  getting_washed: 45,
  getting_dried: 60,
  getting_folded: 30,
  getting_ironed: 45,
};

export type SlaTone = 'muted' | 'error' | 'warning' | 'ok';

export function slaRemainingMinutes(startedAt: unknown, slaMinutes: number): number {
  if (!startedAt) return slaMinutes;
  let ms: number;
  if (typeof (startedAt as any).toDate === 'function') ms = (startedAt as any).toDate().getTime();
  else if (typeof (startedAt as any).seconds === 'number') ms = (startedAt as any).seconds * 1000;
  else ms = new Date(startedAt as any).getTime();
  if (Number.isNaN(ms)) return slaMinutes;
  const elapsedMin = (Date.now() - ms) / 60000;
  // Clamp both ends: a future/backdated startedAt can't stretch the SLA, and an
  // elapsed past the SLA floor at 0.
  return Math.min(slaMinutes, Math.max(0, slaMinutes - elapsedMin));
}

// Urgency is relative to the stage's own SLA so a fresh stage always reads "ok":
// within 75% of the SLA is ok, 25%..50% remaining is warning, under 25% is error.
export function slaTone(remaining: number, slaMinutes: number, done: boolean): SlaTone {
  if (done) return 'muted';
  if (slaMinutes <= 0) return remaining <= 0 ? 'error' : 'ok';
  const pct = remaining / slaMinutes;
  if (pct <= 0.25) return 'error';
  if (pct <= 0.5) return 'warning';
  return 'ok';
}
