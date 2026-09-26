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
  billDetails?: { total?: number; itemTotal?: number; deliveryFee?: number; gst?: number; discount?: number };
  paymentStatus?: string;
  notes?: string;
  tokenNumber?: string;
  pickupOTP?: string;
  storeOTP?: string;
  address?: { formattedAddress?: string; latitude?: number; longitude?: number } | any;
  latitude?: number;
  longitude?: number;
  processingStep?: string;
  deliveryDate?: string;
  deliveryTime?: string;
  deliveryOTP?: string;
  createdAt?: any;
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

export const formatOrderItems = (o: FeedOrder): string =>
  (o.items || [])
    .map(i => `${i.serviceName || i.serviceType || 'Item'}${i.quantity ? ` ×${i.quantity}` : ''}`)
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

// Accept FeedOrder (has pickupDetails) OR PickupSlot / task.pickupSlot directly.
export const slotLabel = (o: FeedOrder | PickupSlot | null | undefined): string => {
  if (!o) return '—';
  const p = (o as FeedOrder).pickupDetails || (o as PickupSlot);
  if (!p) return '—';
  if (p.isInstant) return 'Instant pickup';
  return `${p.scheduledDate || ''} ${p.scheduledTime || ''}`.trim() || '—';
};

const tsToMs = (t: any): number => {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t.toDate === 'function') return t.toDate().getTime();
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  if (typeof t.getTime === 'function') return t.getTime();
  const parsed = new Date(t).getTime();
  return isNaN(parsed) ? 0 : parsed;
};

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
    const amt = orderTotal(o);
    stats.revenue += amt;
    stats.orderCount += 1;
    if (amt > 0) stats.orderRevenue += amt;
    if (o.status === 'ready') stats.readyCount += 1;
    if (o.status === 'out_for_delivery') stats.outForDelivery += 1;
    if (o.status === 'cancelled') stats.cancelledCount += 1;
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
    });
    if (o.customerName && o.customerName !== 'Unknown') c.name = o.customerName;
  }
  // Newest first
  map.forEach(c => c.orders.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt)));
  return map;
};
