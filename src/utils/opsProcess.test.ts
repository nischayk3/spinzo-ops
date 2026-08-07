import { describe, it, expect } from 'vitest';
import {
  OpsProcess,
  parseOpsProcess,
  currentStep,
  isDone,
  stage,
  stepQueue,
  myInProgress,
  stepLabel,
  currentStepLabel,
} from './opsProcess';

describe('stepLabel', () => {
  it('maps process statuses to human labels', () => {
    expect(stepLabel('tagging')).toBe('Tagging');
    expect(stepLabel('getting_washed')).toBe('Washing');
    expect(stepLabel('getting_dried')).toBe('Drying');
    expect(stepLabel('getting_folded')).toBe('Folding');
    expect(stepLabel('getting_ironed')).toBe('Ironing');
    expect(stepLabel('iron_ready')).toBe('Ready for iron');
    expect(stepLabel('done')).toBe('Done');
    expect(stepLabel('bogus')).toBe('bogus');
  });
});

describe('parseOpsProcess — new shape', () => {
  it('maps id, stages and garments through', () => {
    const p = parseOpsProcess('ORD1', {
      orderId: 'ORD1',
      steps: ['tagging', 'getting_washed'],
      currentIndex: 1,
      status: 'getting_washed',
      stages: {
        tagging: { assignee: 'u1', startedAt: 100, completedAt: 200, durationMs: 100 },
        getting_washed: { assignee: 'u2', startedAt: 300 },
      },
      garments: { count: 2, labels: [{ seq: 1, qr: 'SPNZ:x:1' }] },
      claimedAt: 50,
    });
    expect(p.id).toBe('ORD1');
    expect(p.orderId).toBe('ORD1');
    expect(p.steps).toEqual(['tagging', 'getting_washed']);
    expect(p.currentIndex).toBe(1);
    expect(p.status).toBe('getting_washed');
    expect(p.stages.tagging).toEqual({ assignee: 'u1', startedAt: 100, completedAt: 200, durationMs: 100 });
    expect(p.stages.getting_washed).toEqual({ assignee: 'u2', startedAt: 300 });
    expect(p.garments.count).toBe(2);
    expect(p.claimedAt).toBe(50);
  });

  it('defaults stages and garments when absent', () => {
    const p = parseOpsProcess('ORD1', { orderId: 'ORD1' });
    expect(p.stages).toEqual({});
    expect(p.garments).toEqual({ labels: [], registered: [] });
    expect(p.currentIndex).toBe(0);
    expect(p.status).toBe('tagging');
    expect(p.steps).toEqual([]);
  });

  it('keeps garments when present even without labels/registered', () => {
    const p = parseOpsProcess('ORD1', { orderId: 'ORD1', garments: { count: 5 } });
    expect(p.garments).toEqual({ count: 5 });
  });
});

describe('parseOpsProcess — legacy fallback', () => {
  it('maps legacy stepTimes + assignee into per-step stages', () => {
    const p = parseOpsProcess('ORD1', {
      orderId: 'ORD1',
      assignee: 'u9',
      steps: ['tagging', 'getting_washed'],
      currentIndex: 0,
      status: 'tagging',
      stepTimes: {
        tagging: { startedAt: 100, completedAt: 200, durationMs: 100 },
        getting_washed: { startedAt: 300 },
      },
    });
    expect(p.stages.tagging).toEqual({ assignee: 'u9', startedAt: 100, completedAt: 200, durationMs: 100 });
    expect(p.stages.getting_washed).toEqual({ assignee: 'u9', startedAt: 300 });
  });

  it('falls back to assignee for a tagging stage when there is no stepTimes', () => {
    const p = parseOpsProcess('ORD1', {
      orderId: 'ORD1',
      assignee: 'u7',
      steps: ['tagging', 'getting_washed'],
      currentIndex: 0,
      status: 'tagging',
    });
    expect(p.stages.tagging).toEqual({ assignee: 'u7' });
  });

  it('survives null snapshot', () => {
    const p = parseOpsProcess('ORD1', null);
    expect(p.id).toBe('ORD1');
    expect(p.steps).toEqual([]);
    expect(p.stages).toEqual({});
    expect(p.garments).toEqual({ labels: [], registered: [] });
  });
});

describe('derived helpers', () => {
  const base = (overrides: Partial<OpsProcess>): OpsProcess =>
    parseOpsProcess('ORD1', {
      orderId: 'ORD1',
      steps: ['tagging', 'getting_washed', 'getting_dried'],
      currentIndex: 0,
      status: 'tagging',
      stages: {
        tagging: { assignee: 'u1', startedAt: 100 },
        getting_washed: { assignee: 'u2' },
      },
      ...overrides,
    });

  it('currentStep returns the step at currentIndex', () => {
    expect(currentStep(base({}))).toBe('tagging');
    expect(currentStep(base({ currentIndex: 2 }))).toBe('getting_dried');
  });

  it('currentStep returns null for an empty pipeline', () => {
    expect(currentStep(parseOpsProcess('O', { orderId: 'O', steps: [] }))).toBeNull();
  });

  it('isDone is true only when status is done', () => {
    expect(isDone(base({ status: 'done' }))).toBe(true);
    expect(isDone(base({ status: 'tagging' }))).toBe(false);
  });

  it('stage returns the record for a step', () => {
    expect(stage(base({}), 'tagging')).toEqual({ assignee: 'u1', startedAt: 100 });
    expect(stage(base({}), 'getting_washed')).toEqual({ assignee: 'u2' });
    expect(stage(base({}), 'missing')).toBeUndefined();
  });

  it('stepQueue is true only for the current step that has not started', () => {
    // getting_washed is current (index 1) and unstarted
    const p = base({ currentIndex: 1, status: 'getting_washed' });
    expect(stepQueue(p, 'getting_washed')).toBe(true);
    // started steps are not queueable
    expect(stepQueue(p, 'tagging')).toBe(false);
    // non-current steps are not queueable
    expect(stepQueue(p, 'getting_dried')).toBe(false);
  });

  it('myInProgress is true when the current step is assigned to uid and not completed', () => {
    const p = base({ currentIndex: 1, status: 'getting_washed' }); // assignee u2
    expect(myInProgress(p, 'u2')).toBe(true);
  });

  it('myInProgress is false when completed', () => {
    const p = base({
      currentIndex: 1,
      status: 'getting_washed',
      stages: { ...base({}).stages, getting_washed: { assignee: 'u2', startedAt: 1, completedAt: 2 } },
    });
    expect(myInProgress(p, 'u2')).toBe(false);
  });

  it('myInProgress is false when the process is done', () => {
    const p = base({ status: 'done' });
    expect(myInProgress(p, 'u1')).toBe(false);
  });

  it('myInProgress is false when assigned to another user', () => {
    const p = base({ currentIndex: 1, status: 'getting_washed' });
    expect(myInProgress(p, 'someone-else')).toBe(false);
  });

  it('myInProgress is false when the current step has no assignee', () => {
    const p = base({ currentIndex: 2, status: 'getting_dried' });
    expect(myInProgress(p, 'u2')).toBe(false);
  });

  it('myInProgress is false when there is no current step', () => {
    const p = parseOpsProcess('O', { orderId: 'O', steps: [], status: 'tagging' });
    expect(myInProgress(p, 'u1')).toBe(false);
  });
});

describe('currentStepLabel', () => {
  it('labels the current step', () => {
    const p = parseOpsProcess('ORD1', { steps: ['getting_washed', 'getting_dried'], currentIndex: 1, status: 'getting_dried' });
    expect(currentStepLabel(p)).toBe('Drying');
  });
});
