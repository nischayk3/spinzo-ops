import { describe, it, expect } from 'vitest';
import { STAGE_SLA_MINUTES, slaRemainingMinutes, slaTone, SlaTone } from './sla';

describe('STAGE_SLA_MINUTES', () => {
  it('defines SLAs for the processing stages', () => {
    expect(STAGE_SLA_MINUTES.tagging).toBe(30);
    expect(STAGE_SLA_MINUTES.prestain).toBe(20);
    expect(STAGE_SLA_MINUTES.getting_washed).toBe(45);
    expect(STAGE_SLA_MINUTES.getting_dried).toBe(60);
    expect(STAGE_SLA_MINUTES.getting_folded).toBe(30);
    expect(STAGE_SLA_MINUTES.getting_ironed).toBe(45);
  });
});

describe('slaRemainingMinutes', () => {
  it('returns full SLA when there is no startedAt', () => {
    expect(slaRemainingMinutes(null, 30)).toBe(30);
    expect(slaRemainingMinutes(undefined, 45)).toBe(45);
  });

  it('computes remaining from a numeric ms timestamp', () => {
    const started = Date.now() - 10 * 60000; // 10 minutes ago
    const remaining = slaRemainingMinutes(started, 30);
    expect(remaining).toBeGreaterThanOrEqual(19.5);
    expect(remaining).toBeLessThanOrEqual(20.5);
  });

  it('supports Firestore { seconds } timestamps', () => {
    const started = { seconds: (Date.now() - 5 * 60000) / 1000 };
    const remaining = slaRemainingMinutes(started, 60);
    expect(remaining).toBeGreaterThanOrEqual(54.5);
    expect(remaining).toBeLessThanOrEqual(55.5);
  });

  it('returns full SLA on NaN timestamps', () => {
    expect(slaRemainingMinutes('not-a-date', 25)).toBe(25);
  });

  it('never goes below zero', () => {
    const started = Date.now() - 120 * 60000; // 2 hours ago
    expect(slaRemainingMinutes(started, 30)).toBe(0);
  });
});

describe('slaTone', () => {
  it('is muted when done', () => {
    expect(slaTone(1000, true)).toBe('muted');
    expect(slaTone(0, true)).toBe('muted');
  });

  it('is error at or below 30 minutes remaining', () => {
    expect(slaTone(30, false)).toBe('error');
    expect(slaTone(0, false)).toBe('error');
    expect(slaTone(15, false)).toBe('error');
  });

  it('is warning between 30 and 60 minutes remaining', () => {
    expect(slaTone(31, false)).toBe('warning');
    expect(slaTone(45, false)).toBe('warning');
    expect(slaTone(60, false)).toBe('warning');
  });

  it('is ok above 60 minutes remaining', () => {
    expect(slaTone(61, false)).toBe('ok');
    expect(slaTone(120, false)).toBe('ok');
  });

  it('returns the declared union type values', () => {
    const tones: SlaTone[] = ['muted', 'error', 'warning', 'ok'];
    expect(tones).toContain(slaTone(10, false));
  });
});
