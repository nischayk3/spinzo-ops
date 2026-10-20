import { OrderStatus } from '../types';

export const ACTIVE_STATUSES: OrderStatus[] = [
  'placed',
  'confirmed',
  'in_transit_to_store',
  'pickup_completed',
  'processing',
  'ready',
  'out_for_delivery',
];

export const INTAKE_STATUSES: OrderStatus[] = ['placed', 'confirmed'];

export interface FeedOrder {
  id: string;
  userId: string;
  vendorId?: string;
  status: OrderStatus;
  customerName?: string;
  customerPhone?: string;
  phone?: string;
  shortId?: string;
  pickupDetails?: {
    type?: string;
    scheduledDate?: string;
    scheduledTime?: string;
    isInstant?: boolean;
    slot?: string;
    time?: string;
    date?: string;
  };
  pickupSlot?: any;
  pickupDate?: string;
  pickupTime?: string;
  slot?: string;
  isInstant?: boolean;
  riderName?: string;
  deliveryDetails?: {
    scheduledDate?: string;
    scheduledTime?: string;
  };
  deliverySlot?: string;
  items?: Array<{
    serviceName?: string;
    serviceType?: string;
    serviceId?: string;
    name?: string;
    quantity?: number;
    unit?: string;
    weight?: number;
    ironingCount?: number;
    ironingEnabled?: boolean;
    clothesCount?: number;
    singleBlanketCount?: number;
    doubleBlanketCount?: number;
    blanketQuantity?: number;
    blanketType?: string;
    description?: string;
    specialInstructions?: string;
    isCreditItem?: boolean;
    totalPrice?: number;
  }>;
  totalAmount?: number;
  billDetails?: { total?: number; itemTotal?: number; deliveryFee?: number; gst?: number; discount?: number };
  paymentStatus?: string;
  paymentMode?: string;
  notes?: string;
  tokenNumber?: string;
  tokens?: Record<string, string>;
  pickupOTP?: string;
  storeOTP?: string;
  address?: { formattedAddress?: string; latitude?: number; longitude?: number } | any;
  latitude?: number;
  longitude?: number;
  processingStep?: string;
  deliveryDate?: string;
  deliveryTime?: string;
  deliveryOTP?: string;
  riderId?: string;
  deliveryRiderId?: string;
  createdAt?: any;
  isUrgent?: boolean;
  pickupNote?: string;
  garmentCount?: number;
  qualityPhotos?: any;
  packagingPhotos?: any;
  packagingProof?: any;
  proofUrl?: string;
  stageTimings?: Record<string, {
    step?: string;
    acceptedAt?: any;
    startedAt?: any;
    completedAt?: any;
    acceptToCompleteMin?: number;
    startToCompleteMin?: number;
    durationMs?: number;
    assignee?: string;
    assigneeName?: string;
    detergentAddedAt?: any;
    softenerAddedAt?: any;
  }>;
  opsDetails?: {
    garmentCount?: number;
    registeredCount?: number;
    qualityPhotos?: any;
    packagingPhotos?: any;
    stageTimings?: any;
    [key: string]: any;
  };
  opsMeta?: {
    isUrgent?: boolean;
    pickupNote?: string;
    urgentUpdatedAt?: any;
    urgentUpdatedBy?: string;
    pickupNoteUpdatedAt?: any;
    pickupNoteUpdatedBy?: string;
  };
}

export type PickupSlot = {
  type?: string;
  scheduledDate?: string;
  scheduledTime?: string;
  isInstant?: boolean;
};

// Admin-precedence price: billDetails.total is the canonical total on customer orders.
export const orderTotal = (o: FeedOrder): number =>
  o.billDetails?.total ?? o.totalAmount ?? 0;

export interface TokenChip {
  serviceKey?: string;
  serviceLabel?: string;
  token: string;
}

const SERVICE_LABEL_MAP: Record<string, string> = {
  wash_fold: 'Wash & Fold',
  wash_iron: 'Wash & Iron',
  ironing: 'Steam Iron',
  ironing_addon: 'Steam Iron',
  blanket_wash: 'Blanket Wash',
  blanket_wash_single: 'Blanket (Single)',
  blanket_wash_double: 'Blanket (Double)',
  shoe_clean: 'Shoe Clean',
  dry_clean: 'Dry Clean',
  premium_laundry: 'Premium Laundry',
};

