import { create } from 'zustand';
import { db } from '../config/firebase';
import { 
  collectionGroup, 
  onSnapshot, 
  query, 
  where, 
  doc, 
  updateDoc,
  Timestamp
} from 'firebase/firestore';

// ─────────────────────────────────────────────────────────────────────────────
// ENUMS & CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Production-level order status (synced with Livfresh customer app + admin panel) */
export type OrderStatus = 'placed' | 'confirmed' | 'pickup_completed' | 'processing' | 'ready' | 'out_for_delivery' | 'delivered' | 'cancelled';

/** Production processing step — kept in sync for admin panel + customer app */
export type ProductionProcessingStep = 'getting_washed' | 'getting_folded' | 'getting_ironed' | 'getting_dried';

/** Helper-specific ops step — granular in-store tracking */
export type OpsStep = 
  | 'tagging'        // Garment count + label printing
  | 'washing'        // Washing cycle (start → complete)
  | 'drying'         // Drying cycle (start → complete)
  | 'ironing'        // Ironing (start → complete, quality capture)
  | 'folding'        // Folding/bundling (start → complete, quality capture)
  | 'packaging'      // Final packaging + verification
  | 'completed';     // All done → status becomes 'ready'

/** Whether the current step is actively being worked on or waiting to be started */
export type StepPhase = 'pending' | 'active' | 'done';

/** Service types in production */
export type ServiceType = 'wash_fold' | 'wash_iron' | 'ironing' | 'blanket_wash';

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  wash_fold: 'Wash & Fold',
  wash_iron: 'Wash & Iron',
  ironing: 'Steam Iron',
  blanket_wash: 'Blanket Wash',
};

export const OPS_STEP_LABELS: Record<OpsStep, string> = {
  tagging: 'Tagging',
  washing: 'Washing',
  drying: 'Drying',
  ironing: 'Ironing',
  folding: 'Folding',
  packaging: 'Packaging',
  completed: 'Completed',
};

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE COMPUTATION — what steps does this order need?
// ─────────────────────────────────────────────────────────────────────────────

export const getOrderPipeline = (items: any[]): OpsStep[] => {
  if (!items || items.length === 0) {
    return ['tagging', 'washing', 'drying', 'folding', 'packaging'];
  }

  const serviceTypes = items.map((item: any) => item.serviceType);

  // Steam Iron only → skip wash/dry/fold
  const onlyIroning = serviceTypes.every((type: string) => type === 'ironing');
  if (onlyIroning) {
    return ['tagging', 'ironing', 'packaging'];
  }

  const steps: OpsStep[] = ['tagging'];

  // Any service that requires washing
  const needsWash = serviceTypes.some((type: string) => 
    type === 'wash_fold' || type === 'wash_iron' || type === 'blanket_wash'
  );
  if (needsWash) {
    steps.push('washing');
    steps.push('drying'); // All washed items need drying
  }

  // After drying, determine finishing step
  const needsIron = serviceTypes.some((type: string) => type === 'wash_iron' || type === 'ironing');
  const needsFold = serviceTypes.some((type: string) => type === 'wash_fold' || type === 'blanket_wash');

  if (needsIron) steps.push('ironing');
  if (needsFold) steps.push('folding');

  steps.push('packaging');
  return steps;
};

