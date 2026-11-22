import React from 'react';
import { View, Text, Modal, ScrollView, TouchableOpacity } from 'react-native';
import {
  X,
  User,
  Clock,
  Tag,
  ChevronRight,
  CheckCircle2,
  Cpu,
  Briefcase,
} from 'lucide-react-native';
import { HelperLiveTaskItem } from '../../utils/rosterTasks';

export interface SupervisorHelperTasksModalProps {
  visible: boolean;
  helper: { uid: string; name?: string; phone?: string; role?: string } | null;
  tasks: HelperLiveTaskItem[];
  onClose: () => void;
  onSelectOrder: (orderId: string, processId: string) => void;
}

function toMs(ts: any): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts?.toMillis === 'function') return ts.toMillis();
  if (typeof ts?.seconds === 'number') return ts.seconds * 1000;
  if (typeof ts?._seconds === 'number') return ts._seconds * 1000;
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function formatElapsed(startedAt?: any, assignedAt?: any): string | null {
  const refMs = toMs(startedAt) || toMs(assignedAt);
  if (!refMs) return null;
  const diffMin = Math.max(0, Math.floor((Date.now() - refMs) / 60000));
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m elapsed`;
  const hrs = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  return mins > 0 ? `${hrs}h ${mins}m elapsed` : `${hrs}h elapsed`;
}

export function SupervisorHelperTasksModal({
  visible,
  helper,
  tasks,
  onClose,
  onSelectOrder,
}: SupervisorHelperTasksModalProps) {
  if (!visible || !helper) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/60 items-center justify-center p-4">
        <View className="bg-bgSurface border border-white/10 rounded-2xl max-w-lg w-[92%] max-h-[80%] overflow-hidden shadow-2xl">
          {/* Header */}
          <View className="px-4 py-3.5 border-b border-white/10 flex-row items-center justify-between">
            <View className="flex-row items-center gap-3 flex-1 pr-2">
              <View className="w-10 h-10 rounded-full bg-primary/15 border border-primary/30 items-center justify-center">
                <User size={18} color="#994BFF" />
              </View>
              <View className="flex-1">
                <View className="flex-row items-center gap-2 flex-wrap">
                  <Text className="text-textPrimary font-bold text-base" numberOfLines={1}>
                    {helper.name || 'Helper'}
                  </Text>
                  <View className="bg-primary/15 border border-primary/30 px-2 py-0.5 rounded-full">
                    <Text className="text-primary font-bold text-[11px]">
                      {tasks.length} Active {tasks.length === 1 ? 'Task' : 'Tasks'}
                    </Text>
                  </View>
                </View>
                <View className="flex-row items-center gap-2 mt-0.5">
                  {helper.role ? (
                    <Text className="text-textSecondary text-xs capitalize">{helper.role}</Text>
                  ) : null}
                  {helper.phone ? (
                    <Text className="text-textMuted text-xs">{helper.phone}</Text>
                  ) : null}
                </View>
              </View>
            </View>

            <TouchableOpacity
              onPress={onClose}
              className="w-8 h-8 rounded-full bg-bgSurfaceLight items-center justify-center active:opacity-70"
              accessibilityLabel="Close helper tasks modal"
            >
              <X size={16} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* Task List */}
          <ScrollView contentContainerStyle={{ padding: 16 }} className="flex-grow-0">
            {tasks.length === 0 ? (
              <View className="py-10 px-4 items-center justify-center bg-bgSurfaceLight rounded-xl border border-white/10">
                <CheckCircle2 size={32} color="#94A3B8" />
                <Text className="text-textPrimary font-bold text-sm mt-3">
                  No active orders assigned
                </Text>
                <Text className="text-textMuted text-xs text-center mt-1">
                  {helper.name || 'This helper'} currently has no live processing tasks on the floor.
                </Text>
              </View>
            ) : (
              <View className="gap-3">
                {tasks.map((task) => {
                  const elapsed = formatElapsed(task.startedAt, task.assignedAt);
                  return (
                    <TouchableOpacity
                      key={`${task.processId}::${task.stage}`}
                      onPress={() => {
                        onClose();
                        onSelectOrder(task.orderId, task.processId);
                      }}
                      className="bg-bgSurfaceLight border border-white/10 rounded-xl p-3.5 active:opacity-80"
                    >
                      {/* Top row: Order # + Stage Pill */}
                      <View className="flex-row items-center justify-between gap-2 mb-1.5">
                        <View className="flex-row items-center gap-2 flex-1">
                          <Text className="text-textPrimary font-extrabold text-sm">
                            #{task.orderNumber}
                          </Text>
                          {task.serviceLabel ? (
                            <View className="bg-bgSurface px-2 py-0.5 rounded-md border border-white/10">
                              <Text className="text-textSecondary text-[10px] font-semibold" numberOfLines={1}>
                                {task.serviceLabel}
                              </Text>
                            </View>
                          ) : null}
                        </View>

                        <View
                          className={`px-2.5 py-0.5 rounded-full border ${
                            task.isRunningMachine
                              ? 'bg-info/15 border-info/30'
                              : 'bg-primary/15 border-primary/30'
                          }`}
                        >
                          <Text
                            className={`text-[10px] font-bold uppercase ${
                              task.isRunningMachine ? 'text-info' : 'text-primary'
                            }`}
                          >
                            {task.stageLabel}
                            {task.isRunningMachine ? ' • Running' : ''}
                          </Text>
                        </View>
                      </View>

                      {/* Customer Name */}
                      <Text className="text-textPrimary font-semibold text-xs mb-2" numberOfLines={1}>
                        {task.customerName}
                      </Text>

                      {/* Metadata row: Machine, Tokens, Elapsed */}
                      <View className="flex-row flex-wrap items-center gap-2 mb-2">
                        {task.machineName ? (
                          <View className="flex-row items-center gap-1 bg-info/10 px-2 py-0.5 rounded-md border border-info/20">
                            <Cpu size={11} color="#3B82F6" />
                            <Text className="text-info text-[11px] font-semibold">
                              {task.machineName}
                            </Text>
                          </View>
                        ) : null}

                        {task.tokens.map((tok) => (
                          <View
                            key={tok}
                            className="flex-row items-center gap-1 bg-bgSurface px-2 py-0.5 rounded-md border border-white/10"
                          >
                            <Tag size={10} color="#94A3B8" />
                            <Text className="text-textSecondary text-[11px] font-semibold">
                              {tok}
                            </Text>
                          </View>
                        ))}

                        {elapsed ? (
                          <View className="flex-row items-center gap-1">
                            <Clock size={11} color="#94A3B8" />
                            <Text className="text-textMuted text-[11px] font-medium">
                              {elapsed}
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      {/* Footer action hint */}
                      <View className="pt-2 border-t border-white/10 flex-row items-center justify-between">
                        <View className="flex-row items-center gap-1">
                          <Briefcase size={11} color="#94A3B8" />
                          <Text className="text-textMuted text-[11px]">
                            {task.startedAt ? 'In progress' : 'Assigned'}
                          </Text>
                        </View>
                        <View className="flex-row items-center gap-0.5">
                          <Text className="text-primary font-bold text-xs">Open Order</Text>
                          <ChevronRight size={13} color="#994BFF" />
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </ScrollView>

          {/* Footer */}
          <View className="px-4 py-3 border-t border-white/10 flex-row items-center justify-end">
            <TouchableOpacity
              onPress={onClose}
              className="px-4 py-2 rounded-xl bg-bgSurfaceLight border border-white/10 active:opacity-80"
            >
              <Text className="text-textPrimary font-bold text-xs">Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
