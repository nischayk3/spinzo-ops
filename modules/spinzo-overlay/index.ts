import { requireNativeModule, Platform } from 'expo-modules-core';

export interface PendingAcceptedOrder {
  orderId: string;
  isDelivery: boolean;
  taskType?: string;
}

export interface OverlayData {
  orderId: string;
  taskType?: string;
  customerName?: string;
  address?: string;
  slot?: string;
  isInstant?: string | boolean;
  stepName?: string;
  tokenNumber?: string;
  voiceText?: string;
  step?: string;
  phase?: string;
}

interface SpinzoOverlayInterface {
  canDrawOverlays(): boolean;
  openOverlaySettings(): void;
  setOnShift(onShift: boolean): void;
  setOnBreak(onBreak: boolean): void;
  setAppInForeground(inForeground: boolean): void;
  showOverlay(data: OverlayData): boolean;
  dismissOverlay(): void;
  getFCMToken(): Promise<string | null>;
  getCachedFCMToken(): string | null;
  getPendingAcceptedOrder(): PendingAcceptedOrder | null;
  clearPendingAcceptedOrder(): void;
}

let NativeModule: any = null;
if (Platform.OS === 'android') {
  try {
    NativeModule = requireNativeModule('SpinzoOverlay');
  } catch (e) {
    console.warn('SpinzoOverlay native module not found:', e);
  }
}

export const SpinzoOverlay: SpinzoOverlayInterface = {
  canDrawOverlays: () => (NativeModule ? Boolean(NativeModule.canDrawOverlays()) : false),
  openOverlaySettings: () => NativeModule?.openOverlaySettings(),
  setOnShift: (onShift: boolean) => NativeModule?.setOnShift(Boolean(onShift)),
  setOnBreak: (onBreak: boolean) => NativeModule?.setOnBreak?.(Boolean(onBreak)),
  setAppInForeground: (inForeground: boolean) =>
    NativeModule?.setAppInForeground?.(Boolean(inForeground)),
  showOverlay: (data: OverlayData) => {
    if (!NativeModule) return false;
    const stringMap: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        stringMap[key] = String(value);
      }
    }
    return Boolean(NativeModule.showOverlay(stringMap));
  },
  dismissOverlay: () => NativeModule?.dismissOverlay(),
  getFCMToken: async () => {
    if (!NativeModule) return null;
    try {
      return (await NativeModule.getFCMToken()) || null;
    } catch {
      return null;
    }
  },
  getCachedFCMToken: () => (NativeModule ? NativeModule.getCachedFCMToken() : null),
  getPendingAcceptedOrder: () => (NativeModule ? NativeModule.getPendingAcceptedOrder() : null),
  clearPendingAcceptedOrder: () => NativeModule?.clearPendingAcceptedOrder(),
};

export default SpinzoOverlay;