export function parseOrderTokens(
  tokens?: Record<string, string> | null,
  tokenNumber?: string | null,
  items?: Array<{ serviceType?: string; serviceId?: string; serviceName?: string; name?: string }>
): TokenChip[] {
  const chips: TokenChip[] = [];

  if (tokens && typeof tokens === 'object' && Object.keys(tokens).length > 0) {
    for (const [key, val] of Object.entries(tokens)) {
      const tVal = String(val || '').trim();
      if (!tVal) continue;
      const cleanKey = key.toLowerCase();
      let label = SERVICE_LABEL_MAP[cleanKey];
      if (!label && items && items.length > 0) {
        const matchingItem = items.find(i => {
          const s = (i.serviceType || i.serviceId || i.serviceName || '').toLowerCase();
          return s.includes(cleanKey) || cleanKey.includes(s);
        });
        if (matchingItem) {
          label = matchingItem.serviceName || matchingItem.name || '';
        }
      }
      if (!label) {
        label = cleanKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      }
      chips.push({
        serviceKey: key,
        serviceLabel: label,
        token: tVal,
      });
    }
  }

  // If no tokens map found, but tokenNumber exists (could be single or comma-separated)
  if (chips.length === 0 && tokenNumber && String(tokenNumber).trim()) {
    const rawStr = String(tokenNumber).trim();
    const parts = rawStr.split(/[,/]+/).map(p => p.trim()).filter(Boolean);
    if (parts.length > 1 && items && items.length > 0) {
      parts.forEach((tok, idx) => {
        const item = items[idx];
        const rawLabel = item ? (item.serviceName || item.name || item.serviceType) : undefined;
        chips.push({
          token: tok.replace(/^#/, '').replace(/^Token\s*#?/i, '').trim(),
          serviceLabel: rawLabel ? String(rawLabel).replace(/\b\w/g, c => c.toUpperCase()) : undefined,
        });
      });
    } else {
      parts.forEach(tok => {
        chips.push({
          token: tok.replace(/^#/, '').replace(/^Token\s*#?/i, '').trim(),
        });
      });
    }
  }

  return chips;
}

export function formatItemSummary(it: any): { title: string; details: string; price?: string; notes?: string } {
  const rawService = it.serviceName || it.name || (it.serviceType ? it.serviceType.replace(/_/g, ' ') : 'Item');
  const title = String(rawService).replace(/\b\w/g, (c: string) => c.toUpperCase());

  const parts: string[] = [];
  const sid = (it.serviceId || it.serviceType || it.serviceName || '').toLowerCase();

  if (sid.includes('wash_fold') || sid.includes('wash & fold')) {
    const weight = it.weight || (it.unit === 'kg' && it.quantity ? it.quantity : 5);
    parts.push(`${weight} kg`);
    // Do not show default clothes estimate (18). Only show valid addon ironing count.
    if (it.ironingEnabled !== false && it.ironingCount > 0 && it.ironingCount !== 18) {
      parts.push(`+${it.ironingCount} ironed`);
    }
    if (it.isCreditItem) parts.push('Plan Credit');
  } else if (sid.includes('wash_iron') || sid.includes('wash & iron')) {
    const weight = it.weight || (it.unit === 'kg' && it.quantity ? it.quantity : 5);
    parts.push(`${weight} kg`);
    // Wash & Iron is strictly weight-based. Do NOT display default clothesCount (e.g. 18 pcs).
  } else if (sid.includes('ironing') || sid.includes('iron')) {
    const count = it.ironingCount || it.clothesCount || it.quantity;
    if (count) {
      if ((it.mediumCount && it.mediumCount > 0) || (it.heavyCount && it.heavyCount > 0)) {
        const medium = it.mediumCount || 0;
        const heavy = it.heavyCount || 0;
        const light = Math.max(0, count - medium - heavy);
        const tierParts: string[] = [];
        if (light > 0) tierParts.push(`${light} Light`);
        if (medium > 0) tierParts.push(`${medium} Med`);
        if (heavy > 0) tierParts.push(`${heavy} Heavy`);
        parts.push(`${count} pcs (${tierParts.join(', ')})`);
      } else {
        parts.push(`${count} pcs`);
      }
    }
  } else if (sid.includes('blanket')) {
    if (it.singleBlanketCount || it.doubleBlanketCount) {
      const bParts: string[] = [];
      if (it.singleBlanketCount) bParts.push(`${it.singleBlanketCount} Single`);
      if (it.doubleBlanketCount) bParts.push(`${it.doubleBlanketCount} Double`);
      parts.push(bParts.join(', '));
    } else if (it.blanketQuantity) {
      parts.push(`${it.blanketQuantity} blankets`);
    } else if (it.quantity) {
      parts.push(`${it.quantity} blankets`);
    }
  } else {
    if (it.weight) parts.push(`${it.weight} kg`);
    else if (it.quantity && it.quantity > 0) parts.push(`×${it.quantity}${it.unit ? ` ${it.unit}` : ''}`);
  }

  const details = parts.join(' • ');
  const price = typeof it.totalPrice === 'number' && it.totalPrice > 0 ? `₹${it.totalPrice}` : undefined;
  const notes = it.specialInstructions || it.notes || undefined;

  return { title, details, price, notes };
}

export const formatOrderItems = (o: FeedOrder): string =>
  (o.items || [])
    .map(i => {
      const { title, details } = formatItemSummary(i);
      return details ? `${title} (${details})` : title;
    })
    .join('\n');


export function isIntakeOrder(order: FeedOrder): boolean {
  return INTAKE_STATUSES.includes(order.status);
}

export function filterIntakeOrders(orders: FeedOrder[]): FeedOrder[] {
  return orders.filter(isIntakeOrder);
}

export function filterActiveOrders(orders: FeedOrder[]): FeedOrder[] {
  return orders.filter(o => ACTIVE_STATUSES.includes(o.status));
}

export function sortNewestFirst(orders: FeedOrder[]): FeedOrder[] {
  const getMs = (t: any): number => {
    if (!t) return 0;
    if (typeof t === 'number') return t;
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (typeof t.toDate === 'function') return t.toDate().getTime();
    if (t.seconds) return t.seconds * 1000;
    if (typeof t.getTime === 'function') return t.getTime();
    const parsed = new Date(t).getTime();
    return isNaN(parsed) ? 0 : parsed;
  };
  return [...orders].sort((a, b) => getMs(b.createdAt) - getMs(a.createdAt));
}

/**
 * Parses the start time from a slot string into minutes from midnight (0..1439).
 * Supports 12-hour (e.g. "5:00 PM - 6:00 PM", "8 - 9 pm", "12:00 PM"),
 * 24-hour (e.g. "17:00 - 18:00", "20:00 - 21:00"), and keywords ("instant").
 */
export function parseSlotStartMinutes(slotText?: string | null): number | null {
  if (!slotText || typeof slotText !== 'string') return null;
  const lower = slotText.toLowerCase().trim();
  if (!lower) return null;
  if (lower.includes('instant') || lower.includes('immediate')) {
    return 0;
  }
  if (lower === 'anytime') {
    return 1439;
  }

  // Extract start portion (before dash, en-dash, or 'to')
  const parts = lower.split(/[-–—]| to /);
  const startPart = parts[0].trim();

  // If startPart doesn't contain am/pm, look for meridiem in endPart (e.g. "5:00 - 6:00 pm")
  let assumedMeridiem: string | null = null;
  const endPart = parts[1] || '';
  if (!startPart.includes('am') && !startPart.includes('pm')) {
    if (endPart.includes('pm')) {
      const endHourMatch = endPart.match(/(\d{1,2})/);
      const endHour = endHourMatch ? parseInt(endHourMatch[1], 10) : 0;
      if (endHour === 12) {
        assumedMeridiem = 'am';
      } else {
        assumedMeridiem = 'pm';
      }
    } else if (endPart.includes('am')) {
      assumedMeridiem = 'am';
    }
  }

  const match = startPart.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match[3] || assumedMeridiem;

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  return hour * 60 + minute;
}

/**
 * Extracts year, month (1-indexed), and day from diverse date formats:
 * - ISO string: "2026-10-20" or "2026-10-20T..."
 * - DMY string: "20-10-2026" or "20/10/2026"
 * - Firestore Timestamp / Date object
 */
export function parseDeliveryDate(dateInput: any): { year: number; month: number; day: number } | null {
  if (!dateInput) return null;

  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) {
      return {
        year: parseInt(isoMatch[1], 10),
        month: parseInt(isoMatch[2], 10),
        day: parseInt(isoMatch[3], 10),
      };
    }
    const dmyMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (dmyMatch) {
      return {
        year: parseInt(dmyMatch[3], 10),
        month: parseInt(dmyMatch[2], 10),
        day: parseInt(dmyMatch[1], 10),
      };
    }
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      return {
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        day: d.getDate(),
      };
    }
    return null;
  }

  if (typeof dateInput.toDate === 'function') {
    const d = dateInput.toDate();
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  }
  if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    return { year: dateInput.getFullYear(), month: dateInput.getMonth() + 1, day: dateInput.getDate() };
  }

  return null;
}

