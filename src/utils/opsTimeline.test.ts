import { describe, it, expect } from 'vitest';
import { OpsProcess, parseOpsProcess } from './opsProcess';
import { opsTimeline } from './opsTimeline';

const stepLabelFn = (s: string) => (s === 'tagging' ? 'Tagging' : s === 'getting_washed' ? 'Washing' : s);

describe('opsTimeline', () => {
  it('produces an entry per step carrying label, timings and assignee', () => {
    const p: OpsProcess = parseOpsProcess('O1', {
      orderId: 'O1',
      steps: ['tagging', 'getting_washed'],
      currentIndex: 1,
      status: 'getting_washed',
      stages: {
        tagging: { assigneeName: 'Ravi', startedAt: 100, completedAt: 200, durationMs: 100 },
        getting_washed: { assignee: 'u1', assigneeName: 'Amit', startedAt: 300 },
      },
    });

    const timeline = opsTimeline(p, stepLabelFn);

    expect(timeline).toHaveLength(2);

    const tagging = timeline[0];
    expect(tagging.step).toBe('tagging');
    expect(tagging.label).toBe('Tagging');
    expect(tagging.assigneeName).toBe('Ravi');
    expect(tagging.startedAt).toBe(100);
    expect(tagging.completedAt).toBe(200);
    expect(tagging.durationMs).toBe(100);
    expect(tagging.skipped).toBe(false);

    const washing = timeline[1];
    expect(washing.step).toBe('getting_washed');
    expect(washing.label).toBe('Washing');
    expect(washing.assigneeName).toBe('Amit');
    expect(washing.startedAt).toBe(300);
    expect(washing.skipped).toBe(false);
  });

  it('marks steps with no startedAt as skipped', () => {
    const p: OpsProcess = parseOpsProcess('O1', {
      orderId: 'O1',
      steps: ['tagging', 'getting_washed', 'getting_dried'],
      currentIndex: 0,
      status: 'tagging',
      stages: {
        tagging: { startedAt: 1 },
      },
    });

    const timeline = opsTimeline(p, stepLabelFn);

    expect(timeline.map(e => e.skipped)).toEqual([false, true, true]);
    expect(timeline[1].startedAt).toBeUndefined();
    expect(timeline[2].durationMs).toBeUndefined();
  });

  it('carries assigneeName but not assignee into entries', () => {
    const p: OpsProcess = parseOpsProcess('O1', {
      orderId: 'O1',
      steps: ['tagging'],
      currentIndex: 0,
      status: 'tagging',
      stages: { tagging: { assignee: 'u1', assigneeName: 'Amit', startedAt: 1 } },
    });

    const timeline = opsTimeline(p, stepLabelFn);
    expect(timeline[0].assigneeName).toBe('Amit');
  });

  it('handles an empty pipeline', () => {
    const p: OpsProcess = parseOpsProcess('O1', { orderId: 'O1', steps: [], currentIndex: 0, status: 'tagging' });
    expect(opsTimeline(p, stepLabelFn)).toEqual([]);
  });
});
