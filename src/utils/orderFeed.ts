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
  };
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
    if (count) parts.push(`${count} pcs`);
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
