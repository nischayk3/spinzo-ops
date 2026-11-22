import { OpsTask, pickupLabel, formatRiderDateLabel, buildRiderSlotDisplay } from './opsTasks';
import { DeliveryTask } from '../store/opsStaffStore';
import { FeedOrder, isExpressOrder, orderTotal, slotLabel } from './orderFeed';
import { haversineMeters, isValidCoord, LatLng, resolveCustomerCoordinates, SPINZO_STORE_ADDRESS, SPINZO_STORE_LOCATION } from './storeGeo';

export interface SmartRouteStop {
  id: string;
  taskId: string;
  stopNumber: number;
  type: 'pickup' | 'delivery' | 'store_dropoff' | 'store_pickup';
  orderId: string;
  orderNumber: string;
  customerName?: string;
  customerPhone?: string;
  address: string;
  locality: string;
  slotText: string;
  slot?: string;
  isUrgent: boolean;
  isInstant: boolean;
  isExpress?: boolean;
  distanceMeters?: number;
  legDistanceMeters?: number;
  cumulativeDistanceMeters?: number;
  status: string;
  totalAmount?: number;
  paymentStatus?: string;
  latitude?: number;
  longitude?: number;
  loadUnits: number;
  rawTask: OpsTask | DeliveryTask;
  order?: FeedOrder;
}

export function estimateLoadUnits(order?: FeedOrder, task?: OpsTask | DeliveryTask): number {
  const items = order?.items || (task as any)?.items || [];
  let isBulky = false;
  let totalWeight = 0;

  for (const it of items) {
    const sid = String(it.serviceType || (it as any).serviceId || '').toLowerCase();
    if (sid.includes('blanket') || (it as any).blanketType) {
      isBulky = true;
    }
    if (it.weight) {
      totalWeight += it.weight;
    } else if (it.quantity && it.unit === 'kg') {
      totalWeight += it.quantity;
    }
  }

  if (isBulky || totalWeight >= 8) return 2;
  return 1;
}

