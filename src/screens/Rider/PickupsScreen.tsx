import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, Modal, TextInput, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bike, Clock, MapPin, ShieldCheck } from 'lucide-react-native';
import { useAuthStore } from '../../store/authStore';
import { useOpsStaffStore } from '../../store/opsStaffStore';
import { isPending, pickupLabel } from '../../utils/opsTasks';
import { timeAgo } from '../../utils/orderFeed';
import { verifyPickupOTP } from '../../utils/opsPickup';

export function PickupsScreen() {
  const user = useAuthStore(state => state.user);
  const { myTasks, isLoading, initialize } = useOpsStaffStore();

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null); // which task's OTP modal is open
  const [otp, setOtp] = useState('');
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (user?.id) initialize(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = myTasks.filter(isPending);

  const handleVerify = async () => {
    if (!activeTaskId || otp.length !== 4 || verifying) return;
    const orderId = activeTaskId;
    setVerifying(true);
    try {
      const res = await verifyPickupOTP(orderId, otp);
      if (res.ok) {
        setActiveTaskId(null);
        setOtp('');
        // The task flips to picked_up via the onSnapshot subscription and auto-removes.
        Alert.alert('Pickup verified', 'Order marked as picked up.');
      } else {
        const msg =
          res.error === 'invalid_otp' ? 'Incorrect OTP. Please try again.'
          : res.error === 'invalid_state' ? 'This order is no longer awaiting pickup.'
          : res.error === 'unauthorized' ? 'You are not assigned to this pickup.'
          : res.error === 'locked' ? 'Too many incorrect attempts. Contact the supervisor.'
          : 'Could not verify pickup. Please try again.';
        Alert.alert('Verification failed', msg);
      }
    } catch {
      // verifyPickupOTP never throws today, but guard against a sync throw so the
      // modal isn't stuck with no error surface.
      Alert.alert('Verification failed', 'Could not verify pickup. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  if (isLoading && pending.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-bgDark items-center justify-center">
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text className="text-textSecondary mt-4 font-bold">Loading pickups…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bgDark">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-2xl font-bold text-textPrimary">My Pickups</Text>
        <Text className="text-textSecondary">
          {pending.length} pending pickup{pending.length === 1 ? '' : 's'}
        </Text>
      </View>
      <FlatList
        data={pending}
        keyExtractor={t => t.id}
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={
          <View className="items-center justify-center mt-20">
            <Bike size={36} color="#64748B" />
            <Text className="text-textSecondary text-lg font-bold mt-3">No pickups assigned yet</Text>
            <Text className="text-textMuted text-center mt-2">Assigned pickups appear here instantly.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View className="bg-bgSurface rounded-xl p-4 mb-3 border border-bgSurfaceLight">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-textPrimary font-bold text-lg">
                #{item.orderId.slice(-6).toUpperCase()}
              </Text>
              {item.createdAt ? (
                <View className="flex-row items-center">
                  <Clock size={13} color="#94A3B8" />
                  <Text className="text-textMuted text-xs ml-1">{timeAgo(item.createdAt)}</Text>
                </View>
              ) : null}
            </View>
            {item.pickupAddress ? (
              <View className="flex-row items-start mb-2">
                <MapPin size={14} color="#94A3B8" className="mt-0.5" />
                <Text className="text-textSecondary text-sm ml-1 flex-1">{item.pickupAddress}</Text>
              </View>
            ) : null}
            <View className="flex-row items-center justify-between">
              <View className="bg-bgDark px-2 py-1 rounded-md self-start">
                <Text className="text-primary text-xs font-bold">{pickupLabel(item)}</Text>
              </View>
              {item.tokenNumber ? (
                <Text className="text-textMuted text-xs">Token #{item.tokenNumber}</Text>
              ) : null}
            </View>
            <TouchableOpacity
              onPress={() => { setOtp(''); setActiveTaskId(item.id); }}
              className="mt-3 bg-info/15 border border-info/40 rounded-lg h-11 items-center justify-center flex-row"
            >
              <ShieldCheck size={18} color="#3B82F6" className="mr-2" />
              <Text className="text-info font-bold">Verify pickup OTP</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      <Modal
        visible={activeTaskId !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setActiveTaskId(null)}
      >
        <View className="flex-1 justify-center items-center bg-black/60 p-6">
          <View className="w-full bg-bgSurface rounded-2xl p-5 border border-bgSurfaceLight">
            <Text className="text-textPrimary text-lg font-bold mb-1">Verify Pickup</Text>
            <Text className="text-textSecondary text-sm mb-4">Enter the 4-digit OTP the customer shared.</Text>

            <TextInput
              value={otp}
              onChangeText={(t) => setOtp(t.replace(/[^0-9]/g, '').slice(0, 4))}
              keyboardType="number-pad"
              maxLength={4}
              placeholder="••••"
              placeholderTextColor="#64748B"
              autoFocus
              className="bg-bgDark border border-bgSurfaceLight rounded-xl h-14 text-center text-2xl tracking-[0.5em] text-textPrimary font-bold"
            />

            {verifying ? (
              <View className="mt-4">
                <ActivityIndicator size="small" color="#3B82F6" />
              </View>
            ) : (
              <View className="flex-row gap-3 mt-4">
                <TouchableOpacity
                  onPress={() => setActiveTaskId(null)}
                  className="flex-1 bg-bgSurfaceLight rounded-xl h-12 items-center justify-center"
                >
                  <Text className="text-textSecondary font-bold">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleVerify}
                  disabled={otp.length !== 4}
                  className="flex-1 bg-primary rounded-xl h-12 items-center justify-center"
                >
                  <Text className="text-white font-bold">Verify</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