/**
 * Calculates a millisecond timestamp representing when a scheduled delivery window begins.
 * Returns null for orders that have no scheduled date or time slot.
 */
export function getDeliveryTargetTimestamp(order: FeedOrder): number | null {
  const dateStr =
    order.deliveryDate ||
    (typeof (order as any).deliverySlot === 'string' &&
    (order as any).deliverySlot.includes('-') &&
    (order as any).deliverySlot.length === 10
      ? (order as any).deliverySlot
      : undefined) ||
    (order as any).deliverySlot?.date;

  const timeStr =
    order.deliveryTime ||
    (order as any).deliverySlot?.time ||
    (typeof (order as any).deliverySlot === 'string' &&
    !(order as any).deliverySlot.includes('-')
      ? (order as any).deliverySlot
      : undefined);

  if (!dateStr && !timeStr) return null;

  const parsedDate = parseDeliveryDate(dateStr);
  const startMinutes = parseSlotStartMinutes(timeStr);

  if (parsedDate) {
    // If specific time slot is given, use its start minute; otherwise default to end of day (23:59)
    // so dated orders with specific slots sort before unslotted dated orders.
    const hour = startMinutes !== null ? Math.floor(startMinutes / 60) : 23;
    const minute = startMinutes !== null ? startMinutes % 60 : 59;
    const d = new Date(parsedDate.year, parsedDate.month - 1, parsedDate.day, hour, minute, 0, 0);
    return d.getTime();
  }

  if (startMinutes !== null) {
    const now = new Date();
    const hour = Math.floor(startMinutes / 60);
    const minute = startMinutes % 60;
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
    return d.getTime();
  }

  return null;
}