export function extractLocality(addressText?: string | null): string {
  if (!addressText || typeof addressText !== 'string') return 'Local';
  const clean = addressText.toLowerCase();

  // 1. Primary Bangalore neighborhoods:
  const primaryAreas = [
    { key: 'hsr layout', label: 'HSR LAYOUT' },
    { key: 'koramangala', label: 'KORAMANGALA' },
    { key: 'bellandur', label: 'BELLANDUR' },
    { key: 'btm layout', label: 'BTM LAYOUT' },
    { key: 'btm 1st stage', label: 'BTM 1ST STAGE' },
    { key: 'btm 2nd stage', label: 'BTM 2ND STAGE' },
    { key: 'btm', label: 'BTM LAYOUT' },
    { key: 'sarjapur road', label: 'SARJAPUR ROAD' },
    { key: 'sarjapur', label: 'SARJAPUR' },
    { key: 'indiranagar', label: 'INDIRANAGAR' },
    { key: 'marathahalli', label: 'MARATHAHALLI' },
    { key: 'electronic city', label: 'ELECTRONIC CITY' },
    { key: 'jp nagar', label: 'JP NAGAR' },
    { key: 'jayanagar', label: 'JAYANAGAR' },
    { key: 'whitefield', label: 'WHITEFIELD' },
  ];

  for (const item of primaryAreas) {
    if (clean.includes(item.key)) {
      return item.label;
    }
  }

  // 2. Specific landmarks & sectors (when main area is not explicitly written):
  if (clean.includes('silk board')) return 'HSR SILK BOARD';
  if (clean.includes('green glen')) return 'BELLANDUR';
  if (clean.includes('1st sector') || clean.includes('sector 1')) return 'HSR SECTOR 1';
  if (clean.includes('2nd sector') || clean.includes('sector 2')) return 'HSR SECTOR 2';
  if (clean.includes('3rd sector') || clean.includes('sector 3')) return 'HSR SECTOR 3';
  if (clean.includes('4th sector') || clean.includes('sector 4')) return 'HSR SECTOR 4';
  if (clean.includes('5th sector') || clean.includes('sector 5')) return 'HSR SECTOR 5';
  if (clean.includes('6th sector') || clean.includes('sector 6')) return 'HSR SECTOR 6';
  if (clean.includes('7th sector') || clean.includes('sector 7')) return 'HSR SECTOR 7';
  if (clean.includes('1st block') || clean.includes('block 1')) return 'KORAMANGALA 1ST BLOCK';
  if (clean.includes('3rd block') || clean.includes('block 3')) return 'KORAMANGALA 3RD BLOCK';
  if (clean.includes('4th block') || clean.includes('block 4')) return 'KORAMANGALA 4TH BLOCK';
  if (clean.includes('5th block') || clean.includes('block 5')) return 'KORAMANGALA 5TH BLOCK';
  if (clean.includes('6th block') || clean.includes('block 6')) return 'KORAMANGALA 6TH BLOCK';
  if (clean.includes('7th block') || clean.includes('block 7')) return 'KORAMANGALA 7TH BLOCK';
  if (clean.includes('8th block') || clean.includes('block 8')) return 'KORAMANGALA 8TH BLOCK';

  if (clean.includes('hsr')) return 'HSR LAYOUT';

  // 3. Pincode mapping for South/East Bangalore:
  if (clean.includes('560102')) return 'HSR LAYOUT';
  if (clean.includes('560095') || clean.includes('560034')) return 'KORAMANGALA';
  if (clean.includes('560068')) return 'BTM / BOMMANAHALLI';
  if (clean.includes('560076')) return 'BTM 2ND STAGE';
  if (clean.includes('560103')) return 'BELLANDUR';
  if (clean.includes('560037')) return 'MARATHAHALLI';
  if (clean.includes('560100')) return 'ELECTRONIC CITY';
  if (clean.includes('560078')) return 'JP NAGAR';
  if (clean.includes('560041')) return 'JAYANAGAR';
  if (clean.includes('560038') || clean.includes('560008')) return 'INDIRANAGAR';
  if (clean.includes('560066')) return 'WHITEFIELD';

  // 4. Fallback: extract the cleanest token that is not generic city/state
  const ignore = new Set(['bengaluru', 'bangalore', 'karnataka', 'india']);
  const parts = addressText.split(',').map(p => p.trim()).filter(p => {
    const low = p.toLowerCase();
    return !ignore.has(low) && !/^\d{5,6}$/.test(p);
  });

  if (parts.length >= 1) {
    return parts[parts.length - 1].toUpperCase();
  }
  return 'LOCAL';
}

export function parseSlotTimeWeight(slotText?: string | null): number {
  if (!slotText) return 1200; // default midday
  const lower = slotText.toLowerCase().trim();

  if (lower.includes('instant')) return 0; // immediate SLA

  // Extract start time part (before dash, en-dash, or 'to')
  const startPart = lower.split(/[-–—]| to /)[0].trim();

  // Try extracting hour and optional minute and am/pm
  const match = startPart.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (match) {
    let hour = parseInt(match[1], 10);
    const minute = match[2] ? parseInt(match[2], 10) : 0;
    const meridian = match[3];

    if (meridian === 'pm' && hour < 12) hour += 12;
    if (meridian === 'am' && hour === 12) hour = 0;
    return hour * 60 + minute;
  }

  return 1200;
}

export function safeShortId(id?: string | null): string {
  if (!id || typeof id !== 'string') return '------';
  return id.slice(-6).toUpperCase();
}

export function safeAddressText(addr: any): string {
  if (!addr) return 'Customer Address';
  if (typeof addr === 'string') return addr;
  return addr.formattedAddress || addr.address || addr.fullAddress || addr.line1 || 'Customer Address';
}

