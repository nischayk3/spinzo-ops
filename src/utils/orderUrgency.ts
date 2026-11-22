import {
  isExpressOrder,
  parseDeliveryDate,
  parseSlotStartMinutes,
} from './orderFeed';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export type UrgencySeverity = 'critical' | 'high' | 'medium' | 'normal';
export type OpsSortMode = 'ops_fifo' | 'pickup_schedule' | 'delivery_schedule';

export interface OrderTimestamps {
  placedMs: number | null;
  pickedUpMs: number | null;
  isActualPickup: boolean;
  readyMs: number | null;
  deliveredMs: number | null;
}

export interface OrderUrgencyInfo {
  isExpress: boolean;
  pickedUpMs: number | null;
  isActualPickup: boolean;
  pickedUpShort: string;
  ageMs: number;
  ageHours: number;
  ageLabel: string;
  deadlineMs: number | null;
  remainingMs: number | null;
  slaLabel: string;
  severity: UrgencySeverity;
  isOverdue: boolean;
  isStalled48h: boolean;
  isAging24h: boolean;
  priorityScore: number;
}

/**
 * Safely parses Firestore Timestamp (toMillis, toDate, seconds/_seconds),
 * ISO string, Date, or epoch milliseconds into epoch ms.
 */
export function toEpochMs(ts: unknown): number | null {
  if (ts === null || ts === undefined) return null;

  if (typeof ts === 'number') {
    return Number.isFinite(ts) && ts > 0 ? ts : null;
  }

  if (ts instanceof Date) {
    const ms = ts.getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  if (typeof ts === 'string') {
    const trimmed = ts.trim();
    if (!trimmed) return null;
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) ? ms : null;
  }

  if (typeof ts === 'object') {
    const obj = ts as Record<string, any>;
    if (typeof obj.toMillis === 'function') {
      const ms = obj.toMillis();
      return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
    }
    if (typeof obj.toDate === 'function') {
      const d = obj.toDate();
      const ms = d instanceof Date ? d.getTime() : NaN;
      return Number.isFinite(ms) ? ms : null;
    }
    const secs = typeof obj.seconds === 'number'
      ? obj.seconds
      : typeof obj._seconds === 'number'
        ? obj._seconds
        : null;
    if (secs !== null && Number.isFinite(secs)) {
      const nanos = typeof obj.nanoseconds === 'number'
        ? obj.nanoseconds
        : typeof obj._nanoseconds === 'number'
          ? obj._nanoseconds
          : 0;
      return secs * 1000 + Math.floor((Number.isFinite(nanos) ? nanos : 0) / 1_000_000);
    }
  }

  return null;
}

export function getOrderTimestamps(order?: any): OrderTimestamps {
  const placedMs = toEpochMs(order?.createdAt);
  const actualPickupMs =
    toEpochMs(order?.pickedUpAt) ??
    toEpochMs(order?.pickupCompletedAt) ??
    toEpochMs(order?.inTransitAt);
  const isActualPickup = actualPickupMs !== null;
  const pickedUpMs = actualPickupMs ?? placedMs;
  const readyMs = toEpochMs(order?.readyAt);
  const deliveredMs = toEpochMs(order?.deliveredAt);

  return {
    placedMs,
    pickedUpMs,
    isActualPickup,
    readyMs,
    deliveredMs,
  };
}

/**
 * Formats an epoch timestamp concisely relative to `nowMs`:
 * - "Today, 10:21 AM"
 * - "Yesterday, 9:21 PM"
 * - "20 Nov, 9:21 PM"
 * Returns "—" if ms is null or invalid.
 */
