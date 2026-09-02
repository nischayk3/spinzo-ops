import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, SafeAreaView, ActivityIndicator } from 'react-native';
import { useAuthStore } from '../../store/authStore';
import { useAttendanceStore, ShiftDoc } from '../../store/attendanceStore';
import { Clock, Utensils, LogOut, MapPin, AlertCircle, AlertTriangle } from 'lucide-react-native';
import { QRScanner } from '../../components/QRScanner';
import * as Location from 'expo-location';

const STORE_LAT = 28.6139; // Replace with actual store coordinates
const STORE_LNG = 77.2090;

// Helper to format ms to HH:MM:SS
const formatDuration = (ms: number) => {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const getWorkTime = (shift: ShiftDoc | null) => {
  if (!shift) return 0;
  const now = shift.logoutAt || Date.now();
  let elapsed = now - shift.loginAt;
  elapsed -= (shift.totalLunchMs || 0);
  
  if (shift.status === 'lunch') {
    if (shift.lunch && !shift.lunch.endAt) elapsed -= (now - shift.lunch.startAt);
  }
  
  return elapsed;
};

const LiveTimer = ({ shift }: { shift: ShiftDoc | null }) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!shift || shift.status === 'off') return;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [shift]);

  return <Text className="text-3xl font-bold text-gray-900">{formatDuration(getWorkTime(shift))}</Text>;
};

// Lunch countdown component
const LunchCountdown = () => {
  const lunchRemainingMs = useAttendanceStore(s => s.lunchRemainingMs);
  const lunchOverdue = useAttendanceStore(s => s.lunchOverdue);
  const currentShift = useAttendanceStore(s => s.currentShift);

  if (!currentShift?.lunch || currentShift.lunch.endAt) return null;

  if (lunchOverdue) {
    const overdueMs = Date.now() - (currentShift.lunch.startAt + 2 * 60 * 60 * 1000);
    return (
      <View className="items-center">
        <View className="flex-row items-center gap-2 mb-1">
          <AlertTriangle size={16} color="#ef4444" />
          <Text className="text-red-600 font-bold text-sm uppercase tracking-widest">Overdue</Text>
        </View>
        <Text className="text-3xl font-bold text-red-600">+{formatDuration(overdueMs)}</Text>
      </View>
    );
  }

  const isWarning = lunchRemainingMs < 30 * 60 * 1000; // last 30 mins
  return (
    <View className="items-center">
      <Text className={`text-xs font-bold uppercase tracking-widest mb-1 ${isWarning ? 'text-orange-500' : 'text-purple-500'}`}>
        Time Remaining
      </Text>
      <Text className={`text-3xl font-bold ${isWarning ? 'text-orange-500' : 'text-purple-700'}`}>
        {formatDuration(lunchRemainingMs)}
      </Text>
    </View>
  );
};

