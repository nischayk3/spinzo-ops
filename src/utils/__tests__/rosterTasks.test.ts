import { describe, it, expect } from 'vitest';
import { getHelperLiveTasks } from '../rosterTasks';

describe('getHelperLiveTasks', () => {
  it('returns empty array when helper has 0 assigned tasks or only done processes', () => {
    const helper = { uid: 'h1', name: 'Ravi', phone: '+919876543210' };
    const processes = [
      {
        id: 'ord_done',
        orderId: 'ord_done',
        status: 'done',
        steps: ['tagging', 'done'],
        currentIndex: 1,
        stages: {
          tagging: { assignee: 'h1', completedAt: 1000 },
        },
      },
      {
        id: 'ord_other',
        orderId: 'ord_other',
        status: 'tagging',
        steps: ['tagging', 'getting_washed'],
        currentIndex: 0,
        stages: {
          tagging: { assignee: 'h2', startedAt: 1000 },
        },
      },
    ];

    expect(getHelperLiveTasks(helper, processes)).toEqual([]);
    expect(getHelperLiveTasks(helper, [])).toEqual([]);
  });

  it('finds a single active task assigned to the helper', () => {
    const helper = { uid: 'h1', name: 'Ravi', phone: '+919876543210' };
    const processes = [
      {
        id: 'ord_123456',
        orderId: 'ord_123456',
        orderNumber: '123456',
        customerName: 'Ananya',
        status: 'tagging',
        steps: ['tagging', 'getting_washed'],
        currentIndex: 0,
        tokenNumber: 'T-09',
        serviceLabel: 'Wash & Fold',
        stages: {
          tagging: { assignee: 'h1', startedAt: 5000, assignedAt: 4000 },
        },
      },
    ];

    const tasks = getHelperLiveTasks(helper, processes);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      processId: 'ord_123456',
      orderId: 'ord_123456',
      orderNumber: '123456',
      customerName: 'Ananya',
      stage: 'tagging',
      stageLabel: 'Tagging',
      tokens: ['T-09'],
      isRunningMachine: false,
      serviceLabel: 'Wash & Fold',
    });
  });

  it('finds 2+ tasks across different stages/loads and sorts running machines and hands-on tasks before unstarted machines', () => {
    const helper = { uid: 'h1', name: 'Ravi' };
    const processes = [
      {
        id: 'ord_a__1',
        orderId: 'ord_a',
        customerName: 'Customer A',
        status: 'getting_dried',
        steps: ['tagging', 'getting_washed', 'getting_dried'],
        currentIndex: 2,
        tokens: ['T-1', 'T-2'],
        stages: {
          // Unstarted dryer task -> priority 2
          getting_dried: { assignee: 'h1', assignedAt: 1000, machineName: 'Dryer 2' },
        },
      },
      {
        id: 'ord_b__1',
        orderId: 'ord_b',
        customerName: 'Customer B',
        status: 'packaging',
        steps: ['tagging', 'packaging'],
        currentIndex: 1,
        tokenNumber: 'T-5',
        stages: {
          // Active hands-on task -> priority 1
          packaging: { assignee: 'h1', startedAt: 3000 },
        },
      },
      {
        id: 'ord_c__2',
        orderId: 'ord_c',
        customerName: 'Customer C',
        status: 'getting_washed',
        steps: ['tagging', 'getting_washed'],
        currentIndex: 1,
        tokenNumber: 'T-8',
        stages: {
          // Running washer -> priority 0
          getting_washed: { assignee: 'h1', startedAt: 2000, machineName: 'Washer 1' },
        },
      },
    ];

    const tasks = getHelperLiveTasks(helper, processes);
    expect(tasks).toHaveLength(3);
    expect(tasks.map((t) => t.processId)).toEqual(['ord_c__2', 'ord_b__1', 'ord_a__1']);
    expect(tasks[0].isRunningMachine).toBe(true);
    expect(tasks[0].machineName).toBe('Washer 1');
    expect(tasks[1].isRunningMachine).toBe(false);
    expect(tasks[1].stage).toBe('packaging');
    expect(tasks[2].isRunningMachine).toBe(false);
    expect(tasks[2].stage).toBe('getting_dried');
  });

  it('deduplicates same processId + stage and supports multiple incomplete stages on same process', () => {
    const helper = { uid: 'h1', id: 'h1' };
    const processes = [
      {
        id: 'ord_dup',
        orderId: 'ord_dup',
        status: 'getting_washed',
        steps: ['tagging', 'getting_washed', 'getting_dried'],
        currentIndex: 1,
        stages: {
          tagging: { assignee: 'h1', completedAt: 100 }, // completed, should be excluded
          getting_washed: { assignee: 'h1', startedAt: 200 },
          getting_dried: { assignee: 'h1', assignedAt: 300 }, // incomplete pre-assigned stage
        },
      },
      // Duplicate entry in array for same processId + stage
      {
        id: 'ord_dup',
        orderId: 'ord_dup',
        status: 'getting_washed',
        steps: ['tagging', 'getting_washed'],
        currentIndex: 1,
        stages: {
          getting_washed: { assignee: 'h1', startedAt: 200 },
        },
      },
    ];

    const tasks = getHelperLiveTasks(helper, processes);
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => `${t.processId}:${t.stage}`)).toEqual([
      'ord_dup:getting_washed',
      'ord_dup:getting_dried',
    ]);
  });

  it('matches helper via phone last-10 digits or case-insensitive name fallback', () => {
    const helper = { uid: 'h_uid_99', name: 'Suresh Kumar', phone: '+91 98765-43210' };
    const processes = [
      {
        id: 'ord_phone',
        orderId: 'ord_phone',
        status: 'tagging',
        steps: ['tagging'],
        currentIndex: 0,
        stages: {
          tagging: { assignee: '9876543210', assignedAt: 1000 },
        },
      },
      {
        id: 'ord_name',
        orderId: 'ord_name',
        status: 'getting_ironed',
        steps: ['getting_ironed'],
        currentIndex: 0,
        stages: {
          getting_ironed: { assignee: 'legacy_id', assigneeName: '  suresh kumar ', startedAt: 2000 },
        },
      },
    ];

    const tasks = getHelperLiveTasks(helper, processes);
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.orderId)).toEqual(['ord_phone', 'ord_name']);
  });
});