export const LOCALITY_COORDINATES: Record<string, LatLng> = {
  'HSR SILK BOARD': { latitude: 12.9172, longitude: 77.6228 },
  'HSR LAYOUT': { latitude: 12.9121, longitude: 77.6446 },
  'HSR SECTOR 1': { latitude: 12.9232, longitude: 77.6508 },
  'HSR SECTOR 2': { latitude: 12.9080, longitude: 77.6470 },
  'HSR SECTOR 3': { latitude: 12.9110, longitude: 77.6390 },
  'HSR SECTOR 4': { latitude: 12.9150, longitude: 77.6360 },
  'HSR SECTOR 5': { latitude: 12.9200, longitude: 77.6350 },
  'HSR SECTOR 6': { latitude: 12.9220, longitude: 77.6410 },
  'HSR SECTOR 7': { latitude: 12.9050, longitude: 77.6420 },
  'KORAMANGALA': { latitude: 12.9352, longitude: 77.6245 },
  'KORAMANGALA 1ST BLOCK': { latitude: 12.9270, longitude: 77.6310 },
  'KORAMANGALA 3RD BLOCK': { latitude: 12.9310, longitude: 77.6260 },
  'KORAMANGALA 4TH BLOCK': { latitude: 12.9330, longitude: 77.6320 },
  'KORAMANGALA 5TH BLOCK': { latitude: 12.9350, longitude: 77.6180 },
  'KORAMANGALA 6TH BLOCK': { latitude: 12.9380, longitude: 77.6220 },
  'KORAMANGALA 7TH BLOCK': { latitude: 12.9400, longitude: 77.6150 },
  'KORAMANGALA 8TH BLOCK': { latitude: 12.9420, longitude: 77.6130 },
  'BTM 1ST STAGE': { latitude: 12.9166, longitude: 77.6148 },
  'BTM 2ND STAGE': { latitude: 12.9120, longitude: 77.6080 },
  'BTM LAYOUT': { latitude: 12.9166, longitude: 77.6148 },
  'BTM / BOMMANAHALLI': { latitude: 12.9166, longitude: 77.6148 },
  'BELLANDUR': { latitude: 12.9260, longitude: 77.6762 },
  'MARATHAHALLI': { latitude: 12.9591, longitude: 77.6974 },
  'JP NAGAR': { latitude: 12.9077, longitude: 77.5855 },
  'JAYANAGAR': { latitude: 12.9250, longitude: 77.5938 },
  'INDIRANAGAR': { latitude: 12.9784, longitude: 77.6408 },
  'ELECTRONIC CITY': { latitude: 12.8452, longitude: 77.6602 },
  'STORE': { latitude: 12.9166, longitude: 77.6148 },
};

/**
 * Resolve coordinates for distance math ONLY (never mutates stop.latitude/longitude).
 */
function resolveStopCoordForMath(stop: SmartRouteStop): LatLng | null {
  if (isValidCoord(stop.latitude, stop.longitude)) {
    return { latitude: stop.latitude!, longitude: stop.longitude! };
  }
  const loc = LOCALITY_COORDINATES[stop.locality];
  if (loc && isValidCoord(loc.latitude, loc.longitude)) {
    return loc;
  }
  return null;
}

function legDistanceForMath(a: LatLng | null, b: LatLng | null): number {
  if (!a || !b) return 5000; // Neutral fallback for ungeocoded stops
  return haversineMeters(a, b);
}

/**
 * 2-Opt Multi-Order Shortest-Path Route Optimization.
 * Step 1: Nearest-Neighbor construction minimizing `legMeters + slotPenalty`.
 * Step 2: 2-Opt local search reversing sub-segments `[i..j]` whenever total open-path
 *         distance strictly decreases by >10m without violating >90 min earlier-slot precedence.
 * Never mutates `stop.latitude` or `stop.longitude`.
 */
