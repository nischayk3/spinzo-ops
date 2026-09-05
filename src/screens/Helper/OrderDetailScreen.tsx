import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Modal } from 'react-native';
import { X, Play, AlertCircle, MoreHorizontal, Calendar, Phone, MapPin, MessageCircle, UserPlus } from 'lucide-react-native';
import { Linking, Alert } from 'react-native';
import { QRScanner } from '../../components/QRScanner';
import { CancelOrderModal } from '../../components/Supervisor/CancelOrderModal';
import { RescheduleModal } from '../../components/Supervisor/RescheduleModal';
import { AssignRiderModal } from '../../components/Supervisor/AssignRiderModal';
import { useAuthStore } from '../../store/authStore';
import { useOpsProcessStore, OpsProcessingResult } from '../../store/opsProcessStore';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { serviceSummary } from '../../utils/orderFeed';
import { currentStep, isDone, stage, stepLabel } from '../../utils/opsProcess';
import { opsTimeline } from '../../utils/opsTimeline';
import { printGarmentLabels } from '../../utils/labelPrint';
import { canStartStage } from './ProcessingScreen';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { PackagingVerification } from '../../components/PackagingVerification';
import { WorkflowSteps } from '../../components/WorkflowSteps';

type Props = NativeStackScreenProps<RootStackParamList, 'OrderDetail'>;

const friendlyScanError = (code: string): string => {
  const map: Record<string, string> = {
    not_this_order: 'This label belongs to a different order.',
    already_registered: 'This garment is already registered.',
    not_in_count: "Label number is outside this order's garment count.",
    already_submitted: 'Tagging was already submitted for this order.',
    unauthorized: 'Only the helper who claimed this order can scan labels.',
    not_found: 'Order not found.',
  };
  return map[code] || code || 'Scan failed. Try again.';
};

const friendlyActionError = (code: string): string => {
  const map: Record<string, string> = {
    already_claimed: 'This order is already claimed.',
    invalid_state: "This order isn't in a state that allows that action.",
    unauthorized: "You're not assigned to this stage.",
    already_started: 'This stage is already started.',
    already_completed: 'This stage is already complete.',
    not_found: 'Order not found.',
    not_all_registered: 'Scan every garment before submitting.',
    use_submit: 'Use Submit Tagged Garments to finish tagging.',
  };
  return map[code] || code || 'Request failed.';
};

