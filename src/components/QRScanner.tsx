import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Platform } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { X, CameraOff, AlertCircle } from 'lucide-react-native';

interface QRScannerProps {
  visible: boolean;
  onClose: () => void;
  onScan: (data: string) => void;
  actionType: string;
  /** When true, renders camera inline (no wrapping Modal). Used when already inside a Modal. */
  inline?: boolean;
}

export function QRScanner({ visible, onClose, onScan, actionType, inline = false }: QRScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (visible) {
      setScanned(false);
    }
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

  const handleBarcodeScanned = ({ type, data }: { type: string; data: string }) => {
    if (scanned) return;
    setScanned(true);
    onScan(data);
    
    if (inline) {
      // In inline mode, allow re-scanning after a short delay (for multi-bundle scanning)
      setTimeout(() => setScanned(false), 1500);
    } else {
      // In modal mode, auto-close after scan
      setTimeout(() => {
        onClose();
        setScanned(false);
      }, 500);
    }
  };

  const cameraContent = (
    <View className="flex-1 bg-black">
      <CameraView 
        style={StyleSheet.absoluteFill}
        facing="back"
        onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
        barcodeScannerSettings={{
          barcodeTypes: ["qr"],
        }}
      />
      
      {/* Overlay UI */}
      <View className="flex-1 items-center justify-center relative">
        {!inline && (
          <TouchableOpacity 
            onPress={() => {
              setScanned(false);
              onClose();
            }}
            className="absolute top-12 right-6 w-12 h-12 bg-black/50 rounded-full items-center justify-center z-50"
          >
            <X color="white" size={24} />
          </TouchableOpacity>
        )}
        
        {!inline && (
          <View className="absolute top-24 items-center">
            <Text className="text-white text-xl font-bold bg-black/50 px-4 py-2 rounded-lg">
              Scan {actionType.toUpperCase()} QR
            </Text>
          </View>
        )}

        {/* Scanner frame */}
        <View className="w-48 h-48 border-2 border-primary rounded-xl" />
        
        {Platform.OS === 'web' && (
          <View className="absolute bottom-4 items-center bg-black/70 p-3 rounded-xl">
            <Text className="text-white font-bold text-center text-sm">Point camera at QR code</Text>
          </View>
        )}
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
