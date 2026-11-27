export const REPORT_STAGE_KEYS = [
  'tagging',
  'getting_washed',
  'getting_dried',
  'getting_ironed',
  'packaging',
] as const;

export type ReportStageKey = (typeof REPORT_STAGE_KEYS)[number];

export const REPORT_STAGE_LABELS: Record<ReportStageKey, string> = {
  tagging: 'Tagging',
  getting_washed: 'Washing',
  getting_dried: 'Drying',
  getting_ironed: 'Ironing',
  packaging: 'Packaging',
};

export type IroningServiceBucket = 'wash_iron' | 'ironing' | 'premium_laundry' | 'other';

export const IRONING_SERVICE_LABELS: Record<IroningServiceBucket, string> = {
  wash_iron: 'Wash & Iron',
  ironing: 'Steam Iron',
  premium_laundry: 'Premium Laundry',
  other: 'Other',
};

// Cap stage duration outliers (e.g. timers left open overnight) so they never blow up averages,
// while still counting the completed load and its pieces.
export const MAX_VALID_STAGE_MINUTES = 360;
export const MAX_VALID_RIDER_MINUTES = 600;

export interface StageMetricDoc {
  id?: string;
  processId: string;
  orderId: string;
  parentOrderId?: string;
  step: string;
  serviceType?: string;
  serviceLabel?: string;
  garmentCount?: number;
  loadIndex?: number;
  loadCount?: number;
  assignee?: string;
  assigneeName?: string;
  startedAt?: unknown;
  acceptedAt?: unknown;
  completedAt?: unknown;
  startToCompleteMin?: number;
  acceptToCompleteMin?: number;
  durationMs?: number;
  dateKey?: string;
}

export interface NormalizedStageEvent {
  dedupeKey: string;
  processId: string;
  orderId: string;
  step: ReportStageKey;
  staffName: string;
  dateKey: string;
  serviceType: string;
  serviceLabel: string;
  serviceBucket: IroningServiceBucket;
  durationMin: number | null;
  pieces: number;
  isEstimatedPieces: boolean;
}

export interface StageReportCell {
  avgMinutes: number | null;
  completedCount: number;
  pieces: number;
  hasEstimatedPieces: boolean;
}

export interface ServiceIroningStat {
  loads: number;
  pieces: number;
}

export interface HelperTimingRow {
  staffName: string;
  stages: Record<ReportStageKey, StageReportCell>;
  ironingTotalLoads: number;
  ironingTotalPieces: number;
  ironingHasEstimated: boolean;
  ironingAvgMin: number | null;
  ironingByService: Record<IroningServiceBucket, ServiceIroningStat>;
}

export interface IroningDayStat {
  date: string;
  totalLoads: number;
  totalPieces: number;
  byStaff: Record<string, { loads: number; pieces: number }>;
}

export interface HelperReportResult {
  rows: HelperTimingRow[];
  overallStages: Array<{
    key: ReportStageKey;
    label: string;
    avg: number | null;
    count: number;
    pieces: number;
    hasEstimatedPieces: boolean;
  }>;
  ironingSummary: {
    totalLoads: number;
    totalPieces: number;
    hasEstimatedPieces: boolean;
    avgPiecesPerDay: number;
    byService: Record<IroningServiceBucket, ServiceIroningStat>;
    byDay: IroningDayStat[];
  };
}

export interface RiderTimingRow {
  staffName: string;
  pickupAvgMin: number | null;
  pickupCount: number;
  deliveryAvgMin: number | null;
  deliveryCount: number;
}

export interface RiderDayStat {
  date: string;
  pickupCount: number;
  deliveryCount: number;
  pickupAvgMin: number | null;
  deliveryAvgMin: number | null;
}

export interface RiderReportResult {
  rows: RiderTimingRow[];
  dayStats: RiderDayStat[];
  overall: {
    pickupAvg: number | null;
    pickupCount: number;
    deliveryAvg: number | null;
    deliveryCount: number;
    totalWorkers: number;
  } | null;
}

export function getTimestampMs(t: any): number {
  if (!t) return 0;
  if (typeof t === 'number') return Number.isFinite(t) ? t : 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.toDate === 'function') return t.toDate().getTime();
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  const p = new Date(t).getTime();
  return Number.isNaN(p) ? 0 : p;
}