export function OrderDetailScreen({ route, navigation }: Props) {
  const { orderId } = route.params;
  const user = useAuthStore(s => s.user);
  const activeRole = useAuthStore(s => s.activeRole);
  const orders = useOrderFeedStore(s => s.orders);
  const { processes, claim, startStep, completeStep, printLabels, scanGarment, unregisterGarment, submitTagging, cancelOrder, reschedulePickup, scheduleDelivery, markOutForDelivery, verifyDeliveryOTP } = useOpsProcessStore();

  const [countText, setCountText] = useState('');
  const [printError, setPrintError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [scannerVisible, setScannerVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showQualityVerification, setShowQualityVerification] = useState(false);

  const [machineStartedLocal, setMachineStartedLocal] = useState(false);

  const order = useMemo(() => orders.find(o => o.id === orderId), [orders, orderId]);
  const process = useMemo(() => processes.find(p => p.orderId === orderId), [processes, orderId]);

  const cur = process ? currentStep(process) : null;
  const curStage = cur ? stage(process!, cur) : undefined;
  const isAssignee = activeRole === 'supervisor' || (curStage?.assignee === user?.id);

  // If the stage is changed/completed, reset the local state
  useEffect(() => {
    setMachineStartedLocal(false);
  }, [cur]);

  const [showPackagingVerification, setShowPackagingVerification] = useState(false);
  
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [showAssignRiderModal, setShowAssignRiderModal] = useState(false);


  const done = process ? isDone(process) : false;
  const taggingStage = process?.stages?.tagging;
  const garments = process?.garments || {};
  const registered = garments.registered || [];
  const registeredSeqs = registered.map((r: any) => typeof r === 'number' ? r : r.seq);
  const registeredCount = registered.length;


  const runAction = async (fn: () => Promise<OpsProcessingResult>, onSuccess?: () => void) => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fn();
      if (!res.ok) setActionError(friendlyActionError(res.error));
      else if (onSuccess) onSuccess();
    } finally {
      setBusy(false);
    }
  };

  const handleClaim = () => runAction(() => claim(orderId, ''));
  const handleStart = () => runAction(() => startStep(orderId));
  const handleComplete = () => {
    // Quality and Packaging verification required for packaging step

    if (cur === 'packaging' && !showPackagingVerification) {
      setShowPackagingVerification(true);
      return;
    }
    runAction(() => completeStep(orderId), () => navigation.goBack());
  };

  const handlePrint = async () => {
    const n = Number(countText.trim());
    if (!Number.isInteger(n) || n < 1 || n > 500) {
      setPrintError('Enter a whole number of garments (1–500).');
      return;
    }
    setBusy(true);
    setPrintError(null);
    setActionError(null);
    try {
      const res = await printLabels(orderId, n);
      if (res.ok && res.labels) {
        await printGarmentLabels(res.labels, { orderShort: orderId.slice(-6) });
      } else if (!res.ok) {
        setPrintError(friendlyActionError(res.error));
      } else {
        setPrintError('No labels returned. Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleScan = async (data: string) => {
    setBusy(true);
    setScanError(null);
    setActionError(null);
    try {
      // DEV BYPASS: Accept any scan (or button press) and register the next expected QR
      const nextSeq = Array.from({ length: garments.count || 0 })
        .map((_, i) => i + 1)
        .find(seq => !registeredSeqs.includes(seq));
        
      if (!nextSeq) return;
      const expectedQr = `SPNZ:${orderId}:${nextSeq}`;
      
      const res = await scanGarment(orderId, expectedQr);
      if (!res.ok) setScanError(friendlyScanError(res.error));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitTagging = () => runAction(() => submitTagging(orderId), () => navigation.goBack());

  const handleCancelOrder = async (reason: string, note: string) => {
    if (!order) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await cancelOrder(orderId, order.userId, reason, note);
      if (!res.ok) setActionError(friendlyActionError(res.error));
      else Alert.alert("Success", "Order cancelled successfully.");
    } finally {
      setBusy(false);
    }
  };

  const handleReschedule = async (dateStr: string, slot: string) => {
    if (!order) return;
    setBusy(true);
    setActionError(null);
    try {
      const isDelivery = order.status === 'ready';
      const res = isDelivery 
        ? await scheduleDelivery(orderId, order.userId, dateStr, slot)
        : await reschedulePickup(orderId, order.userId, dateStr, slot);
        
      if (!res.ok) setActionError(friendlyActionError(res.error));
      else Alert.alert("Success", `${isDelivery ? 'Delivery' : 'Pickup'} rescheduled successfully.`);
    } finally {
      setBusy(false);
    }
  };

  const handleMarkOutForDelivery = async () => {
    if (!order) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await markOutForDelivery(orderId, order.userId);
      if (!res.ok) setActionError(friendlyActionError(res.error));
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyDeliveryOTP = async () => {
    if (!order || !otp) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await verifyDeliveryOTP(orderId, order.userId, otp);
      if (!res.ok) setActionError(friendlyActionError(res.error));
      else Alert.alert("Success", "Delivery verified successfully.");
    } finally {
      setBusy(false);
    }
  };

  const handleWhatsApp = () => {
    if (!order || !order.customerPhone) return;
    const phone = order.customerPhone.replace(/\D/g, '');
    const finalPhone = phone.startsWith('91') ? phone : `91${phone}`;
    let message = `Hi ${order.customerName || 'Customer'},\n\nI'm reaching out from *SpinZo* regarding your order *#${orderId.slice(-6).toUpperCase()}*.`;
    if (order.status === 'ready') {
      message += `\n\nYour order is *Packed & Ready*! 🧺\nPlease schedule your delivery slot in the app to receive your fresh clothes.`;
    }
    const url = `whatsapp://send?text=${encodeURIComponent(message)}&phone=${finalPhone}`;
    Linking.openURL(url).catch(() => {
      Linking.openURL(`https://wa.me/${finalPhone}?text=${encodeURIComponent(message)}`);
    });
  };

  const started = !!curStage?.startedAt;
  const completed = !!curStage?.completedAt;

  const statusLabel = !process
    ? order?.status === 'pickup_completed' ? 'Ready to tag' : (order?.status?.replace('_', ' ') || 'Pending')
    : done ? 'Complete' : cur ? stepLabel(cur) : 'No steps';

  const stepArr = process?.steps || [];
  const currentIndex = cur ? stepArr.indexOf(cur) : (done ? stepArr.length : 0);

  // View sections based on stage
  const renderTagging = () => {
    if (garments.count == null) {
      return (
        <View className="bg-white rounded-xl p-5 mb-4 shadow-sm border border-gray-100">
          <Text className="text-gray-900 font-bold mb-4 text-lg">Garment Registration</Text>
          <Text className="text-gray-500 mb-2">How many garments are in this order?</Text>
          <View className="flex-row gap-3">
            <TextInput
              className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-lg font-bold text-gray-900"
              keyboardType="number-pad"
              value={countText}
              onChangeText={setCountText}
              placeholder="e.g. 5"
              editable={!busy}
            />
            <TouchableOpacity
              onPress={handlePrint}
              disabled={busy || !countText.trim()}
              className={`px-6 rounded-xl justify-center ${busy || !countText.trim() ? 'bg-gray-200' : 'bg-[#994bff]'}`}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold">Print Labels</Text>}
            </TouchableOpacity>
          </View>
          {printError && <Text className="text-red-500 text-sm mt-2 font-medium">{printError}</Text>}
        </View>
      );
    }

    const allRegistered = registeredCount === garments.count;

    return (
      <View className="bg-white rounded-xl p-5 mb-4 shadow-sm border border-gray-100">
        <Text className="text-gray-900 font-bold mb-4 text-lg">Garment Scanning</Text>
        
        <View className="flex-row items-center justify-between mb-4 bg-gray-50 p-4 rounded-xl border border-gray-100">
          <View>
            <Text className="text-gray-900 font-bold text-2xl">{registeredCount} / {garments.count}</Text>
            <Text className="text-gray-500 text-xs uppercase tracking-wider">Garments Scanned</Text>
          </View>
          <TouchableOpacity
            onPress={() => setScannerVisible(true)}
            disabled={busy || allRegistered}
            className={`w-14 h-14 rounded-full items-center justify-center ${allRegistered ? 'bg-green-100' : 'bg-[#994bff]'}`}
          >
            <Play size={24} color={allRegistered ? '#22c55e' : '#fff'} />
          </TouchableOpacity>
        </View>

        {scanError && <Text className="text-red-500 text-sm mb-4 font-medium">{scanError}</Text>}

        <View className="flex-row flex-wrap gap-2 mb-6">
          {Array.from({ length: garments.count }).map((_, i) => {
            const seq = i + 1;
            const isScanned = registeredSeqs.includes(seq);
            return (
              <View key={seq} className={`w-12 h-12 rounded-xl items-center justify-center border-2 ${isScanned ? 'bg-green-50 border-green-500' : 'bg-gray-50 border-gray-200'}`}>
                <Text className={`font-bold ${isScanned ? 'text-green-700' : 'text-gray-400'}`}>{seq}</Text>
              </View>
            );
          })}
        </View>

        <TouchableOpacity
          onPress={handleSubmitTagging}
          disabled={busy || !allRegistered}
          className={`h-14 rounded-xl items-center justify-center ${allRegistered && !busy ? 'bg-green-500' : 'bg-gray-200'}`}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text className={`font-bold text-lg ${allRegistered ? 'text-white' : 'text-gray-400'}`}>Submit Tagging</Text>}
        </TouchableOpacity>
      </View>
    );
  };

  const renderActionState = () => {
    if (!process && order?.status === 'pickup_completed') {
      return (
        <View className="bg-white rounded-xl p-5 mb-4 shadow-sm border border-gray-100">
          <Text className="text-gray-900 font-bold mb-2">Ready for Tagging</Text>
          <TouchableOpacity
            onPress={handleClaim}
            disabled={busy}
            className={`h-14 rounded-xl items-center justify-center flex-row ${busy ? 'bg-gray-200' : 'bg-[#994bff]'}`}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-lg">Claim & Start Tagging</Text>}
          </TouchableOpacity>
        </View>
      );
    }

    // If someone else has claimed it and we aren't supervisor, show waiting
    if (cur && curStage?.assignee && !isAssignee) {
      return (
        <View className="bg-gray-50 rounded-xl p-5 mb-4 border border-gray-200 items-center">
          <Text className="text-gray-500 font-bold">In progress by {curStage.assigneeName || 'another worker'}</Text>
        </View>
      );
    }

    if (cur === 'tagging' && (!curStage?.assignee || isAssignee)) {
      if (activeRole && !canStartStage(activeRole as any, cur)) {
        return (
          <View className="bg-gray-50 rounded-xl p-5 mb-4 border border-gray-200 items-center">
            <Text className="text-gray-500 font-bold">Ready for {stepLabel(cur)}.</Text>
            <Text className="text-gray-400 text-xs mt-1">Please switch to the appropriate role to process.</Text>
          </View>
        );
      }
      return renderTagging();
    }

    if (cur && (!curStage?.assignee || isAssignee)) {
      if (activeRole && !canStartStage(activeRole as any, cur)) {
        return (
          <View className="bg-gray-50 rounded-xl p-5 mb-4 border border-gray-200 items-center">
            <Text className="text-gray-500 font-bold">Ready for {stepLabel(cur)}.</Text>
            <Text className="text-gray-400 text-xs mt-1">Please switch to the appropriate role to process.</Text>
          </View>
        );
      }

      // Packaging Verification Flow
      if (cur === 'packaging' && showPackagingVerification) {
        return (
          <PackagingVerification
            orderId={orderId}
            totalGarments={garments.count || 0}
            onPrint={async (bundles: number) => {
              const res = await useOpsProcessStore.getState().printBundleLabels(orderId, bundles);
              if (res.ok && res.labels) {
                try {
                  await printGarmentLabels(res.labels, { orderShort: orderId.slice(-6) });
                } catch (e) {
                  Alert.alert('Printer Error', 'Could not connect to the printer, but labels are recorded. Please print manually later.');
                }
                return true;
              }
              return false;
            }}
            onComplete={async (payload: any) => {
              setShowPackagingVerification(false);
              const res = await useOpsProcessStore.getState().completePackaging(orderId, payload);
              if (res.ok) navigation.goBack();
              else setActionError(friendlyActionError(res.error));
            }}
          />
        );
      }

      const isMachineStep = cur === 'getting_washed' || cur === 'getting_dried';
      const machineIcon = cur === 'getting_washed' ? '🫧' : '☀️';

      return (
        <View className="bg-white rounded-xl p-5 mb-4 shadow-sm border border-gray-100">
          <Text className="text-gray-900 font-bold mb-4">{stepLabel(cur)}</Text>
          {!started ? (
            <View>
              {isMachineStep && !machineStartedLocal ? (
                <TouchableOpacity
                  onPress={() => setMachineStartedLocal(true)}
                  disabled={busy}
                  className="h-14 rounded-xl bg-orange-100 border border-orange-200 items-center justify-center flex-row"
                >
                  <Text className="text-orange-700 font-bold text-lg">Start {stepLabel(cur)}</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={handleStart}
                  disabled={busy}
                  className={`h-14 rounded-xl items-center justify-center flex-row ${busy ? 'bg-gray-200' : 'bg-orange-500'}`}
                >
                  {busy ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-lg">{isMachineStep ? `${machineIcon} Load Machine & Start` : `Start ${stepLabel(cur)}`}</Text>}
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View>
              {isMachineStep && (
                <View className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4 items-center flex-row justify-center">
                  <ActivityIndicator color="#f97316" size="small" className="mr-2" />
                  <Text className="text-orange-700 font-bold">Machine Running</Text>
                </View>
              )}
              <TouchableOpacity
                onPress={handleComplete}
                disabled={busy}
                className={`h-14 rounded-xl items-center justify-center flex-row ${busy ? 'bg-gray-200' : 'bg-green-500'}`}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-lg">{isMachineStep ? '✅ Unload & Complete' : `Complete ${stepLabel(cur)}`}</Text>}
              </TouchableOpacity>
            </View>
          )}
        </View>
      );
    }
    
    if (done) {
      if (activeRole === 'supervisor') {
        if (order?.status === 'ready') {
          return (
            <View className="bg-white rounded-xl p-5 mb-4 border border-gray-200">
              <Text className="text-gray-900 font-bold mb-4">Delivery Dispatch</Text>
              {!order.deliveryDate || !order.deliveryTime ? (
                <Text className="text-gray-500 mb-4 text-sm">Customer has not scheduled delivery yet. You can schedule it from the menu.</Text>
              ) : (
                <Text className="text-gray-600 mb-4 text-sm font-medium">Scheduled for {order.deliveryDate}, {order.deliveryTime}</Text>
              )}
              <View className="flex-row gap-3">
                <TouchableOpacity
                  onPress={() => setShowAssignRiderModal(true)}
                  disabled={busy || !order.deliveryDate || !order.deliveryTime}
                  className={`flex-1 h-14 rounded-xl items-center justify-center ${busy || !order.deliveryDate || !order.deliveryTime ? 'bg-gray-100' : 'bg-blue-50 border border-blue-200'}`}
                >
                  <Text className={`font-bold text-sm ${busy || !order.deliveryDate || !order.deliveryTime ? 'text-gray-400' : 'text-blue-700'}`}>Assign Rider</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleMarkOutForDelivery}
                  disabled={busy || !order.deliveryDate || !order.deliveryTime}
                  className={`flex-1 h-14 rounded-xl items-center justify-center ${busy || !order.deliveryDate || !order.deliveryTime ? 'bg-gray-200' : 'bg-orange-500'}`}
                >
                  {busy ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-sm text-center">Auto-Assign & Dispatch</Text>}
                </TouchableOpacity>
              </View>
            </View>
          );
        } else if (order?.status === 'out_for_delivery') {
          return (
            <View className="bg-white rounded-xl p-5 mb-4 border border-gray-200">
              <Text className="text-gray-900 font-bold mb-4">Verify Delivery OTP</Text>
              <TextInput
                value={otp}
                onChangeText={(t) => setOtp(t.replace(/[^0-9]/g, '').slice(0, 4))}
                keyboardType="number-pad"
                maxLength={4}
                placeholder="••••"
                placeholderTextColor="#94a3b8"
                className="bg-gray-50 border border-gray-200 rounded-xl h-14 px-4 text-center text-xl tracking-[0.5em] text-gray-900 font-bold mb-4"
              />
              <TouchableOpacity
                onPress={handleVerifyDeliveryOTP}
                disabled={busy || otp.length !== 4}
                className={`h-14 rounded-xl items-center justify-center flex-row ${busy || otp.length !== 4 ? 'bg-gray-200' : 'bg-green-500'}`}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-lg">Verify Delivery</Text>}
              </TouchableOpacity>
            </View>
          );
        } else if (order?.status === 'delivered') {
          return (
            <View className="bg-green-50 rounded-xl p-5 mb-4 border border-green-200 items-center">
              <Text className="text-green-700 font-bold text-lg">Order Delivered</Text>
            </View>
          );
        }
      }

      return (
        <View className="bg-green-50 rounded-xl p-5 mb-4 border border-green-200 items-center">
          <Text className="text-green-700 font-bold text-lg">Order Processing Complete</Text>
        </View>
      );
    }

    return (
      <View className="bg-gray-50 rounded-xl p-5 mb-4 border border-gray-200 items-center">
        <Text className="text-gray-500 font-bold">Waiting for {cur ? stepLabel(cur) : 'next step'}</Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-gray-50">
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        {/* Header */}
        <View className="flex-row items-center justify-between mb-4 z-10">
          <TouchableOpacity onPress={() => navigation.goBack()} className="w-10 h-10 rounded-full bg-white items-center justify-center shadow-sm border border-gray-100">
            <X size={20} color="#64748b" />
          </TouchableOpacity>
          <View className="items-center">
            <View className="flex-row items-center gap-2">
              <Text className="text-gray-900 font-bold text-lg">#{orderId.slice(-6).toUpperCase()}</Text>
              {!!process?.tokenNumber && (
                <View className="bg-amber-100 px-2 py-0.5 rounded border border-amber-200">
                  <Text className="text-amber-800 font-bold text-xs">T-{process.tokenNumber}</Text>
                </View>
              )}
            </View>
            {process && <WorkflowSteps steps={stepArr} currentIndex={currentIndex} />}
          </View>
          <View className="flex-row gap-2 items-center">
            <View className={`rounded-full px-3 py-1 border justify-center h-8 ${done ? 'bg-green-50 border-green-200' : 'bg-purple-50 border-purple-200'}`}>
              <Text className={`text-xs font-bold ${done ? 'text-green-700' : 'text-purple-700'}`}>{statusLabel}</Text>
            </View>
            {activeRole === 'supervisor' && (
              <TouchableOpacity onPress={() => setShowMenu(!showMenu)} className="w-10 h-10 rounded-full bg-white items-center justify-center shadow-sm border border-gray-100">
                <MoreHorizontal size={20} color="#64748b" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {showMenu && activeRole === 'supervisor' && (
          <View className="absolute top-16 right-5 bg-white rounded-xl shadow-lg border border-gray-100 z-50 overflow-hidden w-48">
            {(order?.status === 'placed' || order?.status === 'confirmed' || order?.status === 'ready') && (
              <TouchableOpacity onPress={() => { setShowMenu(false); setShowRescheduleModal(true); }} className="p-4 border-b border-gray-100 flex-row items-center">
                <Calendar size={16} color="#64748b" className="mr-3" />
                <Text className="text-gray-700 font-medium">{order?.status === 'ready' ? 'Schedule Delivery' : 'Reschedule Pickup'}</Text>
              </TouchableOpacity>
            )}
            {(order?.status === 'placed' || order?.status === 'confirmed') && (
              <TouchableOpacity onPress={() => { setShowMenu(false); setShowAssignRiderModal(true); }} className="p-4 border-b border-gray-100 flex-row items-center">
                <UserPlus size={16} color="#3b82f6" className="mr-3" />
                <Text className="text-blue-700 font-medium">Assign Rider</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => { setShowMenu(false); handleWhatsApp(); }} className="p-4 border-b border-gray-100 flex-row items-center">
              <MessageCircle size={16} color="#22c55e" className="mr-3" />
              <Text className="text-green-600 font-medium">WhatsApp</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setShowMenu(false); setShowCancelModal(true); }} className="p-4 flex-row items-center">
              <AlertCircle size={16} color="#ef4444" className="mr-3" />
              <Text className="text-red-600 font-medium">Cancel Order</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Enhanced Customer Info for Supervisor */}
        <View className="mb-6 bg-white p-5 rounded-xl shadow-sm border border-gray-100 z-0">
          <View className="items-center mb-4">
            <Text className="text-gray-900 text-lg font-bold">{order?.customerName || 'Unknown customer'}</Text>
            <Text className="text-gray-500 text-sm mt-1">{order ? serviceSummary(order) : '—'}</Text>
          </View>
          
          {activeRole === 'supervisor' && order && (
            <View className="border-t border-gray-100 pt-4 mt-2">
              <View className="flex-row items-center mb-3">
                <View className="w-8 h-8 rounded-full bg-purple-50 items-center justify-center mr-3">
                  <Phone size={14} color="#994bff" />
                </View>
                <TouchableOpacity onPress={() => Linking.openURL(`tel:${order.customerPhone}`)}>
                  <Text className="text-gray-900 font-medium">{order.customerPhone}</Text>
                  <Text className="text-gray-500 text-xs">Tap to call</Text>
                </TouchableOpacity>
              </View>
              
              {order.storeOTP ? (
                <View className="flex-row items-center mb-3">
                  <View className="w-8 h-8 rounded-full bg-blue-50 items-center justify-center mr-3">
                    <Text className="text-blue-500 font-bold text-xs">OTP</Text>
                  </View>
                  <View>
                    <Text className="text-gray-900 font-bold tracking-widest">{order.storeOTP}</Text>
                    <Text className="text-gray-500 text-xs">Store Handover OTP (For Rider)</Text>
                  </View>
                </View>
              ) : null}
              
              <View className="flex-row items-center mb-3">
                <View className="w-8 h-8 rounded-full bg-purple-50 items-center justify-center mr-3">
                  <MapPin size={14} color="#994bff" />
                </View>
                <View className="flex-1">
                  <Text className="text-gray-900 font-medium leading-tight">
                    {typeof order.address === 'string' ? order.address : (order.address?.formattedAddress || order.address?.line1 || 'No address')}
                  </Text>
                </View>
              </View>

              <View className="bg-gray-50 rounded-lg p-3 mt-2">
                <Text className="text-xs font-bold text-gray-500 uppercase mb-2">Item Breakdown</Text>
                {order.items?.map((item: any, idx: number) => (
                  <View key={idx} className="flex-row justify-between mb-1">
                    <Text className="text-gray-700 text-sm">{item.quantity}x {item.name || item.serviceType}</Text>
                    <Text className="text-gray-500 text-sm">₹{item.price}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>

        {!!actionError && (
          <View className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 flex-row items-center gap-2">
            <AlertCircle color="#ef4444" size={20} />
            <Text className="text-red-600 font-medium flex-1">{actionError}</Text>
          </View>
        )}

        {renderActionState()}
        
        {/* Timeline */}
        {process && (
          <View className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 mt-2">
            <Text className="text-gray-900 font-bold mb-4">Timeline</Text>
            {opsTimeline(process).filter(e => e.startedAt || e.completedAt).map((event, idx, arr) => {
              const ts = event.completedAt || event.startedAt;
              const ms = ts ? ((ts as any).toMillis?.() || (ts as any).seconds * 1000 || (ts as any)._seconds * 1000 || (typeof ts === 'number' ? ts : 0)) : 0;
              const dateStr = ms ? new Date(ms).toLocaleString() : '';
              
              return (
                <View key={idx} className="flex-row mb-4">
                  <View className="items-center mr-4">
                    <View className={`w-3 h-3 rounded-full ${event.completedAt ? 'bg-green-500' : 'bg-orange-400'}`} />
                    {idx < arr.length - 1 && <View className="w-0.5 h-full bg-gray-200 my-1" />}
                  </View>
                  <View className="flex-1 pb-2">
                    <Text className="text-gray-900 font-medium">{event.label}</Text>
                    {dateStr ? <Text className="text-gray-500 text-xs mt-1">{dateStr}</Text> : null}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <QRScanner 
        visible={scannerVisible} 
        onClose={() => setScannerVisible(false)} 
        onScan={handleScan}
        actionType="Garment Label"
      />
      
      {order && (
        <>
          <CancelOrderModal 
            visible={showCancelModal}
            onClose={() => setShowCancelModal(false)}
            onConfirm={handleCancelOrder}
            orderId={orderId}
          />
          <RescheduleModal
            visible={showRescheduleModal}
            onClose={() => setShowRescheduleModal(false)}
            onConfirm={handleReschedule}
            title={order.status === 'ready' ? 'Schedule Delivery' : 'Reschedule Pickup'}
          />
          <AssignRiderModal
            visible={showAssignRiderModal}
            onClose={() => setShowAssignRiderModal(false)}
            orderId={orderId}
            isDelivery={order?.status === 'ready'}
            onAssign={async (riderId) => {
              const res = await useOpsProcessStore.getState().assignTaskToRider(orderId, order?.userId || '', riderId, order?.status === 'ready');
              if (!res.ok) setActionError(friendlyActionError(res.error));
            }}
          />
        </>
      )}


    </KeyboardAvoidingView>
  );
}
