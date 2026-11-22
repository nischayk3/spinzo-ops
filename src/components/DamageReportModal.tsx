import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  Image,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import {
  Camera,
  Video,
  AlertTriangle,
  X,
  Trash2,
  CheckCircle2,
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { uploadMediaToStorage } from '../utils/firebaseUpload';
import { useOpsProcessStore } from '../store/opsProcessStore';

export interface DamageReportModalProps {
  visible: boolean;
  processId: string;
  orderId: string;
  orderLabel?: string;
  onClose: () => void;
  onSubmitted?: () => void;
}

export function DamageReportModal({
  visible,
  processId,
  orderId,
  orderLabel,
  onClose,
  onSubmitted,
}: DamageReportModalProps) {
  const [localPhotos, setLocalPhotos] = useState<string[]>([]);
  const [localVideos, setLocalVideos] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const resetState = () => {
    setLocalPhotos([]);
    setLocalVideos([]);
    setNote('');
  };

  const handleClose = () => {
    if (submitting) return;
    resetState();
    onClose();
  };

  const captureMedia = async (isVideo: boolean) => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission Denied', 'Camera access is required to capture damage evidence.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync(
        isVideo
          ? {
              mediaTypes: ['videos'],
              videoMaxDuration: 60,
            }
          : {
              mediaTypes: ['images'],
              quality: 0.5,
            }
      );

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const uri = result.assets[0].uri;
        if (isVideo) {
          setLocalVideos((prev) => [...prev, uri]);
        } else {
          setLocalPhotos((prev) => [...prev, uri]);
        }
      }
    } catch (err: any) {
      Alert.alert('Camera Error', err?.message || 'Unable to open camera.');
    }
  };

  const removePhoto = (index: number) => {
    setLocalPhotos((prev) => prev.filter((_, idx) => idx !== index));
  };

  const removeVideo = (index: number) => {
    setLocalVideos((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSubmit = async () => {
    if (localPhotos.length === 0 && localVideos.length === 0) {
      Alert.alert('Evidence Required', 'Please capture at least one photo or video of the damage.');
      return;
    }

    setSubmitting(true);
    try {
      const uploadedPhotos: string[] = [];
      for (const uri of localPhotos) {
        const url = await uploadMediaToStorage(uri, `damage_reports/${orderId}`, false);
        uploadedPhotos.push(url);
      }

      const uploadedVideos: string[] = [];
      for (const uri of localVideos) {
        const url = await uploadMediaToStorage(uri, `damage_reports/${orderId}`, true);
        uploadedVideos.push(url);
      }

      await useOpsProcessStore
        .getState()
        .reportDamage(processId, uploadedPhotos, uploadedVideos, note.trim() || undefined);

      resetState();
      onSubmitted?.();
      onClose();
    } catch (err: any) {
      Alert.alert(
        'Submission Failed',
        err?.message || 'Could not upload and submit damage report. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const hasMedia = localPhotos.length > 0 || localVideos.length > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View className="flex-1 bg-black/65 items-center justify-center p-4">
        <View className="bg-bgSurface border border-white/10 rounded-2xl max-w-lg w-[92%] max-h-[85%] overflow-hidden shadow-2xl">
          {/* Header */}
          <View className="px-4 py-3.5 border-b border-white/10 flex-row items-center justify-between">
            <View className="flex-row items-center gap-2.5 flex-1 pr-2">
              <View className="w-9 h-9 rounded-full bg-warning/15 border border-warning/30 items-center justify-center">
                <AlertTriangle size={18} color="#F59E0B" />
              </View>
              <View className="flex-1">
                <Text className="text-textPrimary font-bold text-base">Report Damage</Text>
                {orderLabel ? (
                  <Text className="text-textSecondary text-xs" numberOfLines={1}>
                    {orderLabel}
                  </Text>
                ) : (
                  <Text className="text-textMuted text-xs" numberOfLines={1}>
                    Order #{orderId.slice(-6).toUpperCase()}
                  </Text>
                )}
              </View>
            </View>

            <TouchableOpacity
              onPress={handleClose}
              disabled={submitting}
              className="w-8 h-8 rounded-full bg-bgSurfaceLight items-center justify-center active:opacity-70"
              accessibilityLabel="Close damage report modal"
            >
              <X size={16} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }} className="flex-grow-0">
            <Text className="text-textSecondary text-xs mb-4">
              Capture clear photos or a short video (up to 60s) of any pre-existing tear, stain, or garment damage.
            </Text>

            {/* Capture Action Buttons */}
            <View className="flex-row gap-3 mb-4">
              <TouchableOpacity
                onPress={() => captureMedia(false)}
                disabled={submitting}
                className="flex-1 py-4 px-3 rounded-xl bg-primary/10 border border-primary/30 items-center justify-center gap-1.5 active:opacity-80"
              >
                <Camera size={22} color="#994BFF" />
                <Text className="text-primary font-bold text-xs">Click Photo</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => captureMedia(true)}
                disabled={submitting}
                className="flex-1 py-4 px-3 rounded-xl bg-info/10 border border-info/30 items-center justify-center gap-1.5 active:opacity-80"
              >
                <Video size={22} color="#3B82F6" />
                <Text className="text-info font-bold text-xs">Record Video</Text>
              </TouchableOpacity>
            </View>

            {/* Thumbnail Preview Strip */}
            {hasMedia && (
              <View className="mb-4">
                <Text className="text-textSecondary font-semibold text-xs mb-2">
                  Captured Evidence ({localPhotos.length} photo{localPhotos.length === 1 ? '' : 's'},{' '}
                  {localVideos.length} video{localVideos.length === 1 ? '' : 's'})
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View className="flex-row gap-2.5">
                    {localPhotos.map((uri, idx) => (
                      <View
                        key={`photo-${idx}-${uri}`}
                        className="w-20 h-20 rounded-xl overflow-hidden border border-white/10 bg-bgSurfaceLight relative"
                      >
                        <Image source={{ uri }} className="w-full h-full" resizeMode="cover" />
                        <TouchableOpacity
                          onPress={() => removePhoto(idx)}
                          disabled={submitting}
                          className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 items-center justify-center"
                          accessibilityLabel={`Remove photo ${idx + 1}`}
                        >
                          <Trash2 size={12} color="#EF4444" />
                        </TouchableOpacity>
                      </View>
                    ))}

                    {localVideos.map((uri, idx) => (
                      <View
                        key={`video-${idx}-${uri}`}
                        className="w-20 h-20 rounded-xl border border-info/30 bg-info/10 items-center justify-center relative px-1"
                      >
                        <Video size={22} color="#3B82F6" />
                        <Text className="text-info text-[10px] font-bold mt-1">
                          Video {idx + 1}
                        </Text>
                        <TouchableOpacity
                          onPress={() => removeVideo(idx)}
                          disabled={submitting}
                          className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 items-center justify-center"
                          accessibilityLabel={`Remove video ${idx + 1}`}
                        >
                          <Trash2 size={12} color="#EF4444" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
            )}

            {/* Optional Note */}
            <View className="mb-4">
              <Text className="text-textSecondary font-semibold text-xs mb-1.5">
                Damage Note (Optional)
              </Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                editable={!submitting}
                placeholder="Tear on collar, stain on sleeve..."
                placeholderTextColor="#94A3B8"
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                className="bg-bgSurfaceLight border border-white/10 rounded-xl p-3 text-textPrimary text-sm min-h-[80px]"
              />
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              onPress={handleSubmit}
              disabled={!hasMedia || submitting}
              className={`h-12 rounded-xl flex-row items-center justify-center gap-2 ${
                hasMedia && !submitting ? 'bg-error active:opacity-90' : 'bg-bgSurfaceLight opacity-60'
              }`}
            >
              {submitting ? (
                <>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text className="text-white font-bold text-sm">Uploading Evidence...</Text>
                </>
              ) : (
                <>
                  <CheckCircle2 size={18} color={hasMedia ? '#FFFFFF' : '#94A3B8'} />
                  <Text className={`font-bold text-sm ${hasMedia ? 'text-white' : 'text-textMuted'}`}>
                    Submit Damage Report
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
