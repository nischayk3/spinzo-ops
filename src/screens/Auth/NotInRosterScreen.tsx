import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';

export function NotInRosterScreen() {
  const logout = useAuthStore(s => s.logout);
  return (
    <SafeAreaView className="flex-1 bg-bgDark items-center justify-center px-6">
      <Text className="text-2xl font-bold text-textPrimary mb-2">Not in the roster</Text>
      <Text className="text-center text-textSecondary mb-8">
        This phone number isn't registered as SpinZo Ops staff. Ask the supervisor to add it.
      </Text>
      <TouchableOpacity
        onPress={logout}
        className="w-full bg-primary h-14 rounded-xl items-center justify-center"
      >
        <Text className="text-white text-lg font-bold">Log out</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}
