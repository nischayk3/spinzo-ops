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
  return Math.max(0, slaMinutes - elapsedMin);
}

export function slaTone(remaining: number, done: boolean): SlaTone {
  if (done) return 'muted';
  if (remaining <= 30) return 'error';
  if (remaining <= 60) return 'warning';
  return 'ok';
}
