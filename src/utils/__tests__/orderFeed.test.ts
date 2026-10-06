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
  formatItemSummary,
  formatOrderItems,
  parseOrderTokens,
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
      'placed', 'confirmed', 'in_transit_to_store', 'pickup_completed', 'processing', 'ready', 'out_for_delivery',
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

  it('formats minutes ago', () => {
    expect(timeAgo(new Date(Date.now() - 5 * 60000))).toBe('5m ago');
  });

  it('formats hours ago', () => {
    expect(timeAgo(new Date(Date.now() - 2 * 3600 * 1000))).toBe('2h ago');
  });

  it('uses toDate() for Timestamp-like objects', () => {
    const ts = {
      seconds: Math.floor(Date.now() / 1000 - 120),
      nanoseconds: 0,
      toDate: () => new Date(Date.now() - 120000),
    };
    expect(timeAgo(ts)).toBe('2m ago');
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
    expect(slotLabel({ id: '1', userId: 'u1', status: 'placed', pickupDetails: { isInstant: true } })).toBe('Instant • Within 30–45 mins');
    expect(slotLabel({ id: '1b', userId: 'u1', status: 'placed', pickupDetails: { isInstant: true, scheduledTime: '10:00 - 10:30' } })).toBe('Instant • 10:00 - 10:30');
    expect(slotLabel({ id: '2', userId: 'u2', status: 'placed', pickupDetails: { scheduledDate: '2026-08-07', scheduledTime: '10:00 - 11:00' } })).toBe('2026-08-07 10:00 - 11:00');
    expect(slotLabel({ id: '3', userId: 'u3', status: 'placed' })).toBe('—');
  });
});

describe('formatItemSummary', () => {
  it('formats wash and fold with kg weight and ironing addon', () => {
    const item = {
      serviceId: 'wash_fold',
      serviceName: 'Wash & Fold',
      weight: 6,
      ironingCount: 3,
      totalPrice: 564,
    };
    const summary = formatItemSummary(item);
    expect(summary.title).toBe('Wash & Fold');
    expect(summary.details).toBe('6 kg • +3 ironed');
    expect(summary.price).toBe('₹564');
  });

  it('formats wash and fold plan credit item', () => {
    const item = {
      serviceType: 'wash_fold',
      weight: 5,
      isCreditItem: true,
    };
    const summary = formatItemSummary(item);
    expect(summary.title).toBe('Wash Fold');
    expect(summary.details).toBe('5 kg • Plan Credit');
  });

  it('formats wash and iron with weight', () => {
    const item = {
      serviceType: 'wash_iron',
      serviceName: 'Wash & Iron',
      weight: 7,
      totalPrice: 980,
    };
    const summary = formatItemSummary(item);
    expect(summary.title).toBe('Wash & Iron');
    expect(summary.details).toBe('7 kg');
    expect(summary.price).toBe('₹980');
  });

  it('formats steam iron with piece count', () => {
    const item = {
      serviceType: 'ironing',
      serviceName: 'Steam Iron',
      clothesCount: 15,
      totalPrice: 270,
    };
    const summary = formatItemSummary(item);
    expect(summary.title).toBe('Steam Iron');
    expect(summary.details).toBe('15 pcs');
    expect(summary.price).toBe('₹270');
  });

  it('formats blanket wash with single and double counts', () => {
    const item = {
      serviceType: 'blanket_wash',
      serviceName: 'Blanket Wash',
      singleBlanketCount: 1,
      doubleBlanketCount: 2,
      totalPrice: 1097,
    };
    const summary = formatItemSummary(item);
    expect(summary.title).toBe('Blanket Wash');
    expect(summary.details).toBe('1 Single, 2 Double');
    expect(summary.price).toBe('₹1097');
  });
});

describe('formatOrderItems', () => {
  it('formats all items with their respective details', () => {
    const order: FeedOrder = {
      id: '1',
      userId: 'u1',
      status: 'placed',
      items: [
        { serviceName: 'Wash & Fold', weight: 5, ironingCount: 2 },
        { serviceName: 'Wash & Iron', weight: 6 },
        { serviceName: 'Steam Iron', clothesCount: 10 },
      ],
    };
    const formatted = formatOrderItems(order);
    expect(formatted).toContain('Wash & Fold (5 kg • +2 ironed)');
    expect(formatted).toContain('Wash & Iron (6 kg)');
    expect(formatted).toContain('Steam Iron (10 pcs)');
  });
});

describe('removal of default number 18', () => {
  it('does not display default 18 pieces or ironed on wash & fold', () => {
    const item = {
      serviceType: 'wash_fold',
      serviceName: 'Wash & Fold',
      weight: 5,
      ironingCount: 18, // default pieces estimate
      clothesCount: 18,
    };
    const summary = formatItemSummary(item);
    expect(summary.details).toBe('5 kg');
    expect(summary.details).not.toContain('18');
  });

  it('does not display default 18 pieces on wash & iron', () => {
    const item = {
      serviceType: 'wash_iron',
      serviceName: 'Wash & Iron',
      weight: 5,
      clothesCount: 18,
    };
    const summary = formatItemSummary(item);
    expect(summary.details).toBe('5 kg');
    expect(summary.details).not.toContain('18');
    expect(summary.details).not.toContain('pcs');
  });
});

describe('parseOrderTokens', () => {
  it('parses multiple tokens from tokens map with service names', () => {
    const tokens = {
      wash_fold: '23',
      wash_iron: '24',
      ironing: '25',
    };
    const chips = parseOrderTokens(tokens);
    expect(chips).toHaveLength(3);
    expect(chips[0]).toEqual({ serviceKey: 'wash_fold', serviceLabel: 'Wash & Fold', token: '23' });
    expect(chips[1]).toEqual({ serviceKey: 'wash_iron', serviceLabel: 'Wash & Iron', token: '24' });
    expect(chips[2]).toEqual({ serviceKey: 'ironing', serviceLabel: 'Steam Iron', token: '25' });
  });

  it('parses comma-separated tokenNumber with order items', () => {
    const items = [
      { serviceName: 'Wash & Fold', serviceType: 'wash_fold' },
      { serviceName: 'Wash & Iron', serviceType: 'wash_iron' },
      { serviceName: 'Steam Iron', serviceType: 'ironing' },
    ];
    const chips = parseOrderTokens(null, '23, 24, 25', items);
    expect(chips).toHaveLength(3);
    expect(chips[0]).toEqual({ serviceLabel: 'Wash & Fold', token: '23' });
    expect(chips[1]).toEqual({ serviceLabel: 'Wash & Iron', token: '24' });
    expect(chips[2]).toEqual({ serviceLabel: 'Steam Iron', token: '25' });
  });

  it('parses single token with Token # prefix', () => {
    const chips = parseOrderTokens(null, 'Token #23');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toEqual({ token: '23' });
  });
});