/** Map opsStep → production processingStep for admin panel sync */
const getProductionStep = (opsStep: OpsStep): ProductionProcessingStep | null => {
  switch (opsStep) {
    case 'washing': return 'getting_washed';
    case 'drying': return 'getting_dried';
    case 'ironing': return 'getting_ironed';
    case 'folding': return 'getting_folded';
    default: return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderItem {
  serviceId?: string;
  serviceName: string;
  serviceType: ServiceType;
  weight?: number;
  clothesCount?: number;
  ironingCount?: number;
  ironingEnabled?: boolean;
  blanketQuantity?: number;
  description?: string;
  specialInstructions?: string;
  basePrice: number;
  totalPrice: number;
  quantity?: number;
}

export interface HelperOrder {
  id: string;
  userId: string;
  vendorId: string;
  docPath: string;
  
  // Customer info
  customerName: string;
  customerPhone: string;
  
  // Production status (synced with customer app)
  status: OrderStatus;
  processingStep?: ProductionProcessingStep;
  
  // Helper ops tracking
  opsStep?: OpsStep;
  stepPhase?: StepPhase;        // 'pending' | 'active' | 'done'
  currentStepStartedAt?: any;   // When the helper pressed "Start"
  
  // Tagging data
  actualItemCount?: number;
  taggingStartedAt?: any;
  taggingCompletedAt?: any;
  
  // Step timing data
  washingStartedAt?: any;
  washingCompletedAt?: any;
  washingDuration?: number;
  dryingStartedAt?: any;
  dryingCompletedAt?: any;
  dryingDuration?: number;
  ironingStartedAt?: any;
  ironingCompletedAt?: any;
  ironingDuration?: number;
  foldingStartedAt?: any;
  foldingCompletedAt?: any;
  foldingDuration?: number;
  packagingStartedAt?: any;
  packagingCompletedAt?: any;
  packagingDuration?: number;
  
  // Items
  items: OrderItem[];
  
  // Metadata
  tokenNumber?: string;
  pickupOTP?: string;
  createdAt: any;
  pickedUpAt: any;
  updatedAt: any;
  
  // Computed
  serviceTypesSummary: string;
}

export type HelperTab = 'intake' | 'tagging' | 'washing' | 'drying' | 'ironing' | 'folding' | 'packaging' | 'ready';

// ─────────────────────────────────────────────────────────────────────────────
// STORE
// ─────────────────────────────────────────────────────────────────────────────

interface OrderState {
  orders: HelperOrder[];
  activeOrder: HelperOrder | null;
  isLoading: boolean;
  unsubscribeSnapshot: (() => void) | null;
  
  // Actions
  initializeFirebaseListener: () => void;
  setActiveOrder: (orderId: string | null) => void;
  
  // Step lifecycle
  startTagging: (order: HelperOrder, garmentCount: number) => Promise<void>;
  completeTagging: (order: HelperOrder) => Promise<void>;
  startStep: (order: HelperOrder, step: OpsStep) => Promise<void>;
  completeStep: (order: HelperOrder, step: OpsStep) => Promise<void>;
}

/** Dual-write helper: writes to both user + vendor order documents */
const dualWrite = async (order: HelperOrder, updateData: any) => {
  const userRef = doc(db, 'users', order.userId, 'orders', order.id);
  await updateDoc(userRef, updateData);
  
  const vendorRef = doc(db, 'vendors', order.vendorId, 'orders', order.id);
  await updateDoc(vendorRef, updateData);
};

export const useOrderStore = create<OrderState>((set, get) => ({
  orders: [],
  activeOrder: null,
  isLoading: false,
  unsubscribeSnapshot: null,

  // ─── LISTENER ───
  initializeFirebaseListener: () => {
    const { unsubscribeSnapshot } = get();
    if (unsubscribeSnapshot) unsubscribeSnapshot();

    set({ isLoading: true });

    const ordersQuery = query(
      collectionGroup(db, 'orders'),
      where('status', 'in', ['pickup_completed', 'processing', 'ready'])
    );

    const unsubscribe = onSnapshot(ordersQuery, (snapshot) => {
      const uniqueMap = new Map<string, HelperOrder>();
      
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        
        // Extract userId from path: users/{userId}/orders/{orderId}
        let userId = data.userId;
        if (!userId && docSnap.ref.parent?.parent) {
          userId = docSnap.ref.parent.parent.id;
        }

        // Build service summary
        const serviceNames = [...new Set(
          (data.items || [])
            .map((item: any) => SERVICE_TYPE_LABELS[item.serviceType as ServiceType] || item.serviceName)
            .filter(Boolean)
        )];

        uniqueMap.set(docSnap.id, {
          id: docSnap.id,
          docPath: docSnap.ref.path,
          userId: userId || 'unknown',
          vendorId: data.vendorId || 'vendor_1',
          customerName: data.customerName || 'Unknown Customer',
          customerPhone: data.customerPhone || data.userPhone || '',
          status: data.status,
          processingStep: data.processingStep || undefined,
          opsStep: data.opsStep || undefined,
          stepPhase: data.stepPhase || undefined,
          currentStepStartedAt: data.currentStepStartedAt || undefined,
          actualItemCount: data.actualItemCount || undefined,
          taggingStartedAt: data.taggingStartedAt || undefined,
          taggingCompletedAt: data.taggingCompletedAt || undefined,
          washingStartedAt: data.washingStartedAt || undefined,
          washingCompletedAt: data.washingCompletedAt || undefined,
          washingDuration: data.washingDuration || undefined,
          dryingStartedAt: data.dryingStartedAt || undefined,
          dryingCompletedAt: data.dryingCompletedAt || undefined,
          dryingDuration: data.dryingDuration || undefined,
          ironingStartedAt: data.ironingStartedAt || undefined,
          ironingCompletedAt: data.ironingCompletedAt || undefined,
          ironingDuration: data.ironingDuration || undefined,
          foldingStartedAt: data.foldingStartedAt || undefined,
          foldingCompletedAt: data.foldingCompletedAt || undefined,
          foldingDuration: data.foldingDuration || undefined,
          packagingStartedAt: data.packagingStartedAt || undefined,
          packagingCompletedAt: data.packagingCompletedAt || undefined,
          packagingDuration: data.packagingDuration || undefined,
          items: data.items || [],
          tokenNumber: data.tokenNumber || undefined,
          pickupOTP: data.pickupOTP || undefined,
          createdAt: data.createdAt,
          pickedUpAt: data.pickedUpAt,
          updatedAt: data.updatedAt,
          serviceTypesSummary: serviceNames.join(', ') || 'Unknown Service',
        });
      });

      const fetchedOrders = Array.from(uniqueMap.values());

      // Sort: oldest first (longest waiting = top priority)
      fetchedOrders.sort((a, b) => {
        const getMs = (val: any) => {
          if (!val) return 0;
          if (typeof val.toDate === 'function') return val.toDate().getTime();
          if (val.seconds) return val.seconds * 1000;
          return new Date(val).getTime() || 0;
        };
        return getMs(a.createdAt) - getMs(b.createdAt);
      });

      set({ orders: fetchedOrders, isLoading: false });
      
      // Update active order
      const currentActiveId = get().activeOrder?.id;
      if (currentActiveId) {
        const updated = fetchedOrders.find(o => o.id === currentActiveId);
        set({ activeOrder: updated || null });
      }
    }, (error) => {
      console.error("Firebase Snapshot Error:", error);
      set({ isLoading: false });
    });

    set({ unsubscribeSnapshot: unsubscribe });
  },

  setActiveOrder: (orderId) => {
    if (!orderId) { set({ activeOrder: null }); return; }
    const order = get().orders.find(o => o.id === orderId);
    set({ activeOrder: order || null });
  },

  // ─── TAGGING: Start ───
  // pickup_completed → processing, opsStep = tagging
  startTagging: async (order, garmentCount) => {
    try {
      const timestamp = Timestamp.now();
      const pipeline = getOrderPipeline(order.items);
      const firstProductionStep = getProductionStep(pipeline[1]); // Step after tagging

      await dualWrite(order, {
        status: 'processing',
        processingStep: firstProductionStep || 'getting_washed',
        opsStep: 'tagging',
        stepPhase: 'active',
        actualItemCount: garmentCount,
        taggingStartedAt: timestamp,
        currentStepStartedAt: timestamp,
        updatedAt: timestamp,
      });

      console.log(`[Ops] Order ${order.id} → tagging (${garmentCount} items)`);
    } catch (error) {
      console.error(`[Ops] Failed to start tagging ${order.id}:`, error);
      throw error;
    }
  },

  // ─── TAGGING: Complete ───
  completeTagging: async (order) => {
    try {
      const timestamp = Timestamp.now();
      const pipeline = getOrderPipeline(order.items);
      const nextStep = pipeline[pipeline.indexOf('tagging') + 1];
      const productionStep = getProductionStep(nextStep);

      await dualWrite(order, {
        opsStep: nextStep,
        stepPhase: 'pending',
        taggingCompletedAt: timestamp,
        currentStepStartedAt: null,
        ...(productionStep ? { processingStep: productionStep } : {}),
        updatedAt: timestamp,
      });

      console.log(`[Ops] Order ${order.id} → tagging complete → ${nextStep}`);
    } catch (error) {
      console.error(`[Ops] Failed to complete tagging ${order.id}:`, error);
      throw error;
    }
  },

  // ─── GENERIC: Start Step ───
  startStep: async (order, step) => {
    try {
      const timestamp = Timestamp.now();
      const productionStep = getProductionStep(step);

      const updateData: any = {
        opsStep: step,
        stepPhase: 'active',
        currentStepStartedAt: timestamp,
        [`${step}StartedAt`]: timestamp,
        updatedAt: timestamp,
      };

      if (productionStep) {
        updateData.processingStep = productionStep;
      }

      await dualWrite(order, updateData);
      console.log(`[Ops] Order ${order.id} → ${step} started`);
    } catch (error) {
      console.error(`[Ops] Failed to start ${step} for ${order.id}:`, error);
      throw error;
    }
  },

  // ─── GENERIC: Complete Step ───
  completeStep: async (order, step) => {
    try {
      const timestamp = Timestamp.now();
      const pipeline = getOrderPipeline(order.items);
      const currentIndex = pipeline.indexOf(step);
      const nextStep = currentIndex < pipeline.length - 1 ? pipeline[currentIndex + 1] : 'completed';

      // Calculate duration
      const startField = order[`${step}StartedAt` as keyof HelperOrder];
      let duration = 0;
      if (startField) {
        const startMs = typeof startField.toDate === 'function' 
          ? startField.toDate().getTime() 
          : startField.seconds ? startField.seconds * 1000 : 0;
        duration = Math.floor((Date.now() - startMs) / 1000);
      }

      const updateData: any = {
        [`${step}CompletedAt`]: timestamp,
        [`${step}Duration`]: duration,
        currentStepStartedAt: null,
        updatedAt: timestamp,
      };

      if (nextStep === 'completed' || nextStep === 'packaging') {
        // After packaging → mark ready
        if (step === 'packaging') {
          updateData.status = 'ready';
          updateData.opsStep = 'completed';
          updateData.stepPhase = 'done';
        } else {
          updateData.opsStep = nextStep;
          updateData.stepPhase = 'pending';
          const ps = getProductionStep(nextStep);
          if (ps) updateData.processingStep = ps;
        }
      } else {
        updateData.opsStep = nextStep;
        updateData.stepPhase = 'pending';
        const ps = getProductionStep(nextStep);
        if (ps) updateData.processingStep = ps;
      }

      await dualWrite(order, updateData);
      console.log(`[Ops] Order ${order.id} → ${step} complete (${duration}s) → ${nextStep}`);
    } catch (error) {
      console.error(`[Ops] Failed to complete ${step} for ${order.id}:`, error);
      throw error;
    }
  },
}));
