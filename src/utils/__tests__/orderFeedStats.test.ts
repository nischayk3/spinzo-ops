import { describe, it, expect } from 'vitest';
import { dayRevenue, customerIndex, FeedOrder } from '../orderFeed';

const today = new Date();
const now = {
  toDate: () => today,
  seconds: Math.floor(today.getTime() / 1000),
};

const mk = (over: Partial<FeedOrder>): FeedOrder => ({
  id: over.id || 'x',
  userId: 'u',
  status: over.status || 'placed',
  customerPhone: over.customerPhone || '+919000000000',
  customerName: over.customerName || 'A',
  totalAmount: over.totalAmount,
  billDetails: over.billDetails,
  createdAt: over.createdAt || now,
  ...over,
});

describe('dayRevenue', () => {
  it('sums only today orders via billDetails.total precedence', () => {
    const orders = [
      mk({ id: '1', billDetails: { total: 100 }, status: 'ready' }),
      mk({ id: '2', totalAmount: 50, status: 'out_for_delivery' }),
    ];
    const old = new Date(today); old.setDate(old.getDate() - 1);
    orders.push({ ...mk({ id: '3', billDetails: { total: 999 } }), createdAt: { toDate: () => old, seconds: Math.floor(old.getTime() / 1000) } });
    const s = dayRevenue(orders);
    expect(s.revenue).toBe(150);
    expect(s.orderCount).toBe(2);
    expect(s.readyCount).toBe(1);
    expect(s.outForDelivery).toBe(1);
    expect(s.orderRevenue).toBe(150);
  });
});

describe('customerIndex', () => {
  it('groups orders by phone and sums revenue, newest first', () => {
    const orders = [
      mk({ id: 'a', customerPhone: '+911', customerName: 'X', billDetails: { total: 10 }, status: 'placed' }),
      mk({ id: 'b', customerPhone: '+911', customerName: 'X', totalAmount: 20, status: 'ready' }),
      mk({ id: 'c', customerPhone: '+912', customerName: 'Y', billDetails: { total: 30 }, status: 'delivered' }),
    ];
    const idx = customerIndex(orders);
    expect(idx.size).toBe(2);
    const x = idx.get('+911')!;
    expect(x.name).toBe('X');
    expect(x.totalOrders).toBe(2);
    expect(x.totalRevenue).toBe(30);
    expect(x.orders.map(o => o.orderId)).toEqual(['a', 'b']);
  });
});
