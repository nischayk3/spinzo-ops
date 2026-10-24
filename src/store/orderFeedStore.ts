import { create } from 'zustand';
import {
  collectionGroup,
  onSnapshot,
  query,
} from '../config/firebase';
import { db } from '../config/firebase';
import { FeedOrder, sortNewestFirst } from '../utils/orderFeed';

interface OrderFeedState {
  orders: FeedOrder[];
  isLoading: boolean;
  error: string | null;
  initialize: () => void;
  reset: () => void;
}

const orderFromDoc = (d: any): FeedOrder => {
  const data = d.data() as any;
  // For vendor-mirror docs the path parent is the vendor id, so this fallback is best-effort.
  const userId = data.userId || (d.ref.parent?.parent as any)?.id || '';
  const rawPickup = data.pickupDetails || data.pickupSlot || data.pickup || (data.slot ? { scheduledTime: data.slot } : undefined);
  const isInstant = Boolean(
    rawPickup?.isInstant ||
    rawPickup?.type === 'instant' ||
    data.isInstant ||
    (typeof rawPickup?.scheduledTime === 'string' && rawPickup.scheduledTime.toLowerCase().includes('instant')) ||
    (typeof rawPickup?.slot === 'string' && rawPickup.slot.toLowerCase().includes('instant')) ||
    (typeof data.slot === 'string' && data.slot.toLowerCase().includes('instant'))
  );
  const pickupDetails = rawPickup ? {
    ...rawPickup,
    isInstant: isInstant || Boolean(rawPickup.isInstant),
  } : (isInstant ? { isInstant: true } : undefined);

  return {
    id: d.id,
    userId,
    vendorId: data.vendorId,
    status: data.status,
    customerName: data.customerName || data.userName,
    customerPhone: data.customerPhone || data.userPhone,
    pickupDetails,
    pickupSlot: rawPickup,
    pickupDate: data.pickupDate || rawPickup?.scheduledDate || rawPickup?.date,
    pickupTime: data.pickupTime || rawPickup?.scheduledTime || rawPickup?.time || rawPickup?.slot,
    slot: data.slot || rawPickup?.scheduledTime || rawPickup?.slot,
    isInstant,
    riderName: data.riderName || data.assignedRiderName,
    items: data.items || [],
    totalAmount: data.totalAmount || data.billDetails?.total || data.cartTotal,
    billDetails: data.billDetails,
    paymentStatus: data.paymentStatus || data.paymentMethod,
    paymentMode: data.paymentMode || data.paymentMethod,
    notes: data.notes || data.instruction,
    tokenNumber: data.tokenNumber,
    tokens: data.tokens,
    pickupOTP: data.pickupOTP,
    storeOTP: data.storeOTP,
    address: data.address,
    latitude: data.latitude,
    longitude: data.longitude,
    processingStep: data.processingStep,
    deliveryDate: data.deliveryDate,
    deliveryTime: data.deliveryTime,
    deliveryOTP: data.deliveryOTP,
    riderId: data.riderId,
    deliveryRiderId: data.deliveryRiderId || data.riderId,
    deliveredAt: data.deliveredAt || data.deliveryCompletedAt || data.opsDetails?.deliveredAt || (data.status === 'delivered' ? (data.updatedAt || data.createdAt) : undefined),
    pickedUpAt: data.pickedUpAt || data.pickupCompletedAt || data.pickupVerifiedAt || data.opsDetails?.pickedUpAt,
    readyAt: data.readyAt || data.opsDetails?.readyAt,
    outForDeliveryAt: data.outForDeliveryAt || data.opsDetails?.outForDeliveryAt,
    updatedAt: data.updatedAt,
    createdAt: data.createdAt,
    isUrgent: data.opsMeta?.isUrgent ?? data.isUrgent ?? false,
    pickupNote: data.opsMeta?.pickupNote ?? data.pickupNote ?? '',
    opsMeta: data.opsMeta,
    garmentCount: data.opsDetails?.garmentCount ?? data.garmentCount,
    qualityPhotos: data.opsDetails?.qualityPhotos ?? data.qualityPhotos ?? data.qualityProof ?? data.packagingPhotos,
    packagingPhotos: data.opsDetails?.packagingPhotos ?? data.packagingPhotos ?? data.qualityProof,
    packagingProof: data.opsDetails?.packagingProof ?? data.packagingProof,
    proofUrl: data.proofUrl || data.deliveryProofUrl,
    stageTimings: data.opsDetails?.stageTimings ?? data.stageTimings,
    opsDetails: data.opsDetails,
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
