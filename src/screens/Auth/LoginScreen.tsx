import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, SafeAreaView, ActivityIndicator, Alert, Platform } from 'react-native';
import { useAuthStore } from '../../store/authStore';
import { Smartphone, KeyRound } from 'lucide-react-native';

export function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'PHONE' | 'OTP'>('PHONE');
  
  const { requestOTP, verifyOTP, isLoading, error } = useAuthStore();

  const handleSendOTP = async () => {
    if (phone.length < 10) return;
    try {
      if (Platform.OS === 'web') {
        await requestOTP(phone);
        setStep('OTP');
      } else {
        Alert.alert("Error", "Phone Auth currently requires Web Environment setup");
      }
    } catch (err: any) {
      // Error handled in store
    }
  };

  const handleVerifyOTP = async () => {
    if (otp.length < 6) return;
    try {
      await verifyOTP(otp);
    } catch (err: any) {
      // Error handled in store
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bgDark justify-center px-6">
      <View className="items-center mb-10">
        <View className="w-20 h-20 bg-primary/20 rounded-3xl items-center justify-center mb-4">
          <Smartphone color="#3B82F6" size={40} />
        </View>
        <Text className="text-3xl font-bold text-textPrimary">SpinZo Ops</Text>
        <Text className="text-textSecondary mt-2">Operations Portal</Text>
      </View>

      <View className="bg-bgSurface p-6 rounded-2xl border border-bgSurfaceLight shadow-lg shadow-black/20">
        <Text className="text-xl font-bold text-textPrimary mb-6">
          {step === 'PHONE' ? 'Admin Login' : 'Enter OTP'}
        </Text>

        {error ? (
          <View className="bg-danger/20 p-3 rounded-lg border border-danger/30 mb-4">
            <Text className="text-danger text-sm">{error}</Text>
          </View>
        ) : null}

        {step === 'PHONE' ? (
          <View>
            <View className="flex-row items-center border border-bgSurfaceLight rounded-xl bg-bgDark/50 px-4 py-3 mb-6">
              <Text className="text-textSecondary text-lg mr-2">+91</Text>
              <TextInput
                className="flex-1 text-textPrimary text-lg"
                placeholder="Admin Phone Number"
                placeholderTextColor="#64748B"
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
                maxLength={10}
              />
            </View>

            <TouchableOpacity 
              onPress={handleSendOTP}
              disabled={phone.length < 10 || isLoading}
              className={`w-full py-4 rounded-xl items-center justify-center ${
                phone.length === 10 && !isLoading ? 'bg-primary' : 'bg-primary/50'
              }`}
            >
              {isLoading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-white font-bold text-lg">Send OTP</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            <View className="flex-row items-center border border-bgSurfaceLight rounded-xl bg-bgDark/50 px-4 py-3 mb-6">
              <KeyRound color="#94A3B8" size={20} className="mr-3" />
              <TextInput
                className="flex-1 text-textPrimary text-lg tracking-widest"
                placeholder="000000"
                placeholderTextColor="#64748B"
                keyboardType="number-pad"
                value={otp}
                onChangeText={setOtp}
                maxLength={6}
              />
            </View>

            <TouchableOpacity 
              onPress={handleVerifyOTP}
              disabled={otp.length < 6 || isLoading}
              className={`w-full py-4 rounded-xl items-center justify-center ${
                otp.length === 6 && !isLoading ? 'bg-primary' : 'bg-primary/50'
              }`}
            >
              {isLoading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-white font-bold text-lg">Verify & Login</Text>
              )}
            </TouchableOpacity>
            
            <TouchableOpacity onPress={() => setStep('PHONE')} className="mt-4 p-2 items-center">
              <Text className="text-primary text-sm font-bold">Change Phone Number</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      
      {/* Visible Recaptcha container for Web */}
      {Platform.OS === 'web' && (
        <View className="mt-6 items-center">
          <Text className="text-textSecondary mb-2 font-bold text-center">
            Security Check: Please check the box below
          </Text>
          <div id="recaptcha-container" className="flex items-center justify-center" />
        </View>
      )}
    </SafeAreaView>
  );
}
