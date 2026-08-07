import React, { useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuthStore } from '../store/authStore';
import { LoginScreen } from '../screens/Auth/LoginScreen';
import { NotInRosterScreen } from '../screens/Auth/NotInRosterScreen';
import { IntakeScreen } from '../screens/Queue/IntakeScreen';
import { FloorBoardScreen } from '../screens/Queue/FloorBoardScreen';
import { PickupsScreen } from '../screens/Rider/PickupsScreen';
import { SettingsScreen } from '../screens/Settings/SettingsScreen';
import { Home, ClipboardList, Settings, Bike } from 'lucide-react-native';
import { View, ActivityIndicator } from 'react-native';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

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

      {activeRole === 'rider' && (
        <Tab.Screen
          name="Pickups"
          options={{ tabBarIcon: ({ color }) => <Bike color={color} size={24} /> }}
        >
          {() => <PickupsScreen />}
        </Tab.Screen>
      )}

      <Tab.Screen
        name="Settings"
        options={{ tabBarIcon: ({ color }) => <Settings color={color} size={24} /> }}
      >
        {() => <SettingsScreen />}
      </Tab.Screen>
    </Tab.Navigator>
  );
};

export function RootNavigator() {
  const { isLoggedIn, activeRole, authInitialized, initializeAuth } = useAuthStore();

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  if (!authInitialized) {
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
