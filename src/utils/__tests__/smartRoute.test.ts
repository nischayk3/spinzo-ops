import { describe, it, expect } from 'vitest';
import { extractLocality, parseSlotTimeWeight, safeShortId, buildSmartRoute, optimizeStopSequence2Opt } from '../smartRoute';
import { isValidCoord, resolveCustomerCoordinates, buildDirectionsDestination } from '../storeGeo';

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

  it('leaves stop.latitude and stop.longitude undefined when no explicit GPS coordinates exist (never synthesizes LOCALITY_COORDINATES)', () => {
    const route = buildSmartRoute({
      myTasks: [
        {
          id: 'p1',
          orderId: 'p1',
          userId: 'u1',
          vendorId: 'v1',
          assignee: 'r1',
          status: 'assigned',
          customerName: 'Ungeocoded Customer',
          customerPhone: '9999999999',
          pickupAddress: '14th Main, HSR Layout Sector 2',
          items: [],
          totalAmount: 200,
          paymentStatus: 'pending',
          paymentMode: 'cod',
          assignedAt: null,
        } as any,
      ],
      myDeliveries: [],
      orders: [],
    });

    expect(route).toHaveLength(1);
    expect(route[0].latitude).toBeUndefined();
    expect(route[0].longitude).toBeUndefined();
    expect(route[0].address).toBe('14th Main, HSR Layout Sector 2');
  });

  it('preserves exact customer coordinates and address on assigned deliveries instead of overwriting with store location', () => {
    const route = buildSmartRoute({
      myTasks: [],
      myDeliveries: [
        {
          id: 'del-1',
          orderId: 'del-1',
          userId: 'u2',
          status: 'assigned',
          customerName: 'Delivery Customer',
          customerPhone: '8888888888',
          deliveryAddress: '777 Koramangala 4th Block',
          latitude: 12.9352,
          longitude: 77.6245,
        } as any,
      ],
      orders: [],
    });

    const delStop = route.find(s => s.orderId === 'del-1');
    expect(delStop).toBeDefined();
    expect(delStop!.latitude).toBe(12.9352);
    expect(delStop!.longitude).toBe(77.6245);
    expect(delStop!.address).toBe('777 Koramangala 4th Block');
  });

  it('hydrates customer coordinates from matching order when task lacks coordinates', () => {
    const route = buildSmartRoute({
      myTasks: [
        {
          id: 'p-order-coords',
          orderId: 'p-order-coords',
          userId: 'u3',
          vendorId: 'v1',
          assignee: 'r1',
          status: 'pending',
          customerName: 'Order Hydrated Customer',
          customerPhone: '7777777777',
          pickupAddress: 'Some Address in BTM',
          items: [],
          totalAmount: 300,
          paymentStatus: 'pending',
          paymentMode: 'upi',
          assignedAt: null,
        } as any,
      ],
      myDeliveries: [],
      orders: [
        {
          id: 'p-order-coords',
          status: 'confirmed',
          address: {
            location: { latitude: 12.9279, longitude: 77.6271 },
          },
        } as any,
      ],
    });

    expect(route).toHaveLength(1);
    expect(route[0].latitude).toBe(12.9279);
    expect(route[0].longitude).toBe(77.6271);
  });

  it('2-opt eliminates zig-zagging (North-1 → North-2 → South-1) and populates leg & cumulative distance telemetry', () => {
    const store = { latitude: 12.9166, longitude: 77.6148 };
    // ~1.5 km North, ~1.6 km South, ~1.7 km North (right next to North-1)
    const route = buildSmartRoute({
      currentLocation: store,
      myTasks: [
        {
          id: 't_north1',
          orderId: 'NORTH_1',
          assignee: 'rider_1',
          status: 'assigned',
          customerName: 'North 1',
          pickupAddress: 'Koramangala 5th Block, Bengaluru',
          pickupSlot: { type: '09:00 AM - 11:00 AM' },
          latitude: 12.9301,
          longitude: 77.6148,
        } as any,
        {
          id: 't_south1',
          orderId: 'SOUTH_1',
          assignee: 'rider_1',
          status: 'assigned',
          customerName: 'South 1',
          pickupAddress: 'BTM 2nd Stage, Bengaluru',
          pickupSlot: { type: '09:00 AM - 11:00 AM' },
          latitude: 12.9022,
          longitude: 77.6148,
        } as any,
        {
          id: 't_north2',
          orderId: 'NORTH_2',
          assignee: 'rider_1',
          status: 'assigned',
          customerName: 'North 2',
          pickupAddress: 'Koramangala 6th Block, Bengaluru',
          pickupSlot: { type: '09:00 AM - 11:00 AM' },
          latitude: 12.9319,
          longitude: 77.6148,
        } as any,
      ],
      myDeliveries: [],
      orders: [],
    });

    expect(route.map(s => s.orderId)).toEqual(['NORTH_1', 'NORTH_2', 'SOUTH_1']);
    expect(route.map(s => s.stopNumber)).toEqual([1, 2, 3]);

    // Verify legDistanceMeters and cumulativeDistanceMeters telemetry
    expect(route[0].legDistanceMeters).toBeGreaterThan(1400);
    expect(route[0].legDistanceMeters).toBeLessThan(1600);
    // Leg from North-1 to North-2 should be ~200m (not 3km+ zig-zag)
    expect(route[1].legDistanceMeters).toBeGreaterThan(150);
    expect(route[1].legDistanceMeters).toBeLessThan(250);
    // Leg from North-2 to South-1 is ~3.3km
    expect(route[2].legDistanceMeters).toBeGreaterThan(3200);
    expect(route[2].legDistanceMeters).toBeLessThan(3400);

    expect(route[0].cumulativeDistanceMeters).toBe(route[0].legDistanceMeters);
    expect(route[1].cumulativeDistanceMeters).toBe(
      (route[0].legDistanceMeters || 0) + (route[1].legDistanceMeters || 0)
    );
    expect(route[2].cumulativeDistanceMeters).toBe(
      (route[0].legDistanceMeters || 0) + (route[1].legDistanceMeters || 0) + (route[2].legDistanceMeters || 0)
    );
  });

  it('optimizeStopSequence2Opt respects >90 min earlier-slot precedence and never mutates stop coordinates', () => {
    const store = { latitude: 12.9166, longitude: 77.6148 };
    const mkStop = (id: string, slotText: string, lat?: number, lng?: number): any => ({
      id,
      taskId: id,
      stopNumber: 0,
      type: 'pickup',
      orderId: id,
      orderNumber: id,
      address: 'HSR Layout, Bengaluru',
      locality: 'HSR LAYOUT',
      slotText,
      isUrgent: false,
      isInstant: false,
      status: 'assigned',
      latitude: lat,
      longitude: lng,
      loadUnits: 1,
      rawTask: {},
    });

    const earlyFar = mkStop('EARLY_FAR', '09:00 AM - 11:00 AM', 12.9022, 77.6148);
    const lateNear = mkStop('LATE_NEAR', '05:00 PM - 07:00 PM', 12.9301, 77.6148);
    const ungeocoded = mkStop('UNGEOCODED', '09:00 AM - 11:00 AM', undefined, undefined);

    const ordered = optimizeStopSequence2Opt([lateNear, earlyFar, ungeocoded], store);
    // Early morning stops must precede evening stop (>90 min gap)
    const lateIdx = ordered.findIndex(s => s.id === 'LATE_NEAR');
    const earlyIdx = ordered.findIndex(s => s.id === 'EARLY_FAR');
    expect(earlyIdx).toBeLessThan(lateIdx);

    // Ungeocoded stop must NOT have its coordinates mutated
    const ung = ordered.find(s => s.id === 'UNGEOCODED');
    expect(ung?.latitude).toBeUndefined();
    expect(ung?.longitude).toBeUndefined();
  });
});

