import { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';
import { Camera, RotateCcw, Check, X } from 'lucide-react-native';

interface FaceVerificationProps {
  visible: boolean;
  onComplete: () => void;
  onCancel: () => void;
}

// Simulated face verification (the Figma's flow, not real recognition): the
// helper positions a face in the oval, captures, reviews, and submits.
export function FaceVerification({ visible, onComplete, onCancel }: FaceVerificationProps) {
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (visible) setPreview(false);
  }, [visible]);

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent={true}>
      <View className="flex-1 bg-bgDark">
        <View className="px-4 pt-14 pb-3 border-b border-bgSurfaceLight">
          <View className="flex-row items-center justify-between">
            <View className="flex-1">
              <Text className="text-xl font-bold text-textPrimary">Face Verification</Text>
              <Text className="text-textSecondary text-sm mt-1">
                {preview ? 'Review your photo' : 'Capture your photo to go online'}
              </Text>
            </View>
            <TouchableOpacity onPress={onCancel} className="p-2">
              <X size={20} color="#94A3B8" />
            </TouchableOpacity>
          </View>
        </View>

        <View className="flex-1 items-center justify-center">
          {preview ? (
            <View className="w-64 h-80 bg-bgSurface rounded-2xl items-center justify-center border border-bgSurfaceLight">
              <Camera size={44} color="#64748B" />
              <Text className="text-textMuted text-sm mt-2">Simulated photo preview</Text>
            </View>
          ) : (
            <View className="w-64 h-80">
              <View className="absolute inset-0 border-4 border-white/50 rounded-full items-center justify-center">
                <Camera size={40} color="#FFFFFF" />
              </View>
              <Text className="absolute bottom-6 w-full text-center text-textSecondary text-sm">
                Position your face within the oval
              </Text>
            </View>
          )}
        </View>

        <View className="px-6 pb-10">
          {preview ? (
            <View className="flex-row gap-3">
              <TouchableOpacity
                onPress={() => setPreview(false)}
                className="flex-1 h-14 rounded-xl bg-bgSurface border border-bgSurfaceLight items-center justify-center flex-row"
              >
                <RotateCcw size={18} color="#94A3B8" className="mr-2" />
                <Text className="text-textSecondary font-bold">Retake</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onComplete}
                className="flex-1 h-14 rounded-xl bg-primary items-center justify-center flex-row"
              >
                <Check size={18} color="#0F172A" className="mr-2" />
                <Text className="text-bgDark font-bold">Submit</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => setPreview(true)}
              className="w-20 h-20 self-center rounded-full bg-white border-4 border-bgSurfaceLight items-center justify-center"
            >
              <View className="w-16 h-16 rounded-full bg-bgSurfaceLight" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}
