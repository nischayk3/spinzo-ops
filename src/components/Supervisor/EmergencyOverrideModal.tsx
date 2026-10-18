import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { X, AlertTriangle, Zap, Clock } from 'lucide-react-native';

const OVERRIDE_REASONS = [
  'Cycle completed physically / stopped early',
  'Garments already dried or washed adequately',
  'Power failure or machine stopped running',
  'Customer rush / express emergency delivery',
  'Wrong machine started by mistake',
  'Other emergency supervisor override',
];

interface EmergencyOverrideModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void> | void;
  orderId: string;
  stageName: string;
  machineName?: string;
  cycleLockMinLeft?: number;
}

export function EmergencyOverrideModal({
  visible,
  onClose,
  onConfirm,
  orderId,
  stageName,
  machineName,
  cycleLockMinLeft = 0,
}: EmergencyOverrideModalProps) {
  const [selectedReason, setSelectedReason] = useState(OVERRIDE_REASONS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(selectedReason);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Failed to complete emergency override');
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
              <View className="w-10 h-10 rounded-full bg-red-100 items-center justify-center mr-3 shrink-0">
                <AlertTriangle size={20} color="#ef4444" />
              </View>
              <View className="flex-1">
                <Text className="text-xl font-bold text-gray-900">Emergency Override</Text>
                <Text className="text-gray-500 text-xs mt-0.5">
                  #{orderId.slice(-6).toUpperCase()} • {stageName}{machineName ? ` (${machineName})` : ''}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} disabled={busy} className="w-9 h-9 bg-gray-100 rounded-full items-center justify-center">
              <X size={18} color="#64748b" />
            </TouchableOpacity>
          </View>

          {/* Warning Banner */}
          <View className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-4">
            <View className="flex-row items-center mb-1">
              <Clock size={14} color="#dc2626" className="mr-1.5" />
              <Text className="text-red-800 font-bold text-xs uppercase tracking-wider">
                Cycle In Progress ({cycleLockMinLeft}m lock remaining)
              </Text>
            </View>
            <Text className="text-red-700 text-xs leading-relaxed">
              This action bypasses the remaining machine timer, immediately marks {stageName.toLowerCase()} as complete, unloads the machine, and advances the order to the next step.
            </Text>
          </View>

          {error && (
            <View className="bg-red-100 border border-red-300 rounded-xl p-3 mb-4">
              <Text className="text-red-800 text-xs font-semibold">{error}</Text>
            </View>
          )}

          {/* Reason Selection */}
          <Text className="text-gray-500 font-bold mb-2 uppercase tracking-wider text-xs">
            Reason for Override
          </Text>

          <ScrollView showsVerticalScrollIndicator={false} className="max-h-56 mb-4">
            <View className="gap-2">
              {OVERRIDE_REASONS.map((reason) => {
                const isSelected = reason === selectedReason;
                return (
                  <TouchableOpacity
                    key={reason}
                    onPress={() => setSelectedReason(reason)}
                    disabled={busy}
                    className={`p-3.5 rounded-xl border-2 flex-row items-center ${
                      isSelected ? 'border-red-500 bg-red-50/60' : 'border-gray-200 bg-white'
                    }`}
                  >
                    <View
                      className={`w-4 h-4 rounded-full border-2 mr-3 items-center justify-center ${
                        isSelected ? 'border-red-500' : 'border-gray-300'
                      }`}
                    >
                      {isSelected && <View className="w-2 h-2 rounded-full bg-red-500" />}
                    </View>
                    <Text className={`text-xs font-semibold flex-1 ${isSelected ? 'text-red-900' : 'text-gray-700'}`}>
                      {reason}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          {/* Action Buttons */}
          <View className="flex-row gap-3 pt-2 border-t border-gray-100">
            <TouchableOpacity
              onPress={onClose}
              disabled={busy}
              className="flex-1 py-3.5 rounded-xl bg-gray-100 items-center justify-center active:opacity-75"
            >
              <Text className="text-gray-700 font-bold text-sm">Keep Running</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleConfirm}
              disabled={busy}
              className="flex-1 py-3.5 rounded-xl bg-red-600 flex-row items-center justify-center active:opacity-80"
            >
              {busy ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Zap size={16} color="#fff" className="mr-1.5" />
                  <Text className="text-white font-bold text-sm">Force Complete</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
