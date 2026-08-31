import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { WashingMachine, Wind, CheckCircle2 } from 'lucide-react-native';
import { OpsProcess, currentStep, myInProgress, stepLabel } from '../utils/opsProcess';

interface FloatingTaskCardProps {
  process: OpsProcess | null;
  onComplete: () => void;
}

const formatDuration = (ms: number) => {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const LiveTimer = ({ startTime }: { startTime: number }) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);
  
  return <Text className="text-xl font-bold text-gray-900">{formatDuration(Date.now() - startTime)}</Text>;
};

export const FloatingTaskCard = ({ process, onComplete }: FloatingTaskCardProps) => {
  if (!process) return null;
  
  const step = currentStep(process);
  if (step !== 'getting_washed' && step !== 'getting_dried') return null;
  
  const stage = process.stages?.[step];
  if (!stage || !stage.startedAt || stage.completedAt) return null;

  const Icon = step === 'getting_washed' ? WashingMachine : Wind;
  const label = stepLabel(step);
  const startTimeMs = typeof (stage.startedAt as any).toMillis === 'function' 
    ? (stage.startedAt as any).toMillis() 
    : new Date((stage.startedAt as any)).getTime();

  return (
    <View className="absolute bottom-[80px] left-4 right-4 bg-white rounded-2xl shadow-lg border-2 border-[#994bff] p-4 flex-row items-center justify-between">
      <View className="flex-row items-center gap-3">
        <View className="w-12 h-12 rounded-full bg-[#994bff]/10 items-center justify-center">
          <Icon color="#994bff" size={24} />
        </View>
        <View>
          <Text className="text-xs font-bold text-[#994bff] uppercase">{label} IN PROGRESS</Text>
          <Text className="text-sm font-medium text-gray-900">Order #{process.orderId.slice(-6).toUpperCase()}</Text>
          <LiveTimer startTime={startTimeMs} />
        </View>
      </View>
      
      <TouchableOpacity 
        onPress={onComplete}
        className="w-12 h-12 rounded-full bg-[#10b981] items-center justify-center active:scale-95"
      >
        <CheckCircle2 color="white" size={24} />
      </TouchableOpacity>
    </View>
  );
};
