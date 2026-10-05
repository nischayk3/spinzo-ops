// Pricing logic for the rider order-edit flow. Mirrors production
// AdminOrdersScreen (Livfresh) so edited orders stay in sync with the
// customer-facing price model.

export interface EditLineItem {
  serviceId?: string;
  serviceType?: string;
  serviceName?: string;
  weight?: number;
  ironingEnabled?: boolean;
  ironingCount?: number;
  clothesCount?: number;
  quantity?: number;
  unit?: string;
  isCreditItem?: boolean;
  singleBlanketCount?: number;
  doubleBlanketCount?: number;
  shoeSubtotal?: number;
  shoeItems?: Array<{ type: string; name: string; quantity: number; price: number }>;
  shoeCount?: number;
  shoeQuantity?: number;
  deliveryFee?: number;
  totalPrice?: number;
  [key: string]: any;
}

export const SHOE_EDIT_CATEGORIES = [
  { id: 'canvas_sports', name: 'Canvas & Sports Shoes', price: 300 },
  { id: 'crocs_sandals', name: 'Crocs & Sandals', price: 150 },
  { id: 'slippers', name: 'Slippers & Slides', price: 150 },
];

const sidOf = (item: EditLineItem): string =>
  (item.serviceId || item.serviceType || '').toLowerCase();

export const calculateItemPrice = (item: EditLineItem): number => {
  const sid = sidOf(item);

  if (sid === 'wash_fold') {
    const base = (item.weight || 5) * 85;
    const ironing = item.ironingEnabled && item.ironingCount ? item.ironingCount * 18 : 0;
    if (item.isCreditItem) return item.totalPrice || 0;
    return base + ironing;
  }

  if (sid === 'wash_iron') {
    return (item.weight || 5) * 140;
  }

  if (sid === 'ironing') {
    const count = item.ironingCount || item.clothesCount || 0;
    return count * 10;
  }

  if (sid === 'ironing_addon' || (item.serviceName || '').toLowerCase().includes('ironing')) {
    const count = item.clothesCount || item.ironingCount || item.quantity || 0;
    return count * 18;
  }

  if (sid === 'blanket_wash') {
    const single = item.singleBlanketCount || 0;
    const double = item.doubleBlanketCount || 0;
    return single * 299 + double * 399;
  }

  if (sid === 'premium_laundry') {
    return (item.weight || 5) * 200;
  }

  if (sid === 'shoe_clean') {
    const sub =
      item.shoeSubtotal ??
      (item.shoeItems
        ? item.shoeItems.reduce((sum, s) => sum + (s.quantity || 0) * (s.price || 0), 0)
        : 0);
    return sub > 0 ? sub + (item.deliveryFee ?? 50) : 0;
  }

  return item.totalPrice || 0;
};

export const calculateDeliveryFee = (orderItems: EditLineItem[]): number => {
  if (!orderItems || orderItems.length === 0) return 0;

  const hasWashFoldOrWashIron = orderItems.some((item) => {
    const sid = sidOf(item);
    return sid === 'wash_fold' || sid === 'wash_iron' || sid === 'premium_laundry';
  });
  if (hasWashFoldOrWashIron) return 0;

  const hasIroning = orderItems.some((item) => sidOf(item) === 'ironing');
  if (hasIroning) {
    const totalIroningPieces = orderItems.reduce((sum, item) => {
      if (sidOf(item) === 'ironing') return sum + (item.ironingCount || item.clothesCount || item.quantity || 0);
      return sum;
    }, 0);
    return totalIroningPieces >= 20 ? 50 : 80;
  }

  const hasBlanketWash = orderItems.some((item) => sidOf(item) === 'blanket_wash');
  if (hasBlanketWash) return 50;

  return 0;
};