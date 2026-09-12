import { slotLabel } from './orderFeed';

export interface OpsTask {
  id: string;
  orderId: string;
  assignee: string;
  status: 'pending' | 'picked_up' | 'cancelled' | string;
  pickupAddress?: string;
  pickupSlot?: { type?: string; scheduledDate?: string; scheduledTime?: string; isInstant?: boolean } | null;
  tokenNumber?: string;
  pickupOTP?: string;
  assignedAt?: unknown;
  acceptedAt?: unknown;
  createdAt?: unknown;
  bundleCount?: number;
  bundleLabels?: { seq: number; qr: string }[];
  deliveryOTP?: string | null;
  customerName?: string;
  customerPhone?: string;
  pickedUpAt?: any;
  cancelledAt?: any;
  proofUrl?: string | null;
}

export function parseOpsTask(id: string, snapData: Record<string, any> | null | undefined): OpsTask {
  const d = snapData ?? {};
  return {
    id,
    orderId: d.orderId ?? id,
    assignee: d.assignee ?? '',
    status: d.status ?? 'pending',
    pickupAddress: d.pickupAddress ?? undefined,
    // Real snapshots express a missing slot as explicit null; an absent snapshot leaves it undefined.
    pickupSlot: snapData ? (d.pickupSlot ?? null) : undefined,
    tokenNumber: d.tokenNumber ?? undefined,
    pickupOTP: d.pickupOTP ?? undefined,
    assignedAt: d.assignedAt ?? undefined,
    acceptedAt: d.acceptedAt ?? undefined,
    createdAt: d.createdAt ?? undefined,
    bundleCount: d.bundleCount ?? undefined,
    bundleLabels: d.bundleLabels ?? undefined,
    deliveryOTP: d.deliveryOTP ?? undefined,
    customerName: d.customerName ?? undefined,
    customerPhone: d.customerPhone ?? undefined,
    pickedUpAt: d.pickedUpAt ?? undefined,
    cancelledAt: d.cancelledAt ?? undefined,
    proofUrl: d.proofUrl ?? undefined,
  };
}

export function isPending(task: Pick<OpsTask, 'status'>): boolean {
  return task.status === 'pending' || task.status === 'assigned' || task.status === 'in_transit_to_store' || task.status === 'out_for_delivery';
}

export function shouldAnnounce(task: Pick<OpsTask, 'id' | 'status'>, seenIds: Set<string>): boolean {
  return !seenIds.has(task.id) && isPending(task);
}

export function pickupLabel(task: Pick<OpsTask, 'pickupSlot'>): string {
  return task.pickupSlot ? slotLabel(task.pickupSlot as any) : '—';
}
