import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Volume2, Camera, MapPin, CheckCircle2, Layers } from 'lucide-react-native';
import { unlockAudio } from '../../utils/alerts';
import { useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { requestNotificationPermissions, setupNotificationChannels } from '../../utils/systemNotifications';
import { Platform } from 'react-native';
import { SpinzoOverlay } from 'spinzo-overlay';

interface PermissionsScreenProps {
  onComplete: () => void;
}

export function PermissionsScreen({ onComplete }: PermissionsScreenProps) {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [isLoading, setIsLoading] = useState(false);
  const [overlayGranted, setOverlayGranted] = useState(() =>
    Platform.OS === 'android' ? SpinzoOverlay.canDrawOverlays() : true
  );

  const handleEnablePermissions = async () => {
    setIsLoading(true);
    try {
      // 1. Audio Unlock (Must be synchronous to user tap for iOS Safari)
      await unlockAudio();

      // 2. Camera Permission
      if (!cameraPermission?.granted) {
        const camResult = await requestCameraPermission();
        if (!camResult.granted) {
          Alert.alert('Permission Required', 'Camera access is required for scanning QRs.');
          setIsLoading(false);
          return;
        }
      }

      // 3. Location Permission
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Location access is required for shift operations.');
        setIsLoading(false);
        return;
      }

      // 4. Notification Permission & Android Channel Setup
      await requestNotificationPermissions();
      await setupNotificationChannels();

      // 5. Android Overlay Permission (SYSTEM_ALERT_WINDOW)
      if (Platform.OS === 'android') {
        const canDraw = SpinzoOverlay.canDrawOverlays();
        setOverlayGranted(canDraw);
        if (!canDraw) {
          Alert.alert(
            'Display Over Other Apps',
            'To receive order popups even when you are using Instagram, YouTube, or your home screen, please toggle "Allow display over other apps" for SpinZo Ops.',
            [
              {
                text: 'Skip',
                style: 'cancel',
                onPress: () => onComplete(),
              },
              {
                text: 'Open Settings',
                onPress: () => {
                  SpinzoOverlay.openOverlaySettings();
                  setTimeout(() => onComplete(), 1500);
                },
              },
            ]
          );
          setIsLoading(false);
          return;
        }
      }

      onComplete();
    } catch (e) {
      console.error('Permission error:', e);
      Alert.alert('Error', 'Failed to request permissions. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bgDark items-center justify-center p-6">
      <View className="bg-bgSurface w-full max-w-sm rounded-3xl p-8 border border-bgSurfaceLight items-center shadow-lg">
        <View className="w-20 h-20 bg-primary/20 rounded-full items-center justify-center mb-6">
          <CheckCircle2 size={40} color="#994bff" />
        </View>
        
        <Text className="text-2xl font-black text-textPrimary mb-2 text-center">App Setup</Text>
        <Text className="text-textSecondary text-center mb-8">
          SpinZo Ops requires the following permissions to function correctly.
        </Text>

        <View className="w-full space-y-4 mb-8">
          <View className="flex-row items-center mb-4">
            <View className="w-12 h-12 bg-blue-500/10 rounded-xl items-center justify-center mr-4">
              <Volume2 size={24} color="#3b82f6" />
            </View>
            <View className="flex-1">
              <Text className="text-textPrimary font-bold text-lg">Alerts & Sounds</Text>
              <Text className="text-textMuted text-xs">Required for new order notifications</Text>
            </View>
          </View>

          <View className="flex-row items-center mb-4">
            <View className="w-12 h-12 bg-green-500/10 rounded-xl items-center justify-center mr-4">
              <Camera size={24} color="#22c55e" />
            </View>
            <View className="flex-1">
              <Text className="text-textPrimary font-bold text-lg">Camera Access</Text>
              <Text className="text-textMuted text-xs">Required for QR code scanning</Text>
            </View>
          </View>

          <View className="flex-row items-center mb-4">
            <View className="w-12 h-12 bg-orange-500/10 rounded-xl items-center justify-center mr-4">
              <MapPin size={24} color="#f97316" />
            </View>
            <View className="flex-1">
              <Text className="text-textPrimary font-bold text-lg">Location</Text>
              <Text className="text-textMuted text-xs">Required for geofenced shifts</Text>
            </View>
          </View>

          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => {
              if (Platform.OS === 'android') {
                SpinzoOverlay.openOverlaySettings();
              }
            }}
            className="flex-row items-center"
          >
            <View className={`w-12 h-12 ${overlayGranted ? 'bg-purple-500/20' : 'bg-purple-500/10'} rounded-xl items-center justify-center mr-4`}>
              <Layers size={24} color="#994bff" />
            </View>
            <View className="flex-1">
              <View className="flex-row items-center">
                <Text className="text-textPrimary font-bold text-lg mr-2">Display Over Apps</Text>
                {overlayGranted && (
                  <View className="bg-emerald-500/20 px-2 py-0.5 rounded-full">
                    <Text className="text-emerald-400 text-[10px] font-bold">Enabled</Text>
                  </View>
                )}
              </View>
              <Text className="text-textMuted text-xs">Full-screen assignment popups & alarms</Text>
            </View>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={handleEnablePermissions}
          disabled={isLoading}
          className="w-full h-14 bg-primary rounded-2xl items-center justify-center flex-row shadow-lg shadow-primary/30"
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white font-black text-lg tracking-wide uppercase">Enable & Continue</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
