import { describe, it, expect } from 'vitest';
import {
  getTopEligibleTask,
  isHelperEligible,
  isHelperAllowedForStage,
  isWashRequiringService,
  DEFAULT_HELPER_STAGE_RULES,
  ABDUL_PHONE,
  TAHIRUL_PHONE,
  SAMSUL_PHONE,
} from '../helperEligibility';
import type { HelperAssignmentRules } from '../../store/helperRulesStore';
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
    // Off-shift helpers must receive zero alerts (even for supervisor push)
    const offShiftResult = getTopEligibleTask([pushedProcess], orders, 'h1', 'helper', null, resources, false, undefined, false);
    expect(offShiftResult).toBeNull();
    // On-shift helpers on break still receive supervisor manual overrides
    const onBreakOverride = getTopEligibleTask([pushedProcess], orders, 'h1', 'helper', null, resources, true, undefined, true);
    expect(onBreakOverride).not.toBeNull();
    expect(onBreakOverride!.isPushedToMe).toBe(true);
    expect(onBreakOverride!.orderId).toBe('o1');
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

  describe('Break, Lunch & Off-Shift Gating', () => {
    it('blocks system_auto and open pool tasks when helper is off-shift or on break, while allowing supervisor override', () => {
      const systemAutoProcess = makeProcess({
        id: 'p_auto',
        orderId: 'o_auto',
        steps: ['getting_washed'],
        currentIndex: 0,
        status: 'getting_washed',
        stages: {
          getting_washed: {
            assignee: 'h1',
            assignedBy: 'system_auto',
            assignedAt: Date.now(),
          },
        },
      });
      const orders = [
        { id: 'o_auto', status: 'processing', userId: 'u1' },
        { id: 'o_pool', status: 'pickup_completed', userId: 'u2' },
      ];

      // Off-shift (e.g. clocked out / night auto-logout) -> null even for system_auto!
      expect(getTopEligibleTask([systemAutoProcess], orders, 'h1', 'helper', null, resources, false, null, false)).toBeNull();

      // On lunch/short break -> null for system_auto and pool tasks!
      expect(getTopEligibleTask([systemAutoProcess], orders, 'h1', 'helper', null, resources, true, null, true)).toBeNull();

      // Active working (onShift: true, onBreak: false) -> surfaces system_auto!
      const workingRes = getTopEligibleTask([systemAutoProcess], orders, 'h1', 'helper', null, resources, true, null, false);
      expect(workingRes).not.toBeNull();
      expect(workingRes?.orderId).toBe('o_auto');

      // Supervisor manual push while on break -> MUST still surface!
      const supPush = makeProcess({
        id: 'p_sup',
        orderId: 'o_sup',
        steps: ['getting_washed'],
        currentIndex: 0,
        status: 'getting_washed',
        stages: {
          getting_washed: {
            assignee: 'h1',
            assignedBy: 'sup_uid_123',
            assignedAt: Date.now(),
          },
        },
      });
      const supOrders = [{ id: 'o_sup', status: 'processing', userId: 'u3' }];
      const breakOverride = getTopEligibleTask([supPush], supOrders, 'h1', 'helper', null, resources, true, null, true);
      expect(breakOverride).not.toBeNull();
      expect(breakOverride?.orderId).toBe('o_sup');
    });

    it('routes Tagging, Packaging, Washing & Drying to Tahirul (+919707275674) while blocking Ironing', () => {
      const resources = { washers: 2, dryers: 2, ironingStations: 2 };
      const tahirulPhone = '+919707275674';

      // 1. Ironing is strictly blocked for Tahirul
      const ironProc = makeProcess({
        id: 'p_iron',
        orderId: 'o_iron',
        steps: ['getting_ironed'],
        currentIndex: 0,
        status: 'getting_ironed',
        stages: {},
      });
      const ironResult = getTopEligibleTask(
        [ironProc],
        [{ id: 'o_iron', status: 'processing', userId: 'u1' }],
        'h_tahirul',
        'helper',
        null,
        resources,
        true,
        tahirulPhone
      );
      expect(ironResult).toBeNull();

      // 2. Wash-dependent tagging prioritized over packaging when washers are starving (same as Abdul)
      const pkgProc = makeProcess({
        id: 'p_pkg',
        orderId: 'o_pkg',
        steps: ['packaging'],
        currentIndex: 0,
        status: 'packaging',
        stages: {},
      });
      const tagRes = getTopEligibleTask(
        [pkgProc],
        [
          { id: 'o_pkg', status: 'processing', userId: 'u1' },
          { id: 'o_wash', status: 'pickup_completed', userId: 'u2', serviceType: 'wash_fold' },
        ],
        'h_tahirul',
        'helper',
        null,
        resources,
        true,
        tahirulPhone
      );
      expect(tagRes).not.toBeNull();
      expect(tagRes?.orderId).toBe('o_wash');
      expect(tagRes?.status).toBe('tagging');

      // 3. Washing & Drying offered normally
      const washProc = makeProcess({
        id: 'p_wash',
        orderId: 'o_wash2',
        steps: ['getting_washed', 'getting_dried'],
        currentIndex: 0,
        status: 'getting_washed',
        stages: {},
      });
      const washRes = getTopEligibleTask(
        [washProc],
        [{ id: 'o_wash2', status: 'processing', userId: 'u3' }],
        'h_tahirul',
        'helper',
        null,
        resources,
        true,
        tahirulPhone
      );
      expect(washRes).not.toBeNull();
      expect(washRes?.orderId).toBe('o_wash2');
    });
  });

  describe('Dynamic Helper Assignment Rules (R22)', () => {
    it('falls back to DEFAULT_HELPER_STAGE_RULES when no custom rules exist', () => {
      expect(DEFAULT_HELPER_STAGE_RULES(TAHIRUL_PHONE)).toEqual({
        tagging: true,
        getting_washed: true,
        getting_dried: true,
        getting_ironed: false,
        packaging: true,
      });
      expect(DEFAULT_HELPER_STAGE_RULES(SAMSUL_PHONE).getting_ironed).toBe(true);
      expect(isHelperAllowedForStage(TAHIRUL_PHONE, 'getting_ironed', {})).toBe(false);
      expect(isHelperAllowedForStage(SAMSUL_PHONE, 'getting_ironed', {})).toBe(true);
      expect(isHelperAllowedForStage(ABDUL_PHONE, 'tagging', {})).toBe(true);
    });

    it('enables ironing for Tahirul when supervisor toggles getting_ironed ON in helperRules', () => {
      const ironProc = makeProcess({
        id: 'p_iron',
        orderId: 'o_iron',
        steps: ['getting_ironed'],
        currentIndex: 0,
        status: 'getting_ironed',
        stages: {},
      });
      const rules: HelperAssignmentRules = {
        [TAHIRUL_PHONE]: {
          tagging: true,
          getting_washed: true,
          getting_dried: true,
          getting_ironed: true,
          packaging: true,
        },
      };

      expect(isHelperEligible(ironProc, 'helper', false, TAHIRUL_PHONE, rules)).toBe(true);
      const task = getTopEligibleTask(
        [ironProc],
        [{ id: 'o_iron', status: 'processing', userId: 'u1' }],
        'h_tahirul',
        'helper',
        null,
        { washers: 2, dryers: 2, ironingStations: 2 },
        true,
        TAHIRUL_PHONE,
        false,
        rules
      );
      expect(task).not.toBeNull();
      expect(task?.orderId).toBe('o_iron');
    });

    it('blocks tagging (both process & unclaimed pickup_completed) for Abdul when tagging is toggled OFF', () => {
      const rules: HelperAssignmentRules = {
        [ABDUL_PHONE]: {
          tagging: false,
          getting_washed: true,
          getting_dried: true,
          getting_ironed: false,
          packaging: true,
        },
      };

      const tagProc = makeProcess({
        id: 'p_tag',
        orderId: 'o_tag',
        steps: ['tagging'],
        currentIndex: 0,
        status: 'tagging',
        stages: {},
      });

      expect(isHelperEligible(tagProc, 'helper', false, ABDUL_PHONE, rules)).toBe(false);

      const task = getTopEligibleTask(
        [tagProc],
        [
          { id: 'o_tag', status: 'processing', userId: 'u1' },
          { id: 'o_unclaimed', status: 'pickup_completed', userId: 'u2', serviceType: 'wash_fold' },
        ],
        'h_abdul',
        'helper',
        null,
        { washers: 2, dryers: 2, ironingStations: 2 },
        true,
        ABDUL_PHONE,
        false,
        rules
      );
      expect(task).toBeNull();
    });

    it('matches 10-digit phone keys in helperRules and blocks packaging overflow when packaging is OFF', () => {
      const digits10 = ABDUL_PHONE.slice(-10);
      const rules: HelperAssignmentRules = {
        [digits10]: {
          tagging: true,
          getting_washed: true,
          getting_dried: true,
          getting_ironed: false,
          packaging: false,
        },
      };

      const pkgs = ['pkg1', 'pkg2', 'pkg3', 'pkg4'].map((id, i) =>
        makeProcess({
          id,
          orderId: id,
          steps: ['packaging'],
          currentIndex: 0,
          status: 'packaging',
          stages: { packaging: { queuedAt: (i + 1) * 1000 } as any },
        })
      );
      const orders = pkgs.map(p => ({ id: p.orderId, status: 'processing', userId: 'u1' }));

      const task = getTopEligibleTask(
        pkgs,
        orders,
        'h_abdul',
        'helper',
        null,
        { washers: 2, dryers: 2, ironingStations: 2 },
        true,
        ABDUL_PHONE,
        false,
        rules
      );
      expect(task).toBeNull();
    });

    it('gates system_auto pushed tasks (step 0b) by helperRules while allowing supervisor manual push (step 0a)', () => {
      const rules: HelperAssignmentRules = {
        [ABDUL_PHONE]: {
          tagging: false,
          getting_washed: false,
          getting_dried: true,
          getting_ironed: false,
          packaging: true,
        },
      };

      const systemAutoWash = makeProcess({
        id: 'p_auto_wash',
        orderId: 'o_auto_wash',
        steps: ['getting_washed'],
        currentIndex: 0,
        status: 'getting_washed',
        stages: {
          getting_washed: {
            assignee: 'h_abdul',
            assignedBy: 'system_auto',
            assignedAt: Date.now(),
          },
        },
      });

      const supervisorPushWash = makeProcess({
        id: 'p_sup_wash',
        orderId: 'o_sup_wash',
        steps: ['getting_washed'],
        currentIndex: 0,
        status: 'getting_washed',
        stages: {
          getting_washed: {
            assignee: 'h_abdul',
            assignedBy: 'sup_uid_1',
            assignedAt: Date.now(),
          },
        },
      });

      const orders = [
        { id: 'o_auto_wash', status: 'processing', userId: 'u1' },
        { id: 'o_sup_wash', status: 'processing', userId: 'u2' },
      ];

      // Step 0b: system_auto push for disabled stage is blocked for regular helper
      expect(
        getTopEligibleTask(
          [systemAutoWash],
          orders,
          'h_abdul',
          'helper',
          null,
          { washers: 2, dryers: 2, ironingStations: 2 },
          true,
          ABDUL_PHONE,
          false,
          rules
        )
      ).toBeNull();

      // Step 0b: admin bypasses helperRules gate
      const adminRes = getTopEligibleTask(
        [systemAutoWash],
        orders,
        'h_abdul',
        'admin',
        null,
        { washers: 2, dryers: 2, ironingStations: 2 },
        true,
        ABDUL_PHONE,
        false,
        rules
      );
      expect(adminRes).not.toBeNull();
      expect(adminRes?.orderId).toBe('o_auto_wash');
      expect(adminRes?.isPushedToMe).toBe(true);

      // Step 0a: human supervisor manual push ALWAYS surfaces even if stage toggle is OFF
      const supRes = getTopEligibleTask(
        [supervisorPushWash],
        orders,
        'h_abdul',
        'helper',
        null,
        { washers: 2, dryers: 2, ironingStations: 2 },
        true,
        ABDUL_PHONE,
        false,
        rules
      );
      expect(supRes).not.toBeNull();
      expect(supRes?.orderId).toBe('o_sup_wash');
      expect(supRes?.isPushedToMe).toBe(true);
    });
  });

  describe('Client Washer Starvation Parity (Autopilot v2)', () => {
    it('isWashRequiringService covers all wash-requiring service types and excludes ironing/shoe_clean', () => {
      expect(isWashRequiringService('wash_fold')).toBe(true);
      expect(isWashRequiringService('wash_iron')).toBe(true);
      expect(isWashRequiringService('blanket_wash')).toBe(true);
      expect(isWashRequiringService('blanket_wash_single')).toBe(true);
      expect(isWashRequiringService('blanket_wash_double')).toBe(true);
      expect(isWashRequiringService('premium_laundry')).toBe(true);
      expect(isWashRequiringService('dry_clean')).toBe(true);

      expect(isWashRequiringService('ironing')).toBe(false);
      expect(isWashRequiringService('shoe_clean')).toBe(false);
      expect(isWashRequiringService(null)).toBe(false);
      expect(isWashRequiringService(undefined)).toBe(false);
    });

    it.each(['wash_fold', 'blanket_wash', 'premium_laundry'])(
      'pulls a packaging helper for a %s tagging order when a washer is empty and no wash queue is waiting',
      serviceType => {
        const activePackaging = makeProcess({
          id: 'p_pack',
          orderId: 'o_pack',
          steps: ['packaging'],
          currentIndex: 0,
          status: 'packaging',
          stages: {
            packaging: {
              assignee: 'h_abdul',
              startedAt: Date.now() - 30_000,
            },
          },
        });

        const orders = [
          { id: 'o_pack', status: 'processing', userId: 'u1' },
          { id: 'o_wash_new', status: 'pickup_completed', userId: 'u2', serviceType },
        ];

        const result = getTopEligibleTask(
          [activePackaging],
          orders,
          'h_abdul',
          'helper',
          null,
          { washers: 2, dryers: 2, ironingStations: 2 },
          true,
          ABDUL_PHONE
        );

        expect(result).not.toBeNull();
        expect(result?.orderId).toBe('o_wash_new');
        expect(result?.status).toBe('tagging');
      }
    );

    it('pulls an ironing helper for a wash-requiring tagging order when washer is empty', () => {
      const activeIroning = makeProcess({
        id: 'p_iron',
        orderId: 'o_iron',
        steps: ['getting_ironed'],
        currentIndex: 0,
        status: 'getting_ironed',
        stages: {
          getting_ironed: {
            assignee: 'h_samsul',
            startedAt: Date.now() - 30_000,
          },
        },
      });

      const orders = [
        { id: 'o_iron', status: 'processing', userId: 'u1' },
        { id: 'o_wash_new', status: 'pickup_completed', userId: 'u2', serviceType: 'wash_iron' },
      ];

      const result = getTopEligibleTask(
        [activeIroning],
        orders,
        'h_samsul',
        'helper',
        null,
        { washers: 2, dryers: 2, ironingStations: 2 },
        true,
        SAMSUL_PHONE
      );

      expect(result).not.toBeNull();
      expect(result?.orderId).toBe('o_wash_new');
      expect(result?.status).toBe('tagging');
    });

    it('respects helperRules when tagging is disabled for a packaging helper even if washer is empty', () => {
      const activePackaging = makeProcess({
        id: 'p_pack',
        orderId: 'o_pack',
        steps: ['packaging'],
        currentIndex: 0,
        status: 'packaging',
        stages: {
          packaging: {
            assignee: 'h_abdul',
            startedAt: Date.now() - 30_000,
          },
        },
      });

      const rules: HelperAssignmentRules = {
        [ABDUL_PHONE]: {
          tagging: false,
          getting_washed: true,
          getting_dried: true,
          getting_ironed: false,
          packaging: true,
        },
      };

      const orders = [
        { id: 'o_pack', status: 'processing', userId: 'u1' },
        { id: 'o_wash_new', status: 'pickup_completed', userId: 'u2', serviceType: 'wash_fold' },
      ];

      const result = getTopEligibleTask(
        [activePackaging],
        orders,
        'h_abdul',
        'helper',
        null,
        { washers: 2, dryers: 2, ironingStations: 2 },
        true,
        ABDUL_PHONE,
        false,
        rules
      );

      expect(result).toBeNull();
    });

    it('does NOT pull a packaging helper for ironing-only orders when washer is empty', () => {
      const activePackaging = makeProcess({
        id: 'p_pack',
        orderId: 'o_pack',
        steps: ['packaging'],
        currentIndex: 0,
        status: 'packaging',
        stages: {
          packaging: {
            assignee: 'h_abdul',
            startedAt: Date.now() - 30_000,
          },
        },
      });

      const orders = [
        { id: 'o_pack', status: 'processing', userId: 'u1' },
        { id: 'o_iron_only', status: 'pickup_completed', userId: 'u2', serviceType: 'ironing' },
      ];

      const result = getTopEligibleTask(
        [activePackaging],
        orders,
        'h_abdul',
        'helper',
        null,
        { washers: 2, dryers: 2, ironingStations: 2 },
        true,
        ABDUL_PHONE
      );

      expect(result).toBeNull();
    });

    it('does NOT pull a helper who is already doing tagging', () => {
      const activeTagging = makeProcess({
        id: 'p_tag_cur',
        orderId: 'o_tag_cur',
        steps: ['tagging', 'getting_washed', 'getting_dried', 'packaging'],
        currentIndex: 0,
        status: 'tagging',
        stages: {
          tagging: {
            assignee: 'h_abdul',
            startedAt: Date.now() - 30_000,
          },
        },
      });

      const orders = [
        { id: 'o_tag_cur', status: 'processing', userId: 'u1', serviceType: 'wash_fold' },
        { id: 'o_wash_new', status: 'pickup_completed', userId: 'u2', serviceType: 'wash_fold' },
      ];

      const result = getTopEligibleTask(
        [activeTagging],
        orders,
        'h_abdul',
        'helper',
        null,
        { washers: 2, dryers: 2, ironingStations: 2 },
        true,
        ABDUL_PHONE
      );

      expect(result).toBeNull();
    });
  });
});