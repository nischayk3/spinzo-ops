import { describe, it, expect } from 'vitest';
import {
  ACTIVE_STATUSES,
  INTAKE_STATUSES,
  isIntakeOrder,
  filterIntakeOrders,
  filterActiveOrders,
  sortNewestFirst,
  timeAgo,
  serviceSummary,
  slotLabel,
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

  it('sortNewestFirst handles .seconds-only timestamps (no toDate)', () => {
    const orders = [
      makeOrder({ id: 'old', createdAt: { seconds: 1000 } }),
      makeOrder({ id: 'new', createdAt: { seconds: 3000 } }),
      makeOrder({ id: 'mid', createdAt: { seconds: 2000 } }),
    ];
    expect(sortNewestFirst(orders).map(o => o.id)).toEqual(['new', 'mid', 'old']);
  });

  it('sortNewestFirst sorts Date/string timestamps and defers missing createdAt', () => {
    const orders = [
      makeOrder({ id: 'old', createdAt: new Date('2026-01-01T00:00:00Z') }),
      makeOrder({ id: 'new', createdAt: '2026-02-01T00:00:00Z' }),
      makeOrder({ id: 'missing', createdAt: undefined }),
    ];
    expect(sortNewestFirst(orders).map(o => o.id)).toEqual(['new', 'old', 'missing']);
  });
});

describe('timeAgo', () => {
  it('returns "" for missing or unparseable timestamps', () => {
    expect(timeAgo(undefined)).toBe('');
    expect(timeAgo('not-a-date')).toBe('');
  });

  it('formats recent minutes', () => {
    expect(timeAgo(new Date(Date.now() - 30 * 1000))).toBe('Just now');
  });
});

describe('serviceSummary', () => {
  it('joins service names or types, falling back to Unknown', () => {
    const o: FeedOrder = { id: '1', userId: 'u1', status: 'placed', items: [
      { serviceName: 'Wash & Fold' },
      { serviceType: 'ironing' },
    ] };
    expect(serviceSummary(o)).toBe('Wash & Fold, ironing');
    expect(serviceSummary({ id: '2', userId: 'u2', status: 'placed', items: [] })).toBe('Unknown');
  });
});

describe('slotLabel', () => {
  it('labels instant, scheduled, and missing pickup', () => {
    expect(slotLabel({ id: '1', userId: 'u1', status: 'placed', pickupDetails: { isInstant: true } })).toBe('Instant pickup');
    expect(slotLabel({ id: '2', userId: 'u2', status: 'placed', pickupDetails: { scheduledDate: '2026-08-07', scheduledTime: '10:00 - 11:00' } })).toBe('2026-08-07 10:00 - 11:00');
    expect(slotLabel({ id: '3', userId: 'u3', status: 'placed' })).toBe('—');
  });
});
