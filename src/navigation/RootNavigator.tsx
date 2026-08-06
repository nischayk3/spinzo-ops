import React, { useState, useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuthStore } from '../store/authStore';
import { LoginScreen } from '../screens/Auth/LoginScreen';
import { NotInRosterScreen } from '../screens/Auth/NotInRosterScreen';
import { IntakeScreen } from '../screens/Queue/IntakeScreen';
import { FloorBoardScreen } from '../screens/Queue/FloorBoardScreen';
import { Home, ClipboardList, Settings } from 'lucide-react-native';
import { View, Text, ActivityIndicator } from 'react-native';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const Placeholder = ({ name }: { name: string }) => (
  <View className="flex-1 items-center justify-center bg-bgDark">
    <Text className="text-xl font-bold text-textPrimary">{name}</Text>
    <Text className="text-textSecondary mt-2">Coming soon…</Text>
  </View>
);

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};

const AppTabs = () => {
  const activeRole = useAuthStore(state => state.activeRole);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#1E293B',
          borderTopColor: '#334155',
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: '#3B82F6',
        tabBarInactiveTintColor: '#64748B',
      }}
    >
      <Tab.Screen
        name="Intake"
        options={{ tabBarIcon: ({ color }) => <Home color={color} size={24} /> }}
      >
        {() => <IntakeScreen />}
      </Tab.Screen>

      {activeRole === 'supervisor' && (
        <Tab.Screen
          name="FloorBoard"
          options={{ tabBarIcon: ({ color }) => <ClipboardList color={color} size={24} /> }}
        >
          {() => <FloorBoardScreen />}
        </Tab.Screen>
      )}

      <Tab.Screen
        name="Settings"
        options={{ tabBarIcon: ({ color }) => <Settings color={color} size={24} /> }}
      >
        {() => <Placeholder name="Settings" />}
      </Tab.Screen>
    </Tab.Navigator>
  );
};

export function RootNavigator() {
  const { isLoggedIn, activeRole, initializeAuth } = useAuthStore();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    initializeAuth();
    const timer = setTimeout(() => setIsReady(true), 500);
    return () => clearTimeout(timer);
  }, [initializeAuth]);

  if (!isReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!isLoggedIn ? (
        <Stack.Screen name="Login" component={LoginScreen} />
      ) : !activeRole ? (
        <Stack.Screen name="NotInRoster" component={NotInRosterScreen} />
      ) : (
        <Stack.Screen name="Main" component={AppTabs} />
      )}
    </Stack.Navigator>
  );
}
