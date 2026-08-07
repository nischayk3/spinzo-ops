import { describe, it, expect } from 'vitest';
import { parseOpsProcess, stepLabel, currentStepLabel } from '../opsProcess';

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

describe('parseOpsProcess', () => {
  it('maps id + fields', () => {
    const p = parseOpsProcess('ORD1', { orderId: 'ORD1', assignee: 'u1', steps: ['tagging', 'getting_washed'], currentIndex: 1, status: 'getting_washed', stepTimes: { tagging: { startedAt: 1 } } });
    expect(p.id).toBe('ORD1');
    expect(p.orderId).toBe('ORD1');
    expect(p.status).toBe('getting_washed');
    expect(p.steps).toEqual(['tagging', 'getting_washed']);
    expect(p.stages.tagging).toEqual({ assignee: 'u1', startedAt: 1 });
  });
  it('survives null snapshot', () => {
    const p = parseOpsProcess('ORD1', null);
    expect(p.id).toBe('ORD1');
    expect(p.steps).toEqual([]);
    expect(p.stages).toEqual({});
  });
});

describe('currentStepLabel', () => {
  it('labels the current step', () => {
    const p = parseOpsProcess('ORD1', { steps: ['getting_washed', 'getting_dried'], currentIndex: 1, status: 'getting_dried', stepTimes: {} });
    expect(currentStepLabel(p)).toBe('Drying');
  });
});
