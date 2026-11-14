import { describe, it, expect } from 'vitest';
import { slotLabel } from '../orderFeed';
import {
  parseOpsTask,
  isPending,
  shouldAnnounce,
  taskAlertKey,
  pickupLabel,
  formatRiderDateLabel,
  buildRiderSlotDisplay,
} from '../opsTasks';

describe('parseOpsTask', () => {
  it('maps id + fields onto an OpsTask', () => {
    const t = parseOpsTask('ORD123', {
      orderId: 'ORD123',
      assignee: 'uid-1',
      status: 'pending',
      pickupAddress: 'MG Road, Bengaluru',
      tokenNumber: 'T42',
    });
    expect(t).toEqual({
      id: 'ORD123',
      orderId: 'ORD123',
      assignee: 'uid-1',
      status: 'pending',
      pickupAddress: 'MG Road, Bengaluru',
      tokenNumber: 'T42',
      pickupSlot: null,
      pickupOTP: undefined,
      assignedAt: undefined,
      createdAt: undefined,
    });
  });

  it('survives a null/undefined snapshot (defensive)', () => {
    expect(parseOpsTask('X', null)).toEqual({ id: 'X', orderId: 'X', assignee: '', status: 'pending' });
  });
});

describe('isPending', () => {
  it('true only for status pending', () => {
    expect(isPending({ status: 'pending' } as any)).toBe(true);
    expect(isPending({ status: 'picked_up' } as any)).toBe(false);
    expect(isPending({ status: 'cancelled' } as any)).toBe(false);
    expect(isPending({} as any)).toBe(false);
  });
});

describe('shouldAnnounce', () => {
  it('announces a new pending task not yet seen', () => {
    expect(shouldAnnounce({ id: 'A', status: 'pending' } as any, new Set())).toBe(true);
  });
  it('does not re-announce a seen task', () => {
    expect(shouldAnnounce({ id: 'A', status: 'pending' } as any, new Set(['A']))).toBe(false);
  });
  it('does not announce non-pending tasks', () => {
    expect(shouldAnnounce({ id: 'A', status: 'picked_up' } as any, new Set())).toBe(false);
  });
  it('does not announce tasks that are already accepted', () => {
    expect(shouldAnnounce({ id: 'A', status: 'pending', acceptedAt: new Date() } as any, new Set())).toBe(false);
  });
  it('announces a scheduled delivery even when the same orderId was already seen as a pickup', () => {
    const seen = new Set<string>();
    const pickup = { id: 'ORD99', orderId: 'ORD99', status: 'pending', assignedAt: 1000 };
    expect(shouldAnnounce(pickup, seen, 'pickup')).toBe(true);
    seen.add(taskAlertKey(pickup, 'pickup'));

    // Later, same order enters delivery queue for same rider: MUST announce!
    const delivery = { id: 'ORD99', orderId: 'ORD99', status: 'assigned', assignedAt: 5000 };
    expect(shouldAnnounce(delivery, seen, 'delivery')).toBe(true);
  });
  it('re-announces when a task is reassigned with a new assignedAt timestamp', () => {
    const seen = new Set<string>();
    const first = { id: 'ORD55', orderId: 'ORD55', status: 'assigned', assignedAt: 1000 };
    seen.add(taskAlertKey(first, 'pickup'));
    expect(shouldAnnounce(first, seen, 'pickup')).toBe(false);

    const reassigned = { id: 'ORD55', orderId: 'ORD55', status: 'assigned', assignedAt: 2000 };
    expect(shouldAnnounce(reassigned, seen, 'pickup')).toBe(true);
  });
});

describe('pickupLabel', () => {
  it('renders slot via slotLabel when present', () => {
    const t = { pickupSlot: { type: 'scheduled', scheduledDate: '2026-08-07', scheduledTime: '14:00' } } as any;
    expect(pickupLabel(t)).toBe(slotLabel(t.pickupSlot));
  });
  it('renders instant slot with time window', () => {
    const t = { pickupSlot: { isInstant: true, scheduledTime: '11:00 - 11:30' } } as any;
    expect(pickupLabel(t)).toBe('Instant • 11:00 - 11:30');
  });
  it('falls back to a dash when no slot', () => {
    expect(pickupLabel({} as any)).toBe('—');
  });
});

describe('formatRiderDateLabel & buildRiderSlotDisplay', () => {
  const fixedNow = new Date(2026, 10, 14, 12, 0, 0); // 14 Nov 2026

  it('formats ISO date with Today / Tomorrow and short calendar date', () => {
    expect(formatRiderDateLabel('2026-11-14', fixedNow)).toBe('Today, 14 Nov');
    expect(formatRiderDateLabel('2026-11-15', fixedNow)).toBe('Tomorrow, 15 Nov');
    expect(formatRiderDateLabel('2026-11-17', fixedNow)).toBe('Tue, 17 Nov');
  });

  it('shows date AND time window for instant pickups with scheduledDate & scheduledTime', () => {
    const res = buildRiderSlotDisplay(
      {
        type: 'pickup',
        pickupSlot: 'Instant • 13:00 - 14:00',
        pickupDate: '2026-11-14',
        pickupTime: '13:00 - 14:00',
        isInstantPickup: true,
        createdAt: fixedNow,
      },
      fixedNow
    );
    expect(res).toEqual({
      isInstant: true,
      label: '⚡ Instant',
      text: 'Today, 14 Nov • 13:00 - 14:00',
    });
  });

  it('falls back to createdAt date and rich time window when pickupTime is generic "instant"', () => {
    const res = buildRiderSlotDisplay(
      {
        type: 'pickup',
        pickupSlot: 'Instant • Within 30–45 mins (by 12:45 PM)',
        pickupTime: 'instant',
        isInstantPickup: true,
        createdAt: fixedNow,
      },
      fixedNow
    );
    expect(res).toEqual({
      isInstant: true,
      label: '⚡ Instant',
      text: 'Today, 14 Nov • Within 30–45 mins (by 12:45 PM)',
    });
  });

  it('formats scheduled pickup slot with friendly date and window', () => {
    const res = buildRiderSlotDisplay(
      {
        type: 'pickup',
        pickupSlot: '2026-11-14 14:00 - 15:00',
      },
      fixedNow
    );
    expect(res).toEqual({
      isInstant: false,
      label: 'Pickup Window',
      text: 'Today, 14 Nov • 14:00 - 15:00',
    });
  });

  it('formats delivery window with friendly date and time', () => {
    const res = buildRiderSlotDisplay(
      {
        type: 'delivery',
        deliveryDate: '2026-11-15',
        deliveryTime: '17:00 - 18:00',
      },
      fixedNow
    );
    expect(res).toEqual({
      isInstant: false,
      label: 'Delivery Window',
      text: 'Tomorrow, 15 Nov • 17:00 - 18:00',
    });
  });
});
