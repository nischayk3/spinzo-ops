import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Image, Modal, TextInput } from 'react-native';
import { Camera, CheckCircle2, Package, UploadCloud, Video, ChevronRight, X } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { QRScanner } from './QRScanner';
import { uploadMediaToStorage } from '../utils/firebaseUpload';

interface DeliveryVerificationProps {
  visible: boolean;
  onClose: () => void;
  orderId: string;
  expectedBundles: number;
  expectedLabels: { seq: number; qr: string }[];
  onVerifyDelivery: (payload: { otp: string; proofUrl: string | null }) => Promise<boolean>;
}

type DeliveryStep = 'evidence' | 'otp';

export const DeliveryVerification = ({ visible, onClose, orderId, expectedBundles, expectedLabels, onVerifyDelivery }: DeliveryVerificationProps) => {
  const [step, setStep] = useState<DeliveryStep>('evidence');

  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [otp, setOtp] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);





  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      alert('Camera permission is required');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.5,
    });
    if (!result.canceled) {
      setUploading(true);
      try {
        const url = await uploadMediaToStorage(result.assets[0].uri, `delivery_proofs/${orderId}_${Date.now()}.jpg`);
        setProofUrl(url);
      } catch (err) {
        alert('Failed to upload photo');
      } finally {
        setUploading(false);
      }
    }
  };

  const submitOtp = async () => {
    if (otp.length !== 4) return;
    setVerifying(true);
    setOtpError(null);
    const success = await onVerifyDelivery({ otp, proofUrl });
    setVerifying(false);
    if (!success) {
      setOtpError('Verification failed. Check OTP and try again.');
    }
  };


  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/60">
        <View className="bg-bgSurface rounded-t-3xl border border-bgSurfaceLight min-h-[500px]">
          <View className="flex-row items-center justify-between p-4 border-b border-bgSurfaceLight">
            <View>
              <Text className="text-textPrimary text-lg font-bold">Delivery Verification</Text>
              <Text className="text-textSecondary text-sm">Step {step === 'evidence' ? 1 : 2} of 2</Text>
            </View>
            <TouchableOpacity onPress={onClose} className="p-2">
              <X size={24} color="#94a3b8" />
            </TouchableOpacity>
          </View>

          <View className="p-4 flex-1">

            {step === 'evidence' && (
              <View className="flex-1">
                <Text className="text-textSecondary mb-4">Step 2: Take a photo at the delivery location.</Text>
                
                <View className="items-center justify-center bg-bgDark rounded-xl border border-bgSurfaceLight mb-6 overflow-hidden h-48">
                  {uploading ? (
                    <ActivityIndicator color="#3B82F6" size="large" />
                  ) : proofUrl ? (
                    <Image source={{ uri: proofUrl }} className="w-full h-full" resizeMode="cover" />
                  ) : (
                    <View className="items-center opacity-50">
                      <Camera size={48} color="#64748B" className="mb-2" />
                      <Text className="text-textMuted font-medium">No photo captured</Text>
                    </View>
                  )}
                </View>

                <TouchableOpacity
                  onPress={takePhoto}
                  className="h-14 bg-bgDark border border-blue-500/40 rounded-xl flex-row items-center justify-center mb-4"
                >
                  <Camera color="#3B82F6" size={20} className="mr-2" />
                  <Text className="text-info font-bold text-lg">{proofUrl ? 'Retake Photo' : 'Capture Photo'}</Text>
                </TouchableOpacity>

                <View className="flex-1 justify-end">
                  <TouchableOpacity
                    onPress={() => setStep('otp')}
                    disabled={!proofUrl}
                    className={`h-14 rounded-xl flex-row items-center justify-center ${proofUrl ? 'bg-blue-600' : 'bg-bgSurfaceLight'}`}
                  >
                    <Text className={`font-bold text-lg ${proofUrl ? 'text-white' : 'text-textMuted'}`}>Next: Verify OTP</Text>
                    <ChevronRight color={proofUrl ? 'white' : '#64748B'} size={20} className="ml-2" />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {step === 'otp' && (
              <View className="flex-1">
                <Text className="text-textSecondary mb-4">Step 3: Enter the 4-digit OTP from the customer.</Text>
                
                <TextInput
                  value={otp}
                  onChangeText={(t) => setOtp(t.replace(/[^0-9]/g, '').slice(0, 4))}
                  keyboardType="number-pad"
                  maxLength={4}
                  placeholder="••••"
                  placeholderTextColor="#64748B"
                  autoFocus
                  className="bg-bgDark border border-bgSurfaceLight rounded-xl h-16 text-center text-3xl tracking-[0.5em] text-textPrimary font-bold mb-4"
                />

                {otpError && (
                  <Text className="text-red-500 text-sm mb-4 text-center bg-red-500/10 p-2 rounded-lg">{otpError}</Text>
                )}

                <View className="flex-1 justify-end">
                  <TouchableOpacity
                    onPress={submitOtp}
                    disabled={otp.length !== 4 || verifying}
                    className={`h-14 rounded-xl flex-row items-center justify-center ${otp.length === 4 ? 'bg-green-600' : 'bg-bgSurfaceLight'}`}
                  >
                    {verifying ? (
                      <ActivityIndicator color="white" />
                    ) : (
                      <>
                        <CheckCircle2 color={otp.length === 4 ? 'white' : '#64748B'} size={20} className="mr-2" />
                        <Text className={`font-bold text-lg ${otp.length === 4 ? 'text-white' : 'text-textMuted'}`}>Verify Delivery</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
};
