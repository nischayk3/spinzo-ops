import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Platform, AppState } from 'react-native';
import { Layers, AlertTriangle } from 'lucide-react-native';
import { SpinzoOverlay } from 'spinzo-overlay';

export function OverlayPermissionBanner() {
  const [canDraw, setCanDraw] = useState(() =>
    Platform.OS === 'android' ? SpinzoOverlay.canDrawOverlays() : true
  );

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const check = () => setCanDraw(SpinzoOverlay.canDrawOverlays());
    check();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        check();
      }
    });
    return () => sub.remove();
  }, []);

  if (Platform.OS !== 'android' || canDraw) return null;

  return (
    <View className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-3 flex-row items-center justify-between">
      <View className="flex-row items-center flex-1 mr-3">
        <View className="w-8 h-8 rounded-full bg-amber-500/20 items-center justify-center mr-3">
          <AlertTriangle size={18} color="#f59e0b" />
        </View>
        <View className="flex-1">
          <Text className="text-amber-300 font-bold text-xs">Appear on top is disabled</Text>
          <Text className="text-amber-200/80 text-[11px] leading-tight">
            Order popups will not show over Instagram or home screen.
          </Text>
        </View>
      </View>
      <TouchableOpacity
        onPress={() => SpinzoOverlay.openOverlaySettings()}
        className="bg-amber-500 px-3 py-1.5 rounded-lg active:opacity-80"
      >
        <Text className="text-black font-black text-xs uppercase tracking-wide">Enable</Text>
      </TouchableOpacity>
    </View>
  );
}
