import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Platform } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { X, CameraOff, AlertCircle } from 'lucide-react-native';

interface QRScannerProps {
  visible: boolean;
  onClose: () => void;
  onScan: (data: string) => void;
  actionType: string;
}

export function QRScanner({ visible, onClose, onScan, actionType }: QRScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (visible) {
      setScanned(false);
    }
  }, [visible]);

  if (!visible) return null;

  if (!permission) {
    return (
      <Modal visible={visible} animationType="fade" transparent={true}>
        <View className="flex-1 bg-bgDark items-center justify-center">
          <Text className="text-textPrimary mb-4">Requesting camera permission...</Text>
        </View>
      </Modal>
    );
  }

  if (!permission.granted) {
    return (
      <Modal visible={visible} animationType="slide" transparent={true}>
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
      </Modal>
    );
  }

  const handleBarcodeScanned = ({ type, data }: { type: string; data: string }) => {
    if (scanned) return;
    setScanned(true);
    onScan(data);
    
    // Slight delay to prevent immediate re-trigger before modal closes
    setTimeout(() => {
      onClose();
      setScanned(false);
    }, 500);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={true}>
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
          <TouchableOpacity 
            onPress={() => {
              setScanned(false);
              onClose();
            }}
            className="absolute top-12 right-6 w-12 h-12 bg-black/50 rounded-full items-center justify-center z-50"
          >
            <X color="white" size={24} />
          </TouchableOpacity>
          
          <View className="absolute top-24 items-center">
            <Text className="text-white text-xl font-bold bg-black/50 px-4 py-2 rounded-lg">
              Scan {actionType.toUpperCase()} QR
            </Text>
          </View>

          {/* Scanner frame */}
          <View className="w-64 h-64 border-2 border-primary rounded-xl" />
          
          {Platform.OS === 'web' && (
            <View className="absolute bottom-12 items-center bg-black/70 p-4 rounded-xl">
              <Text className="text-white font-bold text-center">Web Camera Active</Text>
              <Text className="text-gray-300 text-sm text-center">Hold the QR code up to your webcam.</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
