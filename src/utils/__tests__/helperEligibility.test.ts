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

  it('allows a second washer to be offered when washers: 2 and 1 washer is already running', () => {
    // Washer 1 is running for order o1
    const runningWasher1 = makeProcess({
      id: 'p1',
      orderId: 'o1',
      steps: ['getting_washed'],
      currentIndex: 0,
      status: 'getting_washed',
      stages: {
        getting_washed: {
          assignee: 'h2',
          startedAt: Date.now() - 5000,
        },
      },
    });

    // Order o2 is ready to wash
    const waitingWasher2 = makeProcess({
      id: 'p2',
      orderId: 'o2',
      steps: ['getting_washed'],
      currentIndex: 0,
      status: 'getting_washed',
      stages: {},
    });

    const orders = [
      { id: 'o1', status: 'processing', userId: 'u1' },
      { id: 'o2', status: 'processing', userId: 'u2' },
    ];

    // Case A: 1 washer limit -> throttled (o2 is null)
    const throttledResult = getTopEligibleTask(
      [runningWasher1, waitingWasher2],
      orders,
      'h1',
      'helper',
      null,
      { washers: 1, dryers: 1, ironingStations: 1 },
      true
    );
    expect(throttledResult).toBeNull();

    // Case B: 2 washers limit -> offered to h1!
    const allowedResult = getTopEligibleTask(
      [runningWasher1, waitingWasher2],
      orders,
      'h1',
      'helper',
      null,
      { washers: 2, dryers: 1, ironingStations: 1 },
      true
    );
    expect(allowedResult).not.toBeNull();
    expect(allowedResult!.orderId).toBe('o2');
  });

  it('strictly throttles dryers when dryers: 1 even if 2 washers are running', () => {
    // Dryer 1 is running for order o1
    const runningDryer1 = makeProcess({
      id: 'p1',
      orderId: 'o1',
      steps: ['getting_dried'],
      currentIndex: 0,
      status: 'getting_dried',
      stages: {
        getting_dried: {
          assignee: 'h2',
          startedAt: Date.now() - 5000,
        },
      },
    });

    // Order o2 finished washing and is ready for dryer
    const waitingDryer2 = makeProcess({
      id: 'p2',
      orderId: 'o2',
      steps: ['getting_dried'],
      currentIndex: 0,
      status: 'getting_dried',
      stages: {},
    });

    const orders = [
      { id: 'o1', status: 'processing', userId: 'u1' },
      { id: 'o2', status: 'processing', userId: 'u2' },
    ];

    // With dryers: 1, o2 must be blocked
    const throttledDryerResult = getTopEligibleTask(
      [runningDryer1, waitingDryer2],
      orders,
      'h1',
      'helper',
      null,
      { washers: 2, dryers: 1, ironingStations: 1 },
      true
    );
    expect(throttledDryerResult).toBeNull();

    // In 2-3 days when dryers: 2, o2 becomes eligible immediately
    const allowedDryerResult = getTopEligibleTask(
      [runningDryer1, waitingDryer2],
      orders,
      'h1',
      'helper',
      null,
      { washers: 2, dryers: 2, ironingStations: 1 },
      true
    );
    expect(allowedDryerResult).not.toBeNull();
    expect(allowedDryerResult!.orderId).toBe('o2');
  });

  describe('Ironing Priority & Restriction', () => {
    it('strictly blocks ironing orders from New Helper or unauthorized phones', () => {
      const ironProcess = makeProcess({
        id: 'p_iron',
        orderId: 'o_iron',
        steps: ['getting_ironed'],
        currentIndex: 0,
        status: 'getting_ironed',
        stages: {},
      });
      const orders = [{ id: 'o_iron', status: 'processing', userId: 'u1' }];

      // New Helper phone -> null
      const blocked = getTopEligibleTask(
        [ironProcess],
        orders,
        'helper_new',
        'helper',
        null,
        { washers: 2, dryers: 1, ironingStations: 1 },
        true,
        '+919999999999'
      );
      expect(blocked).toBeNull();

      // No phone passed -> null
      const noPhone = getTopEligibleTask(
        [ironProcess],
        orders,
        'helper_new',
        'helper',
        null,
        { washers: 2, dryers: 1, ironingStations: 1 },
        true
      );
      expect(noPhone).toBeNull();
    });

    it('allows Samsul and Abdur to receive ironing orders', () => {
      const ironProcess = makeProcess({
        id: 'p_iron',
        orderId: 'o_iron',
        steps: ['getting_ironed'],
        currentIndex: 0,
        status: 'getting_ironed',
        stages: {},
      });
      const orders = [{ id: 'o_iron', status: 'processing', userId: 'u1' }];

      // Samsul (+916369768237)
      const samsulTask = getTopEligibleTask(
        [ironProcess],
        orders,
        'h_samsul',
        'helper',
        null,
        { washers: 2, dryers: 1, ironingStations: 1 },
        true,
        '+916369768237'
      );
      expect(samsulTask).not.toBeNull();
      expect(samsulTask?.orderId).toBe('o_iron');

      // Abdur (+917559105832)
      const abdurTask = getTopEligibleTask(
        [ironProcess],
        orders,
        'h_abdur',
        'helper',
        null,
        { washers: 2, dryers: 1, ironingStations: 1 },
        true,
        '+917559105832'
      );
      expect(abdurTask).not.toBeNull();
      expect(abdurTask?.orderId).toBe('o_iron');
    });
  });

  describe('Machine Buffers', () => {
    it('enforces washer buffer of 2 pending orders per washer', () => {
      // 2 washers -> max 4 pending orders allowed in buffer
      const mkWash = (id: string) => makeProcess({
        id,
        orderId: id,
        steps: ['getting_washed'],
        currentIndex: 0,
        status: 'getting_washed',
        stages: {},
      });

      const p1 = mkWash('w1');
      const p2 = mkWash('w2');
      const p3 = mkWash('w3');
      const p4 = mkWash('w4');
      const p5 = mkWash('w5');

      const orders = [
        { id: 'w1', status: 'processing', userId: 'u1' },
        { id: 'w2', status: 'processing', userId: 'u2' },
        { id: 'w3', status: 'processing', userId: 'u3' },
        { id: 'w4', status: 'processing', userId: 'u4' },
        { id: 'w5', status: 'processing', userId: 'u5' },
      ];

      // 4 pending with 2 washers -> at capacity (buffer full)
      const fullBuffer = getTopEligibleTask(
        [p1, p2, p3, p4, p5],
        orders,
        'h1',
        'helper',
        null,
        { washers: 2, dryers: 1, ironingStations: 1 },
        true
      );
      expect(fullBuffer).toBeNull();
    });

    it('enforces iron buffer of 2 pending orders per iron station', () => {
      // 1 station -> max 2 pending orders
      const mkIron = (id: string) => makeProcess({
        id,
        orderId: id,
        steps: ['getting_ironed'],
        currentIndex: 0,
        status: 'getting_ironed',
        stages: {},
      });

      const p1 = mkIron('i1');
      const p2 = mkIron('i2');
      const p3 = mkIron('i3');

      const orders = [
        { id: 'i1', status: 'processing', userId: 'u1' },
        { id: 'i2', status: 'processing', userId: 'u2' },
        { id: 'i3', status: 'processing', userId: 'u3' },
      ];

      const fullBuffer = getTopEligibleTask(
        [p1, p2, p3],
        orders,
        'h_samsul',
        'helper',
        null,
        { washers: 2, dryers: 1, ironingStations: 1 },
        true,
        '+916369768237'
      );
      expect(fullBuffer).toBeNull();
    });
  });

  describe('Packaging Overflow Rule', () => {
    it('triggers instant assignment of oldest packaging order when > 3 packaging orders pending', () => {
      // 4 packaging orders
      const pkg1 = makeProcess({
        id: 'pkg1',
        orderId: 'pkg1',
        steps: ['packaging'],
        currentIndex: 0,
        status: 'packaging',
        stages: { packaging: { queuedAt: 1000 } as any },
      });
      const pkg2 = makeProcess({
        id: 'pkg2',
        orderId: 'pkg2',
        steps: ['packaging'],
        currentIndex: 0,
        status: 'packaging',
        stages: { packaging: { queuedAt: 2000 } as any },
      });
      const pkg3 = makeProcess({
        id: 'pkg3',
        orderId: 'pkg3',
        steps: ['packaging'],
        currentIndex: 0,
        status: 'packaging',
        stages: { packaging: { queuedAt: 3000 } as any },
      });
      const pkg4 = makeProcess({
        id: 'pkg4',
        orderId: 'pkg4',
        steps: ['packaging'],
        currentIndex: 0,
        status: 'packaging',
        stages: { packaging: { queuedAt: 4000 } as any },
      });

      // Also an open washer task that would normally have higher priority (Tier 2 vs Tier 3)
      const wash = makeProcess({
        id: 'wash1',
        orderId: 'wash1',
        steps: ['getting_washed'],
        currentIndex: 0,
        status: 'getting_washed',
        stages: {},
      });

      const orders = [
        { id: 'pkg1', status: 'processing', userId: 'u1' },
        { id: 'pkg2', status: 'processing', userId: 'u2' },
        { id: 'pkg3', status: 'processing', userId: 'u3' },
        { id: 'pkg4', status: 'processing', userId: 'u4' },
        { id: 'wash1', status: 'processing', userId: 'u5' },
      ];

      // With 4 packaging orders pending (>3), packaging overflow rule triggers!
      // Oldest packaging order (pkg1) is assigned first, overriding the washer task.
      const result = getTopEligibleTask(
        [wash, pkg1, pkg2, pkg3, pkg4],
        orders,
        'h1',
        'helper',
        null,
        { washers: 2, dryers: 1, ironingStations: 1 },
        true
      );
      expect(result).not.toBeNull();
      expect(result?.orderId).toBe('pkg1');
    });
  });

  describe('Drum-Buffer-Feed (Washer Starvation & Machine Feeding)', () => {
    it('prioritizes wash-dependent tagging over packaging for Abdul when washers are starving', () => {
      // 0 washers running, 0 orders in getting_washed
      // 1 packaging task waiting
      const pkg = makeProcess({
        id: 'pkg1',
        orderId: 'pkg1',
        steps: ['packaging'],
        currentIndex: 0,
        status: 'packaging',
        stages: {},
      });

      // 1 incoming pickup_completed order for Wash & Fold
      const orders = [
        { id: 'pkg1', status: 'processing', userId: 'u1' },
        { id: 'wash_order', status: 'pickup_completed', userId: 'u2', serviceType: 'wash_fold' },
      ];

      // Abdul (+916900311761) is free
      const result = getTopEligibleTask(
        [pkg],
        orders,
        'abdul_uid',
        'helper',
        null,
        { washers: 2, dryers: 2, ironingStations: 2 },
        true,
        '+916900311761' // Abdul
      );

      expect(result).not.toBeNull();
      // Must be assigned the tagging task to feed the empty washer!
      expect(result?.orderId).toBe('wash_order');
      expect(result?.status).toBe('tagging');
    });

    it('assigns tagging to Abdur when Abdul is busy and washers are starving', () => {
      const orders = [
        { id: 'pkg1', status: 'processing', userId: 'u1' },
        { id: 'wash_order', status: 'pickup_completed', userId: 'u2', serviceType: 'wash_iron' },
      ];

      // Abdur (+917559105832) is free
      const result = getTopEligibleTask(
        [],
        orders,
        'abdur_uid',
        'helper',
        null,
        { washers: 2, dryers: 2, ironingStations: 2 },
        true,
        '+917559105832' // Abdur
      );

      expect(result).not.toBeNull();
      expect(result?.orderId).toBe('wash_order');
    });

    it('allows Samsul to take tagging as fallback when washers are starving and no floor helpers free', () => {
      const orders = [
        { id: 'wash_order', status: 'pickup_completed', userId: 'u2', serviceType: 'wash_fold' },
      ];

      // Samsul (+916369768237) is free, no iron orders exist
      const result = getTopEligibleTask(
        [],
        orders,
        'samsul_uid',
        'helper',
        null,
        { washers: 2, dryers: 2, ironingStations: 2 },
        true,
        '+916369768237' // Samsul
      );

      expect(result).not.toBeNull();
      expect(result?.orderId).toBe('wash_order');
    });

    it('does NOT let packaging overflow starve an empty washer', () => {
      // 4 packaging orders pending
      const pkg1 = makeProcess({ id: 'pkg1', orderId: 'pkg1', steps: ['packaging'], status: 'packaging', stages: { packaging: { queuedAt: 1000 } as any } });
      const pkg2 = makeProcess({ id: 'pkg2', orderId: 'pkg2', steps: ['packaging'], status: 'packaging', stages: { packaging: { queuedAt: 2000 } as any } });
      const pkg3 = makeProcess({ id: 'pkg3', orderId: 'pkg3', steps: ['packaging'], status: 'packaging', stages: { packaging: { queuedAt: 3000 } as any } });
      const pkg4 = makeProcess({ id: 'pkg4', orderId: 'pkg4', steps: ['packaging'], status: 'packaging', stages: { packaging: { queuedAt: 4000 } as any } });

      // 1 wash order in tagging
      const tagProcess = makeProcess({
        id: 'wash_proc',
        orderId: 'wash_order',
        steps: ['tagging', 'getting_washed', 'getting_dried', 'packaging'],
        status: 'tagging',
        stages: {},
      });

      const orders = [
        { id: 'pkg1', status: 'processing', userId: 'u1' },
        { id: 'pkg2', status: 'processing', userId: 'u2' },
        { id: 'pkg3', status: 'processing', userId: 'u3' },
        { id: 'pkg4', status: 'processing', userId: 'u4' },
        { id: 'wash_order', status: 'processing', userId: 'u5', serviceType: 'wash_fold' },
      ];

      // Abdul is free. Washers: 2, running: 0, waiting: 0 -> Washer is starving!
      const result = getTopEligibleTask(
        [pkg1, pkg2, pkg3, pkg4, tagProcess],
        orders,
        'abdul_uid',
        'helper',
        null,
        { washers: 2, dryers: 2, ironingStations: 2 },
        true,
        '+916900311761' // Abdul
      );

      expect(result).not.toBeNull();
      // Packaging overflow must NOT starve the empty washer! Tagging is assigned!
      expect(result?.orderId).toBe('wash_order');
    });
  });
});