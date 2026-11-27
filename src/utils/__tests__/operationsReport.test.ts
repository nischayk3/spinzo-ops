import { describe, it, expect } from 'vitest';
import {
  collectHelperStageEvents,
  buildHelperReport,
  buildRiderReport,
  getCleanStageDurationMin,
  resolvePieceCount,
  resolveRiderName,
  StageMetricDoc,
} from '../operationsReport';

describe('operationsReport', () => {
  it('never double-counts an active order present in ops_stage_metrics, ops_process, and order.stageTimings', () => {
    const completedAt = new Date('2026-11-23T10:30:00.000Z');
    const stageMetrics: StageMetricDoc[] = [
      {
        processId: 'ord1__wash_iron',
        orderId: 'ord1',
        parentOrderId: 'ord1',
        step: 'getting_ironed',
        serviceType: 'wash_iron',
        serviceLabel: 'Wash & Iron',
        garmentCount: 24,
        assigneeName: 'samsul',
        startToCompleteMin: 45,
        completedAt,
        dateKey: '2026-11-23',
      },
    ];
    const processes = [
      {
        id: 'ord1__wash_iron',
        orderId: 'ord1',
        parentOrderId: 'ord1',
        serviceType: 'wash_iron',
        serviceLabel: 'Wash & Iron',
        garments: { count: 24 },
        stages: {
          getting_ironed: {
            assigneeName: 'samsul',
            startToCompleteMin: 45,
            completedAt,
          },
        },
      },
    ];
    const orders = [
      {
        id: 'ord1',
        garmentCount: 24,
        stageTimings: {
          getting_ironed: {
            assigneeName: 'samsul',
            startToCompleteMin: 45,
            completedAt,
          },
        },
      },
    ];

    const events = collectHelperStageEvents({
      stageMetrics,
      processes,
      orders,
      startDate: '2026-11-23',
      endDate: '2026-11-23',
    });

    expect(events).toHaveLength(1);
    const report = buildHelperReport(events, 'all', ['2026-11-23']);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].staffName).toBe('samsul');
    expect(report.rows[0].stages.getting_ironed.completedCount).toBe(1);
    expect(report.rows[0].stages.getting_ironed.pieces).toBe(24);
    expect(report.rows[0].stages.getting_ironed.avgMinutes).toBe(45);
  });

  it('preserves every load of a multi-load order across different helpers and splits service buckets', () => {
    const stageMetrics: StageMetricDoc[] = [
      {
        processId: 'ordM__premium_laundry__L2',
        orderId: 'ordM',
        parentOrderId: 'ordM',
        step: 'getting_ironed',
        serviceType: 'premium_laundry',
        serviceLabel: 'Premium Laundry (Load 2/4)',
        garmentCount: 18,
        loadCount: 4,
        assigneeName: 'samsul',
        startToCompleteMin: 60,
        dateKey: '2026-11-23',
      },
      {
        processId: 'ordM__premium_laundry__L3',
        orderId: 'ordM',
        parentOrderId: 'ordM',
        step: 'getting_ironed',
        serviceType: 'premium_laundry',
        serviceLabel: 'Premium Laundry (Load 3/4)',
        garmentCount: 22,
        loadCount: 4,
        assigneeName: 'abdur',
        startToCompleteMin: 50,
        dateKey: '2026-11-23',
      },
      {
        processId: 'ordS__ironing',
        orderId: 'ordS',
        parentOrderId: 'ordS',
        step: 'getting_ironed',
        serviceType: 'ironing',
        serviceLabel: 'Steam Iron',
        assigneeName: 'abdur',
        startToCompleteMin: 0, // fast tap — must NOT be dropped from count/pieces!
        dateKey: '2026-11-23',
      },
    ];

    const orders = [
      { id: 'ordS', garmentCount: 12 },
    ];

    const events = collectHelperStageEvents({
      stageMetrics,
      processes: [],
      orders,
      startDate: '2026-11-23',
      endDate: '2026-11-23',
    });

    const report = buildHelperReport(events, 'all', ['2026-11-23']);
    const abdur = report.rows.find((r) => r.staffName === 'abdur')!;
    const samsul = report.rows.find((r) => r.staffName === 'samsul')!;

    expect(abdur.ironingTotalLoads).toBe(2);
    expect(abdur.ironingTotalPieces).toBe(34);
    expect(abdur.ironingAvgMin).toBe(50); // 0m excluded from avg, not from count
    expect(abdur.ironingByService.premium_laundry).toEqual({ loads: 1, pieces: 22 });
    expect(abdur.ironingByService.ironing).toEqual({ loads: 1, pieces: 12 });

    expect(samsul.ironingTotalLoads).toBe(1);
    expect(samsul.ironingTotalPieces).toBe(18);
    expect(report.ironingSummary.totalLoads).toBe(3);
    expect(report.ironingSummary.totalPieces).toBe(52);
  });

  it('caps extreme overnight stage durations (> 360m) from average while preserving count', () => {
    expect(getCleanStageDurationMin({ startToCompleteMin: 779 })).toBeNull();
    expect(getCleanStageDurationMin({ startToCompleteMin: 0 })).toBeNull();
    expect(getCleanStageDurationMin({ startToCompleteMin: 42 })).toBe(42);
  });

  it('resolves piece counts with exact priority and pro-rata fallback for historical multi-load orders', () => {
    const processById = new Map<string, any>([
      ['o1__wash_iron__L1', { garments: { count: 15 } }],
    ]);
    const orderById = new Map<string, any>([
      ['o1', { id: 'o1', garmentCount: 89 }],
      ['o2', { id: 'o2', garmentCount: 60 }],
      ['o3', { id: 'o3', items: [{ serviceType: 'ironing', quantity: 9, unit: 'pc' }] }],
    ]);

    // 1. Live ops_process beats order total
    expect(
      resolvePieceCount(
        { processId: 'o1__wash_iron__L1', orderId: 'o1', serviceLabel: 'Wash & Iron (Load 1/3)' },
        processById,
        orderById
      )
    ).toEqual({ pieces: 15, isEstimated: false });

    // 2. Historical delivered multi-load (no ops_process) uses pro-rata estimate
    expect(
      resolvePieceCount(
        { processId: 'o2__wash_iron__L2', orderId: 'o2', serviceLabel: 'Wash & Iron (Load 2/3)' },
        processById,
        orderById
      )
    ).toEqual({ pieces: 20, isEstimated: true });

    // 3. Fallback to per-piece items when garmentCount is missing
    expect(
      resolvePieceCount(
        { processId: 'o3__ironing', orderId: 'o3', serviceType: 'ironing' },
        processById,
        orderById
      )
    ).toEqual({ pieces: 9, isEstimated: false });
  });

  it('prioritizes delivery task assignee over pickup riderId and keeps Rider Overview & Daily counts in parity', () => {
    const riderNameByUid = { r1: 'Sonu', r2: 'Ravi' };
    const taskRiders = {
      ord1: { pickupUid: 'r1', deliveryUid: 'r2' },
    };

    const order = {
      id: 'ord1',
      riderId: 'r1', // manually assigned pickup rider
      createdAt: new Date(2026, 10, 23, 9, 0).getTime(),
      pickedUpAt: new Date(2026, 10, 23, 9, 25).getTime(), // 25m
      outForDeliveryAt: new Date(2026, 10, 23, 14, 0).getTime(),
      deliveredAt: new Date(2026, 10, 23, 14, 0, 10).getTime(), // 0m — must still be counted!
    };

    expect(resolveRiderName(order, 'pickup', taskRiders, riderNameByUid)).toBe('Sonu');
    expect(resolveRiderName(order, 'delivery', taskRiders, riderNameByUid)).toBe('Ravi');

    const res = buildRiderReport({
      orders: [order],
      taskRiders,
      riderNameByUid,
      startDate: '2026-11-23',
      endDate: '2026-11-23',
      selectedStaff: 'all',
      dates: ['2026-11-23'],
    });

    expect(res.overall?.pickupCount).toBe(1);
    expect(res.overall?.deliveryCount).toBe(1);
    expect(res.dayStats[0].pickupCount).toBe(1);
    expect(res.dayStats[0].deliveryCount).toBe(1);
    expect(res.rows.find((r) => r.staffName === 'Ravi')?.deliveryCount).toBe(1);
  });
});
