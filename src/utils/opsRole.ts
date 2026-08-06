import { ShiftRole } from '../types';

export interface OpsStaffRoster {
  phones: Record<string, ShiftRole>;
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return phone;
}

export function resolveRoleFromRoster(
  phone: string | null,
  roster: OpsStaffRoster | null,
): ShiftRole | null {
  if (!phone || !roster?.phones) return null;
  return roster.phones[normalizePhone(phone)] ?? roster.phones[phone] ?? null;
}
