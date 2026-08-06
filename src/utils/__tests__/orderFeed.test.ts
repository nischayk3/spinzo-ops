import { describe, it, expect } from 'vitest';
import {
  ACTIVE_STATUSES,
  INTAKE_STATUSES,
  isIntakeOrder,
  filterIntakeOrders,
  filterActiveOrders,
  sortNewestFirst,
  FeedOrder,
} from '../orderFeed';

const makeOrder = (overrides: Partial<FeedOrder>): FeedOrder => ({
  id: '1',
  userId: 'u1',
  status: 'placed',
  ...overrides,
});

describe('orderFeed', () => {
  it('defines intake = placed + confirmed', () => {
    expect(INTAKE_STATUSES).toEqual(['placed', 'confirmed']);
  });

  it('includes all active statuses in ACTIVE_STATUSES', () => {
    expect(ACTIVE_STATUSES).toEqual([
      'placed', 'confirmed', 'pickup_completed', 'processing', 'ready', 'out_for_delivery',
    ]);
  });

  it('isIntakeOrder is true only for placed/confirmed', () => {
    expect(isIntakeOrder(makeOrder({ status: 'placed' }))).toBe(true);
    expect(isIntakeOrder(makeOrder({ status: 'confirmed' }))).toBe(true);
    expect(isIntakeOrder(makeOrder({ status: 'processing' }))).toBe(false);
    expect(isIntakeOrder(makeOrder({ status: 'delivered' }))).toBe(false);
  });

  it('filterIntakeOrders keeps only placed/confirmed', () => {
    const orders = [
      makeOrder({ id: 'a', status: 'placed' }),
      makeOrder({ id: 'b', status: 'confirmed' }),
      makeOrder({ id: 'c', status: 'ready' }),
      makeOrder({ id: 'd', status: 'delivered' }),
    ];
    expect(filterIntakeOrders(orders).map(o => o.id)).toEqual(['a', 'b']);
  });

  it('filterActiveOrders drops delivered and cancelled', () => {
    const orders = [
      makeOrder({ id: 'a', status: 'placed' }),
      makeOrder({ id: 'b', status: 'delivered' }),
      makeOrder({ id: 'c', status: 'cancelled' }),
      makeOrder({ id: 'd', status: 'out_for_delivery' }),
    ];
    expect(filterActiveOrders(orders).map(o => o.id)).toEqual(['a', 'd']);
  });

  it('sortNewestFirst orders by createdAt desc, handling Timestamp-like objects', () => {
    const ts = (seconds: number) => ({ seconds, nanoseconds: 0, toDate: () => new Date(seconds * 1000) });
    const orders = [
      makeOrder({ id: 'old', createdAt: ts(1000) }),
      makeOrder({ id: 'new', createdAt: ts(3000) }),
      makeOrder({ id: 'mid', createdAt: ts(2000) }),
    ];
    expect(sortNewestFirst(orders).map(o => o.id)).toEqual(['new', 'mid', 'old']);
  });
});
