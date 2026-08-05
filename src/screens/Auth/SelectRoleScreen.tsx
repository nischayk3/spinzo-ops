import React from 'react';
import { View, Text, TouchableOpacity, SafeAreaView } from 'react-native';
import { useAuthStore } from '../../store/authStore';
import { ShiftRole } from '../../types';
import { Bike, Droplets, Package, AlignCenterVertical as Shirt } from 'lucide-react-native';

export function SelectRoleScreen() {
  const setRole = useAuthStore(state => state.setRole);

  const RoleCard = ({ role, title, subtitle, Icon }: { role: ShiftRole, title: string, subtitle: string, Icon: any }) => (
    <TouchableOpacity
      onPress={() => setRole(role)}
      className="bg-bgSurface border border-bgSurfaceLight rounded-2xl p-4 mb-4 flex-row items-center"
      activeOpacity={0.7}
    >
      <View className="w-14 h-14 bg-bgSurfaceLight rounded-full items-center justify-center mr-4">
        <Icon size={28} color="#22C55E" />
      </View>
      <View className="flex-1">
        <Text className="text-xl font-bold text-textPrimary mb-1">{title}</Text>
        <Text className="text-sm text-textSecondary">{subtitle}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView className="flex-1 bg-bgDark">
      <View className="px-6 pt-8 pb-4">
        <Text className="text-2xl font-bold text-textPrimary mb-2">Select Your Role</Text>
        <Text className="text-sm text-textSecondary">Choose your shift profile for today.</Text>
      </View>
      
      <View className="flex-1 px-6 mt-4">
        <Text className="text-xs font-bold tracking-widest text-textMuted uppercase mb-4">Field Operations</Text>
        <RoleCard 
          role="rider"
          title="Rider (Pickup/Delivery)"
          subtitle="Navigate to customers, verify OTPs, pickup & deliver."
          Icon={Bike}
        />

        <Text className="text-xs font-bold tracking-widest text-textMuted uppercase mt-4 mb-4">In-Store Operations</Text>
        <RoleCard 
          role="helper-a"
          title="Helper A"
          subtitle="Intake, Tagging, Washing & Drying"
          Icon={Droplets}
        />
        <RoleCard 
          role="helper-c"
          title="Helper C"
          subtitle="Steam Ironing & Quality Check"
          Icon={Shirt}
        />
        <RoleCard 
          role="helper-b"
          title="Helper B"
          subtitle="Verification, Packaging & Bundling"
          Icon={Package}
        />
      </View>
    </SafeAreaView>
  );
}