export function formatCompactDateTime(ms: number | null, nowMs = Date.now()): string {
  if (ms === null || !Number.isFinite(ms)) return '—';

  const d = new Date(ms);
  const now = new Date(nowMs);

  let hours = d.getHours();
  const minutes = d.getMinutes();
  const meridiem = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const minStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
  const timeStr = `${hours}:${minStr} ${meridiem}`;

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (isSameDay(d, now)) {
    return `Today, ${timeStr}`;
  }

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (isSameDay(d, yesterday)) {
    return `Yesterday, ${timeStr}`;
  }

  const day = d.getDate();
  const month = MONTHS_SHORT[d.getMonth()];
  return `${day} ${month}, ${timeStr}`;
}

/**
 * Formats an absolute duration concisely:
 * "45m", "2h", "2h 25m", "1d 14h", "2d 3h".
 */
export function formatCompactDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '0m';
  const totalMin = Math.floor(Math.abs(ms) / MINUTE_MS);

  if (totalMin < 60) {
    return `${totalMin}m`;
  }

  if (totalMin < 24 * 60) {
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }

  const days = Math.floor(totalMin / (24 * 60));
  const remHours = Math.floor((totalMin % (24 * 60)) / 60);
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

/**
 * Parses the end minute of a time slot string (e.g. "5:00 PM - 6:00 PM" -> 1080).
 * Falls back to parseSlotStartMinutes if there is no explicit range end.
 */
function parseSlotEndMinutes(slotText?: string | null): number | null {
  if (!slotText || typeof slotText !== 'string') return null;
  const trimmed = slotText.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/[-–—]| to /i);
  if (parts.length >= 2 && parts[1].trim()) {
    const endMinutes = parseSlotStartMinutes(parts[1].trim());
    if (endMinutes !== null) return endMinutes;
  }
  return parseSlotStartMinutes(trimmed);
}

function getDeliverySlotEndMs(order: any): number | null {
  if (!order) return null;
  const dateInput =
    order.deliveryDate ||
    order.deliveryDetails?.scheduledDate ||
    (typeof order.deliverySlot === 'object' ? order.deliverySlot?.date : undefined);

  if (!dateInput) return null;
  const parsedDate = parseDeliveryDate(dateInput);
  if (!parsedDate) return null;

  const timeStr =
    order.deliveryTime ||
    order.deliveryDetails?.scheduledTime ||
    (typeof order.deliverySlot === 'string'
      ? order.deliverySlot
      : order.deliverySlot?.time);

  const endMinutes = parseSlotEndMinutes(timeStr);
  const hour = endMinutes !== null ? Math.floor(endMinutes / 60) : 23;
  const minute = endMinutes !== null ? endMinutes % 60 : 59;

  const ms = new Date(
    parsedDate.year,
    parsedDate.month - 1,
    parsedDate.day,
    hour,
    minute,
    0,
    0,
  ).getTime();

  return Number.isFinite(ms) ? ms : null;
}

function getDeliveryScheduleStartMs(order: any): number | null {
  if (!order) return null;
  const dateInput =
    order.deliveryDate ||
    order.deliveryDetails?.scheduledDate ||
    (typeof order.deliverySlot === 'object' ? order.deliverySlot?.date : undefined);

  if (!dateInput) return null;
  const parsedDate = parseDeliveryDate(dateInput);
  if (!parsedDate) return null;

  const timeStr =
    order.deliveryTime ||
    order.deliveryDetails?.scheduledTime ||
    (typeof order.deliverySlot === 'string'
      ? order.deliverySlot
      : order.deliverySlot?.time);

  const startMinutes = parseSlotStartMinutes(timeStr);
  const hour = startMinutes !== null ? Math.floor(startMinutes / 60) : 23;
  const minute = startMinutes !== null ? startMinutes % 60 : 59;

  const ms = new Date(
    parsedDate.year,
    parsedDate.month - 1,
    parsedDate.day,
    hour,
    minute,
    0,
    0,
  ).getTime();

  return Number.isFinite(ms) ? ms : null;
}

