import { create } from 'zustand';
import {
  collectionGroup,
  onSnapshot,
  query,
  QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { FeedOrder, sortNewestFirst } from '../utils/orderFeed';

interface OrderFeedState {
  orders: FeedOrder[];
  isLoading: boolean;
  error: string | null;
  initialize: () => void;
  reset: () => void;
}

const orderFromDoc = (d: QueryDocumentSnapshot): FeedOrder => {
  const data = d.data() as any;
  // For vendor-mirror docs the path parent is the vendor id, so this fallback is best-effort.
  const userId = data.userId || (d.ref.parent?.parent as any)?.id || '';
  return {
    id: d.id,
    userId,
    vendorId: data.vendorId,
    status: data.status,
    customerName: data.customerName || data.userName,
    customerPhone: data.customerPhone || data.userPhone,
    pickupDetails: data.pickupDetails || data.pickup,
    items: data.items || [],
    totalAmount: data.totalAmount || data.cartTotal,
    paymentStatus: data.paymentStatus || data.paymentMethod,
    notes: data.notes || data.instruction,
    tokenNumber: data.tokenNumber,
    pickupOTP: data.pickupOTP,
    storeOTP: data.storeOTP,
    address: data.address,
    processingStep: data.processingStep,
    deliveryDate: data.deliveryDate,
    deliveryTime: data.deliveryTime,
    deliveryOTP: data.deliveryOTP,
    createdAt: data.createdAt,
  };
};

let unsubscribe: (() => void) | null = null;

export const useOrderFeedStore = create<OrderFeedState>((set) => ({
  orders: [],
  // Start as loading so consumers that key logic off the first snapshot (e.g. the
  // Intake "new order" announce baseline) don't see an empty-but-idle state first.
  isLoading: true,
  error: null,

  initialize: () => {
    if (unsubscribe) unsubscribe();

    set({ isLoading: true, error: null });
    const q = query(collectionGroup(db, 'orders'));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        if (unsubscribe !== unsub) return;
        const map = new Map<string, FeedOrder>();
        
        snapshot.forEach((d) => {
          // Only process documents from the users collection tree to prevent
          // ghost orders or vendor mirror documents from overwriting the feed.
          if (!d.ref.path.startsWith('users/')) return;
          map.set(d.id, orderFromDoc(d));
        });
        
        set({ orders: sortNewestFirst(Array.from(map.values())), isLoading: false });
      },
      (err) => {
        if (unsubscribe !== unsub) return;
        console.error('[orderFeed] snapshot error:', err);
        set({ isLoading: false, error: String(err) });
      },
    );
    unsubscribe = unsub;
  },

  reset: () => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    set({ orders: [], isLoading: false, error: null });
  },
}));