export function optimizeStopSequence2Opt(
  stops: SmartRouteStop[],
  startCoord: LatLng
): SmartRouteStop[] {
  if (stops.length <= 1) return [...stops];

  const SLOT_PENALTY_METERS_PER_MIN = 10;
  const MAX_SLOT_INVERSION_MIN = 90;
  const MIN_IMPROVEMENT_METERS = 10;

  interface Node {
    stop: SmartRouteStop;
    coord: LatLng | null;
    slotWeight: number;
  }

  const remaining: Node[] = stops.map(stop => ({
    stop,
    coord: resolveStopCoordForMath(stop),
    slotWeight: parseSlotTimeWeight(stop.slotText),
  }));

  // Step 1: Nearest-Neighbor Construction with gentle slot-window penalty
  const route: Node[] = [];
  let curCoord: LatLng = startCoord;

  while (remaining.length > 0) {
    let minRemainingSlot = Infinity;
    for (const r of remaining) {
      if (r.slotWeight < minRemainingSlot) minRemainingSlot = r.slotWeight;
    }

    let bestIdx = 0;
    let bestCost = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const legMeters = legDistanceForMath(curCoord, cand.coord);
      const slotDeltaMin = Math.max(0, cand.slotWeight - minRemainingSlot);
      const slotPenalty = slotDeltaMin * SLOT_PENALTY_METERS_PER_MIN;
      const cost = legMeters + slotPenalty;

      if (cost < bestCost) {
        bestCost = cost;
        bestIdx = i;
      }
    }

    const [chosen] = remaining.splice(bestIdx, 1);
    route.push(chosen);
    if (chosen.coord) {
      curCoord = chosen.coord;
    }
  }

  // Step 2: 2-Opt Local Search on open path starting from startCoord
  const n = route.length;
  if (n >= 2) {
    const maxPasses = 20;
    let improved = true;
    let pass = 0;

    while (improved && pass < maxPasses) {
      improved = false;
      pass++;

      for (let i = 0; i < n - 1; i++) {
        const prevCoord = i === 0 ? startCoord : (route[i - 1].coord || startCoord);

        for (let j = i + 1; j < n; j++) {
          const nextCoord = j + 1 < n ? route[j + 1].coord : null;

          const currentEdges =
            legDistanceForMath(prevCoord, route[i].coord) +
            (nextCoord ? legDistanceForMath(route[j].coord, nextCoord) : 0);

          const swappedEdges =
            legDistanceForMath(prevCoord, route[j].coord) +
            (nextCoord ? legDistanceForMath(route[i].coord, nextCoord) : 0);

          if (currentEdges - swappedEdges <= MIN_IMPROVEMENT_METERS) {
            continue;
          }

          // Check slot precedence on the reversed segment [i..j]:
          // Reject if reversal places a stop >90 min later before an earlier-slot stop.
          let violatesSlotPrecedence = false;
          for (let a = j; a > i && !violatesSlotPrecedence; a--) {
            for (let b = a - 1; b >= i; b--) {
              // In reversed order, route[a] comes BEFORE route[b]
              if (route[a].slotWeight - route[b].slotWeight > MAX_SLOT_INVERSION_MIN) {
                violatesSlotPrecedence = true;
                break;
              }
            }
          }

          if (violatesSlotPrecedence) continue;

          // Reverse segment [i..j] in place
          let left = i;
          let right = j;
          while (left < right) {
            const tmp = route[left];
            route[left] = route[right];
            route[right] = tmp;
            left++;
            right--;
          }
          improved = true;
        }
      }
    }
  }

  return route.map(node => node.stop);
}

/**
 * Generates an automated, clustered, shortest-path delivery & pickup route (Zepto/Swiggy style).
 */
