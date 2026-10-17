import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Image, Modal, TextInput } from 'react-native';
import { Camera, CheckCircle2, ChevronRight, X, AlertTriangle, ArrowLeft } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { uploadMediaToStorage } from '../utils/firebaseUpload';

interface DeliveryVerificationProps {
  visible: boolean;
  onClose: () => void;
  orderId: string;
  expectedBundles?: number;
  expectedLabels?: { seq: number; qr: string }[];
  onVerifyDelivery: (payload: { otp: string; proofUrl: string | null; allowUnpaidDelivery?: boolean }) => Promise<boolean>;
  totalAmount?: number;
  paymentStatus?: string;
  paymentMode?: string;
  customerName?: string;
  isSupervisor?: boolean;
}

type DeliveryStep = 'evidence' | 'otp';

export const DeliveryVerification = ({
  visible,
  onClose,
  orderId,
  expectedBundles = 1,
  onVerifyDelivery,
  totalAmount = 0,
  paymentStatus,
  paymentMode,
  customerName,
  isSupervisor = false,
}: DeliveryVerificationProps) => {
  const [step, setStep] = useState<DeliveryStep>('evidence');
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [otp, setOtp] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [allowUnpaid, setAllowUnpaid] = useState(isSupervisor);

  const isPaid = (paymentStatus || '').toLowerCase() === 'paid';
  const isPendingPayment = totalAmount > 0 && !isPaid;

  const takePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        alert('Camera permission is required');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.5,
      });
      if (!result.canceled && result.assets?.[0]?.uri) {
        setUploading(true);
        try {
          const url = await uploadMediaToStorage(result.assets[0].uri, `delivery_proofs/${orderId}_${Date.now()}.jpg`);
          setProofUrl(url);
        } catch {
          alert('Failed to upload photo');
        } finally {
          setUploading(false);
        }
      }
    } catch (e) {
      console.warn('Camera launch error:', e);
    }
  };

  const submitOtp = async () => {
    if (otp.length !== 4) return;
    setVerifying(true);
    setOtpError(null);
    const success = await onVerifyDelivery({ otp, proofUrl, allowUnpaidDelivery: allowUnpaid || isSupervisor });
    setVerifying(false);
    if (!success) {
      setOtpError('Verification failed. Check OTP and payment status.');
    }
  };

  const handleModalClose = () => {
    setStep('evidence');
    setOtp('');
    setOtpError(null);
    onClose();
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleModalClose}>
      <View className="flex-1 justify-end bg-black/60">
        <View className="bg-slate-900 rounded-t-3xl border border-slate-700 min-h-[500px]">
          {/* Header */}
          <View className="flex-row items-center justify-between p-4 border-b border-slate-800">
            <View>
              <Text className="text-white text-lg font-black tracking-tight">Delivery Verification</Text>
              <Text className="text-slate-400 text-xs font-bold mt-0.5">
                {customerName ? `${customerName} • ` : ''}Order #{orderId.slice(-6).toUpperCase()}
              </Text>
            </View>
            <TouchableOpacity onPress={handleModalClose} className="p-2 bg-slate-800 rounded-full">
              <X size={20} color="#94a3b8" />
            </TouchableOpacity>
          </View>

          <View className="p-4 flex-1">
            {/* Payment Status Banner */}
            {isPendingPayment ? (
              <View className="bg-amber-500/15 border-2 border-amber-500/40 p-3 rounded-2xl mb-4 flex-row items-center">
                <AlertTriangle size={20} color="#f59e0b" className="mr-3 shrink-0" />
                <View className="flex-1">
                  <Text className="text-amber-400 font-black text-sm uppercase tracking-wide">
                    💵 Collect Cash / UPI: ₹{totalAmount}
                  </Text>
                  <Text className="text-amber-200 text-xs mt-0.5 font-medium">
                    {paymentMode === 'later' ? 'Customer selected Pay on Delivery.' : 'Customer must settle payment upon delivery.'}
                  </Text>
                </View>
              </View>
            ) : isPaid ? (
              <View className="bg-emerald-500/15 border-2 border-emerald-500/30 p-2.5 rounded-2xl mb-4 flex-row items-center">
                <CheckCircle2 size={18} color="#10b981" className="mr-2.5 shrink-0" />
                <Text className="text-emerald-400 font-black text-xs uppercase tracking-wide">
                  Order Paid Online: ₹{totalAmount}
                </Text>
              </View>
            ) : null}

            {step === 'evidence' && (
              <View className="flex-1">
                <Text className="text-slate-300 text-xs font-bold uppercase tracking-wider mb-2">
                  Delivery Photo (Optional)
                </Text>

                <View className="items-center justify-center bg-slate-950 rounded-2xl border-2 border-slate-800 mb-4 overflow-hidden h-44">
                  {uploading ? (
                    <ActivityIndicator color="#3B82F6" size="large" />
                  ) : proofUrl ? (
                    <Image source={{ uri: proofUrl }} className="w-full h-full" resizeMode="cover" />
                  ) : (
                    <View className="items-center opacity-60">
                      <Camera size={40} color="#64748B" className="mb-2" />
                      <Text className="text-slate-400 text-xs font-bold">No photo captured</Text>
                    </View>
                  )}
                </View>

                <TouchableOpacity
                  onPress={takePhoto}
                  className="h-12 bg-slate-800 active:bg-slate-700 border border-blue-500/40 rounded-xl flex-row items-center justify-center mb-4"
                >
                  <Camera color="#3B82F6" size={18} className="mr-2" />
                  <Text className="text-blue-400 font-bold text-sm">
                    {proofUrl ? 'Retake Photo' : 'Capture Delivery Photo'}
                  </Text>
                </TouchableOpacity>

                <View className="flex-1 justify-end gap-2 pb-2">
                  <TouchableOpacity
                    onPress={() => setStep('otp')}
                    className="h-14 rounded-2xl flex-row items-center justify-center bg-blue-600 active:bg-blue-700 shadow-lg shadow-blue-600/30"
                  >
                    <Text className="font-black text-base text-white uppercase tracking-wider">
                      {proofUrl ? 'Next: Enter Delivery OTP' : 'Continue to Delivery OTP'}
                    </Text>
                    <ChevronRight color="white" size={18} className="ml-2" />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {step === 'otp' && (
              <View className="flex-1">
                <View className="flex-row items-center justify-between mb-3">
                  <Text className="text-slate-300 text-xs font-bold uppercase tracking-wider">
                    Enter 4-Digit Customer OTP
                  </Text>
                  <TouchableOpacity
                    onPress={() => setStep('evidence')}
                    className="flex-row items-center py-1 px-2"
                  >
                    <ArrowLeft size={14} color="#94a3b8" className="mr-1" />
                    <Text className="text-slate-400 text-xs font-bold">Back</Text>
                  </TouchableOpacity>
                </View>

                <TextInput
                  value={otp}
                  onChangeText={(t) => setOtp(t.replace(/[^0-9]/g, '').slice(0, 4))}
                  keyboardType="number-pad"
                  maxLength={4}
                  placeholder="••••"
                  placeholderTextColor="#475569"
                  autoFocus
                  className="bg-slate-950 border-2 border-slate-700 rounded-2xl h-18 text-center text-4xl tracking-[0.5em] text-white font-black mb-4 shadow-inner"
                />

                {isSupervisor && isPendingPayment && (
                  <TouchableOpacity
                    onPress={() => setAllowUnpaid(!allowUnpaid)}
                    className="flex-row items-center bg-purple-500/15 border border-purple-500/30 p-2.5 rounded-xl mb-3"
                  >
                    <View className={`w-4 h-4 rounded border mr-2 items-center justify-center ${allowUnpaid ? 'bg-purple-600 border-purple-400' : 'border-slate-500'}`}>
                      {allowUnpaid && <CheckCircle2 size={12} color="#fff" />}
                    </View>
                    <Text className="text-purple-300 text-xs font-bold">Supervisor Override: Allow Unpaid Delivery</Text>
                  </TouchableOpacity>
                )}

                {otpError && (
                  <Text className="text-red-400 text-xs font-bold mb-3 text-center bg-red-500/15 p-2.5 rounded-xl border border-red-500/30">
                    {otpError}
                  </Text>
                )}

                <View className="flex-1 justify-end pb-2">
                  <TouchableOpacity
                    onPress={submitOtp}
                    disabled={otp.length !== 4 || verifying}
                    className={`h-14 rounded-2xl flex-row items-center justify-center shadow-lg ${
                      otp.length === 4
                        ? 'bg-emerald-600 active:bg-emerald-700 shadow-emerald-600/30'
                        : 'bg-slate-800 opacity-60'
                    }`}
                  >
                    {verifying ? (
                      <ActivityIndicator color="white" />
                    ) : (
                      <>
                        <CheckCircle2 color="white" size={20} className="mr-2" />
                        <Text className="font-black text-base text-white uppercase tracking-wider">
                          Complete & Verify Delivery
                        </Text>
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
