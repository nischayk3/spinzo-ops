import { describe, it, expect } from 'vitest';
import { normalizePhone, resolveRoleFromRoster, OpsStaffRoster } from '../opsRole';

describe('opsRole', () => {
  it('normalizes 10-digit to +91', () => {
    expect(normalizePhone('9661802634')).toBe('+919661802634');
  });

  it('normalizes +91-prefixed and spaces', () => {
    expect(normalizePhone('+91 96618 02634')).toBe('+919661802634');
  });

  it('resolves role from roster by normalized phone', () => {
    const roster: OpsStaffRoster = { phones: { '+919661802634': 'supervisor', '+919852030638': 'rider' } };
    expect(resolveRoleFromRoster('9661802634', roster)).toBe('supervisor');
  });

  it('returns null for unknown phone or missing roster', () => {
    const roster: OpsStaffRoster = { phones: { '+919661802634': 'supervisor' } };
    expect(resolveRoleFromRoster('9852030638', roster)).toBeNull();
    expect(resolveRoleFromRoster('9661802634', null)).toBeNull();
    expect(resolveRoleFromRoster(null, roster)).toBeNull();
  });
});
