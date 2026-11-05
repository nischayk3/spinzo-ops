import { slotLabel } from './orderFeed';

export interface OpsTask {
  id: string;
  orderId: string;
  assignee: string;
  assignedBy?: string;
  status: 'pending' | 'picked_up' | 'cancelled' | string;
  pickupAddress?: string;
  pickupSlot?: { type?: string; scheduledDate?: string; scheduledTime?: string; isInstant?: boolean } | null;
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
  paymentStatus?: string;
  paymentMode?: string;
  notes?: string;
  latitude?: number;
  longitude?: number;
  pickedUpAt?: any;
  cancelledAt?: any;
  proofUrl?: string | null;
  isUrgent?: boolean;
  pickupNote?: string;
}

export function parseOpsTask(id: string, snapData: Record<string, any> | null | undefined): OpsTask {
  const d = snapData ?? {};
  return {
    id,
    orderId: d.orderId ?? id,
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