/**
 * Arranges orders in the supervisor-ready section:
 * 1. Customers who have booked delivery slots are shown FIRST, sorted in ASCENDING order of delivery
 *    target time (e.g. 11:00 AM before 12:00 PM before 5:00 PM before 8:00 PM; today before tomorrow).
 * 2. Unscheduled orders (customers awaiting slot booking) are shown AFTER scheduled orders,
 *    prioritizing urgent orders and newest placements.
 */
export function sortReadyOrders(orders: FeedOrder[]): FeedOrder[] {
  const getMs = (t: any): number => {
    if (!t) return 0;
    if (typeof t === 'number') return t;
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (typeof t.toDate === 'function') return t.toDate().getTime();
    if (t.seconds) return t.seconds * 1000;
    if (typeof t.getTime === 'function') return t.getTime();
    const parsed = new Date(t).getTime();
    return isNaN(parsed) ? 0 : parsed;
  };

  return [...orders].sort((a, b) => {
    const targetA = getDeliveryTargetTimestamp(a);
    const targetB = getDeliveryTargetTimestamp(b);

    // 1. Both have scheduled delivery targets:
    // Ascending order: earliest delivery target first (e.g. 5:00 PM before 8:00 PM)
    if (targetA !== null && targetB !== null) {
      if (targetA !== targetB) {
        return targetA - targetB;
      }
      // Tie-break: urgent orders first
      if (a.isUrgent && !b.isUrgent) return -1;
      if (!a.isUrgent && b.isUrgent) return 1;
      // Tie-break: older orders first
      return getMs(a.createdAt) - getMs(b.createdAt);
    }

    // 2. Customers who have scheduled delivery ALWAYS come first
    if (targetA !== null && targetB === null) return -1;
    if (targetA === null && targetB !== null) return 1;

    // 3. Neither has scheduled delivery (awaiting customer slot booking):
    // Urgent first, then newest first
    if (a.isUrgent && !b.isUrgent) return -1;
    if (!a.isUrgent && b.isUrgent) return 1;
    return getMs(b.createdAt) - getMs(a.createdAt);
  });
}

