import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { WashingMachine, Wind, CheckCircle2, Lock, ChevronUp, ChevronDown, X } from 'lucide-react-native';
import { OpsProcess, currentStep, stepLabel } from '../utils/opsProcess';

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

const LiveTimer = ({ startTime, textClass = 'text-xl font-bold text-gray-900' }: { startTime: number; textClass?: string }) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);
  
  return <Text className={textClass}>{formatDuration(Date.now() - startTime)}</Text>;
};

export const FloatingTaskCard = ({ process, processes, onComplete, onPressCard }: FloatingTaskCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const validList = useMemo(() => {
    const source = processes && processes.length > 0 ? processes : (process ? [process] : []);
    return source.filter(p => {
      const step = currentStep(p);
      if (step !== 'getting_washed' && step !== 'getting_dried') return false;
      const stage = p.stages?.[step];
      return !!stage && !!stage.startedAt && !stage.completedAt;
    });
  }, [processes, process]);

  useEffect(() => {
    if (activeIndex >= validList.length) {
      setActiveIndex(0);
    }
  }, [validList.length, activeIndex]);

  // If no machines are active, reset dismissal
  useEffect(() => {
    if (validList.length === 0) {
      setIsDismissed(false);
    }
  }, [validList.length]);

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
  const isCycleDone = elapsedSec >= 1800;
  const isMachineCycleLocked = elapsedSec < 1800;
  const lockMinutesLeft = Math.max(1, Math.ceil((1800 - elapsedSec) / 60));

  let milestoneBadge: { text: string; bg: string; color: string } | null = null;
  if (step === 'getting_washed') {
    if (elapsedSec >= 2100) {
      milestoneBadge = { text: 'Cycle Done • Unload', bg: 'bg-green-100 border-green-300', color: 'text-green-800' };
    } else if (elapsedSec >= 1260 && !stage.softenerAddedAt) {
      milestoneBadge = { text: '🌸 Add Softener', bg: 'bg-purple-100 border-purple-300', color: 'text-purple-800' };
    } else if (elapsedSec >= 780 && !stage.detergentAddedAt) {
      milestoneBadge = { text: '⚠️ Add Detergent', bg: 'bg-amber-100 border-amber-300', color: 'text-amber-800' };
    }
  }

  const orderShort = activeProcess.orderId.slice(-6).toUpperCase();
  const token = activeProcess.tokenNumber;
  const machineName = stage.machineName || (step === 'getting_washed' ? `Washer ${activeIndex + 1}` : `Dryer ${activeIndex + 1}`);

  // If user dismissed the floating card, render a small restore bubble on bottom right
  if (isDismissed) {
    return (
      <TouchableOpacity
        onPress={() => setIsDismissed(false)}
        activeOpacity={0.8}
        className="absolute bottom-[85px] right-4 bg-slate-900 border border-slate-700 px-3 py-2 rounded-full shadow-lg flex-row items-center gap-1.5 z-30"
      >
        <View className="w-2 h-2 rounded-full bg-emerald-400" />
        <Icon size={14} color="#c084fc" />
        <Text className="text-white text-xs font-bold">
          {validList.length} Active ({formatDuration(Date.now() - startTimeMs).slice(3)})
        </Text>
      </TouchableOpacity>
    );
  }

  // COMPACT CAPSULE (DEFAULT) — Takes only ~44px, never blocks feeds!
  if (!isExpanded) {
    return (
      <View className="absolute bottom-[82px] left-3 right-3 z-30" pointerEvents="box-none">
        <View className="bg-slate-950/95 border border-slate-800 shadow-2xl rounded-full px-3.5 py-2 flex-row items-center justify-between">
          <TouchableOpacity
            onPress={() => onPressCard?.(activeProcess.orderId, activeProcess.id)}
            className="flex-row items-center gap-2.5 flex-1 mr-2"
            activeOpacity={0.8}
          >
            <View className="relative">
              <View className={`w-2 h-2 rounded-full ${isCycleDone ? 'bg-emerald-400' : 'bg-purple-400'}`} />
            </View>
            <View className="w-6 h-6 rounded-full bg-purple-500/20 items-center justify-center">
              <Icon size={13} color="#c084fc" />
            </View>
            <View className="flex-1">
              <Text className="text-white text-xs font-bold" numberOfLines={1}>
                {machineName} <Text className="text-slate-400 font-medium">#{orderShort}</Text>
              </Text>
            </View>
            <LiveTimer startTime={startTimeMs} textClass="text-emerald-400 font-mono font-bold text-xs" />
          </TouchableOpacity>

          <View className="flex-row items-center gap-1.5 shrink-0">
            {isCycleDone ? (
              <TouchableOpacity
                onPress={() => onComplete(activeProcess.orderId)}
                className="bg-emerald-500 px-2.5 py-1 rounded-full flex-row items-center gap-1 active:scale-95 shadow-sm"
              >
                <CheckCircle2 size={12} color="#ffffff" />
                <Text className="text-white font-extrabold text-[11px]">Unload</Text>
              </TouchableOpacity>
            ) : (
              <View className="bg-slate-800/80 px-2 py-0.5 rounded-full flex-row items-center gap-1">
                <Lock size={10} color="#94a3b8" />
                <Text className="text-slate-400 text-[10px] font-bold">{lockMinutesLeft}m</Text>
              </View>
            )}

            {/* Expand Chevron */}
            <TouchableOpacity
              onPress={() => setIsExpanded(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              className="w-6 h-6 rounded-full bg-slate-800 items-center justify-center ml-0.5"
            >
              <ChevronUp size={14} color="#cbd5e1" />
            </TouchableOpacity>

            {/* Dismiss X */}
            <TouchableOpacity
              onPress={() => setIsDismissed(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              className="w-6 h-6 rounded-full bg-slate-800/60 items-center justify-center"
            >
              <X size={12} color="#94a3b8" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // EXPANDED VIEW — Shown on demand
  return (
    <View className="absolute bottom-[80px] left-3 right-3 bg-white rounded-3xl shadow-2xl border-2 border-[#994bff] p-4 z-30">
      {/* Top Header bar with Machine Switcher & Collapse/Dismiss */}
      <View className="flex-row items-center justify-between mb-3 pb-2 border-b border-gray-100">
        <View className="flex-row items-center gap-1.5 flex-1 mr-2 flex-wrap">
          <Text className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest mr-1">
            Running Machines ({validList.length}):
          </Text>
          {validList.map((p, idx) => {
            const pStep = currentStep(p);
            const isSelected = idx === activeIndex;
            const pOrder = p.orderId.slice(-6).toUpperCase();
            const mTitle = p.stages?.[pStep!]?.machineName || (pStep === 'getting_washed' ? `Washer ${idx + 1}` : `Dryer ${idx + 1}`);
            return (
              <TouchableOpacity
                key={p.id || p.orderId}
                onPress={() => setActiveIndex(idx)}
                className={`px-2.5 py-1 rounded-full flex-row items-center gap-1 ${
                  isSelected ? 'bg-[#994bff]' : 'bg-gray-100'
                }`}
              >
                <Text className={`text-[11px] font-bold ${isSelected ? 'text-white' : 'text-gray-600'}`}>
                  {mTitle} (#{pOrder})
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View className="flex-row items-center gap-1">
          <TouchableOpacity
            onPress={() => setIsExpanded(false)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            className="w-7 h-7 rounded-full bg-gray-100 items-center justify-center"
          >
            <ChevronDown size={16} color="#64748b" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setIsDismissed(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            className="w-7 h-7 rounded-full bg-gray-100 items-center justify-center ml-1"
          >
            <X size={14} color="#94a3b8" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Body */}
      <View className="flex-row items-center justify-between">
        <TouchableOpacity
          onPress={() => onPressCard?.(activeProcess.orderId, activeProcess.id)}
          className="flex-row items-center gap-3 flex-1 mr-3"
          activeOpacity={0.8}
        >
          <View className="w-12 h-12 rounded-2xl bg-[#994bff]/10 items-center justify-center">
            <Icon color="#994bff" size={24} />
          </View>
          <View className="flex-1">
            <View className="flex-row items-center gap-2 flex-wrap mb-0.5">
              <Text className="text-xs font-extrabold text-[#994bff] uppercase">
                {machineName} • {label}
              </Text>
              {milestoneBadge && (
                <View className={`px-2 py-0.5 rounded border ${milestoneBadge.bg}`}>
                  <Text className={`text-[10px] font-bold ${milestoneBadge.color}`}>{milestoneBadge.text}</Text>
                </View>
              )}
            </View>
            <Text className="text-sm font-semibold text-gray-900">
              Order #{orderShort}{token ? ` • Token #${token}` : ''}
            </Text>
            <LiveTimer startTime={startTimeMs} textClass="text-lg font-black text-gray-900 mt-0.5" />
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
            className="px-3 py-2.5 rounded-2xl bg-gray-100 border border-gray-200 items-center justify-center shrink-0 flex-row gap-1.5"
            activeOpacity={0.7}
          >
            <Lock color="#94a3b8" size={15} />
            <Text className="text-gray-600 font-bold text-xs">{lockMinutesLeft}m left</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity 
            onPress={() => onComplete(activeProcess.orderId)}
            className="px-4 py-3 rounded-2xl bg-[#10b981] items-center justify-center active:scale-95 shrink-0 shadow-md flex-row gap-1.5"
          >
            <CheckCircle2 color="white" size={18} />
            <Text className="text-white font-extrabold text-sm">Unload</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

