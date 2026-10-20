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
  matchOrderSearch,
  formatDisplayPhone,
  parseSlotStartMinutes,
  parseDeliveryDate,
  getDeliveryTargetTimestamp,
  sortReadyOrders,
  formatFriendlyDate,
  getPickupInfo,
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

describe('formatFriendlyDate', () => {
  const refDate = new Date(2026, 9, 20); // Oct 20, 2026

  it('formats today as Today', () => {
    expect(formatFriendlyDate('2026-10-20', refDate)).toBe('Today');
    expect(formatFriendlyDate('today', refDate)).toBe('Today');
  });

  it('formats tomorrow as Tomorrow', () => {
    expect(formatFriendlyDate('2026-10-21', refDate)).toBe('Tomorrow');
    expect(formatFriendlyDate('tomorrow', refDate)).toBe('Tomorrow');
  });

  it('formats future dates with day of week and month', () => {
    expect(formatFriendlyDate('2026-10-22', refDate)).toBe('Thu, 22 Oct');
    expect(formatFriendlyDate('2026-10-25', refDate)).toBe('Sun, 25 Oct');
  });

  it('handles null and invalid gracefully', () => {
    expect(formatFriendlyDate(null, refDate)).toBe('');
    expect(formatFriendlyDate(undefined, refDate)).toBe('');
  });
});