function isInstantPickup(order: any): boolean {
  if (!order) return false;
  if (order.isInstant || order.pickupDetails?.isInstant || order.pickupSlot?.isInstant) {
    return true;
  }
  const slotText =
    order.pickupDetails?.type ||
    order.pickupDetails?.scheduledTime ||
    order.pickupDetails?.slot ||
    order.pickupTime ||
    (typeof order.pickupSlot === 'string' ? order.pickupSlot : order.pickupSlot?.type || order.pickupSlot?.scheduledTime) ||
    order.slot ||
    '';
  return typeof slotText === 'string' && /instant|immediate/i.test(slotText);
}

function getPickupScheduleMs(order: any): number | null {
  if (!order) return null;
  const dateInput =
    order.pickupDate ||
    order.pickupDetails?.scheduledDate ||
    order.pickupDetails?.date ||
    (typeof order.pickupSlot === 'object' ? order.pickupSlot?.scheduledDate || order.pickupSlot?.date : undefined);

  const timeStr =
    order.pickupTime ||
    order.pickupDetails?.scheduledTime ||
    order.pickupDetails?.slot ||
    order.pickupDetails?.time ||
    (typeof order.pickupSlot === 'string' ? order.pickupSlot : order.pickupSlot?.scheduledTime || order.pickupSlot?.time) ||
    order.slot;

  const parsedDate = parseDeliveryDate(dateInput);
  if (parsedDate) {
    const startMinutes = parseSlotStartMinutes(timeStr);
    const hour = startMinutes !== null ? Math.floor(startMinutes / 60) : 23;
    const minute = startMinutes !== null ? startMinutes % 60 : 59;
    const ms = new Date(
      parsedDate.year,
      parsedDate.month - 1,
      parsedDate.day,
      hour,
      minute,
      0,
      0,
    ).getTime();
    if (Number.isFinite(ms)) return ms;
  }

  return toEpochMs(order.createdAt);
}

const TIER_STEP = 1e14;
const MISSING_TS_FALLBACK = 9e13;

export function computeOrderUrgency(order?: any, nowMs = Date.now()): OrderUrgencyInfo {
  const isExpress = isExpressOrder(order);
  const { pickedUpMs, isActualPickup } = getOrderTimestamps(order);
  const anchorMs = pickedUpMs;

  const pickedUpShort = formatCompactDateTime(anchorMs, nowMs);
  const ageMs = anchorMs !== null ? Math.max(0, nowMs - anchorMs) : 0;
  const ageHours = ageMs / HOUR_MS;
  const ageLabel = anchorMs !== null ? `${formatCompactDuration(ageMs)} ago` : '—';

  let deadlineMs: number | null = null;
  if (anchorMs !== null) {
    if (isExpress) {
      deadlineMs = anchorMs + 8 * HOUR_MS;
    } else {
      const defaultDeadlineMs = anchorMs + 24 * HOUR_MS;
      const slotEndMs = getDeliverySlotEndMs(order);
      deadlineMs = slotEndMs !== null && slotEndMs > defaultDeadlineMs
        ? slotEndMs
        : defaultDeadlineMs;
    }
  }

  const remainingMs = deadlineMs !== null ? deadlineMs - nowMs : null;
  const isOverdue = remainingMs !== null && remainingMs < 0;
  const isStalled48h = ageHours >= 48;
  const isAging24h = ageHours >= 24;

  let slaLabel = '—';
  if (isStalled48h) {
    slaLabel = '48h+ Stalled';
  } else if (isOverdue && remainingMs !== null) {
    slaLabel = `Overdue ${formatCompactDuration(Math.abs(remainingMs))}`;
  } else if (remainingMs !== null) {
    slaLabel = `${formatCompactDuration(remainingMs)} left`;
  }

  let severity: UrgencySeverity = 'normal';
  if (isOverdue || isStalled48h) {
    severity = 'critical';
  } else if (isExpress || isAging24h || (remainingMs !== null && remainingMs <= 2 * HOUR_MS)) {
    severity = 'high';
  } else if (remainingMs !== null && remainingMs <= 6 * HOUR_MS) {
    severity = 'medium';
  }

  // Strict tier-based ops priority score (lower = higher priority):
  // Tier 0: Overdue or >= 48h stalled (most overdue / oldest pickup first)
  // Tier 1: Express 6-8h not yet overdue (least remaining time first)
  // Tier 2: Aging >= 24h (oldest pickup first)
  // Tier 3: Normal (oldest pickup first - FIFO)
  let priorityScore: number;
  if (isOverdue || isStalled48h) {
    const overdueKey = remainingMs !== null && remainingMs < 0 ? remainingMs : -ageMs;
    priorityScore = overdueKey;
  } else if (isExpress) {
    priorityScore = TIER_STEP + (remainingMs ?? MISSING_TS_FALLBACK);
  } else if (isAging24h) {
    priorityScore = 2 * TIER_STEP + (anchorMs ?? MISSING_TS_FALLBACK);
  } else {
    priorityScore = 3 * TIER_STEP + (anchorMs ?? MISSING_TS_FALLBACK);
  }

  return {
    isExpress,
    pickedUpMs,
    isActualPickup,
    pickedUpShort,
    ageMs,
    ageHours,
    ageLabel,
    deadlineMs,
    remainingMs,
    slaLabel,
    severity,
    isOverdue,
    isStalled48h,
    isAging24h,
    priorityScore,
  };
}

