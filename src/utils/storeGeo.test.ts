import { describe, it, expect } from 'vitest';
import { haversineMeters, isWithinRadiusMeters, LatLng } from './storeGeo';

describe('haversineMeters', () => {
  it('returns 0 for identical points', () => {
    const p: LatLng = { latitude: 28.6139, longitude: 77.209 };
    expect(haversineMeters(p, p)).toBe(0);
  });

  it('computes Delhi to northern Delhi approx ~3.6km within tolerance', () => {
    const delhi: LatLng = { latitude: 28.6139, longitude: 77.209 };
    const north: LatLng = { latitude: 28.645, longitude: 77.22 };
    const meters = haversineMeters(delhi, north);
    expect(meters).toBeGreaterThan(3500);
    expect(meters).toBeLessThan(3750);
  });

  it('is symmetric', () => {
    const a: LatLng = { latitude: 28.6139, longitude: 77.209 };
    const b: LatLng = { latitude: 28.645, longitude: 77.22 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });
});

describe('isWithinRadiusMeters', () => {
  const store: LatLng = { latitude: 28.6139, longitude: 77.209 };

  it('is true when the user is within the radius', () => {
    const user: LatLng = { latitude: 28.6139, longitude: 77.2095 }; // ~50m east
    expect(isWithinRadiusMeters(user, store, 100)).toBe(true);
  });

  it('is false when the user is outside the radius', () => {
    const user: LatLng = { latitude: 28.645, longitude: 77.22 }; // ~3.6km away
    expect(isWithinRadiusMeters(user, store, 1000)).toBe(false);
  });

  it('is true at exactly the radius boundary', () => {
    const user: LatLng = { latitude: 28.6139, longitude: 77.209 };
    expect(isWithinRadiusMeters(user, store, 0)).toBe(true);
  });
});
