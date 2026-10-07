import { requireNativeModule, Platform } from 'expo-modules-core';

interface PendingAcceptedOrder {
  orderId: string;
  isDelivery: boolean;
}

interface SpinzoOverlayInterface {
  canDrawOverlays(): boolean;
  openOverlaySettings(): void;
  setOnShift(onShift: boolean): void;
  dismissOverlay(): void;
  getCachedFCMToken(): string | null;
  getPendingAcceptedOrder(): PendingAcceptedOrder | null;
  clearPendingAcceptedOrder(): void;
}

let NativeModule: SpinzoOverlayInterface | null = null;
if (Platform.OS === 'android') {
  try {
    NativeModule = requireNativeModule<SpinzoOverlayInterface>('SpinzoOverlay');
  } catch (e) {
    console.warn('SpinzoOverlay native module not found:', e);
  }
}

export const SpinzoOverlay: SpinzoOverlayInterface = {
  canDrawOverlays: () => (NativeModule ? NativeModule.canDrawOverlays() : false),
  openOverlaySettings: () => NativeModule?.openOverlaySettings(),
  setOnShift: (onShift: boolean) => NativeModule?.setOnShift(onShift),
  dismissOverlay: () => NativeModule?.dismissOverlay(),
  getCachedFCMToken: () => (NativeModule ? NativeModule.getCachedFCMToken() : null),
  getPendingAcceptedOrder: () => (NativeModule ? NativeModule.getPendingAcceptedOrder() : null),
  clearPendingAcceptedOrder: () => NativeModule?.clearPendingAcceptedOrder(),
};

export default SpinzoOverlay;
