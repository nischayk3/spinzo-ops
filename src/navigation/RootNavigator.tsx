import React, { useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuthStore } from '../store/authStore';
import { useOpsStaffStore } from '../store/opsStaffStore';
import { useOpsProcessStore } from '../store/opsProcessStore';
import { useOrderFeedStore } from '../store/orderFeedStore';
import { useStoreResourcesStore } from '../store/storeResourcesStore';
import { LoginScreen } from '../screens/Auth/LoginScreen';
import { NotInRosterScreen } from '../screens/Auth/NotInRosterScreen';
import { PermissionsScreen } from '../screens/Auth/PermissionsScreen';
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
import { HelperAssignmentModal } from '../components/HelperAssignmentModal';
import { Home, ClipboardList, Settings, Bike, WashingMachine, Inbox, Package } from 'lucide-react-native';
import { View, ActivityIndicator, Text } from 'react-native';

export type RootStackParamList = {
  Auth: undefined;
  Login: undefined;
  NotInRoster: undefined;
  Permissions: undefined;
  Main: undefined;
  OrderDetail: { orderId: string, processId?: string };
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
  const [hasGrantedPermissions, setHasGrantedPermissions] = React.useState(false);
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
      useStoreResourcesStore.getState().initialize();
      if (activeRole === 'helper' || activeRole === 'iron' || activeRole === 'rider') {
        useOrderFeedStore.getState().initialize();
      }
      if (activeRole === 'helper' || activeRole === 'iron') {
        useOpsProcessStore.getState().initialize(uid);
      }
    }
  }, [uid, activeRole]);

  // Auto-logout heartbeat: check every minute if it's past 11:30 PM or if the shift is stale.
  useEffect(() => {
    const checkExpiry = () => {
      const { isLoggedIn, logout } = useAuthStore.getState();
      const { staffDoc } = useOpsStaffStore.getState();
      
      if (!isLoggedIn || !staffDoc?.onShift) return;

      const now = new Date();
      // 1. Check if past 11:30 PM
      if (now.getHours() === 23 && now.getMinutes() >= 30) {
        logout();
        return;
      }

      // 2. Check if shift started yesterday
      if (staffDoc.shiftStartAt) {
        const ts: any = staffDoc.shiftStartAt;
        let shiftDate: Date | null = null;
        if (ts?.toDate) shiftDate = ts.toDate();
        else if (ts instanceof Date) shiftDate = ts;

        if (shiftDate) {
          const isPreviousDay = shiftDate.getDate() !== now.getDate() ||
                                shiftDate.getMonth() !== now.getMonth() ||
                                shiftDate.getFullYear() !== now.getFullYear();
          if (isPreviousDay) {
            logout();
          }
        }
      }
    };

    const intervalId = setInterval(checkExpiry, 60000);
    // Run immediately on mount or role change
    checkExpiry();
    
    return () => clearInterval(intervalId);
  }, [isLoggedIn, activeRole]);

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
        ) : !hasGrantedPermissions ? (
          <Stack.Screen name="Permissions">
            {() => <PermissionsScreen onComplete={() => setHasGrantedPermissions(true)} />}
          </Stack.Screen>
        ) : (
          <Stack.Screen name="Main" component={AppTabs} />
        )}
        <Stack.Screen
          name="OrderDetail"
          component={OrderDetailScreen}
          options={{ presentation: 'modal' }}
        />
      </Stack.Navigator>
      {isLoggedIn && activeRole === 'rider' && <GlobalAssignmentModal />}
      {isLoggedIn && (activeRole === 'helper' || activeRole === 'iron') && <HelperAssignmentModal />}
    </>
  );
}
