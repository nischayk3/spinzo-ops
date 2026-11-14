import { slotLabel, formatFriendlyDate, parseDeliveryDate } from './orderFeed';

export interface OpsTask {
  id: string;
  orderId: string;
  userId?: string;
  vendorId?: string;
  assignee: string;
  assignedBy?: string;
  status: 'pending' | 'picked_up' | 'cancelled' | string;
  orderStatus?: string;
  pickupAddress?: string;
  pickupSlot?: { type?: string; scheduledDate?: string; scheduledTime?: string; isInstant?: boolean; isExpress?: boolean } | null;
  tokenNumber?: string;
  tokens?: Record<string, string>;
  pickupOTP?: string;
  assignedAt?: unknown;
  acceptedAt?: unknown;
  createdAt?: unknown;
  bundleCount?: number;
  bundleLabels?: { seq: number; qr: string }[];
  deliveryOTP?: string | null;
  customerName?: string;
  customerPhone?: string;
  items?: any[];
  totalAmount?: number;
  billDetails?: Record<string, any>;
  paymentStatus?: string;
  paymentMode?: string;
  notes?: string;
  latitude?: number;
  longitude?: number;
  pickedUpAt?: any;
  cancelledAt?: any;
  proofUrl?: string | null;
  isUrgent?: boolean;
  isExpress?: boolean;
  pickupNote?: string;
}

export function parseOpsTask(id: string, snapData: Record<string, any> | null | undefined): OpsTask {
  const d = snapData ?? {};
  const computedExpress = Boolean(
    d.isExpress ||
    d.turnaroundMode === 'express_6_8h' ||
    d.pickupSlot?.isExpress ||
    (Array.isArray(d.items) && d.items.some((i: any) => i?.isExpress))
  );
  return {
    id,
    orderId: d.orderId ?? id,
    userId: d.userId ?? undefined,
    assignee: d.assignee ?? '',
    assignedBy: d.assignedBy ?? undefined,
    status: d.status ?? 'pending',
    pickupAddress: d.pickupAddress ?? undefined,
    // Real snapshots express a missing slot as explicit null; an absent snapshot leaves it undefined.
    pickupSlot: snapData ? (d.pickupSlot ?? null) : undefined,
    tokenNumber: d.tokenNumber ?? undefined,
    tokens: d.tokens ?? undefined,
    pickupOTP: d.pickupOTP ?? undefined,
    assignedAt: d.assignedAt ?? undefined,
    acceptedAt: d.acceptedAt ?? undefined,
    createdAt: d.createdAt ?? undefined,
    bundleCount: d.bundleCount ?? undefined,
    bundleLabels: d.bundleLabels ?? undefined,
    deliveryOTP: d.deliveryOTP ?? undefined,
    customerName: d.customerName ?? undefined,
    customerPhone: d.customerPhone ?? undefined,
    items: d.items ?? undefined,
    totalAmount: typeof d.totalAmount === 'number' ? d.totalAmount : undefined,
    paymentStatus: d.paymentStatus ?? undefined,
    paymentMode: d.paymentMode ?? undefined,
    notes: d.notes ?? undefined,
    latitude: d.latitude ?? undefined,
    longitude: d.longitude ?? undefined,
    pickedUpAt: d.pickedUpAt ?? undefined,
    cancelledAt: d.cancelledAt ?? undefined,
    proofUrl: d.proofUrl ?? undefined,
    isUrgent: typeof d.isUrgent === 'boolean' ? d.isUrgent : (d.opsMeta?.isUrgent ?? undefined),
    ...(computedExpress ? { isExpress: true } : {}),
    ...(d.vendorId ? { vendorId: d.vendorId } : {}),
    ...(d.billDetails ? { billDetails: d.billDetails } : {}),
    pickupNote: typeof d.pickupNote === 'string' ? d.pickupNote : (d.opsMeta?.pickupNote ?? undefined),
  };
}

export function isPending(task: Pick<OpsTask, 'status'>): boolean {
  return task.status === 'pending' || task.status === 'assigned' || task.status === 'in_transit_to_store' || task.status === 'out_for_delivery';
}

function assignedAtToKey(ts: unknown): string {
  if (!ts) return '0';
  if (typeof ts === 'number') return String(ts);
  if (typeof (ts as any).toMillis === 'function') return String((ts as any).toMillis());
  if (typeof (ts as any).seconds === 'number') return String((ts as any).seconds * 1000);
  if (typeof (ts as any)._seconds === 'number') return String((ts as any)._seconds * 1000);
  const parsed = Date.parse(String(ts));
  return Number.isNaN(parsed) ? '0' : String(parsed);
}

/**
 * Unique composite key per task type + order + assignment timestamp so:
 * 1) Pickup (`ops_tasks/{orderId}`) and Delivery (`ops_delivery_tasks/{orderId}`) never collide.
 * 2) Reassigned / rescheduled tasks with a new `assignedAt` always alert the rider again.
 */
export function taskAlertKey(
  task: { id?: string; orderId?: string; assignedAt?: unknown },
  kind: 'pickup' | 'delivery' = 'pickup'
): string {
  const baseId = task.orderId || task.id || '';
  return `${kind}:${baseId}:${assignedAtToKey(task.assignedAt)}`;
}

export function shouldAnnounce(
  task: Pick<OpsTask, 'id' | 'status'> & { orderId?: string; assignedAt?: unknown; acceptedAt?: unknown },
  seenIds: Set<string>,
  kind: 'pickup' | 'delivery' = 'pickup'
): boolean {
  if (!task || !task.id) return false;
  const compositeKey = taskAlertKey(task, kind);
  if (seenIds.has(compositeKey)) return false;
  // Backward-compat: if caller stored bare task.id without composite key and assignedAt is absent
  if (!task.assignedAt && seenIds.has(task.id)) return false;
  // If the task has already been accepted, never announce it
  if (task.acceptedAt) return false;
  return isPending(task);
}

