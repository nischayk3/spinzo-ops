import { describe, it, expect } from 'vitest';
import { extractLocality, parseSlotTimeWeight, safeShortId, buildSmartRoute } from '../smartRoute';

describe('smartRoute utility', () => {
  it('extractLocality extracts known Bangalore localities accurately', () => {
    expect(extractLocality('#124, 19th Main, HSR Layout Sector 2, Bangalore')).toBe('HSR LAYOUT');
    expect(extractLocality('Flat 402, Green Glen Layout, Bellandur, Bengaluru')).toBe('BELLANDUR');
    expect(extractLocality('4th Cross, 5th Block, Koramangala, Bengaluru')).toBe('KORAMANGALA');
    expect(extractLocality('Unknown single address')).toBe('UNKNOWN SINGLE ADDRESS');
    expect(extractLocality(null)).toBe('Local');
  });

  it('parseSlotTimeWeight prioritizes instant and early morning slots', () => {
    expect(parseSlotTimeWeight('Instant Delivery')).toBe(0);
    expect(parseSlotTimeWeight('07:00 AM - 09:00 AM')).toBe(420);
    expect(parseSlotTimeWeight('09:00 AM - 11:00 AM')).toBe(540);
    expect(parseSlotTimeWeight('05:00 PM - 07:00 PM')).toBe(1020);
  });

  it('safeShortId handles nulls, numbers, and strings safely without throwing', () => {
    expect(safeShortId('ORDER_123456')).toBe('123456');
    expect(safeShortId(null)).toBe('------');
    expect(safeShortId(undefined)).toBe('------');
    expect(safeShortId(12345 as any)).toBe('------');
  });

  it('buildSmartRoute orders instant/urgent pickups before standard deliveries', () => {
    const route = buildSmartRoute({
      myTasks: [
        {
          id: 'task_normal',
          orderId: 'ORD_NORMAL',
          assignee: 'rider_1',
          status: 'assigned',
          pickupAddress: 'HSR Sector 1, Bangalore',
          pickupSlot: { type: '09:00 AM - 11:00 AM' },
        },
        {
          id: 'task_instant',
          orderId: 'ORD_INSTANT',
          assignee: 'rider_1',
          status: 'assigned',
          pickupAddress: 'HSR Sector 2, Bangalore',
          pickupSlot: { isInstant: true },
        },
      ],
      myDeliveries: [
        {
          id: 'del_1',
          orderId: 'ORD_DEL_1',
          userId: 'user_1',
          vendorId: 'vendor_1',
          status: 'out_for_delivery',
          assignee: 'rider_1',
          deliveryAddress: 'HSR Sector 1, Bangalore',
          deliveryDate: '2026-10-17',
          deliveryTime: '05:00 PM',
          deliveryOTP: '1234',
          customerName: 'Customer A',
          customerPhone: '9999999999',
        },
      ],
      orders: [],
    });

    expect(route.length).toBe(3);
    // Instant task should be stop 1
    expect(route[0].orderId).toBe('ORD_INSTANT');
    expect(route[0].stopNumber).toBe(1);
    expect(route[0].isInstant).toBe(true);
  });

  it('filters out historical completed, delivered, or processing orders from active pickups', () => {
    const route = buildSmartRoute({
      myTasks: [
        {
          id: 'task_historical_delivered',
          orderId: 'ORD_OLD_DELIVERED',
          assignee: 'rider_1',
          status: 'assigned',
          pickupAddress: 'HSR Sector 1, Bangalore',
        },
        {
          id: 'task_historical_washing',
          orderId: 'ORD_IN_WASHING',
          assignee: 'rider_1',
          status: 'assigned',
          pickupAddress: 'HSR Sector 1, Bangalore',
        },
        {
          id: 'task_active_placed',
          orderId: 'ORD_ACTIVE_PLACED',
          assignee: 'rider_1',
          status: 'assigned',
          pickupAddress: 'HSR Sector 1, Bangalore',
        },
      ],
      myDeliveries: [],
      orders: [
        { id: 'ORD_OLD_DELIVERED', status: 'delivered', userId: 'u1' } as any,
        { id: 'ORD_IN_WASHING', status: 'processing', userId: 'u2' } as any,
        { id: 'ORD_ACTIVE_PLACED', status: 'placed', userId: 'u3' } as any,
      ],
    });

    expect(route.length).toBe(1);
    expect(route[0].orderId).toBe('ORD_ACTIVE_PLACED');
  });

  it('includes pending status tasks and sequences uncollected customer pickups before store returns', () => {
    const route = buildSmartRoute({
      myTasks: [
        {
          id: 'task_shamala',
          orderId: 'ORD_SHAMALA',
          customerName: 'Shamala V',
          assignee: 'rider_1',
          status: 'in_transit_to_store',
          pickupAddress: '10, Btm layout, Outer Ring Road, Bengaluru',
        },
        {
          id: 'task_harshit',
          orderId: 'ORD_HARSHIT',
          customerName: 'Harshit Gupta',
          assignee: 'rider_1',
          status: 'pending',
          pickupAddress: 'goSTOPS HSR Silk Board, Bengaluru',
          pickupSlot: { isInstant: true },
        },
        {
          id: 'task_deepak',
          orderId: 'ORD_DEEPAK',
          customerName: 'Deepak',
          assignee: 'rider_1',
          status: 'assigned',
          pickupAddress: 'SRS Elegance, Koramangala 5th Block, Bengaluru',
          pickupSlot: { isInstant: true },
        },
      ],
      myDeliveries: [],
      orders: [
        { id: 'ORD_SHAMALA', status: 'in_transit_to_store', customerName: 'Shamala V' } as any,
        { id: 'ORD_HARSHIT', status: 'placed', customerName: 'Harshit Gupta' } as any,
        { id: 'ORD_DEEPAK', status: 'confirmed', customerName: 'Deepak' } as any,
      ],
    });

    expect(route.length).toBe(3);
    // Active customer pickups should be sequenced BEFORE returning to store
    expect(route[0].type).toBe('pickup');
    expect(route[1].type).toBe('pickup');
    expect(route[2].type).toBe('store_dropoff');
    expect(route[2].customerName).toBe('Shamala V');
    expect(route[2].stopNumber).toBe(3);
  });
});

