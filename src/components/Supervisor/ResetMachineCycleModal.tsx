import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { X, RotateCcw, AlertCircle } from 'lucide-react-native';

interface ResetMachineCycleModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  orderId: string;
  stageName: string;
  machineName?: string;
}

export function ResetMachineCycleModal({
  visible,
  onClose,
  onConfirm,
  orderId,
  stageName,
  machineName,
}: ResetMachineCycleModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Failed to reset machine cycle');
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 bg-black/50 justify-end sm:justify-center p-0 sm:p-4"
      >
        <View className="bg-white rounded-t-3xl sm:rounded-3xl p-6 max-h-[90%] flex-col w-full sm:max-w-lg sm:mx-auto shadow-2xl">
          {/* Header */}
          <View className="flex-row items-center justify-between mb-4">
            <View className="flex-row items-center flex-1 mr-2">
              <View className="w-10 h-10 rounded-full bg-amber-100 items-center justify-center mr-3 shrink-0">
                <RotateCcw size={20} color="#d97706" />
              </View>
              <View className="flex-1">
                <Text className="text-xl font-bold text-gray-900">Reset Machine Cycle</Text>
                <Text className="text-gray-500 text-xs mt-0.5">
                  #{orderId.slice(-6).toUpperCase()} • {stageName}{machineName ? ` (${machineName})` : ''}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} disabled={busy} className="w-9 h-9 bg-gray-100 rounded-full items-center justify-center">
              <X size={18} color="#64748b" />
            </TouchableOpacity>
          </View>

          {/* Explanation Banner */}
          <View className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4">
            <Text className="text-amber-900 font-bold text-xs uppercase tracking-wider mb-1">
              Confirm Clothes Are Outside Machine
            </Text>
            <Text className="text-amber-800 text-xs leading-relaxed">
              This action confirms that the garments are NOT physically inside the machine. It cancels the active timer, releases {machineName || 'the machine'}, and places the order back in the stage queue waiting to be loaded.
            </Text>
          </View>

          {error && (
            <View className="bg-red-100 border border-red-300 rounded-xl p-3 mb-4">
              <Text className="text-red-800 text-xs font-semibold">{error}</Text>
            </View>
          )}

          {/* Action Buttons */}
          <View className="flex-row gap-3 pt-2 border-t border-gray-100">
            <TouchableOpacity
              onPress={onClose}
              disabled={busy}
              className="flex-1 py-3.5 rounded-xl bg-gray-100 items-center justify-center active:opacity-75"
            >
              <Text className="text-gray-700 font-bold text-sm">Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleConfirm}
              disabled={busy}
              className="flex-1 py-3.5 rounded-xl bg-amber-600 flex-row items-center justify-center active:opacity-80"
            >
              {busy ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text className="text-white font-bold text-sm">Reset to Queue</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