export const timeAgo = (v: any): string => {
  if (!v) return '';
  let ms: number;
  if (typeof v.toDate === 'function') ms = v.toDate().getTime();
  else if (typeof v.seconds === 'number') ms = v.seconds * 1000;
  else ms = new Date(v).getTime();
  if (Number.isNaN(ms)) return '';
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
};

export const serviceSummary = (o: FeedOrder): string =>
  (o.items || []).map(i => i.serviceName || i.serviceType).filter(Boolean).join(', ') || 'Unknown';

const tsToMs = (t: any): number => {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t.toDate === 'function') return t.toDate().getTime();
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  if (typeof t.getTime === 'function') return t.getTime();
  const parsed = new Date(t).getTime();
  return isNaN(parsed) ? 0 : parsed;
};

export const formatInstantTime = (p: PickupSlot | null | undefined, createdAt?: any): string => {
  if (!p) return '';
  const explicit = p.scheduledTime || (p as any).time || (p as any).slot;
  if (explicit && String(explicit).trim() && !String(explicit).toLowerCase().includes('instant')) {
    return String(explicit).trim();
  }
  if (createdAt) {
    const ms = tsToMs(createdAt);
    if (ms > 0) {
      const end = new Date(ms + 45 * 60 * 1000); // 45-min SLA window
      const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
      return `Within 30–45 mins (by ${fmtTime(end)})`;
    }
  }
  return 'Within 30–45 mins';
};

// Accept FeedOrder (has pickupDetails) OR PickupSlot / task.pickupSlot directly.
export const slotLabel = (o: FeedOrder | PickupSlot | null | undefined): string => {
  if (!o) return '—';
  const p = (o as FeedOrder).pickupDetails || (o as PickupSlot);
  if (!p) return '—';

  if (p.isInstant) {
    const createdAt = (o as FeedOrder).createdAt;
    const timeStr = formatInstantTime(p, createdAt);
    return `Instant • ${timeStr}`;
  }

  return `${p.scheduledDate || ''} ${p.scheduledTime || ''}`.trim() || '—';
};

/**
 * Formats a date string (YYYY-MM-DD or DD/MM/YYYY) into a friendly label:
 * - "Today" if it matches current local date
 * - "Tomorrow" if it matches next calendar day
 * - "DayName, Day Month" (e.g. "Wed, 21 Oct") for future dates
 */
export function formatFriendlyDate(dateInput: any, now: Date = new Date()): string {
  if (!dateInput) return '';
  if (typeof dateInput === 'string') {
    const lower = dateInput.trim().toLowerCase();
    if (lower === 'today') return 'Today';
    if (lower === 'tomorrow') return 'Tomorrow';
  }

  const parsed = parseDeliveryDate(dateInput);
  if (!parsed) {
    if (typeof dateInput === 'string' && dateInput.trim()) return dateInput.trim();
    return '';
  }

  const todayYear = now.getFullYear();
  const todayMonth = now.getMonth() + 1;
  const todayDay = now.getDate();

  if (parsed.year === todayYear && parsed.month === todayMonth && parsed.day === todayDay) {
    return 'Today';
  }

  const tomorrow = new Date(todayYear, todayMonth - 1, todayDay + 1);
  if (
    parsed.year === tomorrow.getFullYear() &&
    parsed.month === (tomorrow.getMonth() + 1) &&
    parsed.day === tomorrow.getDate()
  ) {
    return 'Tomorrow';
  }

  const targetDate = new Date(parsed.year, parsed.month - 1, parsed.day);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = monthNames[parsed.month - 1] || '';
  const dayOfWeek = targetDate.toLocaleDateString('en-US', { weekday: 'short' });
  return `${dayOfWeek}, ${parsed.day} ${monthName}`;
}

export interface OrderPickupInfo {
  isInstant: boolean;
  type: 'instant' | 'scheduled';
  scheduledDate?: string;
  scheduledTime?: string;
  dateLabel: string;
  timeLabel: string;
  fullDisplay: string;
  badgeLabel: string;
  hasInfo: boolean;
}

