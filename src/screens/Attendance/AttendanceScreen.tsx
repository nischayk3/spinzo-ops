import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, SafeAreaView, ScrollView } from 'react-native';
import { useAttendanceStore } from '../../store/attendanceStore';
import { useAuthStore } from '../../store/authStore';
import { QRScanner } from '../../components/QRScanner';
import { QrCode, Clock, Coffee, LogOut, CheckCircle2 } from 'lucide-react-native';

export function AttendanceScreen() {
  const { user } = useAuthStore();
  const { status, sessionStartTime, breaks, scanLogin, scanBreakOut, scanBreakIn, scanLunchOut, scanLunchIn, scanLogout } = useAttendanceStore();
  
  const [scannerVisible, setScannerVisible] = useState(false);
  const [currentAction, setCurrentAction] = useState<string>('');
  const [elapsedTime, setElapsedTime] = useState('00:00:00');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (status === 'active' && sessionStartTime) {
      timerRef.current = setInterval(() => {
        const diff = Math.floor((Date.now() - new Date(sessionStartTime).getTime()) / 1000);
        const hrs = Math.floor(diff / 3600).toString().padStart(2, '0');
        const mins = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
        const secs = (diff % 60).toString().padStart(2, '0');
        setElapsedTime(`${hrs}:${mins}:${secs}`);
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status, sessionStartTime]);

  const handleScanRequest = (action: string) => {
    setCurrentAction(action);
    setScannerVisible(true);
  };

  const onScanComplete = (data: string) => {
    switch(currentAction) {
      case 'login': scanLogin(data); break;
      case 'break_out': scanBreakOut(data); break;
      case 'break_in': scanBreakIn(data); break;
      case 'lunch_out': scanLunchOut(data); break;
      case 'lunch_in': scanLunchIn(data); break;
      case 'logout': scanLogout(data); break;
    }
  };

  const shortBreaksTaken = breaks.filter(b => b.type === 'short_break').length;
  const lunchTaken = breaks.some(b => b.type === 'lunch');

  if (status === 'not_logged_in') {
    return (
      <SafeAreaView className="flex-1 bg-bgDark justify-center items-center px-6">
        <View className="w-20 h-20 bg-bgSurface rounded-full items-center justify-center mb-6">
          <QrCode size={40} color="#22C55E" />
        </View>
        <Text className="text-2xl font-bold text-textPrimary mb-2">Start Your Shift</Text>
        <Text className="text-center text-textSecondary mb-8">Scan the Store QR code to clock in and begin receiving orders.</Text>
        
        <TouchableOpacity 
          onPress={() => handleScanRequest('login')}
          className="w-full bg-primary h-14 rounded-xl items-center justify-center flex-row"
        >
          <QrCode size={20} color="white" className="mr-2" />
          <Text className="text-white text-lg font-bold">Scan to Login</Text>
        </TouchableOpacity>
        
        <QRScanner 
          visible={scannerVisible} 
          onClose={() => setScannerVisible(false)} 
          onScan={onScanComplete}
          actionType={currentAction}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bgDark">
      <ScrollView className="flex-1 px-4 pt-6">
        {/* Header */}
        <View className="flex-row justify-between items-center mb-6">
          <View>
            <Text className="text-textSecondary text-sm">Hello,</Text>
            <Text className="text-2xl font-bold text-textPrimary">{user?.name}</Text>
          </View>
          <View className="bg-bgSurfaceLight px-3 py-1 rounded-full">
            <Text className="text-primary font-bold uppercase text-xs">{user?.role}</Text>
          </View>
        </View>

        {/* Live Status Card */}
        <View className="bg-bgSurface rounded-2xl p-6 mb-6 items-center border border-bgSurfaceLight">
          <View className="flex-row items-center mb-2">
            <View className={`w-3 h-3 rounded-full mr-2 ${status === 'active' ? 'bg-primary' : 'bg-warning'}`} />
            <Text className="text-textSecondary font-semibold uppercase tracking-widest text-sm">
              {status === 'active' ? 'Working' : status === 'break' ? 'On Break' : 'On Lunch'}
            </Text>
          </View>
          <Text className="text-5xl font-light text-textPrimary tracking-wider">{elapsedTime}</Text>
        </View>

        {/* Quick Actions */}
        <Text className="text-sm font-bold text-textMuted uppercase mb-4 ml-2">Quick Actions</Text>
        <View className="flex-row flex-wrap justify-between">
          
          {/* Lunch Action */}
          <TouchableOpacity 
            onPress={() => handleScanRequest(status === 'lunch' ? 'lunch_in' : 'lunch_out')}
            disabled={status === 'break' || (lunchTaken && status !== 'lunch')}
            className={`w-[48%] h-24 rounded-2xl p-4 mb-4 justify-between border ${
              status === 'lunch' ? 'bg-warning/20 border-warning' : 'bg-bgSurface border-bgSurfaceLight'
            } ${(status === 'break' || (lunchTaken && status !== 'lunch')) ? 'opacity-50' : ''}`}
          >
            <Clock size={24} color={status === 'lunch' ? '#F59E0B' : '#94A3B8'} />
            <View>
              <Text className={`font-bold ${status === 'lunch' ? 'text-warning' : 'text-textPrimary'}`}>
                {status === 'lunch' ? 'End Lunch' : 'Lunch Out'}
              </Text>
              {lunchTaken && status !== 'lunch' && (
                <Text className="text-xs text-textSecondary mt-1">Already taken</Text>
              )}
            </View>
          </TouchableOpacity>

          {/* Break Action */}
          <TouchableOpacity 
            onPress={() => handleScanRequest(status === 'break' ? 'break_in' : 'break_out')}
            disabled={status === 'lunch' || shortBreaksTaken >= 3}
            className={`w-[48%] h-24 rounded-2xl p-4 mb-4 justify-between border ${
              status === 'break' ? 'bg-info/20 border-info' : 'bg-bgSurface border-bgSurfaceLight'
            } ${(status === 'lunch' || shortBreaksTaken >= 3) ? 'opacity-50' : ''}`}
          >
            <Coffee size={24} color={status === 'break' ? '#3B82F6' : '#94A3B8'} />
            <View>
              <Text className={`font-bold ${status === 'break' ? 'text-info' : 'text-textPrimary'}`}>
                {status === 'break' ? 'End Break' : 'Take Break'}
              </Text>
              <Text className="text-xs text-textSecondary">{shortBreaksTaken}/3 taken</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Summary */}
        <View className="bg-bgSurface rounded-2xl p-4 mt-2">
          <Text className="font-bold text-textPrimary mb-3">Today's Summary</Text>
          <View className="flex-row items-center mb-2">
            <CheckCircle2 size={16} color="#22C55E" className="mr-2" />
            <Text className="text-textSecondary flex-1">Login Time</Text>
            <Text className="text-textPrimary">{sessionStartTime ? new Date(sessionStartTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--:--'}</Text>
          </View>
          <View className="flex-row items-center mb-2">
            <CheckCircle2 size={16} color={lunchTaken ? "#22C55E" : "#64748B"} className="mr-2" />
            <Text className="text-textSecondary flex-1">Lunch Break</Text>
            <Text className="text-textPrimary">{lunchTaken ? 'Taken' : 'Not Taken'}</Text>
          </View>
          <View className="flex-row items-center">
            <CheckCircle2 size={16} color="#22C55E" className="mr-2" />
            <Text className="text-textSecondary flex-1">Breaks Taken</Text>
            <Text className="text-textPrimary">{shortBreaksTaken} / 3</Text>
          </View>
        </View>

        {/* Logout */}
        <TouchableOpacity 
          onPress={() => handleScanRequest('logout')}
          className="w-full bg-error/20 border border-error/50 h-14 rounded-xl items-center justify-center flex-row mt-8"
        >
          <LogOut size={20} color="#EF4444" className="mr-2" />
          <Text className="text-error text-lg font-bold">Logout</Text>
        </TouchableOpacity>

      </ScrollView>

      <QRScanner 
        visible={scannerVisible} 
        onClose={() => setScannerVisible(false)} 
        onScan={onScanComplete}
        actionType={currentAction}
      />
    </SafeAreaView>
  );
}
