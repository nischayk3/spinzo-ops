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

  it('immediately surfaces a supervisor-pushed task to the helper', () => {
    const pushedProcess = makeProcess({
      steps: ['getting_washed'],
      currentIndex: 0,
      status: 'getting_washed',
      stages: {
        getting_washed: {
          assignee: 'h1',
          assignedBy: 'supervisor_1',
          assignedAt: Date.now(),
          // acceptedAt is null/undefined
        },
      },
    });
    const orders = [{ id: 'o1', status: 'processing', userId: 'u1', vendorId: 'v1' }];
    const result = getTopEligibleTask([pushedProcess], orders, 'h1', 'helper', null, resources, true);
    expect(result).not.toBeNull();
    expect(result!.isPushedToMe).toBe(true);
    expect(result!.orderId).toBe('o1');
  });

  it('surfaces a supervisor-pushed task even if helper has not clocked in yet (onShift: false)', () => {
    const pushedProcess = makeProcess({
      steps: ['getting_washed'],
      currentIndex: 0,
      status: 'getting_washed',
      stages: {
        getting_washed: {
          assignee: 'h1',
          assignedBy: 'supervisor_1',
          assignedAt: Date.now(),
        },
      },
    });
    const orders = [{ id: 'o1', status: 'processing', userId: 'u1', vendorId: 'v1' }];
    const result = getTopEligibleTask([pushedProcess], orders, 'h1', 'helper', null, resources, false);
    expect(result).not.toBeNull();
    expect(result!.isPushedToMe).toBe(true);
    expect(result!.orderId).toBe('o1');
  });
});