describe('storeGeo coordinate & destination helpers', () => {
  it('validates finite non-zero coordinates with isValidCoord', () => {
    expect(isValidCoord(12.9352, 77.6245)).toBe(true);
    expect(isValidCoord(0, 0)).toBe(false);
    expect(isValidCoord(undefined, 77.6245)).toBe(false);
    expect(isValidCoord(NaN, 77.6245)).toBe(false);
    expect(isValidCoord('12.9352' as any, '77.6245' as any)).toBe(false);
  });

  it('resolves exact coordinates across nested sources in priority order', () => {
    const resolved = resolveCustomerCoordinates([
      { latitude: undefined, longitude: undefined },
      { address: { location: { latitude: 12.9121, longitude: 77.6446 } } },
      { latitude: 12.95, longitude: 77.7 },
    ]);
    expect(resolved).toEqual({ latitude: 12.9121, longitude: 77.6446 });

    expect(resolveCustomerCoordinates([null, { latitude: 0, longitude: 0 }])).toBeUndefined();
  });

  it('builds deterministic Google Maps destinations preferring exact lat,lng over text fallback', () => {
    expect(buildDirectionsDestination('  123 Main Rd, HSR  ', 12.9121, 77.6446)).toBe('12.9121,77.6446');
    expect(buildDirectionsDestination('  123 Main Rd, HSR  ', undefined, undefined)).toBe('123 Main Rd, HSR');
    expect(buildDirectionsDestination('  123 Main Rd, HSR  ', 0, 0)).toBe('123 Main Rd, HSR');
  });
});