export function buildSmartRoute({
  myTasks,
  myDeliveries,
  orders = [],
  currentLocation,
}: {
  myTasks: OpsTask[];
  myDeliveries: DeliveryTask[];
  orders?: FeedOrder[];
  currentLocation?: LatLng | null;
}): SmartRouteStop[] {
  const stops: SmartRouteStop[] = [];

  const getOrder = (orderId: string): FeedOrder | undefined =>
    orders && orders.length > 0
      ? orders.find(o => o.id === orderId || o.id === orderId.split('__')[0])
      : undefined;

  // 1. Process active Pickups (strictly uncollected live orders or orders in transit to store)
  myTasks.forEach(t => {
    if (t.status === 'cancelled' || t.status === 'completed') return;
    if (t.status !== 'pending' && t.status !== 'assigned' && t.status !== 'in_transit_to_store') return;

    const order = getOrder(t.orderId || t.id);
    if (orders.length > 0) {
      if (order) {
        if (order.status === 'cancelled' || order.status === 'delivered') return;
        // An order is only a live pickup if placed, confirmed, or mid-transit to store
        if (order.status !== 'placed' && order.status !== 'confirmed' && order.status !== 'in_transit_to_store') {
          return;
        }
      } else {
        // If orders feed has not synced this doc, check if task has actionable fields
        if (!t.customerName && !t.pickupAddress && (!t.items || t.items.length === 0)) {
          return;
        }
      }
    }

    const isInTransit = t.status === 'in_transit_to_store' || order?.status === 'in_transit_to_store';
    const isInstant = isInTransit ? false : Boolean(t.pickupSlot?.isInstant || order?.pickupDetails?.isInstant);
    const isUrgent = isInTransit ? false : Boolean(t.isUrgent || order?.isUrgent);
    const isExpress = Boolean(t.isExpress || isExpressOrder(order) || isExpressOrder(t));

    const addr = safeAddressText(t.pickupAddress || order?.address);
    const locality = isInTransit ? 'STORE' : extractLocality(addr);
    const slotInfo = buildRiderSlotDisplay({
      type: 'pickup',
      pickupSlot: order ? slotLabel(order) : (pickupLabel(t) !== '—' ? pickupLabel(t) : (t.pickupSlot?.type || '')),
      pickupDate: (t.pickupSlot as any)?.scheduledDate || order?.pickupDetails?.scheduledDate || null,
      pickupTime: (t.pickupSlot as any)?.scheduledTime || order?.pickupDetails?.scheduledTime || null,
      isInstantPickup: isInstant,
      createdAt: t.createdAt || order?.createdAt,
    });
    const slot = slotInfo.text || (order ? slotLabel(order) : (t.pickupSlot?.type || ''));
    const realCoords = resolveCustomerCoordinates([order, t]);
    const lat = isInTransit ? SPINZO_STORE_LOCATION.latitude : realCoords?.latitude;
    const lng = isInTransit ? SPINZO_STORE_LOCATION.longitude : realCoords?.longitude;

    stops.push({
      id: `pickup_${t.id}`,
      taskId: t.id,
      stopNumber: 0,
      type: isInTransit ? 'store_dropoff' : 'pickup',
      orderId: t.orderId || t.id,
      orderNumber: safeShortId(t.orderId || t.id),
      customerName: t.customerName || order?.customerName,
      customerPhone: t.customerPhone || order?.customerPhone,
      address: isInTransit ? SPINZO_STORE_ADDRESS : addr,
      locality,
      slotText: isInTransit ? 'Drop to store' : slot,
      slot: isInTransit ? 'Drop to store' : slot,
      isUrgent,
      isInstant,
      ...(isExpress ? { isExpress: true } : {}),
      status: t.status,
      totalAmount: order ? orderTotal(order) : (typeof t.totalAmount === 'number' ? t.totalAmount : 0),
      paymentStatus: order?.paymentStatus || t.paymentStatus,
      latitude: lat,
      longitude: lng,
      loadUnits: estimateLoadUnits(order, t),
      rawTask: t,
      order,
    });
  });

  // 2. Process active Deliveries (strictly ready or out for delivery)
  myDeliveries.forEach(d => {
    if (d.status === 'delivered' || d.status === 'cancelled') return;
    if (d.status !== 'assigned' && d.status !== 'out_for_delivery') return;

    const order = getOrder(d.orderId || d.id);
    if (orders.length > 0) {
      if (!order) return; // Ignore historical deliveries not in live orders feed
      if (order.status === 'cancelled' || order.status === 'delivered') return;
      if (order.status !== 'ready' && order.status !== 'out_for_delivery') {
        return;
      }
    }

    // Guard: Deliveries are strictly for today. Future-scheduled deliveries must not appear on active route.
    const todayStr = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().split('T')[0];
    if (d.deliveryDate && d.deliveryDate > todayStr && d.status !== 'out_for_delivery') {
      return;
    }

    const isPickupFromStore = d.status === 'assigned';
    const isDelExpress = Boolean(d.isExpress || isExpressOrder(order) || isExpressOrder(d));
    const addr = safeAddressText(d.deliveryAddress || order?.address);
    const locality = extractLocality(addr);
    const dDateLabel = d.deliveryDate ? formatRiderDateLabel(d.deliveryDate) : '';
    const slot = dDateLabel && d.deliveryTime ? `${dDateLabel} • ${d.deliveryTime}` : (d.deliveryTime || dDateLabel || 'Immediate');
    const realCoords = resolveCustomerCoordinates([order, d]);
    const lat = realCoords?.latitude;
    const lng = realCoords?.longitude;

    stops.push({
      id: `delivery_${d.id}`,
      taskId: d.id,
      stopNumber: 0,
      type: isPickupFromStore ? 'store_pickup' : 'delivery',
      orderId: d.orderId || d.id,
      orderNumber: safeShortId(d.orderId || d.id),
      customerName: d.customerName || order?.customerName,
      customerPhone: d.customerPhone || order?.customerPhone,
      address: addr,
      locality,
      slotText: slot,
      slot,
      isUrgent: false,
      isInstant: false,
      ...(isDelExpress ? { isExpress: true } : {}),
      status: d.status,
      totalAmount: order ? orderTotal(order) : (d.totalAmount || 0),
      paymentStatus: order?.paymentStatus || d.paymentStatus || undefined,
      latitude: lat,
      longitude: lng,
      loadUnits: estimateLoadUnits(order, d),
      rawTask: d,
      order,
    });
  });

  if (stops.length === 0) return [];

  // Calculate distance from rider position or store hub (for sorting only; never mutate stop coordinates)
  const origin = currentLocation || SPINZO_STORE_LOCATION;
  stops.forEach(s => {
    const sortLat = s.latitude ?? LOCALITY_COORDINATES[s.locality]?.latitude;
    const sortLng = s.longitude ?? LOCALITY_COORDINATES[s.locality]?.longitude;
    if (isValidCoord(sortLat, sortLng)) {
      s.distanceMeters = Math.round(
        haversineMeters(origin, { latitude: sortLat!, longitude: sortLng! })
      );
    }
  });

  // 3. Priority-Tiered 2-Opt Route Sequencing:
  // - Tier 0: Express / Instant / Urgent customer stops (optimized from origin)
  // - Tier 1: Standard customer pickups & deliveries (optimized chained from last Tier 0 stop)
  // - Tier 2: Store Drop-off stops at the end
  const tier0Urgent: SmartRouteStop[] = [];
  const tier1Standard: SmartRouteStop[] = [];
  const tier2StoreDropoff: SmartRouteStop[] = [];

  for (const s of stops) {
    if (s.type === 'store_dropoff') {
      tier2StoreDropoff.push(s);
    } else if (s.isExpress || s.isInstant || s.isUrgent) {
      tier0Urgent.push(s);
    } else {
      tier1Standard.push(s);
    }
  }

  const orderedTier0 = optimizeStopSequence2Opt(tier0Urgent, origin);

  let tier1StartCoord: LatLng = origin;
  for (let i = orderedTier0.length - 1; i >= 0; i--) {
    const c = resolveStopCoordForMath(orderedTier0[i]);
    if (c) {
      tier1StartCoord = c;
      break;
    }
  }
  const orderedTier1 = optimizeStopSequence2Opt(tier1Standard, tier1StartCoord);

  const sequenced = [...orderedTier0, ...orderedTier1, ...tier2StoreDropoff];

  // Compute legDistanceMeters, cumulativeDistanceMeters, and sequential stopNumber
  let prevCoord: LatLng = origin;
  let cumulativeMeters = 0;

  return sequenced.map((s, index) => {
    const stopCoord = resolveStopCoordForMath(s);
    let legDistanceMeters: number | undefined;
    let cumulativeDistanceMeters: number | undefined;

    if (stopCoord) {
      legDistanceMeters = Math.round(haversineMeters(prevCoord, stopCoord));
      cumulativeMeters += legDistanceMeters;
      cumulativeDistanceMeters = cumulativeMeters;
      prevCoord = stopCoord;
    }

    return {
      ...s,
      stopNumber: index + 1,
      legDistanceMeters,
      cumulativeDistanceMeters,
    };
  });
}
