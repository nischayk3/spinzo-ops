import React, { useState, useEffect } from 'react';
import { View, Text, SafeAreaView, TouchableOpacity, ScrollView, ActivityIndicator, Alert, TextInput } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { 
  useOrderStore, 
  HelperOrder, 
  OpsStep,
  getOrderPipeline,
  OPS_STEP_LABELS,
  SERVICE_TYPE_LABELS,
  ServiceType
} from '../../store/orderStore';
import { RootStackParamList } from '../../navigation/RootNavigator';
import { 
  X, ArrowRight, CheckCircle2, Droplets, Wind, Shirt, FoldVertical,
  Package, Clock, User, Phone, Tag, Play, Square, Printer
} from 'lucide-react-native';

type OrderDetailRouteProp = RouteProp<RootStackParamList, 'OrderDetail'>;

// ─── Time helper ───
const getTimeAgo = (timestamp: any): string => {
  if (!timestamp) return 'N/A';
  let ms: number;
  if (typeof timestamp.toDate === 'function') ms = timestamp.toDate().getTime();
  else if (timestamp.seconds) ms = timestamp.seconds * 1000;
  else ms = new Date(timestamp).getTime();
  const diffMs = Date.now() - ms;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ${diffMins % 60}m ago`;
  return `${Math.floor(diffHrs / 24)}d ago`;
};

const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  if (secs === 0) return `${mins}m`;
  return `${mins}m ${secs}s`;
};

// ─── Item summary ───
const getItemSummary = (item: any): string => {
  if (item.serviceType === 'blanket_wash') return item.description || `${item.blanketQuantity || item.quantity || 0} Blankets`;
  if (item.serviceType === 'ironing') return `${item.ironingCount || item.clothesCount || item.quantity || 0} Clothes`;
  const weightStr = item.weight ? `${item.weight}kg` : `${item.quantity || 1} units`;
  const ironingStr = (item.ironingCount || item.ironingEnabled) ? ` + ${item.ironingCount || 0} Ironing` : '';
  return weightStr + ironingStr;
};

// ─── Step icon map ───
const STEP_ICONS: Record<string, any> = {
  tagging: Tag,
  washing: Droplets,
  drying: Wind,
  ironing: Shirt,
  folding: FoldVertical,
  packaging: Package,
  completed: CheckCircle2,
};

const STEP_COLORS: Record<string, string> = {
  tagging: '#F97316',
  washing: '#0EA5E9',
  drying: '#8B5CF6',
  ironing: '#EC4899',
  folding: '#10B981',
  packaging: '#6366F1',
  completed: '#22C55E',
};

// ─── Live timer ───
const LiveTimer = ({ startTimestamp, large }: { startTimestamp: any; large?: boolean }) => {
  const [elapsed, setElapsed] = useState('00:00');

  useEffect(() => {
    const getMs = () => {
      if (!startTimestamp) return 0;
      if (typeof startTimestamp.toDate === 'function') return startTimestamp.toDate().getTime();
      if (startTimestamp.seconds) return startTimestamp.seconds * 1000;
      return new Date(startTimestamp).getTime();
    };

    const tick = () => {
      const startMs = getMs();
      if (!startMs) return;
      const diffSec = Math.floor((Date.now() - startMs) / 1000);
      const mins = Math.floor(diffSec / 60);
      const secs = diffSec % 60;
      setElapsed(`${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startTimestamp]);

  return (
    <Text className={`font-bold text-warning ${large ? 'text-3xl' : 'text-lg'}`}>
      {elapsed}
    </Text>
  );
};