// Convert timestamp ms to IST (UTC+5:30) YYYY-MM-DD matching backend ops_stage_metrics.dateKey
export function toIstDateKey(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return '';
  return new Date(ms + 5.5 * 3600 * 1000).toISOString().split('T')[0];
}

export function localISODate(d: Date): string {
  const c = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return c.toISOString().split('T')[0];
}

export function dayStartMs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function normalizeStageKey(rawStep: string): ReportStageKey | null {
  const mapped =
    rawStep === 'drying'
      ? 'getting_dried'
      : rawStep === 'ironing'
      ? 'getting_ironed'
      : rawStep;
  return (REPORT_STAGE_KEYS as readonly string[]).includes(mapped)
    ? (mapped as ReportStageKey)
    : null;
}

export function normalizeServiceBucket(
  serviceType?: string,
  serviceLabel?: string
): IroningServiceBucket {
  const raw = `${serviceType || ''} ${serviceLabel || ''}`.toLowerCase();
  if (raw.includes('premium')) return 'premium_laundry';
  if (raw.includes('wash_iron') || raw.includes('wash & iron') || raw.includes('wash and iron')) {
    return 'wash_iron';
  }
  if (raw.includes('ironing') || raw.includes('steam iron') || raw.includes('iron')) {
    return 'ironing';
  }
  return 'other';
}

/**
 * Extracts a clean stage duration in minutes for averaging.
 * Returns null for 0m instant taps or extreme overnight outliers (> 360m)
 * so they never corrupt averages, while callers STILL count the completed load & pieces.
 */
export function getCleanStageDurationMin(s: any): number | null {
  if (!s || typeof s !== 'object') return null;

  let min: number | null = null;
  if (typeof s.startToCompleteMin === 'number' && s.startToCompleteMin > 0) {
    min = s.startToCompleteMin;
  } else if (typeof s.acceptToCompleteMin === 'number' && s.acceptToCompleteMin > 0) {
    min = s.acceptToCompleteMin;
  } else if (typeof s.durationMs === 'number' && s.durationMs > 0) {
    min = Math.round(s.durationMs / 60000);
  } else if (s.completedAt && (s.startedAt || s.acceptedAt)) {
    const cMs = getTimestampMs(s.completedAt);
    const stMs = getTimestampMs(s.startedAt || s.acceptedAt);
    if (cMs > stMs && stMs > 0) {
      min = Math.round((cMs - stMs) / 60000);
    }
  }

  if (min === null || !Number.isFinite(min) || min <= 0 || min > MAX_VALID_STAGE_MINUTES) {
    return null;
  }
  return Math.round(min);
}

