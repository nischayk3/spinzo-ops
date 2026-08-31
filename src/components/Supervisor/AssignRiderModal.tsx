import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, ActivityIndicator, FlatList } from 'react-native';
import { X, UserPlus, CheckCircle2 } from 'lucide-react-native';
import { db } from '../../config/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

interface StaffDoc {
  uid: string;
  name?: string;
  phone: string;
  role: string;
  onShift?: boolean;
}

interface AssignRiderModalProps {
  visible: boolean;
  onClose: () => void;
  onAssign: (riderId: string) => Promise<void>;
  orderId: string;
  isDelivery?: boolean;
}

export function AssignRiderModal({ visible, onClose, onAssign, orderId, isDelivery }: AssignRiderModalProps) {
  const [riders, setRiders] = useState<StaffDoc[]>([]);
  const [loadingRiders, setLoadingRiders] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedRider, setSelectedRider] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      loadRiders();
    } else {
      setSelectedRider(null);
    }
  }, [visible]);

  const loadRiders = async () => {
    setLoadingRiders(true);
    try {
      const q = query(
        collection(db, 'ops_staff'),
        where('role', '==', 'rider'),
        where('onShift', '==', true)
      );
      const snap = await getDocs(q);
      const fetchedRiders: StaffDoc[] = [];
      snap.forEach(doc => {
        fetchedRiders.push({ ...doc.data(), uid: doc.id } as StaffDoc);
      });
      setRiders(fetchedRiders);
    } catch (err) {
      console.warn("Failed to fetch riders", err);
    } finally {
      setLoadingRiders(false);
    }
  };

  const handleConfirm = async () => {
    if (!selectedRider) return;
    setBusy(true);
    try {
      await onAssign(selectedRider);
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
              <View className="w-10 h-10 rounded-full bg-blue-100 items-center justify-center mr-3">
                <UserPlus size={20} color="#3b82f6" />
              </View>
              <View>
                <Text className="text-xl font-bold text-gray-900">Assign to Rider</Text>
                <Text className="text-gray-500 text-xs mt-1">#{orderId.slice(-6).toUpperCase()} • {isDelivery ? 'Delivery' : 'Pickup'}</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} className="w-10 h-10 bg-gray-100 rounded-full items-center justify-center">
              <X size={20} color="#64748b" />
            </TouchableOpacity>
          </View>

          <Text className="text-gray-500 font-bold mb-3 uppercase tracking-wider text-xs">Online Riders</Text>
          
          {loadingRiders ? (
            <View className="flex-1 items-center justify-center py-10">
              <ActivityIndicator color="#3b82f6" />
              <Text className="text-gray-500 mt-2">Finding available riders...</Text>
            </View>
          ) : riders.length === 0 ? (
            <View className="bg-orange-50 border border-orange-200 rounded-xl p-4 items-center justify-center my-4">
              <Text className="text-orange-700 font-medium">No riders are currently on shift.</Text>
            </View>
          ) : (
            <FlatList
              data={riders}
              keyExtractor={(item) => item.uid}
              className="max-h-64 mb-4"
              renderItem={({ item }) => {
                const isSelected = selectedRider === item.uid;
                return (
                  <TouchableOpacity
                    onPress={() => setSelectedRider(item.uid)}
                    className={`flex-row items-center justify-between p-4 rounded-xl mb-2 border ${
                      isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <View>
                      <Text className={`font-bold text-lg ${isSelected ? 'text-blue-700' : 'text-gray-900'}`}>
                        {item.name || 'Unnamed Rider'}
                      </Text>
                      <Text className="text-gray-500 text-sm mt-0.5">{item.phone}</Text>
                    </View>
                    {isSelected && <CheckCircle2 color="#3b82f6" size={20} />}
                  </TouchableOpacity>
                );
              }}
            />
          )}

          <TouchableOpacity
            onPress={handleConfirm}
            disabled={!selectedRider || busy}
            className={`h-14 rounded-xl flex-row items-center justify-center mt-auto ${
              !selectedRider || busy ? 'bg-gray-200' : 'bg-blue-600'
            }`}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className={`font-bold text-lg ${!selectedRider ? 'text-gray-400' : 'text-white'}`}>Assign Order</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
