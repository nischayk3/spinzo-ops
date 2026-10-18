import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { X, RotateCcw, CheckCircle2, Bike, AlertCircle } from 'lucide-react-native';

const RETURN_REASONS = [
  'Customer not available at location',
  'Customer requested later delivery / reschedule',
  'Rider vehicle breakdown / emergency',
  'Incorrect or unreachable address',
  'Store recall / packaging check',
  'Other',
];

export interface ReturnDeliveryOptions {
  resetSlot: boolean;
  reason: string;
  note: string;
}

interface ReturnDeliveryModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (options: ReturnDeliveryOptions) => Promise<void>;
  onSwitchToReassign?: () => void;
  orderId: string;
  customerName?: string;
  currentSlot?: string;
}

export function ReturnDeliveryModal({
  visible,
  onClose,
  onConfirm,
  onSwitchToReassign,
  orderId,
  customerName,
  currentSlot,
}: ReturnDeliveryModalProps) {
  const [resetSlot, setResetSlot] = useState(false);
  const [selectedReason, setSelectedReason] = useState(RETURN_REASONS[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm({
        resetSlot,
        reason: selectedReason,
        note: note.trim(),
      });
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Failed to return order');
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 bg-black/50 justify-end sm:justify-center p-0 sm:p-4"
      >
        <View className="bg-white rounded-t-3xl sm:rounded-3xl p-6 max-h-[90%] flex-col">
          {/* Header */}
          <View className="flex-row items-center justify-between mb-4">
            <View className="flex-row items-center">
              <View className="w-10 h-10 rounded-full bg-amber-100 items-center justify-center mr-3">
                <RotateCcw size={20} color="#d97706" />
              </View>
              <View>
                <Text className="text-xl font-bold text-gray-900">Return Delivery to Store</Text>
                <Text className="text-gray-500 text-xs mt-0.5">
                  #{orderId.slice(-6).toUpperCase()}{customerName ? ` • ${customerName}` : ''}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} className="w-9 h-9 bg-gray-100 rounded-full items-center justify-center">
              <X size={18} color="#64748b" />
            </TouchableOpacity>
          </View>

          {error && (
            <View className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3 flex-row items-center">
              <AlertCircle size={16} color="#dc2626" className="mr-2" />
              <Text className="text-red-700 text-xs font-medium flex-1">{error}</Text>
            </View>
          )}

          <ScrollView showsVerticalScrollIndicator={false} className="flex-shrink">
            {/* Action Mode Choice */}
            <Text className="text-gray-500 font-bold mb-2 uppercase tracking-wider text-xs">
              Select Return Action
            </Text>

            <View className="gap-2.5 mb-4">
              {/* Option A: Return to Store Rack (Keep Slot) */}
              <TouchableOpacity
                onPress={() => setResetSlot(false)}
                className={`p-3.5 rounded-2xl border-2 flex-row items-start ${
                  !resetSlot ? 'border-amber-500 bg-amber-50/50' : 'border-gray-200 bg-white'
                }`}
              >
                <View
                  className={`w-5 h-5 rounded-full border-2 mr-3 mt-0.5 items-center justify-center ${
                    !resetSlot ? 'border-amber-500' : 'border-gray-300'
                  }`}
                >
                  {!resetSlot && <View className="w-2.5 h-2.5 rounded-full bg-amber-500" />}
                </View>
                <View className="flex-1">
                  <Text className={`font-bold text-sm ${!resetSlot ? 'text-amber-900' : 'text-gray-800'}`}>
                    Return to Store Rack (Keep Slot)
                  </Text>
                  <Text className="text-gray-500 text-xs mt-0.5 leading-4">
                    Unassigns rider and returns order to Ready status. Bundle stays on store shelf ready to be re-dispatched today{currentSlot ? ` (${currentSlot})` : ''}.
                  </Text>
                </View>
              </TouchableOpacity>

              {/* Option B: Return & Reset Slot */}
              <TouchableOpacity
                onPress={() => setResetSlot(true)}
                className={`p-3.5 rounded-2xl border-2 flex-row items-start ${
                  resetSlot ? 'border-amber-500 bg-amber-50/50' : 'border-gray-200 bg-white'
                }`}
              >
                <View
                  className={`w-5 h-5 rounded-full border-2 mr-3 mt-0.5 items-center justify-center ${
                    resetSlot ? 'border-amber-500' : 'border-gray-300'
                  }`}
                >
                  {resetSlot && <View className="w-2.5 h-2.5 rounded-full bg-amber-500" />}
                </View>
                <View className="flex-1">
                  <Text className={`font-bold text-sm ${resetSlot ? 'text-amber-900' : 'text-gray-800'}`}>
                    Return to Store & Clear Slot (Awaiting Reschedule)
                  </Text>
                  <Text className="text-gray-500 text-xs mt-0.5 leading-4">
                    Customer could not receive delivery. Unassigns rider and clears slot; customer or store can pick a new date/time.
                  </Text>
                </View>
              </TouchableOpacity>
            </View>

            {/* Return Reason */}
            <Text className="text-gray-500 font-bold mb-2 uppercase tracking-wider text-xs">
              Reason for Return
            </Text>
            <View className="gap-2 mb-4">
              {RETURN_REASONS.map((r) => {
                const active = r === selectedReason;
                return (
                  <TouchableOpacity
                    key={r}
                    onPress={() => setSelectedReason(r)}
                    className={`px-3.5 py-2.5 rounded-xl border flex-row items-center ${
                      active ? 'border-amber-500 bg-amber-50/80' : 'border-gray-200 bg-white'
                    }`}
                  >
                    <View
                      className={`w-4 h-4 rounded-full border mr-2.5 items-center justify-center ${
                        active ? 'border-amber-600 bg-amber-600' : 'border-gray-300'
                      }`}
                    >
                      {active && <CheckCircle2 size={12} color="#ffffff" />}
                    </View>
                    <Text className={`text-xs font-medium flex-1 ${active ? 'text-amber-900 font-bold' : 'text-gray-700'}`}>
                      {r}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Note Input */}
            <Text className="text-gray-500 font-bold mb-1.5 uppercase tracking-wider text-xs">
              Additional Note (Optional)
            </Text>
            <TextInput
              className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-gray-900 text-xs font-medium mb-4"
              placeholder="e.g. Customer requested delivery after 8 PM"
              placeholderTextColor="#94a3b8"
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={2}
            />
          </ScrollView>

          {/* Footer Actions */}
          <View className="pt-3 border-t border-gray-100">
            {onSwitchToReassign && (
              <TouchableOpacity
                onPress={onSwitchToReassign}
                disabled={busy}
                className="flex-row items-center justify-center py-2 mb-2"
              >
                <Bike size={14} color="#3b82f6" className="mr-1.5" />
                <Text className="text-blue-600 text-xs font-bold">
                  Need to reassign directly to another rider? Tap here
                </Text>
              </TouchableOpacity>
            )}

            <View className="flex-row gap-3">
              <TouchableOpacity
                onPress={onClose}
                disabled={busy}
                className="flex-1 h-12 rounded-xl items-center justify-center bg-gray-100"
              >
                <Text className="font-bold text-xs text-gray-700">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleConfirm}
                disabled={busy}
                className="flex-1 h-12 rounded-xl items-center justify-center bg-amber-500"
              >
                {busy ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text className="text-white font-bold text-xs">Confirm Return to Ready</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