function inferLoadCount(
  metric: Partial<StageMetricDoc>,
  order?: any
): number {
  if (typeof metric.loadCount === 'number' && metric.loadCount > 0) {
    return Math.floor(metric.loadCount);
  }
  const label = metric.serviceLabel || '';
  const m = label.match(/Load\s+\d+\s*\/\s*(\d+)/i);
  if (m) {
    const parsed = parseInt(m[1], 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const loadTimings = order?.loadTimings || order?.opsDetails?.loadTimings;
  if (loadTimings && typeof loadTimings === 'object') {
    const keys = Object.keys(loadTimings);
    if (keys.length > 1) return keys.length;
  }
  return 1;
}

function sumMatchingOrderItems(order: any, bucket: IroningServiceBucket): number {
  if (!order || !Array.isArray(order.items) || order.items.length === 0) return 0;
  let matchingSum = 0;
  let totalSum = 0;
  for (const item of order.items) {
    const qty = Number(item?.quantity ?? item?.qty ?? item?.count ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    // Skip weight-based kg entries (where unit is kg or service is wash_fold/wash_iron weight)
    const unit = String(item?.unit || '').toLowerCase();
    if (unit === 'kg' || unit === 'kgs') continue;
    totalSum += qty;
    const itemBucket = normalizeServiceBucket(item?.serviceType, item?.serviceName || item?.name);
    if (itemBucket === bucket) matchingSum += qty;
  }
  if (matchingSum > 0) return Math.round(matchingSum);
  if (bucket === 'ironing' && totalSum > 0) return Math.round(totalSum);
  return 0;
}

/**
 * Resolves piece count for a single stage completion (load):
 * 1. Exact per-load garmentCount stored on ops_stage_metrics
 * 2. Exact per-load garments.count on live ops_process
 * 3. Exact per-load loadTimings[processId].garmentCount on order
 * 4. Order-level garmentCount (exact for single-load; pro-rata estimated for historical delivered multi-load)
 * 5. Fallback to per-piece order.items quantities (e.g. Steam Iron)
 */
export function resolvePieceCount(
  metric: Partial<StageMetricDoc>,
  processById: Map<string, any>,
  orderById: Map<string, any>
): { pieces: number; isEstimated: boolean } {
  if (typeof metric.garmentCount === 'number' && Number.isFinite(metric.garmentCount) && metric.garmentCount > 0) {
    return { pieces: Math.round(metric.garmentCount), isEstimated: false };
  }

  const proc = metric.processId ? processById.get(metric.processId) : undefined;
  if (proc) {
    const procCount = Number(proc?.garments?.count || 0);
    if (Number.isFinite(procCount) && procCount > 0) {
      return { pieces: Math.round(procCount), isEstimated: false };
    }
    const regLen = Array.isArray(proc?.garments?.registered) ? proc.garments.registered.length : 0;
    if (regLen > 0) {
      return { pieces: regLen, isEstimated: false };
    }
  }

  const orderId = metric.parentOrderId || metric.orderId || '';
  const order = orderId ? orderById.get(orderId) : undefined;
  if (order) {
    const loadTimings = order.loadTimings || order.opsDetails?.loadTimings;
    if (metric.processId && loadTimings && typeof loadTimings === 'object') {
      const lt = loadTimings[metric.processId];
      if (lt && typeof lt.garmentCount === 'number' && lt.garmentCount > 0) {
        return { pieces: Math.round(lt.garmentCount), isEstimated: false };
      }
    }

    const orderGarmentCount = Number(order.garmentCount ?? order.opsDetails?.garmentCount ?? 0);
    if (Number.isFinite(orderGarmentCount) && orderGarmentCount > 0) {
      const loadCount = inferLoadCount(metric, order);
      if (loadCount <= 1) {
        return { pieces: Math.round(orderGarmentCount), isEstimated: false };
      }
      return { pieces: Math.max(1, Math.round(orderGarmentCount / loadCount)), isEstimated: true };
    }

    const bucket = normalizeServiceBucket(metric.serviceType, metric.serviceLabel);
    const itemPieces = sumMatchingOrderItems(order, bucket);
    if (itemPieces > 0) {
      return { pieces: itemPieces, isEstimated: false };
    }
  }

  return { pieces: 0, isEstimated: false };
}

/**
 * Merges ops_stage_metrics (primary permanent source), live ops_process (real-time fallback),
 * and legacy order.stageTimings (pre-metrics fallback) with strict deduplication so no stage
 * is ever double-counted.
 */
export function collectHelperStageEvents(params: {
  stageMetrics: StageMetricDoc[];
  processes: any[];
  orders: any[];
  startDate: string;
  endDate: string;
}): NormalizedStageEvent[] {
  const { stageMetrics, processes, orders, startDate, endDate } = params;

  const processById = new Map<string, any>();
  for (const p of processes || []) {
    if (p?.id) processById.set(p.id, p);
  }

  const orderById = new Map<string, any>();
  for (const o of orders || []) {
    if (o?.id) orderById.set(o.id, o);
  }

  const events: NormalizedStageEvent[] = [];
  const seenProcessStep = new Set<string>();
  const seenOrderStep = new Set<string>();

  const inRange = (dateKey: string) =>
    Boolean(dateKey) && dateKey >= startDate && dateKey <= endDate;

  // 1. Primary source: permanent ops_stage_metrics
  for (const m of stageMetrics || []) {
    const step = normalizeStageKey(m.step);
    if (!step) continue;

    const compMs = getTimestampMs(m.completedAt);
    const dateKey = m.dateKey || toIstDateKey(compMs);
    if (!inRange(dateKey)) continue;

    const processId = m.processId || m.orderId || '';
    const orderId = m.parentOrderId || m.orderId || processId;
    const dedupeKey = `${processId}__${step}`;
    if (seenProcessStep.has(dedupeKey)) continue;

    seenProcessStep.add(dedupeKey);
    if (orderId) seenOrderStep.add(`${orderId}__${step}`);

    const staffName = (m.assigneeName || '').trim() || 'Unknown';
    const { pieces, isEstimated } = resolvePieceCount(m, processById, orderById);

    events.push({
      dedupeKey,
      processId,
      orderId,
      step,
      staffName,
      dateKey,
      serviceType: m.serviceType || '',
      serviceLabel: m.serviceLabel || '',
      serviceBucket: normalizeServiceBucket(m.serviceType, m.serviceLabel),
      durationMin: getCleanStageDurationMin(m),
      pieces,
      isEstimatedPieces: isEstimated,
    });
  }

  // 2. Real-time fallback: live ops_process docs not yet in ops_stage_metrics
  for (const p of processes || []) {
    const stages = p?.stages;
    if (!stages || typeof stages !== 'object') continue;
    const processId = p.id || p.orderId || '';
    const orderId = p.parentOrderId || p.orderId || processId;

    for (const [rawStep, s] of Object.entries<any>(stages)) {
      if (!s || !s.completedAt) continue;
      const step = normalizeStageKey(rawStep);
      if (!step) continue;

      const dedupeKey = `${processId}__${step}`;
      if (seenProcessStep.has(dedupeKey)) continue;

      const compMs = getTimestampMs(s.completedAt);
      const dateKey = toIstDateKey(compMs);
      if (!inRange(dateKey)) continue;

      seenProcessStep.add(dedupeKey);
      if (orderId) seenOrderStep.add(`${orderId}__${step}`);

      const staffName = (s.assigneeName || '').trim() || 'Unknown';
      const { pieces, isEstimated } = resolvePieceCount(
        {
          processId,
          orderId,
          parentOrderId: p.parentOrderId,
          serviceType: p.serviceType,
          serviceLabel: p.serviceLabel,
          loadCount: p.loadCount || p.siblingCount,
        },
        processById,
        orderById
      );

      events.push({
        dedupeKey,
        processId,
        orderId,
        step,
        staffName,
        dateKey,
        serviceType: p.serviceType || '',
        serviceLabel: p.serviceLabel || '',
        serviceBucket: normalizeServiceBucket(p.serviceType, p.serviceLabel),
        durationMin: getCleanStageDurationMin(s),
        pieces,
        isEstimatedPieces: isEstimated,
      });
    }
  }

  // 3. Legacy fallback: archived orders whose stages predated ops_stage_metrics
  for (const o of orders || []) {
    const timings = o?.stageTimings || o?.opsDetails?.stageTimings;
    if (!timings || typeof timings !== 'object') continue;
    const orderId = o.id || '';
    if (!orderId) continue;

    for (const [rawStep, s] of Object.entries<any>(timings)) {
      if (!s || !s.completedAt) continue;
      const step = normalizeStageKey(rawStep);
      if (!step) continue;

      // Never duplicate an order+step already accounted for by ops_stage_metrics or live ops_process
      if (seenOrderStep.has(`${orderId}__${step}`)) continue;

      const compMs = getTimestampMs(s.completedAt);
      const dateKey = toIstDateKey(compMs);
      if (!inRange(dateKey)) continue;

      seenOrderStep.add(`${orderId}__${step}`);

      const staffName = (s.assigneeName || s.assignee || '').trim() || 'Unknown';
      const { pieces, isEstimated } = resolvePieceCount(
        {
          processId: orderId,
          orderId,
          parentOrderId: orderId,
          serviceType: o.serviceType,
          serviceLabel: o.serviceLabel,
        },
        processById,
        orderById
      );

      events.push({
        dedupeKey: `${orderId}__${step}`,
        processId: orderId,
        orderId,
        step,
        staffName,
        dateKey,
        serviceType: o.serviceType || '',
        serviceLabel: o.serviceLabel || '',
        serviceBucket: normalizeServiceBucket(o.serviceType, o.serviceLabel),
        durationMin: getCleanStageDurationMin(s),
        pieces,
        isEstimatedPieces: isEstimated,
      });
    }
  }

  return events;
}

function emptyIroningByService(): Record<IroningServiceBucket, ServiceIroningStat> {
  return {
    wash_iron: { loads: 0, pieces: 0 },
    ironing: { loads: 0, pieces: 0 },
    premium_laundry: { loads: 0, pieces: 0 },
    other: { loads: 0, pieces: 0 },
  };
}

export function buildHelperReport(
  events: NormalizedStageEvent[],
  selectedStaff: string,
  dates: string[]
): HelperReportResult {
  const filtered =
    selectedStaff === 'all'
      ? events
      : events.filter((e) => e.staffName === selectedStaff);

  interface Accum {
    stages: Record<
      ReportStageKey,
      { durationSum: number; durationCount: number; completedCount: number; pieces: number; hasEstimated: boolean }
    >;
    ironingByService: Record<IroningServiceBucket, ServiceIroningStat>;
  }

  const makeAccum = (): Accum => ({
    stages: {
      tagging: { durationSum: 0, durationCount: 0, completedCount: 0, pieces: 0, hasEstimated: false },
      getting_washed: { durationSum: 0, durationCount: 0, completedCount: 0, pieces: 0, hasEstimated: false },
      getting_dried: { durationSum: 0, durationCount: 0, completedCount: 0, pieces: 0, hasEstimated: false },
      getting_ironed: { durationSum: 0, durationCount: 0, completedCount: 0, pieces: 0, hasEstimated: false },
      packaging: { durationSum: 0, durationCount: 0, completedCount: 0, pieces: 0, hasEstimated: false },
    },
    ironingByService: emptyIroningByService(),
  });

  const staffMap = new Map<string, Accum>();
  const overallTotals = makeAccum().stages;
  const ironingByServiceTotal = emptyIroningByService();
  const ironingByDayMap = new Map<string, IroningDayStat>();

  for (const d of dates) {
    ironingByDayMap.set(d, { date: d, totalLoads: 0, totalPieces: 0, byStaff: {} });
  }

  for (const ev of filtered) {
    if (!staffMap.has(ev.staffName)) staffMap.set(ev.staffName, makeAccum());
    const acc = staffMap.get(ev.staffName)!;

    const cell = acc.stages[ev.step];
    const overall = overallTotals[ev.step];

    cell.completedCount += 1;
    cell.pieces += ev.pieces;
    if (ev.isEstimatedPieces) cell.hasEstimated = true;

    overall.completedCount += 1;
    overall.pieces += ev.pieces;
    if (ev.isEstimatedPieces) overall.hasEstimated = true;

    if (ev.durationMin !== null) {
      cell.durationSum += ev.durationMin;
      cell.durationCount += 1;
      overall.durationSum += ev.durationMin;
      overall.durationCount += 1;
    }

    if (ev.step === 'getting_ironed') {
      acc.ironingByService[ev.serviceBucket].loads += 1;
      acc.ironingByService[ev.serviceBucket].pieces += ev.pieces;

      ironingByServiceTotal[ev.serviceBucket].loads += 1;
      ironingByServiceTotal[ev.serviceBucket].pieces += ev.pieces;

      let dayRec = ironingByDayMap.get(ev.dateKey);
      if (!dayRec) {
        dayRec = { date: ev.dateKey, totalLoads: 0, totalPieces: 0, byStaff: {} };
        ironingByDayMap.set(ev.dateKey, dayRec);
      }
      dayRec.totalLoads += 1;
      dayRec.totalPieces += ev.pieces;
      if (!dayRec.byStaff[ev.staffName]) {
        dayRec.byStaff[ev.staffName] = { loads: 0, pieces: 0 };
      }
      dayRec.byStaff[ev.staffName].loads += 1;
      dayRec.byStaff[ev.staffName].pieces += ev.pieces;
    }
  }

  const rows: HelperTimingRow[] = Array.from(staffMap.entries())
    .map(([staffName, acc]) => {
      const stages = {} as Record<ReportStageKey, StageReportCell>;
      for (const k of REPORT_STAGE_KEYS) {
        const s = acc.stages[k];
        stages[k] = {
          avgMinutes: s.durationCount > 0 ? Math.round(s.durationSum / s.durationCount) : null,
          completedCount: s.completedCount,
          pieces: s.pieces,
          hasEstimatedPieces: s.hasEstimated,
        };
      }
      const ironCell = stages.getting_ironed;
      return {
        staffName,
        stages,
        ironingTotalLoads: ironCell.completedCount,
        ironingTotalPieces: ironCell.pieces,
        ironingHasEstimated: ironCell.hasEstimatedPieces,
        ironingAvgMin: ironCell.avgMinutes,
        ironingByService: acc.ironingByService,
      };
    })
    .sort((a, b) => {
      const sum = (r: HelperTimingRow) =>
        REPORT_STAGE_KEYS.reduce((total, k) => total + (r.stages[k]?.completedCount || 0), 0);
      return sum(b) - sum(a);
    });

  const overallStages = REPORT_STAGE_KEYS.map((k) => {
    const t = overallTotals[k];
    return {
      key: k,
      label: REPORT_STAGE_LABELS[k],
      avg: t.durationCount > 0 ? Math.round(t.durationSum / t.durationCount) : null,
      count: t.completedCount,
      pieces: t.pieces,
      hasEstimatedPieces: t.hasEstimated,
    };
  });

  const ironOverall = overallTotals.getting_ironed;
  const numDays = Math.max(1, dates.length);
  const byDay = dates
    .map((d) => ironingByDayMap.get(d)!)
    .filter((d) => d && (d.totalLoads > 0 || d.totalPieces > 0));

  return {
    rows,
    overallStages,
    ironingSummary: {
      totalLoads: ironOverall.completedCount,
      totalPieces: ironOverall.pieces,
      hasEstimatedPieces: ironOverall.hasEstimated,
      avgPiecesPerDay: Math.round(ironOverall.pieces / numDays),
      byService: ironingByServiceTotal,
      byDay,
    },
  };
}

export function resolveRiderName(
  order: any,
  leg: 'pickup' | 'delivery',
  taskRiders: Record<string, { pickupUid?: string; deliveryUid?: string }>,
  riderNameByUid: Record<string, string>
): string {
  const taskInfo = taskRiders[order.id] || taskRiders[order.orderId] || {};
  // For delivery leg, prioritize explicit deliveryRiderId & ops_delivery_tasks.assignee BEFORE pickup riderId
  const uid =
    leg === 'pickup'
      ? order.riderId || taskInfo.pickupUid
      : order.deliveryRiderId || taskInfo.deliveryUid || order.riderId || taskInfo.pickupUid;
  const resolved = uid ? riderNameByUid[uid] : undefined;
  return resolved || order.riderName || 'Unassigned';
}

export function buildRiderReport(params: {
  orders: any[];
  taskRiders: Record<string, { pickupUid?: string; deliveryUid?: string }>;
  riderNameByUid: Record<string, string>;
  startDate: string;
  endDate: string;
  selectedStaff: string;
  dates: string[];
}): RiderReportResult {
  const { orders, taskRiders, riderNameByUid, startDate, endDate, selectedStaff, dates } = params;
  const startTs = dayStartMs(startDate);
  const endTs = dayStartMs(endDate) + 86400000;

  const riderMap = new Map<
    string,
    {
      pickupCount: number;
      pickupDurSum: number;
      pickupDurCount: number;
      deliveryCount: number;
      deliveryDurSum: number;
      deliveryDurCount: number;
    }
  >();

  const dayMap = new Map<
    string,
    {
      pickupCount: number;
      pickupDurSum: number;
      pickupDurCount: number;
      deliveryCount: number;
      deliveryDurSum: number;
      deliveryDurCount: number;
    }
  >();

  for (const d of dates) {
    dayMap.set(d, {
      pickupCount: 0,
      pickupDurSum: 0,
      pickupDurCount: 0,
      deliveryCount: 0,
      deliveryDurSum: 0,
      deliveryDurCount: 0,
    });
  }

  const ensureRider = (name: string) => {
    if (!riderMap.has(name)) {
      riderMap.set(name, {
        pickupCount: 0,
        pickupDurSum: 0,
        pickupDurCount: 0,
        deliveryCount: 0,
        deliveryDurSum: 0,
        deliveryDurCount: 0,
      });
    }
    return riderMap.get(name)!;
  };

  for (const o of orders || []) {
    const pickupRider = resolveRiderName(o, 'pickup', taskRiders, riderNameByUid);
    const deliveryRider = resolveRiderName(o, 'delivery', taskRiders, riderNameByUid);

    const pickTs = o.pickedUpAt || o.pickupCompletedAt;
    if (pickTs) {
      const pickMs = getTimestampMs(pickTs);
      if (pickMs >= startTs && pickMs < endTs) {
        if (selectedStaff === 'all' || pickupRider === selectedStaff) {
          const rec = ensureRider(pickupRider);
          rec.pickupCount += 1;

          const dayKey = localISODate(new Date(pickMs));
          const dayRec = dayMap.get(dayKey);
          if (dayRec) dayRec.pickupCount += 1;

          const oMs = getTimestampMs(o.createdAt);
          if (oMs > 0 && pickMs > oMs) {
            const min = Math.round((pickMs - oMs) / 60000);
            if (min > 0 && min < MAX_VALID_RIDER_MINUTES) {
              rec.pickupDurSum += min;
              rec.pickupDurCount += 1;
              if (dayRec) {
                dayRec.pickupDurSum += min;
                dayRec.pickupDurCount += 1;
              }
            }
          }
        }
      }
    }

    const delTs = o.deliveredAt || o.deliveryCompletedAt;
    if (delTs) {
      const delMs = getTimestampMs(delTs);
      if (delMs >= startTs && delMs < endTs) {
        if (selectedStaff === 'all' || deliveryRider === selectedStaff) {
          const rec = ensureRider(deliveryRider);
          rec.deliveryCount += 1;

          const dayKey = localISODate(new Date(delMs));
          const dayRec = dayMap.get(dayKey);
          if (dayRec) dayRec.deliveryCount += 1;

          const refMs = getTimestampMs(o.outForDeliveryAt || o.readyAt || o.createdAt);
          if (refMs > 0 && delMs > refMs) {
            const min = Math.round((delMs - refMs) / 60000);
            if (min > 0 && min < MAX_VALID_RIDER_MINUTES) {
              rec.deliveryDurSum += min;
              rec.deliveryDurCount += 1;
              if (dayRec) {
                dayRec.deliveryDurSum += min;
                dayRec.deliveryDurCount += 1;
              }
            }
          }
        }
      }
    }
  }

  let totalPickupCount = 0;
  let totalPickupDurSum = 0;
  let totalPickupDurCount = 0;
  let totalDeliveryCount = 0;
  let totalDeliveryDurSum = 0;
  let totalDeliveryDurCount = 0;

  const rows: RiderTimingRow[] = Array.from(riderMap.entries())
    .map(([staffName, d]) => {
      totalPickupCount += d.pickupCount;
      totalPickupDurSum += d.pickupDurSum;
      totalPickupDurCount += d.pickupDurCount;
      totalDeliveryCount += d.deliveryCount;
      totalDeliveryDurSum += d.deliveryDurSum;
      totalDeliveryDurCount += d.deliveryDurCount;
      return {
        staffName,
        pickupAvgMin: d.pickupDurCount > 0 ? Math.round(d.pickupDurSum / d.pickupDurCount) : null,
        pickupCount: d.pickupCount,
        deliveryAvgMin: d.deliveryDurCount > 0 ? Math.round(d.deliveryDurSum / d.deliveryDurCount) : null,
        deliveryCount: d.deliveryCount,
      };
    })
    .sort((a, b) => b.pickupCount + b.deliveryCount - (a.pickupCount + a.deliveryCount));

  const dayStats: RiderDayStat[] = dates.map((date) => {
    const d = dayMap.get(date)!;
    return {
      date,
      pickupCount: d.pickupCount,
      deliveryCount: d.deliveryCount,
      pickupAvgMin: d.pickupDurCount > 0 ? Math.round(d.pickupDurSum / d.pickupDurCount) : null,
      deliveryAvgMin: d.deliveryDurCount > 0 ? Math.round(d.deliveryDurSum / d.deliveryDurCount) : null,
    };
  });

  const overall =
    rows.length > 0
      ? {
          pickupAvg: totalPickupDurCount > 0 ? Math.round(totalPickupDurSum / totalPickupDurCount) : null,
          pickupCount: totalPickupCount,
          deliveryAvg: totalDeliveryDurCount > 0 ? Math.round(totalDeliveryDurSum / totalDeliveryDurCount) : null,
          deliveryCount: totalDeliveryCount,
          totalWorkers: rows.length,
        }
      : null;

  return { rows, dayStats, overall };
}
