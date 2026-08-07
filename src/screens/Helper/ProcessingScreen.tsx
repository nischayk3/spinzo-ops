import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  WashingMachine,
  Tag,
  CheckCircle2,
  Play,
  ArrowRight,
  Inbox,
} from 'lucide-react-native';
import { useAuthStore } from '../../store/authStore';
import { useOpsProcessStore, OpsProcessingResult } from '../../store/opsProcessStore';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { serviceSummary, timeAgo } from '../../utils/orderFeed';
import { stepLabel, OpsProcess } from '../../utils/opsProcess';

interface ActionButton {
  key: string;
  label: string;
  onPress: () => void;
  variant: 'primary' | 'info';
}

export function ProcessingScreen() {
  const user = useAuthStore(state => state.user);
  const activeRole = useAuthStore(state => state.activeRole);
  const { myProcesses, isLoading, error, initialize, claim, startStep, completeStep, advanceStep } =
    useOpsProcessStore();
  const { orders, initialize: initializeFeed } = useOrderFeedStore();

  // Tracks which orders have had their production step advanced, so the stepper
  // can move from "Advance to <Next>" to "Start <Next>" without a doc write.
  const [advanced, setAdvanced] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    initializeFeed();
    if (user?.id) initialize(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const myProcessIds = useMemo(() => new Set(myProcesses.map(p => p.orderId)), [myProcesses]);

  // pickup_completed orders not already claimed by this helper.
  const claimable = useMemo(
    () => orders.filter(o => o.status === 'pickup_completed' && !myProcessIds.has(o.id)),
    [orders, myProcessIds],
  );

  const hasWork = myProcesses.length > 0 || claimable.length > 0;

  const runAction = async (fn: () => Promise<OpsProcessingResult>) => {
    setActionError(null);
    const res = await fn();
    if (!res.ok) setActionError(res.error || 'request_failed');
  };

  const handleAdvance = (p: OpsProcess) => {
    setAdvanced(a => ({ ...a, [p.orderId]: true }));
    runAction(() => advanceStep(p.orderId));
  };

  const processActions = (p: OpsProcess): ActionButton[] => {
    const actions: ActionButton[] = [];
    if (p.status === 'done') return actions;

    const current = p.steps[p.currentIndex];
    const curTime = current ? p.stepTimes[current] || {} : {};
    const started = !!curTime.startedAt;
    const completed = !!curTime.completedAt;
    const prevComplete =
      p.currentIndex > 0 && !!p.stepTimes[p.steps[p.currentIndex - 1]]?.completedAt;
    // Only offer "Advance to <Next>" when the callable can compute a next step,
    // so the last step never hits a no_next_step error.
    const hasNext = p.currentIndex < p.steps.length - 1;
    const label = current ? stepLabel(current) : '';

    if (p.status === 'tagging') {
      if (!started) {
        actions.push({
          key: 'start-tagging',
          label: 'Start Tagging',
          onPress: () => runAction(() => startStep(p.orderId)),
          variant: 'primary',
        });
      } else if (!completed) {
        actions.push({
          key: 'complete-tagging',
          label: 'Complete Tagging',
          onPress: () => runAction(() => completeStep(p.orderId)),
          variant: 'primary',
        });
      }
    } else if (current) {
      if (!started) {
        if (prevComplete && hasNext && !advanced[p.orderId]) {
          actions.push({
            key: 'advance',
            label: `Advance to ${label}`,
            onPress: () => handleAdvance(p),
            variant: 'info',
          });
        } else {
          actions.push({
            key: 'start',
            label: `Start ${label}`,
            onPress: () => runAction(() => startStep(p.orderId)),
            variant: 'primary',
          });
        }
      } else if (!completed) {
        actions.push({
          key: 'complete',
          label: `Complete ${label}`,
          onPress: () => runAction(() => completeStep(p.orderId)),
          variant: 'primary',
        });
      }
    }
    return actions;
  };

  if (isLoading && myProcesses.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-bgDark items-center justify-center">
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text className="text-textSecondary mt-4 font-bold">Loading processing…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bgDark">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-2xl font-bold text-textPrimary">Processing</Text>
        <Text className="text-textSecondary">
          {activeRole === 'helper' ? 'Helper pipeline' : 'Ops queue'} · {myProcesses.length} in your
          queue · {claimable.length} claimable
        </Text>
      </View>

      <FlatList
        data={myProcesses}
        keyExtractor={p => p.id}
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 24 }}
        ListHeaderComponent={
          <View>
            {claimable.length > 0 && (
              <View className="mb-2">
                <Text className="text-textSecondary font-bold text-xs mb-2 tracking-wide">
                  CLAIMABLE
                </Text>
                {claimable.map(o => (
                  <View
                    key={o.id}
                    className="bg-bgSurface rounded-xl p-4 mb-3 border border-bgSurfaceLight"
                  >
                    <View className="flex-row items-center justify-between mb-1">
                      <Text className="text-textPrimary font-bold text-lg">
                        #{o.id.slice(-6).toUpperCase()}
                      </Text>
                      <Text className="text-textMuted text-xs">{timeAgo(o.createdAt)}</Text>
                    </View>
                    <Text className="text-textSecondary text-sm mb-1">
                      {o.customerName || 'Unknown customer'}
                    </Text>
                    <Text className="text-textMuted text-xs mb-3">{serviceSummary(o)}</Text>
                    <TouchableOpacity
                      onPress={() => runAction(() => claim(o.id))}
                      className="bg-primary rounded-lg h-11 items-center justify-center flex-row"
                    >
                      <Play size={18} color="#0F172A" className="mr-2" />
                      <Text className="text-bgDark font-bold">Claim</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            {myProcesses.length > 0 && (
              <Text className="text-textSecondary font-bold text-xs mb-2 mt-2 tracking-wide">
                MY WORK
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const actions = processActions(item);
          return (
            <View className="bg-bgSurface rounded-xl p-4 mb-3 border border-bgSurfaceLight">
              <View className="flex-row items-center justify-between mb-2">
                <View className="flex-row items-center">
                  <WashingMachine size={16} color="#22C55E" className="mr-2" />
                  <Text className="text-textPrimary font-bold text-lg">
                    #{item.orderId.slice(-6).toUpperCase()}
                  </Text>
                </View>
                {item.status === 'done' ? (
                  <View className="flex-row items-center bg-primary/15 border border-primary/40 rounded-full px-2 py-0.5">
                    <CheckCircle2 size={13} color="#22C55E" className="mr-1" />
                    <Text className="text-primary text-xs font-bold">Complete</Text>
                  </View>
                ) : (
                  <Text className="text-textMuted text-xs">{stepLabel(item.status)}</Text>
                )}
              </View>

              {/* Step stepper */}
              <View className="flex-row flex-wrap mb-3">
                {item.steps.length === 0 ? (
                  <Text className="text-textMuted text-xs">No steps</Text>
                ) : (
                  item.steps.map((s, i) => {
                    const isCurrent = i === item.currentIndex;
                    const isDone = i < item.currentIndex || !!item.stepTimes[s]?.completedAt;
                    return (
                      <View
                        key={`${s}-${i}`}
                        className={`rounded-full px-2.5 py-1 mr-1.5 mb-1 border ${
                          isCurrent
                            ? 'bg-primary border-primary'
                            : isDone
                              ? 'bg-bgSurfaceLight border-bgSurfaceLight'
                              : 'bg-bgSurface border-bgSurfaceLight'
                        }`}
                      >
                        <Text
                          className={`text-xs font-bold ${
                            isCurrent
                              ? 'text-bgDark'
                              : isDone
                                ? 'text-textPrimary'
                                : 'text-textMuted'
                          }`}
                        >
                          {stepLabel(s)}
                        </Text>
                      </View>
                    );
                  })
                )}
              </View>

              {/* Action buttons */}
              {actions.length > 0 && (
                <View className="flex-row flex-wrap gap-2">
                  {actions.map(a =>
                    a.variant === 'info' ? (
                      <TouchableOpacity
                        key={a.key}
                        onPress={a.onPress}
                        className="bg-info/15 border border-info/40 rounded-lg h-11 px-4 items-center justify-center flex-row"
                      >
                        <ArrowRight size={18} color="#3B82F6" className="mr-2" />
                        <Text className="text-info font-bold">{a.label}</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        key={a.key}
                        onPress={a.onPress}
                        className="bg-primary rounded-lg h-11 px-4 items-center justify-center flex-row"
                      >
                        <Play size={18} color="#0F172A" className="mr-2" />
                        <Text className="text-bgDark font-bold">{a.label}</Text>
                      </TouchableOpacity>
                    ),
                  )}
                </View>
              )}

              {item.status === 'done' && (
                <View className="flex-row items-center mt-1">
                  <Tag size={13} color="#94A3B8" className="mr-1" />
                  <Text className="text-textMuted text-xs">
                    Order ready for the next stage
                  </Text>
                </View>
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          hasWork ? null : (
            <View className="items-center justify-center mt-20">
              <Inbox size={36} color="#64748B" />
              <Text className="text-textSecondary text-lg font-bold mt-3">
                No orders in your queue
              </Text>
              <Text className="text-textMuted text-center mt-2">
                Claim a pickup-completed order to start processing.
              </Text>
            </View>
          )
        }
      />

      {(error || actionError) && (
        <View className="mx-4 mb-4 bg-error/15 border border-error/40 rounded-lg p-3">
          <Text className="text-error text-xs font-bold">{actionError || error}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}