/**
 * Analyzes and formats pickup information for an order:
 * Identifies if it is an Instant order or Scheduled order, and extracts the pickup window/slot and date.
 */
export function getPickupInfo(order: FeedOrder | any, now: Date = new Date()): OrderPickupInfo {
  if (!order) {
    return {
      isInstant: false,
      type: 'scheduled',
      dateLabel: '',
      timeLabel: '',
      fullDisplay: 'Standard Pickup',
      badgeLabel: 'Pickup',
      hasInfo: false,
    };
  }

  const raw = order.pickupDetails || order.pickupSlot || order.pickup || {};
  const isInstant = Boolean(
    raw.isInstant ||
    raw.type === 'instant' ||
    order.isInstant ||
    (typeof raw.scheduledTime === 'string' && raw.scheduledTime.toLowerCase().includes('instant')) ||
    (typeof raw.slot === 'string' && raw.slot.toLowerCase().includes('instant')) ||
    (typeof order.slot === 'string' && order.slot.toLowerCase().includes('instant'))
  );

  const rawDate = raw.scheduledDate || raw.date || order.pickupDate;
  const rawTime = raw.scheduledTime || raw.time || raw.slot || order.pickupTime || order.slot;

  const dateLabel = formatFriendlyDate(rawDate, now);

  let timeLabel = '';
  if (isInstant) {
    timeLabel = formatInstantTime(raw, order.createdAt);
  } else if (rawTime && String(rawTime).trim()) {
    timeLabel = String(rawTime).trim();
  }

  const hasInfo = Boolean(isInstant || rawDate || rawTime);

  let fullDisplay = '';
  if (isInstant) {
    fullDisplay = `⚡ Instant • ${timeLabel || 'Within 30–45 mins'}`;
  } else if (dateLabel && timeLabel) {
    fullDisplay = `📅 Scheduled • ${dateLabel}, ${timeLabel}`;
  } else if (dateLabel) {
    fullDisplay = `📅 Scheduled • ${dateLabel}`;
  } else if (timeLabel) {
    fullDisplay = `📅 Scheduled • ${timeLabel}`;
  } else {
    fullDisplay = 'Standard Pickup';
  }

  return {
    isInstant,
    type: isInstant ? 'instant' : 'scheduled',
    scheduledDate: rawDate ? String(rawDate) : undefined,
    scheduledTime: rawTime ? String(rawTime) : undefined,
    dateLabel,
    timeLabel,
    fullDisplay,
    badgeLabel: isInstant ? '⚡ Instant Pickup' : '📅 Scheduled Pickup',
    hasInfo,
  };
}

export const isToday = (t: any): boolean => {
  const ms = tsToMs(t);
  if (!ms) return false;
  const d = new Date(ms);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
};

export interface DayStats {
  revenue: number;
  orderCount: number;
  orderRevenue: number;
  placedCount: number;
  readyCount: number;
  outForDelivery: number;
  activeCount: number;
  cancelledCount: number;
}

export const dayRevenue = (orders: FeedOrder[]): DayStats => {
  const stats: DayStats = { revenue: 0, orderCount: 0, orderRevenue: 0, placedCount: 0, readyCount: 0, outForDelivery: 0, activeCount: 0, cancelledCount: 0 };
  for (const o of orders) {
    if (!o.createdAt || !isToday(o.createdAt)) continue;
    if (o.status === 'cancelled') {
      stats.cancelledCount += 1;
      continue;
    }
    const amt = orderTotal(o);
    stats.revenue += amt;
    stats.orderCount += 1;
    if (amt > 0) stats.orderRevenue += amt;
    if (o.status === 'placed') stats.placedCount += 1;
    if (o.status === 'ready') stats.readyCount += 1;
    if (o.status === 'out_for_delivery') stats.outForDelivery += 1;
  }
  stats.activeCount = orders.length;
  return stats;
};

export interface CustomerOrder {
  orderId: string;
  status: string;
  total: number;
  createdAt?: any;
  items?: FeedOrder['items'];
  deliveryDate?: string;
  deliveryTime?: string;
  tokenNumber?: string;
  tokens?: Record<string, string>;
}

export interface CustomerSummary {
  phone: string;
  name: string;
  totalOrders: number;
  totalRevenue: number;
  orders: CustomerOrder[];
}

