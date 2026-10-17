import { OpsTask } from './opsTasks';
import { DeliveryTask } from '../store/opsStaffStore';
import { FeedOrder, orderTotal, slotLabel } from './orderFeed';
import { haversineMeters, LatLng, SPINZO_STORE_ADDRESS, SPINZO_STORE_LOCATION } from './storeGeo';

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
  distanceMeters?: number;
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
 * Generates an automated, clustered, shortest-path delivery & pickup route (Zepto/Swiggy style).
 */
export function buildSmartRoute({
  myTasks,
  myDeliveries,
  orders,
  currentLocation,
}: {
  myTasks: OpsTask[];
  myDeliveries: DeliveryTask[];
  orders: FeedOrder[];
  currentLocation?: LatLng | null;
}): SmartRouteStop[] {
  const stops: SmartRouteStop[] = [];

  const getOrder = (orderId: string): FeedOrder | undefined =>
    orders.find(o => o.id === orderId || o.id === orderId.split('__')[0]);

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

    const addr = safeAddressText(t.pickupAddress || order?.address);
    const locality = isInTransit ? 'STORE' : extractLocality(addr);
    const locCoord = LOCALITY_COORDINATES[locality];
    const slot = order ? slotLabel(order) : (t.pickupSlot?.type || '');
    const lat = isInTransit ? SPINZO_STORE_LOCATION.latitude : (t.latitude || order?.latitude || (order?.address as any)?.latitude || locCoord?.latitude);
    const lng = isInTransit ? SPINZO_STORE_LOCATION.longitude : (t.longitude || order?.longitude || (order?.address as any)?.longitude || locCoord?.longitude);

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

    const isPickupFromStore = d.status === 'assigned';
    const addr = safeAddressText(d.deliveryAddress || order?.address);
    const locality = isPickupFromStore ? 'STORE' : extractLocality(addr);
    const locCoord = LOCALITY_COORDINATES[locality];
    const slot = d.deliveryDate && d.deliveryTime ? `${d.deliveryDate} • ${d.deliveryTime}` : (d.deliveryTime || 'Immediate');
    const lat = isPickupFromStore ? SPINZO_STORE_LOCATION.latitude : (order?.latitude || (order?.address as any)?.latitude || locCoord?.latitude);
    const lng = isPickupFromStore ? SPINZO_STORE_LOCATION.longitude : (order?.longitude || (order?.address as any)?.longitude || locCoord?.longitude);

    stops.push({
      id: `delivery_${d.id}`,
      taskId: d.id,
      stopNumber: 0,
      type: isPickupFromStore ? 'store_pickup' : 'delivery',
      orderId: d.orderId || d.id,
      orderNumber: safeShortId(d.orderId || d.id),
      customerName: d.customerName || order?.customerName,
      customerPhone: d.customerPhone || order?.customerPhone,
      address: isPickupFromStore ? SPINZO_STORE_ADDRESS : addr,
      locality,
      slotText: slot,
      slot,
      isUrgent: false,
      isInstant: false,
      status: d.status,
      totalAmount: order ? orderTotal(order) : (d.totalAmount || 0),
      paymentStatus: order?.paymentStatus,
      latitude: lat,
      longitude: lng,
      loadUnits: estimateLoadUnits(order, d),
      rawTask: d,
      order,
    });
  });

  if (stops.length === 0) return [];

  // Calculate distance from rider position or store hub
  const origin = currentLocation || SPINZO_STORE_LOCATION;
  stops.forEach(s => {
    if (s.latitude && s.longitude) {
      s.distanceMeters = Math.round(
        haversineMeters(origin, { latitude: s.latitude, longitude: s.longitude })
      );
    }
  });

  // 3. Multi-tier Clustering & Sequencing Algorithm:
  // - Tier 0: Live customer tasks first before returning to store
  // - Tier 1: Instant / Urgent Pickups (<30m SLA)
  // - Tier 2: Nearest distance / Locality cluster
  // - Tier 3: Time-slot chronological order
  stops.sort((a, b) => {
    // 0. Active customer pickups & deliveries before returning to store
    const aIsStoreDrop = a.type === 'store_dropoff';
    const bIsStoreDrop = b.type === 'store_dropoff';
    if (aIsStoreDrop !== bIsStoreDrop) {
      return aIsStoreDrop ? 1 : -1;
    }

    // 1. Instant / Urgent priority
    const aUrgentScore = (a.isInstant ? 2000 : 0) + (a.isUrgent ? 1000 : 0);
    const bUrgentScore = (b.isInstant ? 2000 : 0) + (b.isUrgent ? 1000 : 0);
    if (aUrgentScore !== bUrgentScore) return bUrgentScore - aUrgentScore;

    // 2. Distance proximity from origin (or store hub)
    if (typeof a.distanceMeters === 'number' && typeof b.distanceMeters === 'number') {
      const distDiff = a.distanceMeters - b.distanceMeters;
      // If significantly different (>500m), choose the closer stop
      if (Math.abs(distDiff) > 500) {
        return distDiff;
      }
    }

    // 3. Locality clustering (keep same neighborhoods grouped together)
    if (a.locality !== b.locality) {
      return a.locality.localeCompare(b.locality);
    }

    // 4. Time slot within the same neighborhood
    const aTime = parseSlotTimeWeight(a.slotText);
    const bTime = parseSlotTimeWeight(b.slotText);
    if (aTime !== bTime) return aTime - bTime;

    return 0;
  });

  // Assign sequential stop numbers (1, 2, 3...)
  return stops.map((s, index) => ({
    ...s,
    stopNumber: index + 1,
  }));
}