export function OrderDetailScreen() {
  const route = useRoute<OrderDetailRouteProp>();
  const navigation = useNavigation();
  const { orderId } = route.params;
  
  const { orders, startTagging, completeTagging, startStep, completeStep } = useOrderStore();
  const order = orders.find(o => o.id === orderId);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [itemCount, setItemCount] = useState('');
  const [labelsPrinted, setLabelsPrinted] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);

  if (!order) {
    return (
      <SafeAreaView className="flex-1 bg-bgDark justify-center items-center">
        <Text className="text-textSecondary text-lg">Order not found or has moved.</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} className="mt-4 px-6 py-3 bg-bgSurface rounded-lg">
          <Text className="text-textPrimary font-bold">Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const pipeline = getOrderPipeline(order.items);
  const currentStepIdx = order.opsStep ? pipeline.indexOf(order.opsStep) : -1;

  // ─── Tagging: Print Labels ───
  const handlePrintLabels = () => {
    const count = parseInt(itemCount, 10);
    if (!itemCount || isNaN(count) || count <= 0) {
      Alert.alert('Invalid', 'Please enter the number of garments received.');
      return;
    }
    setIsPrinting(true);
    // Simulate printing delay
    setTimeout(() => {
      setIsPrinting(false);
      setLabelsPrinted(true);
      Alert.alert('Labels Printed', `✓ ${count} garment labels printed successfully.`);
    }, 2000);
  };

  // ─── Tagging: Start (pickup_completed → processing/tagging) ───
  const handleStartTagging = async () => {
    const count = parseInt(itemCount, 10);
    if (!count || count <= 0) {
      Alert.alert('Invalid', 'Please enter garment count first.');
      return;
    }
    try {
      setIsSubmitting(true);
      await startTagging(order, count);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to start tagging');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Tagging: Complete → move to next step ───
  const handleCompleteTagging = async () => {
    try {
      setIsSubmitting(true);
      await completeTagging(order);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to complete tagging');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Generic step actions ───
  const handleStartCurrentStep = async () => {
    if (!order.opsStep) return;
    try {
      setIsSubmitting(true);
      await startStep(order, order.opsStep);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to start step');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCompleteCurrentStep = async () => {
    if (!order.opsStep) return;
    try {
      setIsSubmitting(true);
      await completeStep(order, order.opsStep);
      // If packaging was completed, order becomes ready — go back
      if (order.opsStep === 'packaging') {
        navigation.goBack();
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to complete step');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Completed step history ───
  const getCompletedSteps = () => {
    const completed: { step: string; duration: number }[] = [];
    const stepDurations: Record<string, string> = {
      tagging: 'taggingDuration',
      washing: 'washingDuration',
      drying: 'dryingDuration',
      ironing: 'ironingDuration',
      folding: 'foldingDuration',
      packaging: 'packagingDuration',
    };

    for (const step of pipeline) {
      const durationField = stepDurations[step];
      if (durationField && (order as any)[durationField]) {
        completed.push({ step, duration: (order as any)[durationField] });
      }
    }
    return completed;
  };

  const completedSteps = getCompletedSteps();

  return (
    <SafeAreaView className="flex-1 bg-bgDark">
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-4 border-b border-bgSurfaceLight">
        <Text className="text-xl font-bold text-textPrimary">
          Order #{order.id.slice(-6).toUpperCase()}
        </Text>
        <TouchableOpacity onPress={() => navigation.goBack()} className="p-2 bg-bgSurface rounded-full">
          <X color="#94A3B8" size={20} />
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1 p-4">
        {/* ─── Customer Info Card ─── */}
        <View className="bg-bgSurface p-4 rounded-xl border border-bgSurfaceLight mb-4">
          <View className="flex-row items-center mb-3">
            <User size={16} color="#94A3B8" />
            <Text className="text-textPrimary font-bold text-lg ml-2">{order.customerName}</Text>
          </View>
          {order.customerPhone ? (
            <View className="flex-row items-center mb-3">
              <Phone size={14} color="#64748B" />
              <Text className="text-textSecondary ml-2">{order.customerPhone}</Text>
            </View>
          ) : null}
          <View className="flex-row justify-between">
            <View>
              <Text className="text-textMuted text-xs mb-1">Status</Text>
              <View className="bg-primary/20 px-2 py-1 rounded">
                <Text className="text-primary font-bold text-xs">
                  {order.opsStep ? OPS_STEP_LABELS[order.opsStep].toUpperCase() : order.status.replace('_', ' ').toUpperCase()}
                </Text>
              </View>
            </View>
            {order.tokenNumber && (
              <View>
                <Text className="text-textMuted text-xs mb-1">Token</Text>
                <View className="flex-row items-center">
                  <Tag size={14} color="#3B82F6" />
                  <Text className="text-textPrimary font-bold ml-1">T-{order.tokenNumber}</Text>
                </View>
              </View>
            )}
            <View className="items-end">
              <Text className="text-textMuted text-xs mb-1">Picked Up</Text>
              <Text className="text-textSecondary text-xs">{getTimeAgo(order.pickedUpAt || order.createdAt)}</Text>
            </View>
          </View>
        </View>

        {/* ─── Items Card ─── */}
        <View className="bg-bgSurface p-4 rounded-xl border border-bgSurfaceLight mb-4">
          <Text className="text-textPrimary font-bold text-base mb-3">Order Items</Text>
          {order.items.map((item: any, idx: number) => (
            <View key={idx} className="flex-row justify-between items-start py-2 border-b border-bgSurfaceLight">
              <View className="flex-1">
                <Text className="text-textPrimary font-bold">
                  {SERVICE_TYPE_LABELS[item.serviceType as ServiceType] || item.serviceName}
                </Text>
                <Text className="text-textMuted text-xs mt-1">{getItemSummary(item)}</Text>
                {item.specialInstructions && (
                  <Text className="text-warning text-xs mt-1 italic">"{item.specialInstructions}"</Text>
                )}
              </View>
              <Text className="text-textSecondary font-bold">₹{item.totalPrice}</Text>
            </View>
          ))}
        </View>

        {/* ─── Pipeline Progress ─── */}
        <View className="bg-bgSurface p-4 rounded-xl border border-bgSurfaceLight mb-4">
          <Text className="text-textPrimary font-bold text-base mb-4">Processing Pipeline</Text>
          
          <View className="flex-row items-center justify-between mb-4 px-1">
            {pipeline.map((step, idx) => {
              const StepIcon = STEP_ICONS[step] || Package;
              const stepColor = STEP_COLORS[step] || '#64748B';
              const isDone = idx < currentStepIdx;
              const isCurrent = idx === currentStepIdx;

              return (
                <React.Fragment key={step}>
                  {idx > 0 && (
                    <View className={`flex-1 h-0.5 mx-0.5 ${isDone ? 'bg-success' : 'bg-bgSurfaceLight'}`} />
                  )}
                  <View className="items-center">
                    <View className={`w-8 h-8 rounded-full items-center justify-center ${
                      isDone ? 'bg-success/20' : isCurrent ? 'bg-primary/20' : 'bg-bgSurfaceLight'
                    }`}>
                      {isDone ? (
                        <CheckCircle2 size={16} color="#22C55E" />
                      ) : (
                        <StepIcon size={14} color={isCurrent ? stepColor : '#64748B'} />
                      )}
                    </View>
                    <Text className={`text-xs mt-1 ${isCurrent ? 'text-textPrimary font-bold' : 'text-textMuted'}`}
                      style={{ fontSize: 9 }}
                    >
                      {OPS_STEP_LABELS[step]}
                    </Text>
                  </View>
                </React.Fragment>
              );
            })}
          </View>
        </View>

        {/* ─── Timeline (completed steps) ─── */}
        {completedSteps.length > 0 && (
          <View className="bg-bgSurface p-4 rounded-xl border border-bgSurfaceLight mb-4">
            <View className="flex-row items-center mb-3">
              <Clock size={16} color="#3B82F6" />
              <Text className="text-textPrimary font-bold text-base ml-2">Processing Timeline</Text>
            </View>
            {completedSteps.map((entry, idx) => (
              <View key={idx} className="flex-row items-center justify-between py-2 border-b border-bgSurfaceLight">
                <View className="flex-row items-center">
                  <View className="w-2 h-2 rounded-full bg-success mr-3" />
                  <Text className="text-textPrimary text-sm">{OPS_STEP_LABELS[entry.step as OpsStep]}</Text>
                </View>
                <Text className="text-primary font-bold text-sm">{formatDuration(entry.duration)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ─── INTAKE: Print Labels + Start Tagging ─── */}
        {order.status === 'pickup_completed' && !order.opsStep && (
          <View className="bg-bgSurface p-4 rounded-xl border border-bgSurfaceLight mb-4">
            <Text className="text-textPrimary font-bold text-base mb-2">Tagging & Intake</Text>
            <Text className="text-textSecondary text-sm mb-4">
              Enter the actual number of garments received, print labels, then start tagging.
            </Text>

            {/* Required Pipeline Preview */}
            <View className="bg-bgDark p-3 rounded-lg mb-4">
              <Text className="text-textMuted text-xs mb-2 font-bold uppercase">Pipeline for this order:</Text>
              <View className="flex-row flex-wrap gap-2">
                {pipeline.map((step) => {
                  const StepIcon = STEP_ICONS[step] || Package;
                  return (
                    <View key={step} className="flex-row items-center bg-bgSurface px-3 py-1.5 rounded-full">
                      <StepIcon size={12} color={STEP_COLORS[step] || '#64748B'} />
                      <Text className="text-textSecondary text-xs font-bold ml-1">{OPS_STEP_LABELS[step]}</Text>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* Garment Count Input */}
            <View className="mb-4">
              <Text className="text-textMuted text-xs mb-2 font-bold uppercase tracking-wider">Total Garments Received</Text>
              <TextInput
                className="bg-bgDark border border-bgSurfaceLight rounded-lg p-4 text-textPrimary text-xl font-bold"
                placeholder="Enter number of clothes"
                placeholderTextColor="#64748B"
                keyboardType="number-pad"
                value={itemCount}
                onChangeText={setItemCount}
                editable={!labelsPrinted && !isSubmitting}
              />
            </View>

            {/* Print Labels Button */}
            {!labelsPrinted && (
              <TouchableOpacity 
                className="flex-row items-center justify-center p-4 rounded-lg bg-[#F97316] mb-3"
                disabled={isPrinting || !itemCount}
                onPress={handlePrintLabels}
                style={{ opacity: (!itemCount || isPrinting) ? 0.5 : 1 }}
              >
                {isPrinting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Printer color="#fff" size={18} />
                    <Text className="text-white font-bold text-base ml-2">Print {itemCount || '0'} Labels</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {/* Labels Printed Confirmation */}
            {labelsPrinted && (
              <View className="bg-success/10 p-3 rounded-lg mb-3 flex-row items-center">
                <CheckCircle2 color="#22C55E" size={18} />
                <Text className="text-success font-bold ml-2">✓ {itemCount} Labels Printed</Text>
              </View>
            )}

            {/* Start Tagging Button (only after printing) */}
            {labelsPrinted && (
              <TouchableOpacity 
                className="flex-row items-center justify-center p-4 rounded-lg bg-[#6366F1]"
                disabled={isSubmitting}
                onPress={handleStartTagging}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Tag color="#fff" size={18} />
                    <Text className="text-white font-bold text-base ml-2">Start Tagging</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ─── TAGGING IN PROGRESS ─── */}
        {order.opsStep === 'tagging' && order.stepPhase === 'active' && (
          <View className="bg-bgSurface p-4 rounded-xl border border-bgSurfaceLight mb-4">
            <Text className="text-textPrimary font-bold text-base mb-2">Tagging In Progress</Text>
            <View className="bg-bgDark p-4 rounded-lg mb-4 items-center">
              <Text className="text-textMuted text-xs mb-1">Time Elapsed</Text>
              <LiveTimer startTimestamp={order.currentStepStartedAt} large />
              {order.actualItemCount && (
                <Text className="text-textSecondary text-sm mt-2">{order.actualItemCount} garments to tag</Text>
              )}
            </View>
            <Text className="text-textSecondary text-sm mb-4">
              Tag each garment with the printed label. Once all garments are tagged, tap Complete.
            </Text>
            <TouchableOpacity 
              className="flex-row items-center justify-center p-4 rounded-lg bg-success"
              disabled={isSubmitting}
              onPress={handleCompleteTagging}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <CheckCircle2 color="#fff" size={18} />
                  <Text className="text-white font-bold text-base ml-2">Complete Tagging</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* ─── PROCESSING STEP: Pending (Start button) ─── */}
        {order.opsStep && order.opsStep !== 'tagging' && order.opsStep !== 'completed' && order.stepPhase === 'pending' && (() => {
          const StepIcon = STEP_ICONS[order.opsStep] || Package;
          const stepColor = STEP_COLORS[order.opsStep] || '#3B82F6';
          return (
            <View className="bg-bgSurface p-4 rounded-xl border border-bgSurfaceLight mb-4">
              <View className="flex-row items-center mb-3">
                <StepIcon size={20} color={stepColor} />
                <Text className="text-textPrimary font-bold text-base ml-2">
                  {OPS_STEP_LABELS[order.opsStep]} — Ready to Start
                </Text>
              </View>
              <Text className="text-textSecondary text-sm mb-4">
                {order.opsStep === 'washing' && 'Load the garments into the washing machine and tap Start.'}
                {order.opsStep === 'drying' && 'Transfer washed garments to the dryer and tap Start.'}
                {order.opsStep === 'ironing' && 'Set up the ironing station and tap Start.'}
                {order.opsStep === 'folding' && 'Begin folding and bundling the garments.'}
                {order.opsStep === 'packaging' && 'Begin final packaging, verify garment count, and prepare for delivery.'}
              </Text>
              <TouchableOpacity 
                className="flex-row items-center justify-center p-4 rounded-lg"
                style={{ backgroundColor: stepColor }}
                disabled={isSubmitting}
                onPress={handleStartCurrentStep}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Play color="#fff" size={18} />
                    <Text className="text-white font-bold text-base ml-2">
                      Start {OPS_STEP_LABELS[order.opsStep]}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          );
        })()}

        {/* ─── PROCESSING STEP: Active (Timer + Complete button) ─── */}
        {order.opsStep && order.opsStep !== 'tagging' && order.opsStep !== 'completed' && order.stepPhase === 'active' && (() => {
          const StepIcon = STEP_ICONS[order.opsStep] || Package;
          const stepColor = STEP_COLORS[order.opsStep] || '#3B82F6';
          return (
            <View className="bg-bgSurface p-4 rounded-xl border border-bgSurfaceLight mb-4">
              <View className="flex-row items-center mb-3">
                <StepIcon size={20} color={stepColor} />
                <Text className="text-textPrimary font-bold text-base ml-2">
                  {OPS_STEP_LABELS[order.opsStep]} — In Progress
                </Text>
              </View>
              
              {/* Live Timer */}
              <View className="bg-bgDark p-6 rounded-lg mb-4 items-center">
                <Text className="text-textMuted text-xs mb-2">Time Elapsed</Text>
                <LiveTimer startTimestamp={order.currentStepStartedAt} large />
              </View>

              <TouchableOpacity 
                className="flex-row items-center justify-center p-4 rounded-lg bg-success"
                disabled={isSubmitting}
                onPress={handleCompleteCurrentStep}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Square color="#fff" size={18} />
                    <Text className="text-white font-bold text-base ml-2">
                      Complete {OPS_STEP_LABELS[order.opsStep]}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          );
        })()}

        {/* ─── READY STATE ─── */}
        {(order.status === 'ready' || order.opsStep === 'completed') && (
          <View className="bg-success/10 p-6 rounded-xl border border-success/30 mb-4 items-center">
            <CheckCircle2 color="#22C55E" size={48} />
            <Text className="text-success font-bold text-lg mt-3">Order is Ready!</Text>
            <Text className="text-success/70 text-center mt-2">
              All processing complete. Waiting for delivery rider.
            </Text>
          </View>
        )}

        {/* Bottom spacer */}
        <View className="h-8" />
      </ScrollView>
    </SafeAreaView>
  );
}
