import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { WashingMachine, Wind, CheckCircle2, Lock } from 'lucide-react-native';
import { OpsProcess, currentStep, myInProgress, stepLabel } from '../utils/opsProcess';

interface FloatingTaskCardProps {
  process?: OpsProcess | null;
  processes?: OpsProcess[];
  onComplete: (orderId?: string) => void;
  onPressCard?: (orderId: string, processId?: string) => void;
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

export const FloatingTaskCard = ({ process, processes, onComplete, onPressCard }: FloatingTaskCardProps) => {
  const validList = useMemo(() => {
    const source = processes && processes.length > 0 ? processes : (process ? [process] : []);
    return source.filter(p => {
      const step = currentStep(p);
      if (step !== 'getting_washed' && step !== 'getting_dried') return false;
      const stage = p.stages?.[step];
      return !!stage && !!stage.startedAt && !stage.completedAt;
    });
  }, [processes, process]);

  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (activeIndex >= validList.length) {
      setActiveIndex(0);
    }
  }, [validList.length, activeIndex]);

  if (validList.length === 0) return null;

  const activeProcess = validList[activeIndex] || validList[0];
  const step = currentStep(activeProcess)!;
  const stage = activeProcess.stages?.[step]!;
  const Icon = step === 'getting_washed' ? WashingMachine : Wind;
  const label = stepLabel(step);

  const startTimeMs = typeof (stage.startedAt as any).toMillis === 'function' 
    ? (stage.startedAt as any).toMillis() 
    : new Date((stage.startedAt as any)).getTime();

  const elapsedSec = Math.floor((Date.now() - startTimeMs) / 1000);
  let milestoneBadge: { text: string; bg: string; color: string } | null = null;
  if (step === 'getting_washed') {
    if (elapsedSec >= 2100) {
      milestoneBadge = { text: 'Cycle Done • Unload', bg: 'bg-green-100 border-green-300', color: 'text-green-800' };
    } else if (elapsedSec >= 1260 && !stage.softenerAddedAt) {
      milestoneBadge = { text: '🌸 Add Softener Now', bg: 'bg-purple-100 border-purple-300', color: 'text-purple-800' };
    } else if (elapsedSec >= 780 && !stage.detergentAddedAt) {
      milestoneBadge = { text: '⚠️ Add Detergent Now', bg: 'bg-amber-100 border-amber-300', color: 'text-amber-800' };
    }
  }

  const orderShort = activeProcess.orderId.slice(-6).toUpperCase();
  const token = activeProcess.tokenNumber;

  // Accidental completion guard: Lock completion button until 30 minutes (1800s) have passed
  const isMachineCycleLocked = (step === 'getting_washed' || step === 'getting_dried') && elapsedSec < 1800;
  const lockMinutesLeft = Math.max(1, Math.ceil((1800 - elapsedSec) / 60));

  return (
    <View className="absolute bottom-[80px] left-4 right-4 bg-white rounded-2xl shadow-lg border-2 border-[#994bff] p-3.5 z-30">
      {/* Multi-machine tab pills if more than 1 machine is running */}
      {validList.length > 1 && (
        <View className="flex-row items-center gap-2 mb-2 pb-2 border-b border-gray-100">
          <Text className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mr-1">
            Active Machines ({validList.length}):
          </Text>
          {validList.map((p, idx) => {
            const pStep = currentStep(p);
            const isSelected = idx === activeIndex;
            const pOrder = p.orderId.slice(-6).toUpperCase();
            const machineTitle = pStep === 'getting_washed' ? `Washer ${idx + 1}` : `Dryer ${idx + 1}`;
            return (
              <TouchableOpacity
                key={p.id || p.orderId}
                onPress={() => setActiveIndex(idx)}
                className={`px-2.5 py-1 rounded-full flex-row items-center gap-1.5 ${
                  isSelected ? 'bg-[#994bff]' : 'bg-gray-100'
                }`}
              >
                <Text className={`text-xs font-bold ${isSelected ? 'text-white' : 'text-gray-600'}`}>
                  {machineTitle} (#{pOrder})
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <View className="flex-row items-center justify-between">
        <TouchableOpacity
          onPress={() => onPressCard?.(activeProcess.orderId, activeProcess.id)}
          className="flex-row items-center gap-3 flex-1 mr-2"
          activeOpacity={0.8}
        >
          <View className="w-12 h-12 rounded-full bg-[#994bff]/10 items-center justify-center">
            <Icon color="#994bff" size={24} />
          </View>
          <View className="flex-1">
            <View className="flex-row items-center gap-2 flex-wrap">
              <Text className="text-xs font-bold text-[#994bff] uppercase">
                {validList.length > 1 ? `${step === 'getting_washed' ? `Washer ${activeIndex + 1}` : `Dryer ${activeIndex + 1}`} • ` : ''}
                {label} IN PROGRESS
              </Text>
              {milestoneBadge && (
                <View className={`px-2 py-0.5 rounded border ${milestoneBadge.bg}`}>
                  <Text className={`text-[10px] font-bold ${milestoneBadge.color}`}>{milestoneBadge.text}</Text>
                </View>
              )}
            </View>
            <Text className="text-sm font-medium text-gray-900">
              Order #{orderShort}{token ? ` • Token #${token}` : ''}
            </Text>
            <LiveTimer startTime={startTimeMs} />
          </View>
        </TouchableOpacity>

        {isMachineCycleLocked ? (
          <TouchableOpacity 
            onPress={() => {
              Alert.alert(
                'Cycle in Progress',
                `The ${step === 'getting_washed' ? 'washing' : 'drying'} cycle requires at least 30 minutes. ${lockMinutesLeft} minute${lockMinutesLeft > 1 ? 's' : ''} remaining before unload is enabled.`
              );
            }}
            className="px-3 py-2 rounded-2xl bg-gray-100 border border-gray-200 items-center justify-center shrink-0 flex-row gap-1.5"
            activeOpacity={0.7}
          >
            <Lock color="#94a3b8" size={16} />
            <Text className="text-gray-500 font-bold text-xs">{lockMinutesLeft}m left</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity 
            onPress={() => onComplete(activeProcess.orderId)}
            className="w-12 h-12 rounded-full bg-[#10b981] items-center justify-center active:scale-95 shrink-0 shadow-md"
          >
            <CheckCircle2 color="white" size={24} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

