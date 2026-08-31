import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { X, AlertTriangle } from 'lucide-react-native';

const CANCELLATION_REASONS = [
  "Customer didn't pickup the call",
  "Customer not available at location",
  "Customer requested cancellation",
  "Invalid/ incorrect address",
  "Other"
];

interface CancelOrderModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (reason: string, note: string) => Promise<void>;
  orderId: string;
}

export function CancelOrderModal({ visible, onClose, onConfirm, orderId }: CancelOrderModalProps) {
  const [selectedReason, setSelectedReason] = useState(CANCELLATION_REASONS[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm(selectedReason, note);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-black/50 justify-end">
        <View className="bg-white rounded-t-3xl p-6 min-h-[60%]">
          <View className="flex-row items-center justify-between mb-6">
            <View className="flex-row items-center">
              <View className="w-10 h-10 rounded-full bg-red-100 items-center justify-center mr-3">
                <AlertTriangle size={20} color="#ef4444" />
              </View>
              <View>
                <Text className="text-xl font-bold text-gray-900">Cancel Order</Text>
                <Text className="text-gray-500 text-xs mt-1">#{orderId.slice(-6).toUpperCase()}</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} className="w-10 h-10 bg-gray-100 rounded-full items-center justify-center">
              <X size={20} color="#64748b" />
            </TouchableOpacity>
          </View>

          <Text className="text-gray-500 font-bold mb-3 uppercase tracking-wider text-xs">Reason for cancellation</Text>
          <ScrollView className="mb-4 max-h-48">
            <View className="gap-2">
              {CANCELLATION_REASONS.map((reason) => {
                const isSelected = reason === selectedReason;
                return (
                  <TouchableOpacity
                    key={reason}
                    onPress={() => setSelectedReason(reason)}
                    className={`p-4 rounded-xl border-2 flex-row items-center ${
                      isSelected ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-white'
                    }`}
                  >
                    <View className={`w-5 h-5 rounded-full border-2 mr-3 items-center justify-center ${
                      isSelected ? 'border-red-500' : 'border-gray-300'
                    }`}>
                      {isSelected && <View className="w-2.5 h-2.5 rounded-full bg-red-500" />}
                    </View>
                    <Text className={`font-medium flex-1 ${isSelected ? 'text-red-700' : 'text-gray-700'}`}>{reason}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          <Text className="text-gray-500 font-bold mb-3 uppercase tracking-wider text-xs">Additional Note (Optional)</Text>
          <TextInput
            className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-gray-900 font-medium mb-6"
            placeholder="Type here..."
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={2}
            textAlignVertical="top"
          />

          <TouchableOpacity
            disabled={busy}
            onPress={handleConfirm}
            className={`h-14 rounded-2xl items-center justify-center flex-row ${
              !busy ? 'bg-red-500' : 'bg-gray-200'
            }`}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="font-bold text-lg text-white">Confirm Cancellation</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