describe('getPickupInfo', () => {
  const refDate = new Date(2026, 9, 20); // Oct 20, 2026

  it('identifies instant orders and formats instant window', () => {
    const o = makeOrder({
      pickupDetails: { isInstant: true },
    });
    const info = getPickupInfo(o, refDate);
    expect(info.isInstant).toBe(true);
    expect(info.type).toBe('instant');
    expect(info.badgeLabel).toBe('⚡ Instant Pickup');
    expect(info.timeLabel).toBe('Within 30–45 mins');
    expect(info.fullDisplay).toBe('⚡ Instant • Within 30–45 mins');
    expect(info.hasInfo).toBe(true);
  });

  it('identifies instant orders with custom scheduledTime slot', () => {
    const o = makeOrder({
      pickupDetails: { isInstant: true, scheduledTime: '10:00 - 10:30' },
    });
    const info = getPickupInfo(o, refDate);
    expect(info.isInstant).toBe(true);
    expect(info.timeLabel).toBe('10:00 - 10:30');
    expect(info.fullDisplay).toBe('⚡ Instant • 10:00 - 10:30');
  });

  it('identifies scheduled orders for today', () => {
    const o = makeOrder({
      pickupDetails: { scheduledDate: '2026-10-20', scheduledTime: '17:00 - 18:00' },
    });
    const info = getPickupInfo(o, refDate);
    expect(info.isInstant).toBe(false);
    expect(info.type).toBe('scheduled');
    expect(info.badgeLabel).toBe('📅 Scheduled Pickup');
    expect(info.dateLabel).toBe('Today');
    expect(info.timeLabel).toBe('17:00 - 18:00');
    expect(info.fullDisplay).toBe('📅 Scheduled • Today, 17:00 - 18:00');
    expect(info.hasInfo).toBe(true);
  });

  it('identifies scheduled orders for tomorrow and future dates', () => {
    const oTomorrow = makeOrder({
      pickupDetails: { scheduledDate: '2026-10-21', scheduledTime: '10:00 - 11:00' },
    });
    const infoTomorrow = getPickupInfo(oTomorrow, refDate);
    expect(infoTomorrow.dateLabel).toBe('Tomorrow');
    expect(infoTomorrow.fullDisplay).toBe('📅 Scheduled • Tomorrow, 10:00 - 11:00');

    const oFuture = makeOrder({
      pickupDetails: { scheduledDate: '2026-10-25', scheduledTime: '14:00 - 15:00' },
    });
    const infoFuture = getPickupInfo(oFuture, refDate);
    expect(infoFuture.dateLabel).toBe('Sun, 25 Oct');
    expect(infoFuture.fullDisplay).toBe('📅 Scheduled • Sun, 25 Oct, 14:00 - 15:00');
  });

  it('handles orders with only scheduledTime', () => {
    const o = makeOrder({
      pickupDetails: { scheduledTime: '18:00 - 19:00' },
    });
    const info = getPickupInfo(o, refDate);
    expect(info.isInstant).toBe(false);
    expect(info.timeLabel).toBe('18:00 - 19:00');
    expect(info.fullDisplay).toBe('📅 Scheduled • 18:00 - 19:00');
  });

  it('handles null/missing orders gracefully', () => {
    const info = getPickupInfo(null);
    expect(info.isInstant).toBe(false);
    expect(info.hasInfo).toBe(false);
    expect(info.fullDisplay).toBe('Standard Pickup');
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

  it('formats tiered steam iron with tier breakdown in details', () => {
    const item = {
      serviceType: 'ironing',
      serviceName: 'Steam Iron',
      clothesCount: 10,
      mediumCount: 2,
      heavyCount: 1,
      totalPrice: 210,
    };
    const summary = formatItemSummary(item);
    expect(summary.title).toBe('Steam Iron');
    expect(summary.details).toBe('10 pcs (7 Light, 2 Med, 1 Heavy)');
    expect(summary.price).toBe('₹210');
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

describe('matchOrderSearch', () => {
  const sampleOrder: FeedOrder = makeOrder({
    id: 'ORDER_XYZ_789456',
    customerName: 'Aarav Mehta',
    customerPhone: '9876543210',
    tokenNumber: '14',
    tokens: { wash_fold: '14', ironing: '19' },
    pickupNote: 'Handle silk saree carefully',
  });

  it('returns true on empty query', () => {
    expect(matchOrderSearch(sampleOrder, '')).toBe(true);
    expect(matchOrderSearch(sampleOrder, '   ')).toBe(true);
  });

  it('matches by exact token number', () => {
    expect(matchOrderSearch(sampleOrder, '14')).toBe(true);
  });

  it('matches token with prefixes (#, Token, TK-)', () => {
    expect(matchOrderSearch(sampleOrder, '#14')).toBe(true);
    expect(matchOrderSearch(sampleOrder, 'Token 14')).toBe(true);
    expect(matchOrderSearch(sampleOrder, 'TK-14')).toBe(true);
    expect(matchOrderSearch(sampleOrder, 'token#14')).toBe(true);
  });

  it('matches secondary token from multi-service tokens map', () => {
    expect(matchOrderSearch(sampleOrder, '19')).toBe(true);
    expect(matchOrderSearch(sampleOrder, '#19')).toBe(true);
    expect(matchOrderSearch(sampleOrder, 'Token 19')).toBe(true);
  });

  it('matches by Order ID and short ID', () => {
    expect(matchOrderSearch(sampleOrder, 'XYZ_789456')).toBe(true);
    expect(matchOrderSearch(sampleOrder, '789456')).toBe(true);
  });

  it('matches by Customer Phone', () => {
    expect(matchOrderSearch(sampleOrder, '9876543210')).toBe(true);
    expect(matchOrderSearch(sampleOrder, '98765')).toBe(true);
  });

  it('matches by Customer Name (case-insensitive)', () => {
    expect(matchOrderSearch(sampleOrder, 'aarav')).toBe(true);
    expect(matchOrderSearch(sampleOrder, 'Mehta')).toBe(true);
  });

  it('matches by pickup notes', () => {
    expect(matchOrderSearch(sampleOrder, 'silk saree')).toBe(true);
  });

  it('returns false when no match', () => {
    expect(matchOrderSearch(sampleOrder, '999999')).toBe(false);
    expect(matchOrderSearch(sampleOrder, 'Priya')).toBe(false);
    expect(matchOrderSearch(sampleOrder, '#99')).toBe(false);
  });

  describe('formatDisplayPhone', () => {
    it('returns empty string for null or undefined or empty', () => {
      expect(formatDisplayPhone(null)).toBe('');
      expect(formatDisplayPhone(undefined)).toBe('');
      expect(formatDisplayPhone('')).toBe('');
      expect(formatDisplayPhone('   ')).toBe('');
    });

    it('formats standard 10-digit Indian phone with 5-5 split for easy last 4 digit verification', () => {
      expect(formatDisplayPhone('9876543210')).toBe('98765 43210');
      expect(formatDisplayPhone('8376821934')).toBe('83768 21934');
    });

    it('strips +91 prefix and formats 10-digit number for riders', () => {
      expect(formatDisplayPhone('+919876543210')).toBe('98765 43210');
      expect(formatDisplayPhone('+91 83768 21934')).toBe('83768 21934');
      expect(formatDisplayPhone('918376821934')).toBe('83768 21934');
    });

    it('strips leading 0 if present', () => {
      expect(formatDisplayPhone('09876543210')).toBe('98765 43210');
    });

    it('falls back to trimmed string for unusual numbers', () => {
      expect(formatDisplayPhone('12345')).toBe('12345');
      expect(formatDisplayPhone('+1-555-0192')).toBe('+1-555-0192');
    });
  });

  describe('parseSlotStartMinutes', () => {
    it('parses 12-hour slots with explicit meridiem', () => {
      expect(parseSlotStartMinutes('5:00 PM - 6:00 PM')).toBe(1020);
      expect(parseSlotStartMinutes('8:00 PM - 9:00 PM')).toBe(1200);
      expect(parseSlotStartMinutes('11:00 AM - 12:00 PM')).toBe(660);
      expect(parseSlotStartMinutes('12:00 PM - 1:00 PM')).toBe(720);
    });

    it('parses slots where meridiem is only on the end portion', () => {
      expect(parseSlotStartMinutes('5:00 - 6:00 PM')).toBe(1020);
      expect(parseSlotStartMinutes('8 - 9 pm')).toBe(1200);
      expect(parseSlotStartMinutes('11 - 12 pm')).toBe(660);
    });

    it('parses 24-hour military slots', () => {
      expect(parseSlotStartMinutes('17:00 - 18:00')).toBe(1020);
      expect(parseSlotStartMinutes('20:00 - 21:00')).toBe(1200);
      expect(parseSlotStartMinutes('11:00 - 12:00')).toBe(660);
    });

    it('handles instant, immediate, and invalid input', () => {
      expect(parseSlotStartMinutes('Instant')).toBe(0);
      expect(parseSlotStartMinutes('Immediate')).toBe(0);
      expect(parseSlotStartMinutes(null)).toBeNull();
      expect(parseSlotStartMinutes(undefined)).toBeNull();
      expect(parseSlotStartMinutes('')).toBeNull();
    });
  });

  describe('parseDeliveryDate', () => {
    it('parses ISO date string YYYY-MM-DD', () => {
      expect(parseDeliveryDate('2026-10-20')).toEqual({ year: 2026, month: 10, day: 20 });
    });

    it('parses DD-MM-YYYY and DD/MM/YYYY', () => {
      expect(parseDeliveryDate('20-10-2026')).toEqual({ year: 2026, month: 10, day: 20 });
      expect(parseDeliveryDate('20/10/2026')).toEqual({ year: 2026, month: 10, day: 20 });
    });

    it('returns null for empty/invalid input', () => {
      expect(parseDeliveryDate(null)).toBeNull();
      expect(parseDeliveryDate(undefined)).toBeNull();
      expect(parseDeliveryDate('invalid-date')).toBeNull();
    });
  });

  describe('sortReadyOrders', () => {
    it('orders 5:00 PM today before 8:00 PM today (user requirement)', () => {
      const order5PM = makeOrder({
        id: 'ord_5pm',
        status: 'ready',
        deliveryDate: '2026-10-20',
        deliveryTime: '5:00 PM - 6:00 PM',
      });
      const order8PM = makeOrder({
        id: 'ord_8pm',
        status: 'ready',
        deliveryDate: '2026-10-20',
        deliveryTime: '8:00 PM - 9:00 PM',
      });

      const sorted = sortReadyOrders([order8PM, order5PM]);
      expect(sorted.map(o => o.id)).toEqual(['ord_5pm', 'ord_8pm']);
    });

    it('orders 17:00 - 18:00 before 20:00 - 21:00 in 24-hr format', () => {
      const order5PM = makeOrder({
        id: 'ord_17',
        status: 'ready',
        deliveryDate: '2026-10-20',
        deliveryTime: '17:00 - 18:00',
      });
      const order8PM = makeOrder({
        id: 'ord_20',
        status: 'ready',
        deliveryDate: '2026-10-20',
        deliveryTime: '20:00 - 21:00',
      });

      const sorted = sortReadyOrders([order8PM, order5PM]);
      expect(sorted.map(o => o.id)).toEqual(['ord_17', 'ord_20']);
    });

    it('orders ascending across the entire day: 11:00, 12:00, 17:00 (5 PM), 20:00 (8 PM)', () => {
      const ord11 = makeOrder({ id: '11am', deliveryDate: '2026-10-20', deliveryTime: '11:00 - 12:00' });
      const ord12 = makeOrder({ id: '12pm', deliveryDate: '2026-10-20', deliveryTime: '12:00 - 13:00' });
      const ord5pm = makeOrder({ id: '5pm', deliveryDate: '2026-10-20', deliveryTime: '5:00 PM - 6:00 PM' });
      const ord8pm = makeOrder({ id: '8pm', deliveryDate: '2026-10-20', deliveryTime: '8:00 PM - 9:00 PM' });

      const sorted = sortReadyOrders([ord8pm, ord12, ord5pm, ord11]);
      expect(sorted.map(o => o.id)).toEqual(['11am', '12pm', '5pm', '8pm']);
    });

    it('places customers who have scheduled delivery FIRST before unbooked orders', () => {
      const unbookedOld = makeOrder({ id: 'unbooked_old', createdAt: 1000 });
      const scheduled5PM = makeOrder({ id: 'sched_5pm', deliveryDate: '2026-10-20', deliveryTime: '5:00 PM - 6:00 PM' });
      const scheduled8PM = makeOrder({ id: 'sched_8pm', deliveryDate: '2026-10-20', deliveryTime: '8:00 PM - 9:00 PM' });
      const unbookedNew = makeOrder({ id: 'unbooked_new', createdAt: 3000 });

      const sorted = sortReadyOrders([unbookedOld, scheduled8PM, unbookedNew, scheduled5PM]);
      expect(sorted.map(o => o.id)).toEqual(['sched_5pm', 'sched_8pm', 'unbooked_new', 'unbooked_old']);
    });

    it('sorts today before tomorrow', () => {
      const today8PM = makeOrder({ id: 'today_8pm', deliveryDate: '2026-10-20', deliveryTime: '8:00 PM - 9:00 PM' });
      const tomorrow11AM = makeOrder({ id: 'tomorrow_11am', deliveryDate: '2026-10-21', deliveryTime: '11:00 - 12:00' });

      const sorted = sortReadyOrders([tomorrow11AM, today8PM]);
      expect(sorted.map(o => o.id)).toEqual(['today_8pm', 'tomorrow_11am']);
    });

    it('places overdue deliveries at the very top (highest priority)', () => {
      const yesterday = makeOrder({ id: 'yesterday', deliveryDate: '2026-10-19', deliveryTime: '20:00 - 21:00' });
      const today11AM = makeOrder({ id: 'today_11am', deliveryDate: '2026-10-20', deliveryTime: '11:00 - 12:00' });

      const sorted = sortReadyOrders([today11AM, yesterday]);
      expect(sorted.map(o => o.id)).toEqual(['yesterday', 'today_11am']);
    });
  });
});

