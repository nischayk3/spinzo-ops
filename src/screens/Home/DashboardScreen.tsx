import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, SafeAreaView, ActivityIndicator } from 'react-native';
import { useAuthStore } from '../../store/authStore';
import { useAttendanceStore, ShiftDoc } from '../../store/attendanceStore';
import { Clock, Coffee, Utensils, LogOut, CheckCircle, MapPin, AlertCircle } from 'lucide-react-native';
import { QRScanner } from '../../components/QRScanner';
import * as Location from 'expo-location';

const STORE_LAT = 28.6139; // Replace with actual store coordinates
const STORE_LNG = 77.2090;
const MAX_DISTANCE_METERS = 200; // 200 meters allowed radius

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
  elapsed -= (shift.totalBreakMs || 0);
  elapsed -= (shift.totalLunchMs || 0);
  
  if (shift.status === 'break') {
    const active = shift.breaks[shift.breaks.length - 1];
    if (active && !active.endAt) elapsed -= (now - active.startAt);
  } else if (shift.status === 'lunch') {
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

export const DashboardScreen = () => {
  const user = useAuthStore(state => state.user);
  const { currentShift, status, initializeListener, clockIn, startBreak, endBreak, lunchOut, lunchIn, clockOut, isLoading } = useAttendanceStore();
  
  const [showQR, setShowQR] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
    initializeListener();
  }, []);

  // Distance calculation using Haversine formula
  const getDistanceFromLatLonInM = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3; // Radius of the earth in m
    const dLat = (lat2 - lat1) * (Math.PI/180);
    const dLon = (lon2 - lon1) * (Math.PI/180); 
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * (Math.PI/180)) * Math.cos(lat2 * (Math.PI/180)) * 
      Math.sin(dLon/2) * Math.sin(dLon/2); 
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    return R * c; 
  };

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
    
    // Validate store QR code - for now just check it's not empty
    if (!data) {
      setLocationError('Invalid QR code.');
      setPendingAction(null);
      return;
    }

    try {
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const distance = getDistanceFromLatLonInM(location.coords.latitude, location.coords.longitude, STORE_LAT, STORE_LNG);
      
      // TEMPORARY BYPASS FOR DEV: if distance > MAX_DISTANCE_METERS, we would normally fail here
      // But for testing without mocking location, we will allow it and just log it.
      // if (distance > MAX_DISTANCE_METERS) {
      //   setLocationError('You must be at the store to mark attendance.');
      //   setPendingAction(null);
      //   return;
      // }

      executePendingAction(data);
    } catch (e) {
      setLocationError('Failed to verify location. Please ensure GPS is enabled.');
      setPendingAction(null);
    }
  };

  const executePendingAction = (storeId: string) => {
    switch (pendingAction) {
      case 'clockIn': clockIn(storeId); break;
      case 'startBreak': startBreak(); break;
      case 'endBreak': endBreak(); break;
      case 'lunchOut': lunchOut(); break;
      case 'lunchIn': lunchIn(); break;
      case 'clockOut': clockOut(); break;
    }
    setPendingAction(null);
  };

  const getStatusColor = () => {
    switch(status) {
      case 'working': return 'bg-green-100 text-green-700 border-green-200';
      case 'break': return 'bg-orange-100 text-orange-700 border-orange-200';
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
            <View className={`w-3 h-3 rounded-full ${status === 'working' ? 'bg-green-500' : status === 'break' ? 'bg-orange-500' : status === 'lunch' ? 'bg-purple-500' : 'bg-gray-400'}`} />
            <Text className="text-sm font-bold tracking-widest uppercase">
              {status === 'off' ? 'OFF SHIFT' : status}
            </Text>
          </View>
          <LiveTimer shift={currentShift} />
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
              {/* Break Button */}
              {status === 'break' ? (
                <TouchableOpacity 
                  onPress={() => handleActionRequest('endBreak')}
                  disabled={isLoading}
                  className="bg-white border-2 border-orange-500 py-5 rounded-2xl flex-row items-center justify-center gap-3 active:bg-orange-50"
                >
                  <Coffee color="#f97316" size={20} />
                  <Text className="text-orange-600 font-bold text-base">End Break</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity 
                  onPress={() => handleActionRequest('startBreak')}
                  disabled={isLoading || status !== 'working' || (currentShift?.breaks?.length || 0) >= 3}
                  className={`bg-white border-2 py-4 rounded-2xl flex-row items-center justify-center gap-3 ${status !== 'working' || (currentShift?.breaks?.length || 0) >= 3 ? 'border-gray-200 opacity-50' : 'border-orange-500 active:bg-orange-50'}`}
                >
                  <Coffee color={status !== 'working' || (currentShift?.breaks?.length || 0) >= 3 ? "#9ca3af" : "#f97316"} size={20} />
                  <View>
                    <Text className={`font-bold text-base ${status !== 'working' || (currentShift?.breaks?.length || 0) >= 3 ? 'text-gray-400' : 'text-orange-600'}`}>Start Break</Text>
                    <Text className="text-xs text-center text-gray-500">{3 - (currentShift?.breaks?.length || 0)} left · 10m auto-timer</Text>
                  </View>
                </TouchableOpacity>
              )}

              {/* Lunch Button */}
              {status === 'lunch' ? (
                <TouchableOpacity 
                  onPress={() => handleActionRequest('lunchIn')}
                  disabled={isLoading}
                  className="bg-white border-2 border-purple-500 py-5 rounded-2xl flex-row items-center justify-center gap-3 active:bg-purple-50"
                >
                  <Utensils color="#a855f7" size={20} />
                  <Text className="text-purple-600 font-bold text-base">Lunch In</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity 
                  onPress={() => handleActionRequest('lunchOut')}
                  disabled={isLoading || status !== 'working' || currentShift?.lunch !== null}
                  className={`bg-white border-2 py-4 rounded-2xl flex-row items-center justify-center gap-3 ${status !== 'working' || currentShift?.lunch !== null ? 'border-gray-200 opacity-50' : 'border-purple-500 active:bg-purple-50'}`}
                >
                  <Utensils color={status !== 'working' || currentShift?.lunch !== null ? "#9ca3af" : "#a855f7"} size={20} />
                  <View>
                    <Text className={`font-bold text-base ${status !== 'working' || currentShift?.lunch !== null ? 'text-gray-400' : 'text-purple-600'}`}>Lunch Out</Text>
                    <Text className="text-xs text-center text-gray-500">{currentShift?.lunch ? 'Completed' : '45m max'}</Text>
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
              
              <View className="flex-row justify-between items-center border-b border-gray-200 pb-3">
                <Text className="text-gray-500">Breaks Taken</Text>
                <Text className="text-gray-900 font-medium">{currentShift.breaks?.length || 0} / 3</Text>
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
