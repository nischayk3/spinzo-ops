import { describe, it, expect } from 'vitest';
import { getProcessNudge, STAGE_NUDGE_RULES, recordLocalSnooze, clearLocalSnooze } from '../stageNudges';
import { OpsProcess } from '../opsProcess';

function makeTestProcess(cur: 'getting_washed' | 'getting_dried', stageData: any): OpsProcess {
  return {
    id: 'proc_1',
    orderId: 'ord_1',
    steps: [cur],
    currentIndex: 0,
    status: cur,
    stages: {
      [cur]: stageData,
    },
    garments: { count: 0, labels: [], registered: [] },
  };
}

describe('stageNudges', () => {
  const UID = 'helper_1';

  it('triggers wash accepted nudge after 5 minutes', () => {
    const baseTime = 1000000;
    const process = makeTestProcess('getting_washed', {
      assignee: UID,
      acceptedAt: baseTime,
    });

    // 4 minutes: not due yet
    expect(getProcessNudge(process, UID, baseTime + 4 * 60 * 1000)).toBeNull();

    // 5 minutes: due!
    const nudge = getProcessNudge(process, UID, baseTime + 5 * 60 * 1000);
    expect(nudge).not.toBeNull();
    expect(nudge?.phase).toBe('accepted');
    expect(nudge?.snoozeLabel).toBe('Still Pre-staining (+5m)');
    expect(nudge?.actionLabel).toBe('Start Washing');
  });

  it('respects 5-minute snooze loop after wash accepted', () => {
    const baseTime = 1000000;
    const snoozedAt = baseTime + 5 * 60 * 1000;
    const process = makeTestProcess('getting_washed', {
      assignee: UID,
      acceptedAt: baseTime,
      nudge: {
        accepted: {
          lastSnoozedAt: snoozedAt,
          snoozeCount: 1,
        },
      },
    });

    // 4 minutes after snooze: suppressed
    expect(getProcessNudge(process, UID, snoozedAt + 4 * 60 * 1000)).toBeNull();

    // 5 minutes after snooze: fires again!
    const nudge = getProcessNudge(process, UID, snoozedAt + 5 * 60 * 1000);
    expect(nudge).not.toBeNull();
    expect(nudge?.snoozeLabel).toBe('Still Pre-staining (+5m)');
  });

  it('triggers wash started nudge after 37 minutes and allows 5-min snooze', () => {
    const baseTime = 1000000;
    const process = makeTestProcess('getting_washed', {
      assignee: UID,
      acceptedAt: baseTime - 10000,
      startedAt: baseTime,
    });

    // 36 minutes: suppressed
    expect(getProcessNudge(process, UID, baseTime + 36 * 60 * 1000)).toBeNull();

    // 37 minutes: fires!
    const nudge = getProcessNudge(process, UID, baseTime + 37 * 60 * 1000);
    expect(nudge).not.toBeNull();
    expect(nudge?.phase).toBe('started');
    expect(nudge?.snoozeLabel).toBe('Still running');
    expect(nudge?.actionLabel).toBe('Complete Washing');
  });

  it('triggers dry accepted after 5 mins (5 min snooze) and dry started after 46 mins (3 min snooze)', () => {
    const baseTime = 2000000;
    const dryProcess = makeTestProcess('getting_dried', {
      assignee: UID,
      acceptedAt: baseTime,
    });

    // Dry accept: fires after 5m
    expect(getProcessNudge(dryProcess, UID, baseTime + 4 * 60 * 1000)).toBeNull();
    const dryAcceptNudge = getProcessNudge(dryProcess, UID, baseTime + 5 * 60 * 1000);
    expect(dryAcceptNudge?.snoozeLabel).toBe('Still transferring (+5m)');
    expect(dryAcceptNudge?.actionLabel).toBe('Start Drying');

    // Dry start: fires after 46m
    const dryStartedProcess = makeTestProcess('getting_dried', {
      assignee: UID,
      startedAt: baseTime,
    });
    expect(getProcessNudge(dryStartedProcess, UID, baseTime + 45 * 60 * 1000)).toBeNull();
    const dryStartedNudge = getProcessNudge(dryStartedProcess, UID, baseTime + 46 * 60 * 1000);
    expect(dryStartedNudge?.snoozeLabel).toBe('Still running');
    expect(dryStartedNudge?.actionLabel).toBe('Complete Drying');
  });

  it('suppresses nudges instantly when recordLocalSnooze is called', () => {
    const baseTime = 3000000;
    const process = makeTestProcess('getting_washed', {
      assignee: UID,
      acceptedAt: baseTime,
    });

    // At 5m, it's due
    const now = baseTime + 5 * 60 * 1000;
    expect(getProcessNudge(process, UID, now)).not.toBeNull();

    // Call recordLocalSnooze
    recordLocalSnooze('proc_1_getting_washed_accepted', now);

    // 2m later, it must be suppressed locally
    expect(getProcessNudge(process, UID, now + 2 * 60 * 1000)).toBeNull();

    // After repeat interval (5m later), it becomes due again
    expect(getProcessNudge(process, UID, now + 5 * 60 * 1000)).not.toBeNull();

    // Clean up
    clearLocalSnooze('proc_1_getting_washed_accepted');
  });

  it('allows supervisors to receive unstarted machine nudges even if assigned to someone else', () => {
    const baseTime = 4000000;
    const process = makeTestProcess('getting_washed', {
      assignee: 'other_helper',
      acceptedAt: baseTime,
    });

    const now = baseTime + 6 * 60 * 1000;
    // Another helper does not see it
    expect(getProcessNudge(process, 'helper_different', now, 'helper')).toBeNull();

    // Supervisor sees it
    const supervisorNudge = getProcessNudge(process, 'supervisor_1', now, 'supervisor');
    expect(supervisorNudge).not.toBeNull();
    expect(supervisorNudge?.actionLabel).toBe('Start Washing');
  });
});

