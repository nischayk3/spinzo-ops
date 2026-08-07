import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LogOut, Power } from 'lucide-react-native';
import { useAuthStore } from '../../store/authStore';
import { useOpsStaffStore } from '../../store/opsStaffStore';

export function SettingsScreen() {
  const { user, activeRole } = useAuthStore();
  const { staffDoc, goOnShift, goOffShift, error } = useOpsStaffStore();
  const [isUpdating, setIsUpdating] = useState(false);

  const onShift = !!staffDoc?.onShift;

  const handleToggleShift = async () => {
    if (!user || isUpdating) return;
    setIsUpdating(true);
    try {
      if (onShift) {
        await goOffShift(user.id);
      } else {
        await goOnShift(user.id, user.role, user.phone, user.name);
      }
    } catch {
      // The store already surfaces the error; swallow so the promise doesn't reject unhandled.
    } finally {
      setIsUpdating(false);
    }
  };

  const handleLogout = () => {
    useAuthStore.getState().logout();
  };

  return (
    <SafeAreaView className="flex-1 bg-bgDark">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-2xl font-bold text-textPrimary">Settings</Text>
        <Text className="text-textSecondary">Account & shift management</Text>
      </View>

      <View className="flex-1 px-4">
        {activeRole === 'rider' && (
          <View className="bg-bgSurface rounded-xl p-4 mb-3 border border-bgSurfaceLight">
            <Text className="text-textSecondary font-bold uppercase tracking-widest text-xs mb-3">
              Shift
            </Text>
            <View className="flex-row items-center mb-4">
              <Power size={18} color={onShift ? '#22C55E' : '#64748B'} />
              <Text className={`font-bold ml-2 ${onShift ? 'text-primary' : 'text-textMuted'}`}>
                {onShift ? 'On shift' : 'Off shift'}
              </Text>
            </View>
            <TouchableOpacity
              onPress={handleToggleShift}
              disabled={isUpdating}
              className={`h-14 rounded-xl items-center justify-center flex-row ${
                onShift ? 'bg-warning' : 'bg-primary'
              } ${isUpdating ? 'opacity-70' : ''}`}
            >
              {isUpdating ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text className="text-white text-lg font-bold">
                  {onShift ? 'Go off shift' : 'Go on shift'}
                </Text>
              )}
            </TouchableOpacity>
            {error ? <Text className="text-error text-xs mt-3">{error}</Text> : null}
          </View>
        )}

        <View className="flex-1" />

        <TouchableOpacity
          onPress={handleLogout}
          className="w-full bg-error/20 border border-error/50 h-14 rounded-xl items-center justify-center flex-row mb-6"
        >
          <LogOut size={20} color="#EF4444" className="mr-2" />
          <Text className="text-error text-lg font-bold">Log out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
