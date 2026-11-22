import { describe, it, expect } from 'vitest';
import {
  toEpochMs,
  getOrderTimestamps,
  formatCompactDateTime,
  formatCompactDuration,
  computeOrderUrgency,
  compareOrdersForOps,
} from '../orderUrgency';

const HOUR = 3_600_000;
const MIN = 60_000;

// Fixed local-time anchor: 22 Nov 2026, 12:46 PM local time
const NOW_MS = new Date(2026, 10, 22, 12, 46, 0, 0).getTime();

describe('orderUrgency', () => {
  describe('toEpochMs', () => {
    it('parses epoch numbers, Dates, ISO strings, and Firestore-like timestamps', () => {
      const sample = new Date(2026, 10, 22, 10, 0, 0, 0);
      const ms = sample.getTime();

      expect(toEpochMs(ms)).toBe(ms);
      expect(toEpochMs(sample)).toBe(ms);
      expect(toEpochMs(sample.toISOString())).toBe(ms);
      expect(toEpochMs({ toMillis: () => ms })).toBe(ms);
      expect(toEpochMs({ toDate: () => sample })).toBe(ms);
      expect(toEpochMs({ seconds: Math.floor(ms / 1000), nanoseconds: 0 })).toBe(
        Math.floor(ms / 1000) * 1000,
      );
      expect(toEpochMs(null)).toBeNull();
      expect(toEpochMs(undefined)).toBeNull();
      expect(toEpochMs('')).toBeNull();
      expect(toEpochMs('not-a-date')).toBeNull();
      expect(toEpochMs(NaN)).toBeNull();
    });
  });

  describe('getOrderTimestamps', () => {
    it('distinguishes actual pickup from createdAt fallback', () => {
      const created = NOW_MS - 5 * HOUR;
      const picked = NOW_MS - 3 * HOUR;

      const withPickup = getOrderTimestamps({
        createdAt: created,
        pickedUpAt: picked,
        readyAt: NOW_MS - HOUR,
      });
      expect(withPickup.placedMs).toBe(created);
      expect(withPickup.pickedUpMs).toBe(picked);
      expect(withPickup.isActualPickup).toBe(true);
      expect(withPickup.readyMs).toBe(NOW_MS - HOUR);
      expect(withPickup.deliveredMs).toBeNull();

      const fallbackOnly = getOrderTimestamps({ createdAt: created });
      expect(fallbackOnly.pickedUpMs).toBe(created);
      expect(fallbackOnly.isActualPickup).toBe(false);
    });

    it('falls back through pickupCompletedAt and inTransitAt', () => {
      const t = NOW_MS - 2 * HOUR;
      expect(getOrderTimestamps({ pickupCompletedAt: t }).isActualPickup).toBe(true);
      expect(getOrderTimestamps({ pickupCompletedAt: t }).pickedUpMs).toBe(t);
      expect(getOrderTimestamps({ inTransitAt: t }).isActualPickup).toBe(true);
      expect(getOrderTimestamps({ inTransitAt: t }).pickedUpMs).toBe(t);
    });
  });

  describe('formatCompactDateTime & formatCompactDuration', () => {
    it('formats Today, Yesterday, and older dates cleanly', () => {
      const todayMorning = new Date(2026, 10, 22, 10, 21, 0, 0).getTime();
      const yesterdayNight = new Date(2026, 10, 21, 21, 21, 0, 0).getTime();
      const twoDaysAgo = new Date(2026, 10, 20, 21, 21, 0, 0).getTime();

      expect(formatCompactDateTime(todayMorning, NOW_MS)).toBe('Today, 10:21 AM');
      expect(formatCompactDateTime(yesterdayNight, NOW_MS)).toBe('Yesterday, 9:21 PM');
      expect(formatCompactDateTime(twoDaysAgo, NOW_MS)).toBe('20 Nov, 9:21 PM');
      expect(formatCompactDateTime(null, NOW_MS)).toBe('—');
    });

    it('formats durations concisely', () => {
      expect(formatCompactDuration(45 * MIN)).toBe('45m');
      expect(formatCompactDuration(2 * HOUR + 25 * MIN)).toBe('2h 25m');
      expect(formatCompactDuration(9 * HOUR)).toBe('9h');
      expect(formatCompactDuration(38 * HOUR)).toBe('1d 14h');
      expect(formatCompactDuration(51 * HOUR)).toBe('2d 3h');
      expect(formatCompactDuration(48 * HOUR)).toBe('2d');
    });
  });

  describe('computeOrderUrgency', () => {
    it('Express 6-8h order picked 2h 25m ago -> 5h 35m left, not overdue, severity high', () => {
      const pickedUpAt = NOW_MS - (2 * HOUR + 25 * MIN); // Today, 10:21 AM
      const info = computeOrderUrgency(
        {
          id: 'exp-1',
          turnaroundMode: 'express_6_8h',
          pickedUpAt,
        },
        NOW_MS,
      );

      expect(info.isExpress).toBe(true);
      expect(info.isActualPickup).toBe(true);
      expect(info.pickedUpShort).toBe('Today, 10:21 AM');
      expect(info.ageLabel).toBe('2h 25m ago');
      expect(info.slaLabel).toBe('5h 35m left');
      expect(info.isOverdue).toBe(false);
      expect(info.isStalled48h).toBe(false);
      expect(info.severity).toBe('high');
      expect(info.remainingMs).toBe(5 * HOUR + 35 * MIN);
    });

    it('Express 6-8h order picked 10h ago -> Overdue 2h, isOverdue true, severity critical', () => {
      const pickedUpAt = NOW_MS - 10 * HOUR;
      const info = computeOrderUrgency(
        {
          id: 'exp-overdue',
          isExpress: true,
          pickedUpAt,
        },
        NOW_MS,
      );

      expect(info.isExpress).toBe(true);
      expect(info.isOverdue).toBe(true);
      expect(info.slaLabel).toBe('Overdue 2h');
      expect(info.severity).toBe('critical');
      expect(info.remainingMs).toBe(-2 * HOUR);
    });

    it('Standard order picked 50h ago -> isStalled48h true, severity critical', () => {
      const pickedUpAt = NOW_MS - 50 * HOUR;
      const info = computeOrderUrgency(
        {
          id: 'std-stalled',
          pickedUpAt,
        },
        NOW_MS,
      );

      expect(info.isExpress).toBe(false);
      expect(info.isStalled48h).toBe(true);
      expect(info.isAging24h).toBe(true);
      expect(info.isOverdue).toBe(true);
      expect(info.slaLabel).toBe('48h+ Stalled');
      expect(info.severity).toBe('critical');
    });

    it('Standard order picked 15h ago -> 9h left, severity normal, Yesterday formatting', () => {
      const pickedUpAt = NOW_MS - 15 * HOUR; // Yesterday, 9:46 PM
      const info = computeOrderUrgency(
        {
          id: 'std-15h',
          pickedUpAt,
        },
        NOW_MS,
      );

      expect(info.isExpress).toBe(false);
      expect(info.slaLabel).toBe('9h left');
      expect(info.isOverdue).toBe(false);
      expect(info.severity).toBe('normal');
      expect(info.pickedUpShort).toBe('Yesterday, 9:46 PM');
    });

    it('respects a later valid deliveryDate slot for standard orders', () => {
      const pickedUpAt = NOW_MS - 10 * HOUR;
      const info = computeOrderUrgency(
        {
          id: 'std-scheduled',
          pickedUpAt,
          deliveryDate: '2026-11-24',
          deliveryTime: '5:00 PM - 6:00 PM',
        },
        NOW_MS,
      );

      const expectedDeadline = new Date(2026, 10, 24, 18, 0, 0, 0).getTime();
      expect(info.deadlineMs).toBe(expectedDeadline);
      expect(info.isOverdue).toBe(false);
      expect(info.severity).toBe('normal');
    });
  });

  describe('compareOrdersForOps', () => {
    it('ops_fifo: 50h stalled standard sorts above 1h express and fresh normal, with FIFO within normal', () => {
      const stalled50h = { id: 'stalled-50h', pickedUpAt: NOW_MS - 50 * HOUR };
      const overdueExpress10h = { id: 'overdue-exp', isExpress: true, pickedUpAt: NOW_MS - 10 * HOUR };
      const express2h = { id: 'exp-2h', isExpress: true, pickedUpAt: NOW_MS - 2 * HOUR };
      const express1h = { id: 'exp-1h', isExpress: true, pickedUpAt: NOW_MS - 1 * HOUR };
      const normal15h = { id: 'norm-15h', pickedUpAt: NOW_MS - 15 * HOUR };
      const normal2h = { id: 'norm-2h', pickedUpAt: NOW_MS - 2 * HOUR };

      const sorted = [normal2h, express1h, normal15h, express2h, overdueExpress10h, stalled50h]
        .sort((a, b) => compareOrdersForOps(a, b, 'ops_fifo', NOW_MS))
        .map(o => o.id);

      expect(sorted).toEqual([
        'stalled-50h',
        'overdue-exp',
        'exp-2h',
        'exp-1h',
        'norm-15h',
        'norm-2h',
      ]);
    });

    it('pickup_schedule: express/instant first, then earliest pickup slot ascending', () => {
      const instantOrder = {
        id: 'instant',
        isInstant: true,
        createdAt: NOW_MS - 10 * MIN,
      };
      const expressOrder = {
        id: 'express',
        isExpress: true,
        createdAt: NOW_MS - 30 * MIN,
      };
      const slotMorning = {
        id: 'slot-10am',
        pickupDate: '2026-11-22',
        pickupTime: '10:00 AM - 11:00 AM',
        createdAt: NOW_MS - 2 * HOUR,
      };
      const slotEvening = {
        id: 'slot-6pm',
        pickupDate: '2026-11-22',
        pickupTime: '6:00 PM - 7:00 PM',
        createdAt: NOW_MS - 4 * HOUR,
      };

      const sorted = [slotEvening, instantOrder, slotMorning, expressOrder]
        .sort((a, b) => compareOrdersForOps(a, b, 'pickup_schedule', NOW_MS))
        .map(o => o.id);

      expect(sorted).toEqual(['express', 'instant', 'slot-10am', 'slot-6pm']);
    });

    it('delivery_schedule: overdue/express first, then earliest delivery slot ascending', () => {
      const overdue = {
        id: 'overdue',
        pickedUpAt: NOW_MS - 30 * HOUR,
      };
      const express = {
        id: 'express',
        isExpress: true,
        pickedUpAt: NOW_MS - 2 * HOUR,
      };
      const delEarlier = {
        id: 'del-2pm',
        pickedUpAt: NOW_MS - 5 * HOUR,
        deliveryDate: '2026-11-23',
        deliveryTime: '2:00 PM - 3:00 PM',
      };
      const delLater = {
        id: 'del-6pm',
        pickedUpAt: NOW_MS - 6 * HOUR,
        deliveryDate: '2026-11-23',
        deliveryTime: '6:00 PM - 7:00 PM',
      };

      const sorted = [delLater, express, delEarlier, overdue]
        .sort((a, b) => compareOrdersForOps(a, b, 'delivery_schedule', NOW_MS))
        .map(o => o.id);

      expect(sorted).toEqual(['overdue', 'express', 'del-2pm', 'del-6pm']);
    });
  });
});
