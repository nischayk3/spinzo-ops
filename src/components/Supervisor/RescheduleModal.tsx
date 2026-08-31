import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { X, Calendar } from 'lucide-react-native';

interface RescheduleModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (dateStr: string, slot: string) => Promise<void>;
  title: string;
}

export function RescheduleModal({ visible, onClose, onConfirm, title }: RescheduleModalProps) {
  const [selectedDateIndex, setSelectedDateIndex] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dates = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      arr.push(d);
    }
    return arr;
  }, []);

  const dateStrings = useMemo(() => {
    return dates.map(d => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    });
  }, [dates]);

  const displayDates = useMemo(() => {
    return dates.map(d => {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return {
        dayName: days[d.getDay()],
        dayNum: d.getDate(),
        month: months[d.getMonth()]
      };
    });
  }, [dates]);

  const slots = useMemo(() => {
    const arr = [];
    for (let i = 9; i < 21; i++) {
      const start = `${i.toString().padStart(2, '0')}:00`;
      const end = `${(i + 1).toString().padStart(2, '0')}:00`;
      arr.push(`${start} - ${end}`);
    }
    return arr;
  }, []);

  const handleConfirm = async () => {
    if (!selectedSlot) return;
    setBusy(true);
    try {
      await onConfirm(dateStrings[selectedDateIndex], selectedSlot);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View className="flex-1 bg-black/50 justify-end">
        <View className="bg-white rounded-t-3xl p-6 min-h-[70%]">
          <View className="flex-row items-center justify-between mb-6">
            <Text className="text-xl font-bold text-gray-900">{title}</Text>
            <TouchableOpacity onPress={onClose} className="w-10 h-10 bg-gray-100 rounded-full items-center justify-center">
              <X size={20} color="#64748b" />
            </TouchableOpacity>
          </View>

          <Text className="text-gray-500 font-bold mb-3 uppercase tracking-wider text-xs">Select Date</Text>
          <View className="mb-6">
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-3">
                {displayDates.map((d, i) => {
                  const isSelected = i === selectedDateIndex;
                  return (
                    <TouchableOpacity
                      key={i}
                      onPress={() => {
                        setSelectedDateIndex(i);
                        setSelectedSlot(null);
                      }}
                      className={`w-20 py-3 rounded-2xl border-2 items-center justify-center ${
                        isSelected ? 'border-[#994bff] bg-purple-50' : 'border-gray-100 bg-white'
                      }`}
                    >
                      <Text className={`text-sm mb-1 ${isSelected ? 'text-[#994bff]' : 'text-gray-500'}`}>{d.dayName}</Text>
                      <Text className={`text-xl font-bold ${isSelected ? 'text-[#994bff]' : 'text-gray-900'}`}>{d.dayNum}</Text>
                      <Text className={`text-xs mt-1 ${isSelected ? 'text-[#994bff]' : 'text-gray-500'}`}>{d.month}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>

          <Text className="text-gray-500 font-bold mb-3 uppercase tracking-wider text-xs">Select Time Slot</Text>
          <ScrollView className="flex-1">
            <View className="flex-row flex-wrap gap-3">
              {slots.map((slot) => {
                const isSelected = slot === selectedSlot;
                return (
                  <TouchableOpacity
                    key={slot}
                    onPress={() => setSelectedSlot(slot)}
                    className={`px-4 py-3 rounded-xl border-2 mb-1 ${
                      isSelected ? 'border-[#994bff] bg-[#994bff]' : 'border-gray-200 bg-white'
                    }`}
                  >
                    <Text className={`font-bold ${isSelected ? 'text-white' : 'text-gray-700'}`}>{slot}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          <TouchableOpacity
            disabled={!selectedSlot || busy}
            onPress={handleConfirm}
            className={`mt-4 h-14 rounded-2xl items-center justify-center flex-row ${
              selectedSlot && !busy ? 'bg-[#994bff]' : 'bg-gray-200'
            }`}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Calendar color={selectedSlot ? '#fff' : '#94a3b8'} size={20} className="mr-2" />
                <Text className={`font-bold text-lg ${selectedSlot ? 'text-white' : 'text-gray-400'}`}>Confirm Schedule</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
