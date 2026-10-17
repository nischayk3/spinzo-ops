import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Platform, Vibration } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { X, AlertCircle, CheckCircle2, Zap } from 'lucide-react-native';

export interface QRScannerProps {
  visible: boolean;
  onClose: () => void;
  onScan: (data: string) => void;
  actionType: string;
  /** When true, renders camera inline (no wrapping Modal). Used when already inside a Modal. */
  inline?: boolean;
  /** When true, camera remains open continuously across multiple scans */
  continuous?: boolean;
  /** Optional progress string (e.g. "3 / 5 Garments Scanned") */
  progressText?: string;
  /** Optional current count of items scanned */
  currentCount?: number;
  /** Optional total count of items expected */
  totalCount?: number;
  /** Optional manual trigger to scan next item (e.g. for dummy tag bypass or manual step) */
  onManualScanNext?: () => void;
  /** Optional trigger to tag/verify all remaining items in 1 click */
  onBypassAll?: () => void;
}

// Lightweight Web Audio tone for instantaneous (<1ms) scan confirmation
function playScanTone() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime); // Crisp A5 tone
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
      }
    } catch {
      // AudioContext may be restricted until first user interaction; safe to ignore
    }
  }
}

export function QRScanner({
  visible,
  onClose,
  onScan,
  actionType,
  inline = false,
  continuous = false,
  progressText,
  currentCount,
  totalCount,
  onManualScanNext,
  onBypassAll,
}: QRScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [flashActive, setFlashActive] = useState(false);
  const [lastScannedBadge, setLastScannedBadge] = useState<string | null>(null);

  // High-performance debounce refs: avoid unmounting/detaching onBarcodeScanned
  const lastScanTimeRef = useRef<number>(0);
  const lastScannedDataRef = useRef<string>('');
  const flashTimeoutRef = useRef<any>(null);

  useEffect(() => {
    if (visible) {
      lastScanTimeRef.current = 0;
      lastScannedDataRef.current = '';
      setFlashActive(false);
      setLastScannedBadge(null);
    }
    return () => {
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    };
  }, [visible]);

  if (!visible) return null;

  if (!permission) {
    const content = (
      <View className="flex-1 bg-bgDark items-center justify-center">
        <Text className="text-textPrimary mb-4">Requesting camera permission...</Text>
      </View>
    );
    if (inline) return content;
    return (
      <Modal visible={visible} animationType="fade" transparent={true}>
        {content}
      </Modal>
    );
  }

  if (!permission.granted) {
    const content = (
      <View className="flex-1 bg-bgDark items-center justify-center p-6">
        <AlertCircle color="#EF4444" size={48} className="mb-4" />
        <Text className="text-xl font-bold text-textPrimary text-center mb-2">Camera Access Required</Text>
        <Text className="text-textSecondary text-center mb-6">
          We need your permission to use the camera to scan QR codes for {actionType}.
          {Platform.OS === 'web' ? ' Please allow camera access in your browser settings.' : ''}
        </Text>
        <TouchableOpacity 
          onPress={requestPermission}
          className="w-full bg-primary h-14 rounded-xl items-center justify-center mb-4"
        >
          <Text className="text-white font-bold text-lg">Grant Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onClose}>
          <Text className="text-textMuted font-bold">Cancel</Text>
        </TouchableOpacity>
      </View>
    );
    if (inline) return content;
    return (
      <Modal visible={visible} animationType="slide" transparent={true}>
        {content}
      </Modal>
    );
  }

  const triggerFeedback = (data: string) => {
    // 1. Audio chime
    playScanTone();

    // 2. Haptic tick
    try {
      Vibration.vibrate(40);
    } catch {}

    // 3. Visual reticle flash
    setFlashActive(true);
    let badgeText = '✓ Scanned';
    if (data.includes(':')) {
      const parts = data.split(':');
      if (parts[2]) badgeText = `✓ Item #${parts[2]}`;
    }
    setLastScannedBadge(badgeText);

    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = setTimeout(() => {
      setFlashActive(false);
    }, 280);
  };

  const handleBarcodeScanned = ({ type, data }: { type: string; data: string }) => {
    if (!visible || !data) return;

    const now = Date.now();
    const isSameCode = data === lastScannedDataRef.current;
    
    // Optimal scan cadence:
    // When holding camera steady on the same dummy QR code: 650ms rhythmic auto-advance
    // When pointing camera at a new / different QR tag: 250ms near-instant recognition
    const cooldownMs = isSameCode ? 650 : 250;

    if (now - lastScanTimeRef.current < cooldownMs) {
      return;
    }

    lastScanTimeRef.current = now;
    lastScannedDataRef.current = data;

    triggerFeedback(data);
    onScan(data);

    if (!continuous && !inline) {
      // Single scan mode: close smoothly after visual confirmation
      setTimeout(() => {
        onClose();
      }, 350);
    }
  };

  const hasProgress = typeof currentCount === 'number' && typeof totalCount === 'number' && totalCount > 0;
  const progressPct = hasProgress ? Math.min(100, Math.round((currentCount! / totalCount!) * 100)) : 0;

  const cameraContent = (
    <View className="flex-1 bg-black">
      <CameraView 
        style={StyleSheet.absoluteFill}
        facing="back"
        onBarcodeScanned={handleBarcodeScanned}
        barcodeScannerSettings={{
          barcodeTypes: ["qr"],
        }}
      />
      
      {/* Overlay UI */}
      <View className="flex-1 items-center justify-between py-12 px-6 relative">
        {/* Top Header & Progress */}
        <View className="w-full items-center">
          <View className="w-full flex-row items-center justify-between mb-3">
            <View className="bg-black/75 px-3 py-1.5 rounded-full border border-white/10">
              <Text className="text-white font-bold text-xs tracking-wider uppercase">
                {actionType}
              </Text>
            </View>

            {!inline && (
              <TouchableOpacity 
                onPress={onClose}
                className="w-10 h-10 bg-black/60 rounded-full items-center justify-center border border-white/20 active:opacity-75"
              >
                <X color="white" size={20} />
              </TouchableOpacity>
            )}
          </View>

          {/* Progress pill if provided */}
          {!!progressText && (
            <View className="bg-primary/95 px-5 py-2 rounded-2xl shadow-lg border border-white/20 items-center">
              <Text className="text-white font-black text-sm">{progressText}</Text>
              {hasProgress && (
                <View className="w-36 h-1.5 bg-white/30 rounded-full mt-1.5 overflow-hidden">
                  <View 
                    className="h-full bg-white rounded-full" 
                    style={{ width: `${progressPct}%` }}
                  />
                </View>
              )}
            </View>
          )}
        </View>

        {/* Center Scanner reticle */}
        <View className="items-center justify-center">
          <View 
            className={`w-60 h-60 rounded-3xl items-center justify-center relative transition-all ${
              flashActive 
                ? 'border-4 border-green-400 bg-green-500/20 shadow-2xl' 
                : 'border-2 border-primary/80 bg-transparent'
            }`}
          >
            {/* Corner accents */}
            <View className="absolute top-2 left-2 w-5 h-5 border-t-4 border-l-4 border-white/80 rounded-tl-lg" />
            <View className="absolute top-2 right-2 w-5 h-5 border-t-4 border-r-4 border-white/80 rounded-tr-lg" />
            <View className="absolute bottom-2 left-2 w-5 h-5 border-b-4 border-l-4 border-white/80 rounded-bl-lg" />
            <View className="absolute bottom-2 right-2 w-5 h-5 border-b-4 border-r-4 border-white/80 rounded-br-lg" />

            {/* Flash badge */}
            {flashActive && (
              <View className="bg-green-500 px-4 py-2 rounded-xl flex-row items-center gap-1.5 shadow-lg">
                <CheckCircle2 color="white" size={18} />
                <Text className="text-white font-bold text-sm">
                  {lastScannedBadge || 'Scanned!'}
                </Text>
              </View>
            )}
          </View>

          <Text className="text-white/80 text-xs font-semibold mt-4 bg-black/60 px-3 py-1.5 rounded-full text-center">
            {continuous 
              ? 'Keep camera placed on dummy QR for auto-advance'
              : 'Align QR code within the frame'}
          </Text>
        </View>

        {/* Bottom Actions Bar */}
        <View className="w-full gap-2 items-center">
          <View className="flex-row items-center gap-2 w-full">
            {onManualScanNext && (
              <TouchableOpacity
                onPress={onManualScanNext}
                className="flex-1 bg-white/20 active:bg-white/30 h-12 rounded-xl flex-row items-center justify-center border border-white/20 gap-1.5"
              >
                <Zap color="#fff" size={16} />
                <Text className="text-white font-bold text-xs">Scan Next Item</Text>
              </TouchableOpacity>
            )}

            {onBypassAll && (
              <TouchableOpacity
                onPress={onBypassAll}
                className="flex-1 bg-green-600 active:bg-green-700 h-12 rounded-xl flex-row items-center justify-center border border-green-400 gap-1.5"
              >
                <CheckCircle2 color="#fff" size={16} />
                <Text className="text-white font-bold text-xs">Verify / Tag All</Text>
              </TouchableOpacity>
            )}
          </View>

          {!inline && (
            <TouchableOpacity 
              onPress={onClose}
              className="py-2 px-6"
            >
              <Text className="text-white/60 font-semibold text-xs">Close Camera</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );

  if (inline) return cameraContent;

  return (
    <Modal visible={visible} animationType="slide" transparent={true}>
      {cameraContent}
    </Modal>
  );
}