export function compareOrdersForOps(
  aOrder: any,
  bOrder: any,
  mode: OpsSortMode,
  nowMs = Date.now(),
): number {
  if (mode === 'ops_fifo') {
    const aUrg = computeOrderUrgency(aOrder, nowMs);
    const bUrg = computeOrderUrgency(bOrder, nowMs);
    return aUrg.priorityScore - bUrg.priorityScore;
  }

  if (mode === 'pickup_schedule') {
    const aFast = isExpressOrder(aOrder) || isInstantPickup(aOrder) ? 0 : 1;
    const bFast = isExpressOrder(bOrder) || isInstantPickup(bOrder) ? 0 : 1;
    if (aFast !== bFast) return aFast - bFast;

    const aMs = getPickupScheduleMs(aOrder) ?? Number.MAX_SAFE_INTEGER;
    const bMs = getPickupScheduleMs(bOrder) ?? Number.MAX_SAFE_INTEGER;
    if (aMs !== bMs) return aMs - bMs;

    const aCreated = toEpochMs(aOrder?.createdAt) ?? Number.MAX_SAFE_INTEGER;
    const bCreated = toEpochMs(bOrder?.createdAt) ?? Number.MAX_SAFE_INTEGER;
    return aCreated - bCreated;
  }

  // delivery_schedule: Overdue/Express first, then earliest deliveryDate/deliveryTime or pickedUpMs ascending
  const aUrg = computeOrderUrgency(aOrder, nowMs);
  const bUrg = computeOrderUrgency(bOrder, nowMs);

  const aBucket = aUrg.isOverdue || aUrg.isStalled48h ? 0 : aUrg.isExpress ? 1 : 2;
  const bBucket = bUrg.isOverdue || bUrg.isStalled48h ? 0 : bUrg.isExpress ? 1 : 2;
  if (aBucket !== bBucket) return aBucket - bBucket;

  if (aBucket === 0) {
    return aUrg.priorityScore - bUrg.priorityScore;
  }

  const aTarget = getDeliveryScheduleStartMs(aOrder) ?? aUrg.pickedUpMs ?? Number.MAX_SAFE_INTEGER;
  const bTarget = getDeliveryScheduleStartMs(bOrder) ?? bUrg.pickedUpMs ?? Number.MAX_SAFE_INTEGER;
  if (aTarget !== bTarget) return aTarget - bTarget;

  return aUrg.priorityScore - bUrg.priorityScore;
}
