import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, ActivityIndicator, FlatList } from 'react-native';
import { X, UserPlus, CheckCircle2 } from 'lucide-react-native';
import { db } from '../../config/firebase';
import { collection, query, where, getDocs } from '../../config/firebase';

interface StaffDoc {
  uid: string;
  name?: string;
  phone: string;
  role: string;
  onShift?: boolean;
}

interface AssignHelperModalProps {
  visible: boolean;
  onClose: () => void;
  onAssign: (helperId: string) => Promise<void>;
  processId: string;
  stepName?: string;
}

export function AssignHelperModal({ visible, onClose, onAssign, processId, stepName }: AssignHelperModalProps) {
  const [helpers, setHelpers] = useState<StaffDoc[]>([]);
  const [loadingHelpers, setLoadingHelpers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedHelper, setSelectedHelper] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      loadHelpers();
    } else {
      setSelectedHelper(null);
    }
  }, [visible]);

  const loadHelpers = async () => {
    setLoadingHelpers(true);
    try {
      const q = query(
        collection(db, 'ops_staff'),
        where('role', '==', 'helper'),
        where('onShift', '==', true)
      );
      const snap = await getDocs(q);
      const fetchedHelpers: StaffDoc[] = [];
      snap.forEach(doc => {
        fetchedHelpers.push({ ...doc.data(), uid: doc.id } as StaffDoc);
      });
      setHelpers(fetchedHelpers);
    } catch (err) {
      console.warn("Failed to fetch helpers", err);
    } finally {
      setLoadingHelpers(false);
    }
  };

  const handleConfirm = async () => {
    if (!selectedHelper) return;
    setBusy(true);
    try {
      await onAssign(selectedHelper);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View className="flex-1 bg-black/50 justify-end sm:justify-center p-0 sm:p-4">
        <View className="bg-white rounded-t-3xl sm:rounded-3xl p-6 min-h-[60%] sm:min-h-0 sm:max-h-[80%]">
          <View className="flex-row items-center justify-between mb-6">
            <View className="flex-row items-center">
              <View className="w-10 h-10 rounded-full bg-purple-100 items-center justify-center mr-3">
                <UserPlus size={20} color="#994bff" />
              </View>
              <View>
                <Text className="text-xl font-bold text-gray-900">Assign to Helper</Text>
                <Text className="text-gray-500 text-xs mt-1">{stepName || 'Process task'}</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} className="w-10 h-10 bg-gray-100 rounded-full items-center justify-center">
              <X size={20} color="#64748b" />
            </TouchableOpacity>
          </View>

          <Text className="text-gray-500 font-bold mb-3 uppercase tracking-wider text-xs">Online Helpers</Text>
          
          {loadingHelpers ? (
            <View className="flex-1 items-center justify-center py-10">
              <ActivityIndicator color="#994bff" />
              <Text className="text-gray-500 mt-2">Finding available helpers...</Text>
            </View>
          ) : helpers.length === 0 ? (
            <View className="bg-orange-50 border border-orange-200 rounded-xl p-4 items-center justify-center my-4">
              <Text className="text-orange-700 font-medium">No helpers are currently on shift.</Text>
            </View>
          ) : (
            <FlatList
              data={helpers}
              keyExtractor={(item) => item.uid}
              className="max-h-64 mb-4"
              renderItem={({ item }) => {
                const isSelected = selectedHelper === item.uid;
                return (
                  <TouchableOpacity
                    onPress={() => setSelectedHelper(item.uid)}
                    className={`flex-row items-center justify-between p-4 rounded-xl mb-2 border ${
                      isSelected ? 'border-purple-500 bg-purple-50' : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <View>
                      <Text className={`font-bold text-lg ${isSelected ? 'text-purple-700' : 'text-gray-900'}`}>
                        {item.name || 'Unnamed Helper'}
                      </Text>
                      <Text className="text-gray-500 text-sm mt-0.5">{item.phone}</Text>
                    </View>
                    {isSelected && <CheckCircle2 color="#994bff" size={20} />}
                  </TouchableOpacity>
                );
              }}
            />
          )}

          <TouchableOpacity
            onPress={handleConfirm}
            disabled={!selectedHelper || busy}
            className={`h-14 rounded-xl flex-row items-center justify-center mt-auto ${
              !selectedHelper || busy ? 'bg-gray-200' : 'bg-[#994bff]'
            }`}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className={`font-bold text-lg ${!selectedHelper ? 'text-gray-400' : 'text-white'}`}>Assign Task</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
