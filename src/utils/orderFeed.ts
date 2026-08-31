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
  pickupDetails?: {
    type?: string;
    scheduledDate?: string;
    scheduledTime?: string;
    isInstant?: boolean;
  };
  deliveryDetails?: {
    scheduledDate?: string;
    scheduledTime?: string;
  };
  deliverySlot?: string;
  items?: Array<{
    serviceName?: string;
    serviceType?: string;
    quantity?: number;
    totalPrice?: number;
  }>;
  totalAmount?: number;
  paymentStatus?: string;
  notes?: string;
  tokenNumber?: string;
  pickupOTP?: string;
  storeOTP?: string;
  address?: { formattedAddress?: string; latitude?: number; longitude?: number } | any;
  processingStep?: string;
  deliveryDate?: string;
  deliveryTime?: string;
  deliveryOTP?: string;
  createdAt?: any;
}

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

export const slotLabel = (o: FeedOrder): string => {
  const p = o.pickupDetails;
  if (!p) return '—';
  if (p.isInstant) return 'Instant pickup';
  return `${p.scheduledDate || ''} ${p.scheduledTime || ''}`.trim() || '—';
};
