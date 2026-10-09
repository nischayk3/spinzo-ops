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

  it('prioritizes getting_dried and getting_washed over packaging and tagging when machines are available', () => {
    const packagingProcess = makeProcess({
      id: 'p_pack',
      orderId: 'o_pack',
      steps: ['packaging'],
      currentIndex: 0,
      status: 'packaging',
      stages: {},
    });
    const washingProcess = makeProcess({
      id: 'p_wash',
      orderId: 'o_wash',
      steps: ['getting_washed'],
      currentIndex: 0,
      status: 'getting_washed',
      stages: {},
    });
    const dryingProcess = makeProcess({
      id: 'p_dry',
      orderId: 'o_dry',
      steps: ['getting_dried'],
      currentIndex: 0,
      status: 'getting_dried',
      stages: {},
    });

    const orders = [
      { id: 'o_pack', status: 'processing', userId: 'u1' },
      { id: 'o_wash', status: 'processing', userId: 'u1' },
      { id: 'o_dry', status: 'processing', userId: 'u1' },
      { id: 'o_new', status: 'pickup_completed', userId: 'u1' },
    ];

    const result = getTopEligibleTask(
      [packagingProcess, washingProcess, dryingProcess],
      orders,
      'h1',
      'helper',
      null,
      resources,
      true
    );
    expect(result).not.toBeNull();
    // Dryer load must take absolute #1 priority
    expect(result!.orderId).toBe('o_dry');
  });

  it('assigns an available machine task on priority even if helper is busy with tagging or packaging', () => {
    // Helper h1 is currently busy with packaging on order o1
    const busyPackagingProcess = makeProcess({
      id: 'p1',
      orderId: 'o1',
      steps: ['packaging'],
      currentIndex: 0,
      status: 'packaging',
      stages: {
        packaging: {
          assignee: 'h1',
          startedAt: Date.now(),
        },
      },
    });

    // An available washer task on order o2 needs a load
    const washingProcess = makeProcess({
      id: 'p2',
      orderId: 'o2',
      steps: ['getting_washed'],
      currentIndex: 0,
      status: 'getting_washed',
      stages: {},
    });

    const orders = [
      { id: 'o1', status: 'processing', userId: 'u1' },
      { id: 'o2', status: 'processing', userId: 'u1' },
    ];

    const result = getTopEligibleTask(
      [busyPackagingProcess, washingProcess],
      orders,
      'h1',
      'helper',
      null,
      resources,
      true
    );
    // Even though h1 is packaging o1, washer o2 is empty and needs to be loaded immediately!
    expect(result).not.toBeNull();
    expect(result!.orderId).toBe('o2');
  });

  it('does not interrupt a helper who is actively loading another machine', () => {
    // Helper h1 has accepted getting_washed on o1, but has not started it yet (actively loading)
    const loadingWasherProcess = makeProcess({
      id: 'p1',
      orderId: 'o1',
      steps: ['getting_washed'],
      currentIndex: 0,
      status: 'getting_washed',
      stages: {
        getting_washed: {
          assignee: 'h1',
          // startedAt is undefined/null -> actively loading!
        },
      },
    });

    // Another dryer task on o2 is ready
    const dryingProcess = makeProcess({
      id: 'p2',
      orderId: 'o2',
      steps: ['getting_dried'],
      currentIndex: 0,
      status: 'getting_dried',
      stages: {},
    });

    const orders = [
      { id: 'o1', status: 'processing', userId: 'u1' },
      { id: 'o2', status: 'processing', userId: 'u1' },
    ];

    const result = getTopEligibleTask(
      [loadingWasherProcess, dryingProcess],
      orders,
      'h1',
      'helper',
      null,
      resources,
      true
    );
    // Should NOT interrupt h1 while h1 is actively loading washer 1
    expect(result).toBeNull();
  });
});