export const customerIndex = (orders: FeedOrder[]): Map<string, CustomerSummary> => {
  const map = new Map<string, CustomerSummary>();
  for (const o of orders) {
    const phone = o.customerPhone || 'unknown';
    let c = map.get(phone);
    if (!c) {
      c = { phone, name: o.customerName || 'Unknown', totalOrders: 0, totalRevenue: 0, orders: [] };
      map.set(phone, c);
    }
    c.totalOrders += 1;
    c.totalRevenue += orderTotal(o);
    c.orders.push({
      orderId: o.id,
      status: o.status,
      total: orderTotal(o),
      createdAt: o.createdAt,
      items: o.items,
      deliveryDate: o.deliveryDate,
      deliveryTime: o.deliveryTime,
      tokenNumber: o.tokenNumber,
      tokens: o.tokens,
    });
    if (o.customerName && o.customerName !== 'Unknown') c.name = o.customerName;
  }
  // Newest first
  map.forEach(c => c.orders.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt)));
  return map;
};

/**
 * Robust search matcher across token numbers, service tokens, order IDs,
 * phone numbers, customer names, and notes.
 */
export function matchOrderSearch(o: FeedOrder, query: string): boolean {
  if (!query || !query.trim()) return true;
  const rawQ = query.trim();
  const lowerQ = rawQ.toLowerCase();

  // Clean token candidate: strips "#", "token", "tokens", "tk", "t-"
  const cleanToken = lowerQ
    .replace(/^#+/, '')
    .replace(/^tokens?[\s\-#]*/i, '')
    .replace(/^tks?[\s\-#]*/i, '')
    .replace(/^t[\s\-#]+/i, '')
    .trim();

  // 1. Direct Token Number match
  if (cleanToken && o.tokenNumber) {
    const tn = String(o.tokenNumber).toLowerCase().trim();
    if (tn === cleanToken || tn.includes(cleanToken)) return true;
  }

  // 2. Tokens Record match (service-specific tokens)
  if (cleanToken && o.tokens && typeof o.tokens === 'object') {
    const hasToken = Object.values(o.tokens).some(t => {
      const s = String(t).toLowerCase().trim();
      return s === cleanToken || s.includes(cleanToken);
    });
    if (hasToken) return true;
  }

  // 3. Token chips parsed from items/services
  if (cleanToken) {
    const chips = parseOrderTokens(o.tokens, o.tokenNumber, o.items);
    if (chips.some(c => c.token.toLowerCase() === cleanToken || c.token.toLowerCase().includes(cleanToken))) {
      return true;
    }
  }

  // 4. Order ID (full or short 6-digit)
  if (o.id) {
    const lowerId = o.id.toLowerCase();
    if (lowerId.includes(lowerQ)) return true;
    if (cleanToken && lowerId.slice(-6).includes(cleanToken)) return true;
  }

  // 5. Customer Phone
  if (o.customerPhone) {
    const digitsOnly = lowerQ.replace(/\D/g, '');
    if (digitsOnly && o.customerPhone.includes(digitsOnly)) return true;
    if (o.customerPhone.toLowerCase().includes(lowerQ)) return true;
  }

  // 6. Customer Name
  if (o.customerName && o.customerName.toLowerCase().includes(lowerQ)) {
    return true;
  }

  // 7. Pickup Note or Instructions
  if (o.pickupNote && o.pickupNote.toLowerCase().includes(lowerQ)) return true;
  if (o.notes && o.notes.toLowerCase().includes(lowerQ)) return true;

  return false;
}

/**
 * Formats a phone number for quick readability by delivery riders.
 * Indian 10-digit mobile numbers are formatted as `XXXXX XXXXX` (e.g. `98765 43210`),
 * ensuring the last 4 digits are distinct and easy to read at apartment gates / intercoms.
 */
export function formatDisplayPhone(phone?: string | null): string {
  if (!phone) return '';
  const trimmed = String(phone).trim();
  const digits = trimmed.replace(/\D/g, '');

  if (digits.length === 10) {
    return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    const main = digits.slice(2);
    return `${main.slice(0, 5)} ${main.slice(5)}`;
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    const main = digits.slice(1);
    return `${main.slice(0, 5)} ${main.slice(5)}`;
  }

  return trimmed;
}

