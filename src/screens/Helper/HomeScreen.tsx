import { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TrendingUp, Clock, MapPin, Power } from 'lucide-react-native';
import * as Location from 'expo-location';
import { useAuthStore } from '../../store/authStore';
import { useOpsStaffStore, StoreInfo } from '../../store/opsStaffStore';
import { useOpsProcessStore } from '../../store/opsProcessStore';
import { FaceVerification } from '../../components/FaceVerification';
import { QRScanner } from '../../components/QRScanner';
import { isWithinRadiusMeters } from '../../utils/storeGeo';
import { isDone } from '../../utils/opsProcess';

type VerifyStep = 'none' | 'face' | 'qr' | 'geo';

// The in-store QR encodes the store id (printed + placed at the store).
const STORE_QR_RE = /^SPNZ-STORE:([A-Za-z0-9_-]+)$/;

function parseStoreQr(data: string): string | null {
  const m = STORE_QR_RE.exec((data || '').trim());
  return m ? m[1] : null;
}

function fmtDurationMs(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const secs = s % 60;
  if (m < 60) return secs ? `${m}m ${secs}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function HomeScreen() {
  const user = useAuthStore(s => s.user);
  const activeRole = useAuthStore(s => s.activeRole);
  const { staffDoc, goOnShift, goOffShift, fetchStore, error } = useOpsStaffStore();
  const { processes, initialize } = useOpsProcessStore();

  const [verifyStep, setVerifyStep] = useState<VerifyStep>('none');
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (user?.id) initialize(user.id);
  }, [user?.id, initialize]);

  const onShift = !!staffDoc?.onShift;
  const displayName = staffDoc?.name || user?.name || 'Staff';
  const staffId = user?.phone || user?.id || '';

  const performance = useMemo(() => {
    const done = processes.filter(isDone);
    let totalMs = 0;
    for (const p of done) {
      for (const st of Object.values(p.stages)) totalMs += st.durationMs || 0;
    }
    return { ordersCompleted: done.length, avgMs: done.length > 0 ? totalMs / done.length : 0 };
  }, [processes]);

  const shiftMinutes = (() => {
    const v = staffDoc?.shiftStartAt;
    if (!v) return 0;
    let ms = 0;
    if (typeof (v as any).toDate === 'function') ms = (v as any).toDate().getTime();
    else if (typeof (v as any).seconds === 'number') ms = (v as any).seconds * 1000;
    else ms = new Date(v as any).getTime();
    return Number.isNaN(ms) ? 0 : Math.max(0, (Date.now() - ms) / 60000);
  })();

  const abort = () => {
    setVerifyStep('none');
    setStore(null);
    setNotice(null);
  };

  const handleToggle = (wantOnline: boolean) => {
    setNotice(null);
    if (wantOnline) {
      setStore(null);
      setVerifyStep('face');
    } else if (user?.id) {
      goOffShift(user.id);
    }
  };

  const handleStoreScan = async (data: string) => {
    const storeId = parseStoreQr(data);
    if (!storeId) {
      setNotice('That QR is not a store code. Scan the store entry QR.');
      return;
    }
    const info = await fetchStore(storeId);
    if (!info) {
      setNotice('Store not found. Ask the supervisor to register this store.');
      return;
    }
    setStore(info);
    setNotice(null);
    setVerifyStep('geo');
  };

  const runGeo = async () => {
    if (!store || !user) return;
    setBusy(true);
    setNotice(null);
    let geoError: string | null = null;
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && !navigator.geolocation) {
        await Location.installWebGeolocationPolyfill();
      }
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        geoError = 'location_permission';
      } else {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const inside = isWithinRadiusMeters(
          { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
          { latitude: store.lat, longitude: store.lng },
          store.radiusMeters
        );
        geoError = inside ? null : 'outside_radius';
      }
    } catch {
      geoError = 'unavailable';
    }

    // Geo is a soft corroboration — the store QR + face are the primary in-store
    // proof. Record the outcome and still allow going online.
    if (geoError) {
      setNotice(`Location not verified (${geoError}). Continuing without the geo check.`);
    }

    await goOnShift(user.id, user.role, user.phone, user.name, {
      storeId: store.storeId,
      storeName: store.name,
      ...(geoError
        ? { geoVerifiedAt: null, geoError }
        : { geoVerifiedAt: new Date(), geoError: null }),
      verifiedAt: new Date(),
    });
    setBusy(false);
    setVerifyStep('none');
  };

  return (
    <SafeAreaView className="flex-1 bg-bgDark">
      <ScrollView className="flex-1">
        <View className="p-4">
        {/* Identity + online toggle */}
        <View className="flex-row items-start justify-between mb-4">
          <View className="flex-1 mr-3">
            <Text className="text-xl font-bold text-textPrimary">{displayName}</Text>
            <Text className="text-textSecondary text-sm mt-1">ID: {staffId}</Text>
            {onShift && store && (
              <Text className="text-textSecondary text-xs mt-1">Active at {store.name}</Text>
            )}
            {activeRole ? (
              <Text className="text-primary text-xs mt-0.5 font-semibold uppercase tracking-wide">
                {activeRole}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity
            onPress={() => handleToggle(!onShift)}
            disabled={busy}
            className={`px-4 py-2 rounded-full border flex-row items-center ${
              onShift ? 'bg-primary/15 border-primary/40' : 'bg-bgSurface border-bgSurfaceLight'
            }`}
          >
            <Power size={14} color={onShift ? '#22C55E' : '#94A3B8'} className="mr-1" />
            <Text className={`font-bold text-sm ${onShift ? 'text-primary' : 'text-textSecondary'}`}>
              {onShift ? 'Online' : 'Offline'}
            </Text>
          </TouchableOpacity>
        </View>

        {onShift && !!staffDoc?.shiftStartAt && (
          <View className="flex-row items-center mb-4">
            <Clock size={14} color="#94A3B8" className="mr-1" />
            <Text className="text-textSecondary text-sm">
              Shift since {Math.floor(shiftMinutes)}m ago
            </Text>
          </View>
        )}

        {/* Today's Performance */}
        <View className="bg-bgSurface rounded-2xl p-5 border border-bgSurfaceLight mb-4">
          <View className="flex-row items-center mb-4">
            <View className="w-10 h-10 rounded-full bg-primary/10 items-center justify-center mr-2">
              <TrendingUp size={20} color="#22C55E" />
            </View>
            <Text className="text-textPrimary font-bold">Today's Performance</Text>
          </View>
          <View className="flex-row gap-4">
            <View className="flex-1 bg-bgDark rounded-xl p-4 items-center">
              <Text className="text-3xl font-bold text-textPrimary">{performance.ordersCompleted}</Text>
              <Text className="text-textMuted text-xs mt-1">Orders Completed</Text>
            </View>
            <View className="flex-1 bg-bgDark rounded-xl p-4 items-center">
              <Text className="text-lg font-bold text-textPrimary">
                {performance.ordersCompleted > 0 ? fmtDurationMs(performance.avgMs) : '—'}
              </Text>
              <Text className="text-textMuted text-xs mt-1">Avg. Processing</Text>
            </View>
          </View>
        </View>

        {error ? <Text className="text-error text-xs mb-2">{error}</Text> : null}
        {notice ? <Text className="text-warning text-xs mb-2">{notice}</Text> : null}
        </View>
      </ScrollView>

      <FaceVerification
        visible={verifyStep === 'face'}
        onComplete={() => setVerifyStep('qr')}
        onCancel={abort}
      />

      <QRScanner
        visible={verifyStep === 'qr'}
        onClose={() => setVerifyStep(s => (s === 'qr' ? 'none' : s))}
        onScan={handleStoreScan}
        actionType="store"
      />

      {verifyStep === 'geo' && store && (
        <View className="absolute inset-0 bg-bgDark/95 items-center justify-center px-6">
          <MapPin size={40} color="#22C55E" className="mb-3" />
          <Text className="text-textPrimary text-lg font-bold mb-1">Verify your location</Text>
          <Text className="text-textSecondary text-center mb-6">Confirm you're at {store.name}</Text>
          {busy ? (
            <ActivityIndicator size="large" color="#22C55E" />
          ) : (
            <>
              <TouchableOpacity
                onPress={runGeo}
                className="w-full bg-primary h-14 rounded-xl items-center justify-center mb-3"
              >
                <Text className="text-bgDark font-bold text-lg">Verify location</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={abort}>
                <Text className="text-textMuted font-bold">Cancel</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}