export const DashboardScreen = () => {
  const user = useAuthStore(state => state.user);
  const { currentShift, status, initializeListener, clockIn, lunchOut, lunchIn, clockOut, isLoading } = useAttendanceStore();
  
  const [showQR, setShowQR] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
    initializeListener();
  }, []);

  const handleActionRequest = async (action: string) => {
    setLocationError(null);
    setPendingAction(action);
    
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError('Location permission is required for attendance.');
        setPendingAction(null);
        return;
      }
      setShowQR(true);
    } catch (e) {
      setLocationError('Error accessing location services.');
      setPendingAction(null);
    }
  };

  const onQRScan = async (data: string) => {
    setShowQR(false);
    
    if (!data) {
      setLocationError('Invalid QR code.');
      setPendingAction(null);
      return;
    }

    try {
      await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      executePendingAction(data);
    } catch (e) {
      setLocationError('Failed to verify location. Please ensure GPS is enabled.');
      setPendingAction(null);
    }
  };

  const executePendingAction = (storeId: string) => {
    switch (pendingAction) {
      case 'clockIn': clockIn(storeId); break;
      case 'lunchOut': lunchOut(); break;
      case 'lunchIn': lunchIn(); break;
      case 'clockOut': clockOut(); break;
    }
    setPendingAction(null);
  };

  const getStatusColor = () => {
    switch(status) {
      case 'working': return 'bg-green-100 text-green-700 border-green-200';
      case 'lunch': return 'bg-purple-100 text-purple-700 border-purple-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView className="flex-1 px-6 pt-4">
        {/* Header */}
        <View className="mb-6">
          <Text className="text-xs font-bold text-gray-400 tracking-wider mb-1">SPINZO · OPS</Text>
          <Text className="text-2xl text-gray-900">Hi, {user?.name}</Text>
          <Text className="text-sm text-gray-500 mt-1">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </Text>
        </View>

        {/* Status Card */}
        <View className={`border rounded-3xl p-6 mb-6 items-center shadow-sm ${getStatusColor()}`}>
          <View className="flex-row items-center gap-2 mb-2">
            <View className={`w-3 h-3 rounded-full ${status === 'working' ? 'bg-green-500' : status === 'lunch' ? 'bg-purple-500' : 'bg-gray-400'}`} />
            <Text className="text-sm font-bold tracking-widest uppercase">
              {status === 'off' ? 'OFF SHIFT' : status === 'lunch' ? 'LUNCH BREAK' : 'WORKING'}
            </Text>
          </View>
          {status === 'lunch' ? <LunchCountdown /> : <LiveTimer shift={currentShift} />}
          {user?.role && (
            <View className="mt-3 bg-white/50 px-3 py-1 rounded-full">
              <Text className="text-xs font-medium uppercase opacity-80">{user.role}</Text>
            </View>
          )}
        </View>

        {locationError && (
          <View className="bg-red-50 p-4 rounded-xl mb-6 flex-row items-center gap-3">
            <AlertCircle size={20} color="#ef4444" />
            <Text className="text-red-600 flex-1">{locationError}</Text>
          </View>
        )}

        {/* Action Buttons */}
        <View className="space-y-4 mb-8">
          {status === 'off' ? (
            <TouchableOpacity 
              onPress={() => handleActionRequest('clockIn')}
              disabled={isLoading}
              className="bg-white border-2 border-green-500 py-5 rounded-2xl flex-row items-center justify-center gap-3 active:bg-green-50"
            >
              <MapPin color="#22c55e" size={20} />
              <Text className="text-green-600 font-bold text-base">Clock In</Text>
            </TouchableOpacity>
          ) : (
            <>
              {/* Lunch Button */}
              {status === 'lunch' ? (
                <TouchableOpacity 
                  onPress={() => handleActionRequest('lunchIn')}
                  disabled={isLoading}
                  className="bg-white border-2 border-purple-500 py-5 rounded-2xl flex-row items-center justify-center gap-3 active:bg-purple-50"
                >
                  <Utensils color="#a855f7" size={20} />
                  <Text className="text-purple-600 font-bold text-base">End Lunch</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity 
                  onPress={() => handleActionRequest('lunchOut')}
                  disabled={isLoading || status !== 'working' || currentShift?.lunch !== null}
                  className={`bg-white border-2 py-4 rounded-2xl flex-row items-center justify-center gap-3 ${status !== 'working' || currentShift?.lunch !== null ? 'border-gray-200 opacity-50' : 'border-purple-500 active:bg-purple-50'}`}
                >
                  <Utensils color={status !== 'working' || currentShift?.lunch !== null ? "#9ca3af" : "#a855f7"} size={20} />
                  <View>
                    <Text className={`font-bold text-base ${status !== 'working' || currentShift?.lunch !== null ? 'text-gray-400' : 'text-purple-600'}`}>Lunch Break</Text>
                    <Text className="text-xs text-center text-gray-500">{currentShift?.lunch ? 'Completed' : '2 hour limit'}</Text>
                  </View>
                </TouchableOpacity>
              )}

              {/* Logout Button */}
              <TouchableOpacity 
                onPress={() => handleActionRequest('clockOut')}
                disabled={isLoading || (status as string) === 'off'}
                className="bg-white border-2 border-red-500 py-5 rounded-2xl flex-row items-center justify-center gap-3 mt-4 active:bg-red-50"
              >
                <LogOut color="#ef4444" size={20} />
                <Text className="text-red-600 font-bold text-base">Clock Out</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Today's Summary */}
        {currentShift && (
          <View className="bg-gray-50 rounded-3xl p-6 mb-8">
            <Text className="text-base text-gray-900 mb-4 font-medium">Today's Summary</Text>
            
            <View className="space-y-4">
              <View className="flex-row justify-between items-center border-b border-gray-200 pb-3">
                <Text className="text-gray-500">Login Time</Text>
                <Text className="text-gray-900 font-medium">
                  {new Date(currentShift.loginAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
              
              <View className="flex-row justify-between items-center pb-1">
                <Text className="text-gray-500">Lunch</Text>
                <Text className="text-gray-900 font-medium">
                  {currentShift.lunch ? (currentShift.lunch.endAt ? 'Completed' : 'In Progress') : 'Not Taken'}
                </Text>
              </View>
            </View>
          </View>
        )}
        
        {isLoading && (
          <View className="absolute inset-0 bg-white/50 flex items-center justify-center">
            <ActivityIndicator size="large" color="#994bff" />
          </View>
        )}
      </ScrollView>

      <QRScanner 
        visible={showQR} 
        onClose={() => {
          setShowQR(false);
          setPendingAction(null);
        }} 
        onScan={onQRScan}
        actionType={pendingAction === 'clockIn' ? 'Login' : pendingAction === 'clockOut' ? 'Logout' : 'Attendance'} 
      />
    </SafeAreaView>
  );
};
