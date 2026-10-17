export interface LatLng {
  latitude: number;
  longitude: number;
}
export type Coordinate = LatLng;

export const SPINZO_STORE_ADDRESS =
  'Gold Loan building, Basement, NO. 12, Outer Ring Rd, below Muthoot Finance, BTM 1st Stage, Bengaluru, Karnataka 560068';

export const SPINZO_STORE_LOCATION: LatLng = {
  latitude: 12.9166,
  longitude: 77.6148,
};

// Precise Polygon boundaries for SpinZo Service Area (from customer geofence)
export const NEW_MAP_POLYGON: Coordinate[] = [
  { latitude: 12.894226891, longitude: 77.599241985 },
  { latitude: 12.899455983, longitude: 77.60076548 },
  { latitude: 12.9022169, longitude: 77.601194633 },
  { latitude: 12.905417016, longitude: 77.601838363 },
  { latitude: 12.907560861, longitude: 77.600465072 },
  { latitude: 12.911953077, longitude: 77.599912534 },
  { latitude: 12.920298065, longitude: 77.600191484 },
  { latitude: 12.932093512, longitude: 77.600620638 },
  { latitude: 12.936527118, longitude: 77.601736437 },
  { latitude: 12.944453038, longitude: 77.602723488 },
  { latitude: 12.943992965, longitude: 77.607487092 },
  { latitude: 12.943700192, longitude: 77.630575547 },
  { latitude: 12.938597502, longitude: 77.63276423 },
  { latitude: 12.920486294, longitude: 77.655681024 },
  { latitude: 12.905866705, longitude: 77.654393562 },
  { latitude: 12.90350323, longitude: 77.64999474 },
  { latitude: 12.90350323, longitude: 77.648728738 },
  { latitude: 12.899612858, longitude: 77.648728738 },
  { latitude: 12.899320032, longitude: 77.645166765 },
  { latitude: 12.896559083, longitude: 77.645424257 },
  { latitude: 12.893839937, longitude: 77.644866358 },
  { latitude: 12.892292103, longitude: 77.644866358 },
  { latitude: 12.891999268, longitude: 77.64411534 },
  { latitude: 12.890702424, longitude: 77.64411534 },
  { latitude: 12.889238238, longitude: 77.640210043 },
  { latitude: 12.8925431, longitude: 77.59892012 },
  { latitude: 12.894226891, longitude: 77.599241985 }, // closes loop
];

export interface ExtraServiceArea {
  id: string;
  name: string;
  ring: Coordinate[];
}

export const EXTRA_SERVICE_AREAS: ExtraServiceArea[] = [
  {
    id: 'nischay_home',
    name: 'Nischay Home',
    ring: [
      { latitude: 12.883565086, longitude: 77.614182565 },
      { latitude: 12.883206874, longitude: 77.614012245 },
      { latitude: 12.882980703, longitude: 77.614751193 },
      { latitude: 12.883406897, longitude: 77.614874575 },
      { latitude: 12.883565086, longitude: 77.614182565 },
    ],
  },
];

export interface ServiceZone {
  id: string;
  name: string;
  center: Coordinate;
  radiusMeters: number;
}

export const SERVICE_ZONES: ServiceZone[] = [
  {
    id: 'btm_store_hub',
    name: 'BTM 1st Stage Hub',
    center: SPINZO_STORE_LOCATION,
    radiusMeters: 3000,
  },
  {
    id: 'jayanagar_area',
    name: 'Jayanagar & Surroundings',
    center: { latitude: 12.9170047, longitude: 77.5883353 },
    radiusMeters: 3100,
  },
  {
    id: 'hsr_layout',
    name: 'HSR Layout & Silk Board',
    center: { latitude: 12.9121, longitude: 77.6446 },
    radiusMeters: 3500,
  },
  {
    id: 'koramangala',
    name: 'Koramangala Blocks',
    center: { latitude: 12.9352, longitude: 77.6245 },
    radiusMeters: 3200,
  },
];

export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export const isWithinRadiusMeters = (user: LatLng, store: LatLng, radiusMeters: number): boolean =>
  haversineMeters(user, store) <= radiusMeters;

export const SERVICE_EDGE_TOLERANCE_METERS = 20;

/**
 * Checks if a coordinate is inside a polygon using ray-casting.
 */
export const isPointInPolygon = (point: Coordinate, polygon: Coordinate[]): boolean => {
  const x = point.longitude;
  const y = point.latitude;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].longitude;
    const yi = polygon[i].latitude;
    const xj = polygon[j].longitude;
    const yj = polygon[j].latitude;

    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }

  return inside;
};

/**
 * Checks if a location is inside SpinZo's operational boundaries.
 */
export const isLocationServiceable = (location?: Coordinate | null): boolean => {
  if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
    return true; // Don't block un-geocoded legacy orders
  }
  if (isPointInPolygon(location, NEW_MAP_POLYGON)) return true;
  return EXTRA_SERVICE_AREAS.some(area => isPointInPolygon(location, area.ring));
};

/**
 * Returns the operational zone name for a given coordinate.
 */
export const getServiceZoneName = (location?: Coordinate | null): string => {
  if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
    return 'SpinZo Hub';
  }
  const pocket = EXTRA_SERVICE_AREAS.find(area => isPointInPolygon(location, area.ring));
  if (pocket) return pocket.name;

  if (isPointInPolygon(location, NEW_MAP_POLYGON)) {
    // Find closest sub-zone center
    let closestZone = SERVICE_ZONES[0];
    let minD = Infinity;
    for (const z of SERVICE_ZONES) {
      const d = haversineMeters(location, z.center);
      if (d < minD) {
        minD = d;
        closestZone = z;
      }
    }
    return closestZone.name;
  }

  return 'Out of Geofence';
};