export function pickupLabel(task: Pick<OpsTask, 'pickupSlot'> & { createdAt?: any }): string {
  if (!task.pickupSlot) return '—';
  if ((task.pickupSlot as any).isInstant) {
    return slotLabel({ pickupDetails: task.pickupSlot, createdAt: task.createdAt } as any);
  }
  return slotLabel(task.pickupSlot as any);
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatShortCalendarDate(dateInput: any, now?: Date): string {
  const parsed = parseDeliveryDate(dateInput);
  if (!parsed) {
    if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
      return `${dateInput.getDate()} ${MONTH_NAMES[dateInput.getMonth()] || ''}`.trim();
    }
    return '';
  }
  void now;
  return `${parsed.day} ${MONTH_NAMES[parsed.month - 1] || ''}`.trim();
}

export function formatRiderDateLabel(rawDate?: any, now: Date = new Date()): string {
  if (!rawDate) return '';
  let friendlyInput = rawDate;
  if (rawDate instanceof Date && !isNaN(rawDate.getTime())) {
    const y = rawDate.getFullYear();
    const m = String(rawDate.getMonth() + 1).padStart(2, '0');
    const d = String(rawDate.getDate()).padStart(2, '0');
    friendlyInput = `${y}-${m}-${d}`;
  }
  const friendly = formatFriendlyDate(friendlyInput, now);
  if (!friendly) return '';
  if (friendly === 'Today' || friendly === 'Tomorrow') {
    const shortCal = formatShortCalendarDate(friendlyInput, now);
    return shortCal ? `${friendly}, ${shortCal}` : friendly;
  }
  return friendly;
}

function timestampToDate(ts: unknown): Date | null {
  if (!ts) return null;
  if (ts instanceof Date) return isNaN(ts.getTime()) ? null : ts;
  if (typeof (ts as any).toDate === 'function') return (ts as any).toDate();
  if (typeof (ts as any).seconds === 'number') return new Date((ts as any).seconds * 1000);
  if (typeof (ts as any)._seconds === 'number') return new Date((ts as any)._seconds * 1000);
  if (typeof ts === 'number' || typeof ts === 'string') {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export interface RiderSlotInput {
  type: 'pickup' | 'delivery';
  pickupSlot?: string;
  slot?: string;
  pickupDate?: string | null;
  pickupTime?: string | null;
  isInstantPickup?: boolean;
  deliveryDate?: string | null;
  deliveryTime?: string | null;
  createdAt?: unknown;
}

export function buildRiderSlotDisplay(
  p: RiderSlotInput,
  now: Date = new Date()
): { isInstant: boolean; label: string; text: string } {
  const isPickup = p.type === 'pickup';
  const rawSlotText = (p.pickupSlot || p.slot || '').trim();
  const isInstant = Boolean(
    p.isInstantPickup ||
    (rawSlotText && rawSlotText.toLowerCase().includes('instant'))
  );

  if (isPickup) {
    const datePart =
      formatRiderDateLabel(p.pickupDate, now) ||
      (isInstant ? formatRiderDateLabel(timestampToDate(p.createdAt), now) : '');

    const rawPickupTime = (p.pickupTime || '').trim();
    const isGenericInstantText = /^instant(\s*pickup)?$/i.test(rawPickupTime);
    let timePart = rawPickupTime && !isGenericInstantText ? rawPickupTime : '';

    if (!timePart && rawSlotText) {
      let cleaned = rawSlotText.replace(/^Instant\s*[•\-–]\s*/i, '').trim();
      const isoPrefix = cleaned.match(/^(\d{4}-\d{1,2}-\d{1,2})[\s,•\-–]*(.*)$/);
      if (isoPrefix) {
        const extractedDate = formatRiderDateLabel(isoPrefix[1], now);
        cleaned = isoPrefix[2]?.trim() || '';
        const finalDate = datePart || extractedDate;
        const parts = [finalDate, cleaned].filter(Boolean);
        return {
          isInstant,
          label: isInstant ? '⚡ Instant' : 'Pickup Window',
          text: parts.join(' • ') || rawSlotText,
        };
      }
      timePart = cleaned;
    }

    const parts = [datePart, timePart].filter(Boolean);
    return {
      isInstant,
      label: isInstant ? '⚡ Instant' : 'Pickup Window',
      text: parts.join(' • ') || rawSlotText.replace(/^Instant\s*[•\-–]\s*/i, '').trim(),
    };
  }

  const dDate = formatRiderDateLabel(p.deliveryDate, now);
  const dTime = (p.deliveryTime || '').trim();
  if (dDate || dTime) {
    return {
      isInstant: false,
      label: 'Delivery Window',
      text: [dDate, dTime].filter(Boolean).join(' • '),
    };
  }

  if (rawSlotText) {
    const isoPrefix = rawSlotText.match(/^(\d{4}-\d{1,2}-\d{1,2})[\s,•\-–]*(.*)$/);
    if (isoPrefix) {
      const fDate = formatRiderDateLabel(isoPrefix[1], now);
      const rest = isoPrefix[2]?.trim();
      return {
        isInstant: false,
        label: 'Delivery Window',
        text: [fDate, rest].filter(Boolean).join(' • '),
      };
    }
  }

  return {
    isInstant: false,
    label: 'Delivery Window',
    text: rawSlotText,
  };
}
