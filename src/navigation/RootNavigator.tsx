import React, { useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuthStore } from '../store/authStore';
import { useOpsStaffStore } from '../store/opsStaffStore';
import { LoginScreen } from '../screens/Auth/LoginScreen';
import { NotInRosterScreen } from '../screens/Auth/NotInRosterScreen';
import { IntakeScreen } from '../screens/Queue/IntakeScreen';
import { FloorBoardScreen } from '../screens/Queue/FloorBoardScreen';
import { PickupsScreen } from '../screens/Rider/PickupsScreen';
import { DashboardScreen } from '../screens/Home/DashboardScreen';
import { SupervisorDashboardScreen } from '../screens/Supervisor/SupervisorDashboardScreen';
import { ProcessingScreen } from '../screens/Helper/ProcessingScreen';
import { OrderDetailScreen } from '../screens/Helper/OrderDetailScreen';
import { DeliveriesScreen } from '../screens/Rider/DeliveriesScreen';
import { SettingsScreen } from '../screens/Settings/SettingsScreen';
import { useLifecycleNotifications } from '../utils/lifecycleNotifications';
import { GlobalAssignmentModal } from '../components/GlobalAssignmentModal';
import { Home, ClipboardList, Settings, Bike, WashingMachine, Inbox, Package } from 'lucide-react-native';
import { View, ActivityIndicator, Text } from 'react-native';

export type RootStackParamList = {
  Auth: undefined;
  Login: undefined;
  NotInRoster: undefined;
  Main: undefined;
  OrderDetail: { orderId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();

const ComingSoonScreen = () => (
  <View style={{ flex: 1, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' }}>
    <Text style={{ color: '#64748B', fontSize: 16 }}>Coming Soon</Text>
  </View>
);

const AppTabs = () => {
  const activeRole = useAuthStore(state => state.activeRole);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopColor: '#f1f5f9',
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: '#994bff',
        tabBarInactiveTintColor: '#94a3b8',
      }}
    >
      <Tab.Screen
        name="Dashboard"
        options={{ tabBarLabel: 'Home', tabBarIcon: ({ color }) => <Home color={color} size={24} /> }}
      >
        {() => activeRole === 'supervisor' ? <SupervisorDashboardScreen /> : <DashboardScreen />}
      </Tab.Screen>

      {(activeRole === 'helper' || activeRole === 'iron' || activeRole === 'supervisor') && (
        <Tab.Screen
          name="Floor"
          options={{ tabBarIcon: ({ color }) => <WashingMachine color={color} size={24} /> }}
        >
          {() => <ProcessingScreen />}
        </Tab.Screen>
      )}

      {activeRole === 'supervisor' && (
        <Tab.Screen
          name="Orders"
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

      {activeRole === 'rider' && (
        <Tab.Screen
          name="Deliveries"
          options={{ tabBarIcon: ({ color }) => <Package color={color} size={24} /> }}
        >
          {() => <DeliveriesScreen />}
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
  const { isLoggedIn, activeRole, authInitialized, initializeAuth, user } = useAuthStore();
  useLifecycleNotifications();

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  // Initialize live listeners for all authenticated ops staff so
  // task announcements + shift state + GlobalAssignmentModal work.
  const uid = user?.id;
  useEffect(() => {
    if (uid && activeRole) {
      useOpsStaffStore.getState().initialize(uid);
    }
  }, [uid, activeRole]);

  if (!authInitialized) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  return (
    <>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!isLoggedIn ? (
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : !activeRole ? (
          <Stack.Screen name="NotInRoster" component={NotInRosterScreen} />
        ) : (
          <Stack.Screen name="Main" component={AppTabs} />
        )}
        <Stack.Screen
          name="OrderDetail"
          component={OrderDetailScreen}
          options={{ presentation: 'modal' }}
        />
      </Stack.Navigator>
      {isLoggedIn && (activeRole === 'rider' || activeRole === 'helper') && <GlobalAssignmentModal />}
    </>
  );
}
