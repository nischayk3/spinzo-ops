// ─── Auth Roles ───
export type ShiftRole = 'rider' | 'helper' | 'iron' | 'supervisor';

export interface UserProfile {
  id: string; // phone number or UID
  phone: string;
  name: string;
  role: ShiftRole;
  isActive: boolean;
  storeId?: string; // mostly for helpers
  createdAt: string;
  updatedAt: string;
}

// ─── Production Service Types (exact match to Livfresh CartItem.serviceType) ───
export type ServiceType = 'wash_fold' | 'wash_iron' | 'ironing' | 'blanket_wash';

// ─── Production Order Statuses (exact match to Livfresh) ───
export type OrderStatus = 'placed' | 'confirmed' | 'pickup_completed' | 'processing' | 'ready' | 'out_for_delivery' | 'delivered' | 'cancelled';

// ─── Processing Sub-Steps (exact match to Livfresh admin panel) ───
export type ProcessingStep = 'getting_washed' | 'getting_folded' | 'getting_ironed' | 'getting_dried';
