import React, { useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuthStore } from '../store/authStore';
import { useOpsStaffStore } from '../store/opsStaffStore';
import { useOpsProcessStore } from '../store/opsProcessStore';
import { useOrderFeedStore } from '../store/orderFeedStore';
import { useStoreResourcesStore } from '../store/storeResourcesStore';
import { useStaffRosterStore } from '../store/staffRosterStore';
import { LoginScreen } from '../screens/Auth/LoginScreen';
import { NotInRosterScreen } from '../screens/Auth/NotInRosterScreen';
import { PermissionsScreen } from '../screens/Auth/PermissionsScreen';
import { IntakeScreen } from '../screens/Queue/IntakeScreen';
import { FloorBoardScreen } from '../screens/Queue/FloorBoardScreen';
import { PickupsScreen } from '../screens/Rider/PickupsScreen';
import { DashboardScreen } from '../screens/Home/DashboardScreen';
import { SupervisorDashboardScreen } from '../screens/Supervisor/SupervisorDashboardScreen';
import { CustomerDetailScreen } from '../screens/Supervisor/CustomerDetailScreen';
import { ProcessingScreen } from '../screens/Helper/ProcessingScreen';
import { OrderDetailScreen } from '../screens/Helper/OrderDetailScreen';
import { DeliveriesScreen } from '../screens/Rider/DeliveriesScreen';
import { SettingsScreen } from '../screens/Settings/SettingsScreen';
import { useLifecycleNotifications } from '../utils/lifecycleNotifications';
import { setupNotificationChannels, clearAssignmentNotifications } from '../utils/systemNotifications';
import { stopAlarm } from '../utils/alerts';
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
  CustomerDetail: { phone: string };
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
  const [permissionsLoaded, setPermissionsLoaded] = React.useState(false);
  useLifecycleNotifications();

  // Persist the "App Setup done" decision so a page reload doesn't force the
  // rider to re-grant camera/location every time. Per-platform storage keeps it across
  // sessions without re-prompting (the OS permission itself already persists).
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          const v = window.localStorage.getItem('ops_permissions_granted');
          if (mounted) setHasGrantedPermissions(v === '1');
        } else {
          const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
          const v = await AsyncStorage.getItem('ops_permissions_granted');
          if (mounted) setHasGrantedPermissions(v === '1');
        }
      } catch { /* non-fatal */ }
      if (mounted) setPermissionsLoaded(true);
    })();
    return () => { mounted = false; };
  }, []);

  const handlePermissionsComplete = () => {
    setHasGrantedPermissions(true);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('ops_permissions_granted', '1');
      } else {
        import('@react-native-async-storage/async-storage').then((m) =>
          m.default.setItem('ops_permissions_granted', '1'));
      }
    } catch { /* non-fatal */ }
  };

  useEffect(() => {
    initializeAuth();
    setupNotificationChannels();
    stopAlarm();
    clearAssignmentNotifications();
  }, [initializeAuth]);

  // Initialize live listeners for all authenticated ops staff so
  // task announcements + shift state + GlobalAssignmentModal work.
  const uid = user?.id;
  const staffDoc = useOpsStaffStore(s => s.staffDoc);
  const effectiveRole = activeRole || staffDoc?.role;

  useEffect(() => {
    const role = activeRole || staffDoc?.role;
    if (uid && role) {
      useOpsStaffStore.getState().initialize(uid);
      useStoreResourcesStore.getState().initialize();
      if (role === 'helper' || role === 'iron' || role === 'rider') {
        useOrderFeedStore.getState().initialize();
      }
      if (role === 'helper' || role === 'iron') {
        useOpsProcessStore.getState().initialize(uid);
      }
      if (role === 'supervisor' || role === 'admin') {
        useOrderFeedStore.getState().initialize();
        useStaffRosterStore.getState().initialize();
      }
    }
  }, [uid, activeRole, staffDoc?.role]);

  // Auto-logout heartbeat: check every minute if it's past 11:30 PM or if the shift is stale.
  useEffect(() => {
    const checkExpiry = () => {
      const { isLoggedIn, logout } = useAuthStore.getState();
      const { staffDoc } = useOpsStaffStore.getState();

      // Supervisors don't clock in/out via QR, so their ops_staff.onShift stays
      // false — never force-logout a supervisor from on-shift state.
      if (!isLoggedIn || activeRole === 'supervisor') return;
      if (staffDoc === null || staffDoc === undefined) return;

      // Server-enforced logout: the daily scheduler (scheduleForceLogout) set
      // onShift:false on all staff. If our live staff doc explicitly shows off-shift,
      // sign out so the app reflects the forced clock-out even if we missed it locally.
      if (staffDoc.onShift === false) {
        logout();
        return;
      }
      if (!staffDoc.onShift) return;

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
        ) : !permissionsLoaded ? (
          <Stack.Screen name="Permissions">
            {() => (
              <View style={{ flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#3B82F6" />
              </View>
            )}
          </Stack.Screen>
        ) : !hasGrantedPermissions ? (
          <Stack.Screen name="Permissions">
            {() => <PermissionsScreen onComplete={handlePermissionsComplete} />}
          </Stack.Screen>
        ) : (
          <Stack.Screen name="Main" component={AppTabs} />
        )}
        <Stack.Screen
          name="OrderDetail"
          component={OrderDetailScreen}
          options={{ presentation: 'modal' }}
        />
        <Stack.Screen
          name="CustomerDetail"
          component={CustomerDetailScreen}
        />
      </Stack.Navigator>
      {isLoggedIn && effectiveRole === 'rider' && <GlobalAssignmentModal />}
      {isLoggedIn && (effectiveRole === 'helper' || effectiveRole === 'iron') && <HelperAssignmentModal />}
    </>
  );
}
