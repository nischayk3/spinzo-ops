// Pure dispatch helpers. No firebase imports — unit-testable with `node --test`.

/** Normalize a phone number to full E.164 (+91XXXXXXXXXX). */
function normalizePhone(phone) {
  if (typeof phone !== 'string') return '';
  const p = phone.trim();
  if (!p) return '';
  if (p.startsWith('+')) return p.replace(/[^+\d]/g, '');
  const digits = p.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return '';
}

/**
 * Pick the least-busy on-shift rider from eligible candidates.
 * @param {Array<{uid: string, phone?: string, shiftStartAt?: number}>} candidates
 * @param {Record<string, number>} taskCounts - pending task count keyed by uid
 * @param {Record<string, string>} rosterPhones - config/opsStaff.phones map (full E.164 -> role)
 * @returns {string|null} selected uid, or null if none eligible
 */
function pickRider(candidates, taskCounts, rosterPhones) {
  const roster = rosterPhones || {};
  const eligible = candidates.filter((c) => {
    const phone = normalizePhone(c.phone || '');
    return phone !== '' && roster[phone] === 'rider';
  });
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    const ta = taskCounts[a.uid] || 0;
    const tb = taskCounts[b.uid] || 0;
    if (ta !== tb) return ta - tb;
    return (a.shiftStartAt || 0) - (b.shiftStartAt || 0);
  });
  return eligible[0].uid;
}

module.exports = { pickRider, normalizePhone };
