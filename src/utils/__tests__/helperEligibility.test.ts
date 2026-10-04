import { describe, it, expect } from 'vitest';
import { getTopEligibleTask } from '../helperEligibility';
import { OpsProcess } from '../opsProcess';

const makeProcess = (overrides: Partial<OpsProcess> = {}): OpsProcess => ({
  id: 'p1',
  orderId: 'o1',
  steps: ['tagging'],
  currentIndex: 0,
  status: 'tagging',
  stages: {},
  garments: { labels: [], registered: [] },
  ...overrides,
});

const resources = { washers: 5, dryers: 5, ironingStations: 5 };

describe('getTopEligibleTask', () => {
  it('returns null when the order is already ready (not cancelled)', () => {
    const processes = [makeProcess()];
    const orders = [{ id: 'o1', status: 'ready' }];
    expect(getTopEligibleTask(processes, orders, 'h1', 'helper', null, resources, true)).toBeNull();
  });

  it('returns a tagging task for a pickup_completed order', () => {
    const orders = [{ id: 'o1', status: 'pickup_completed', userId: 'u1', vendorId: 'v1' }];
    const result = getTopEligibleTask([], orders, 'h1', 'helper', null, resources, true);
    expect(result).not.toBeNull();
    expect(result!.orderId).toBe('o1');
  });
});