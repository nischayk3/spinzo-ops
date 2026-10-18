import React, { useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Modal, Image } from 'react-native';
import { X, Play, AlertCircle, MoreHorizontal, Calendar, Phone, MapPin, MessageCircle, UserPlus, Navigation, Undo2, Droplets, Sun, Check, Shirt, Camera, Clock, CheckCircle2, Eye, Lock } from 'lucide-react-native';
import { Linking, Alert } from 'react-native';
import { QRScanner } from '../../components/QRScanner';
import { CancelOrderModal } from '../../components/Supervisor/CancelOrderModal';
import { RescheduleModal } from '../../components/Supervisor/RescheduleModal';
import { AssignRiderModal } from '../../components/Supervisor/AssignRiderModal';
import { AssignHelperModal } from '../../components/Supervisor/AssignHelperModal';
import { ReturnDeliveryModal, ReturnDeliveryOptions } from '../../components/Supervisor/ReturnDeliveryModal';
import { EmergencyOverrideModal } from '../../components/Supervisor/EmergencyOverrideModal';
import { ResetMachineCycleModal } from '../../components/Supervisor/ResetMachineCycleModal';
import { useAuthStore } from '../../store/authStore';
import { useOpsProcessStore, OpsProcessingResult } from '../../store/opsProcessStore';
import { useOpsStaffStore } from '../../store/opsStaffStore';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { serviceSummary, orderTotal, parseOrderTokens, formatItemSummary, slotLabel } from '../../utils/orderFeed';
import { currentStep, isDone, stage, stepLabel, GarmentsRecord } from '../../utils/opsProcess';
import { opsTimeline } from '../../utils/opsTimeline';
import { printGarmentLabels } from '../../utils/labelPrint';
import { canStartStage } from './ProcessingScreen';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { PackagingVerification } from '../../components/PackagingVerification';
import { WorkflowSteps } from '../../components/WorkflowSteps';
import { useStoreResourcesStore } from '../../store/storeResourcesStore';
import { useResponsive } from '../../utils/useResponsive';

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
    payment_required: 'This order is unpaid. The customer must pay in the SpinZo app before completing delivery.',
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

const fmtDT = (v: any): string => {
  if (!v) return '—';
  let ms: number;
  if (typeof v === 'number') ms = v;
  else if (typeof v.toMillis === 'function') ms = v.toMillis();
  else if (typeof v.seconds === 'number') ms = v.seconds * 1000;
  else ms = new Date(v).getTime();
  if (!ms || Number.isNaN(ms)) return '—';
  return new Date(ms).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

function WasherCycleMonitor({
  startedAt,
  detergentAddedAt,
  softenerAddedAt,
  onAddDetergent,
  onAddSoftener,
}: {
  startedAt: any;
  detergentAddedAt?: any;
  softenerAddedAt?: any;
  onAddDetergent: () => Promise<void>;
  onAddSoftener: () => Promise<void>;
}) {
  const [now, setNow] = useState(Date.now());
  const [addingDetergent, setAddingDetergent] = useState(false);
  const [addingSoftener, setAddingSoftener] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const startMs = typeof startedAt?.toMillis === 'function'
    ? startedAt.toMillis()
    : startedAt?.seconds
    ? startedAt.seconds * 1000
    : new Date(startedAt).getTime();

  const elapsedMs = Math.max(0, now - startMs);
  const elapsedSec = Math.floor(elapsedMs / 1000);
  const totalSec = 35 * 60; // 2100 seconds
  const progressPercent = Math.min(100, Math.round((elapsedSec / totalSec) * 100));

  const formatMinSec = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const isDetergentDue = elapsedSec >= 780 && !detergentAddedAt;
  const isSoftenerDue = elapsedSec >= 1260 && !softenerAddedAt;
  const isWashComplete = elapsedSec >= 2100;

  const handleDetergent = async () => {
    setAddingDetergent(true);
    try {
      await onAddDetergent();
    } finally {
      setAddingDetergent(false);
    }
  };

  const handleSoftener = async () => {
    setAddingSoftener(true);
    try {
      await onAddSoftener();
    } finally {
      setAddingSoftener(false);
    }
  };

  return (
    <View className="mb-4 bg-purple-50/60 rounded-2xl p-4 border border-purple-100 shadow-sm">
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center gap-2">
          <Droplets size={18} color="#994bff" />
          <Text className="text-gray-900 font-bold text-sm">35-Min Wash Cycle</Text>
        </View>
        <Text className="text-[#994bff] font-black text-base">{formatMinSec(elapsedSec)} / 35:00</Text>
      </View>

      {/* Progress Bar */}
      <View className="h-2.5 bg-gray-200 rounded-full overflow-hidden mb-4">
        <View
          className="h-full bg-[#994bff] rounded-full"
          style={{ width: `${progressPercent}%` }}
        />
      </View>

      {/* Milestones Info Grid */}
      <View className="gap-2.5">
        {/* Detergent milestone @ 13 min */}
        <View className={`p-3 rounded-xl border ${isDetergentDue ? 'bg-amber-50 border-amber-300 shadow-sm' : detergentAddedAt ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-gray-100'}`}>
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2 flex-1 mr-2">
              <View className={`w-7 h-7 rounded-full items-center justify-center ${detergentAddedAt ? 'bg-emerald-100' : isDetergentDue ? 'bg-amber-100' : 'bg-gray-100'}`}>
                <Text className="text-xs font-bold text-gray-700">13m</Text>
              </View>
              <View className="flex-1">
                <Text className="text-gray-900 font-bold text-xs">Detergent (13 Min)</Text>
                <Text className="text-gray-500 text-[11px]">
                  {detergentAddedAt
                    ? 'Added to washer'
                    : isDetergentDue
                    ? 'Due right now! Add detergent'
                    : `Due in ${Math.max(1, Math.ceil((780 - elapsedSec) / 60))} min`}
                </Text>
              </View>
            </View>

            {detergentAddedAt ? (
              <View className="bg-emerald-100 px-2.5 py-1 rounded-full flex-row items-center gap-1">
                <Check size={12} color="#059669" />
                <Text className="text-emerald-700 font-bold text-xs">Added</Text>
              </View>
            ) : isDetergentDue ? (
              <TouchableOpacity
                onPress={handleDetergent}
                disabled={addingDetergent}
                className="bg-amber-500 px-3 py-1.5 rounded-lg active:scale-95"
              >
                {addingDetergent ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text className="text-white font-bold text-xs">Mark Added ✓</Text>
                )}
              </TouchableOpacity>
            ) : (
              <Text className="text-gray-400 text-xs font-medium">Pending</Text>
            )}
          </View>
        </View>

        {/* Softener milestone @ 21 min */}
        <View className={`p-3 rounded-xl border ${isSoftenerDue ? 'bg-purple-50 border-purple-300 shadow-sm' : softenerAddedAt ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-gray-100'}`}>
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2 flex-1 mr-2">
              <View className={`w-7 h-7 rounded-full items-center justify-center ${softenerAddedAt ? 'bg-emerald-100' : isSoftenerDue ? 'bg-purple-100' : 'bg-gray-100'}`}>
                <Text className="text-xs font-bold text-gray-700">21m</Text>
              </View>
              <View className="flex-1">
                <Text className="text-gray-900 font-bold text-xs">Fabric Softener (21 Min)</Text>
                <Text className="text-gray-500 text-[11px]">
                  {softenerAddedAt
                    ? 'Added to washer'
                    : isSoftenerDue
                    ? 'Due right now! Add softener'
                    : `Due in ${Math.max(1, Math.ceil((1260 - elapsedSec) / 60))} min`}
                </Text>
              </View>
            </View>

            {softenerAddedAt ? (
              <View className="bg-emerald-100 px-2.5 py-1 rounded-full flex-row items-center gap-1">
                <Check size={12} color="#059669" />
                <Text className="text-emerald-700 font-bold text-xs">Added</Text>
              </View>
            ) : isSoftenerDue ? (
              <TouchableOpacity
                onPress={handleSoftener}
                disabled={addingSoftener}
                className="bg-[#994bff] px-3 py-1.5 rounded-lg active:scale-95"
              >
                {addingSoftener ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text className="text-white font-bold text-xs">Mark Added ✓</Text>
                )}
              </TouchableOpacity>
            ) : (
              <Text className="text-gray-400 text-xs font-medium">Pending</Text>
            )}
          </View>
        </View>

        {/* Cycle completion banner @ 35 min */}
        {isWashComplete && (
          <View className="bg-emerald-50 border border-emerald-300 p-3 rounded-xl flex-row items-center gap-2">
            <Check size={16} color="#059669" />
            <Text className="text-emerald-800 font-bold text-xs flex-1">
              35-minute wash cycle completed! Ready to unload and move to dryer.
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

export function OrderDetailScreen({ route, navigation }: Props) {
  const { orderId, processId: initialProcessId } = route.params;
  const user = useAuthStore(s => s.user);
  const activeRole = useAuthStore(s => s.activeRole);
  const orders = useOrderFeedStore(s => s.orders);
  const { processes, claim, startStep, completeStep, printLabels, scanGarment, tagAllGarments, unregisterGarment, submitTagging, cancelOrder, reschedulePickup, scheduleDelivery, markOutForDelivery, verifyDeliveryOTP } = useOpsProcessStore();
  const { clearActiveHelperTask } = useOpsStaffStore();
  const resources = useStoreResourcesStore(s => s.resources);
  const { isDesktop, modalContainerStyle } = useResponsive();

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
  
  // Get all processes for this order
  const orderProcesses = useMemo(() => processes.filter(p => p.orderId === orderId), [processes, orderId]);
  
  // Track selected process ID
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);

  // Initialize selected process on load
  useEffect(() => {
    if (orderProcesses.length > 0 && !selectedProcessId) {
      setSelectedProcessId(initialProcessId || orderProcesses[0].id);
    }
  }, [orderProcesses, selectedProcessId, initialProcessId]);

  // The active process
  const process = useMemo(() => orderProcesses.find(p => p.id === selectedProcessId) || null, [orderProcesses, selectedProcessId]);

  const cur = process ? currentStep(process) : null;
  const curStage = cur ? stage(process!, cur) : undefined;
  const staffDoc = useOpsStaffStore(s => s.staffDoc);
  const isSupervisor = activeRole === 'supervisor' || activeRole === 'admin' || staffDoc?.role === 'supervisor' || staffDoc?.role === 'admin';
  const isAssignee = isSupervisor || (curStage?.assignee === user?.id);

  // If the stage is changed/completed, reset the local state
  useEffect(() => {
    setMachineStartedLocal(false);
  }, [cur]);

  const [showPackagingVerification, setShowPackagingVerification] = useState(false);
  
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [showAssignRiderModal, setShowAssignRiderModal] = useState(false);
  const [showAssignHelperModal, setShowAssignHelperModal] = useState(false);
  const [showReturnDeliveryModal, setShowReturnDeliveryModal] = useState(false);
  const [showEmergencyOverrideModal, setShowEmergencyOverrideModal] = useState(false);
  const [showResetMachineModal, setShowResetMachineModal] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);


  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const done = process ? isDone(process) : false;
  const garments: GarmentsRecord = process?.garments || {};
  const registered = garments?.registered;
  const registeredKey = useMemo(() => {
    if (!registered || !Array.isArray(registered)) return '';
    return registered.map((r: any) => (typeof r === 'number' ? r : r.seq)).sort((a, b) => a - b).join(',');
  }, [registered]);

  const registeredSeqs = useMemo(() => {
    if (!registered || !Array.isArray(registered)) return [];
    return registered.map((r: any) => (typeof r === 'number' ? r : r.seq));
  }, [registeredKey]);

  const [optimisticSeqs, setOptimisticSeqs] = useState<number[]>([]);
  const optimisticSeqsRef = useRef<number[]>([]);

  useEffect(() => {
    setOptimisticSeqs(prev => {
      const hasNew = registeredSeqs.some(s => !prev.includes(s));
      if (!hasNew) {
        return prev; // Prevents re-render and infinite update depth loop
      }
      const merged = Array.from(new Set([...registeredSeqs, ...prev]));
      optimisticSeqsRef.current = merged;
      return merged;
    });
  }, [registeredKey]);

  const effectiveRegisteredSeqs = useMemo(() => Array.from(new Set([...registeredSeqs, ...optimisticSeqs])), [registeredKey, optimisticSeqs]);
  const effectiveCount = effectiveRegisteredSeqs.length;
  const registeredCount = effectiveCount;

  const isCurrentMachineStep = cur === 'getting_washed' || cur === 'getting_dried';
  const cycleStartedAtMs = curStage?.startedAt
    ? (typeof (curStage.startedAt as any).toMillis === 'function'
        ? (curStage.startedAt as any).toMillis()
        : new Date((curStage.startedAt as any)).getTime())
    : 0;
  const machineElapsedSec = cycleStartedAtMs > 0 ? Math.floor((Date.now() - cycleStartedAtMs) / 1000) : 0;
  const isCycleLocked = isCurrentMachineStep && machineElapsedSec < 1800;
  const cycleLockMinLeft = Math.max(1, Math.ceil((1800 - machineElapsedSec) / 60));

  const packagingPhotos = useMemo(() => {
    const list: string[] = [];
    const fromOrder = order?.packagingPhotos || order?.qualityPhotos || order?.opsDetails?.packagingPhotos || order?.opsDetails?.qualityPhotos;
    if (Array.isArray(fromOrder)) {
      list.push(...fromOrder);
    } else if (typeof fromOrder === 'string') {
      list.push(fromOrder);
    }
    const fromProcess = process?.stages?.packaging?.qualityProof?.photos;
    if (Array.isArray(fromProcess)) {
      fromProcess.forEach(p => {
        if (p && !list.includes(p)) list.push(p);
      });
    }
    const fromProofUrl = order?.proofUrl;
    if (fromProofUrl && !list.includes(fromProofUrl)) {
      list.push(fromProofUrl);
    }
    return list;
  }, [order, process]);

  const bundlesCount = order?.opsDetails?.packagingProof?.bundles ?? order?.packagingProof?.bundles ?? process?.stages?.packaging?.qualityProof?.bundles;
  const garmentCountDisplay = process?.garments?.count ?? order?.garmentCount ?? order?.opsDetails?.garmentCount;
  const isTaggingDone = (process?.currentIndex ?? 0) > 0 || process?.status === 'done' || (order?.status !== 'placed' && order?.status !== 'confirmed' && order?.status !== 'in_transit_to_store');

  const timelineEvents = useMemo(() => {
    if (process) {
      const raw = opsTimeline(process);
      const activeOrDone = raw.filter(e => e.startedAt || e.completedAt || e.queuedAt);
      if (activeOrDone.length > 0) return activeOrDone;
    }
    const timings = order?.stageTimings || order?.opsDetails?.stageTimings;
    if (!timings) return [];
    const standardSteps = ['tagging', 'getting_washed', 'drying', 'ironing', 'packaging'];
    const keys = Object.keys(timings);
    const orderedSteps = standardSteps.filter(s => keys.includes(s));
    keys.forEach(k => {
      if (!orderedSteps.includes(k)) orderedSteps.push(k);
    });
    return orderedSteps.map(step => {
      const s = timings[step] || {};
      return {
        step,
        label: stepLabel(step),
        assigneeName: s.assigneeName,
        queuedAt: s.queuedAt,
        acceptedAt: s.acceptedAt,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        durationMs: s.durationMs,
        acceptToCompleteMin: s.acceptToCompleteMin,
        startToCompleteMin: s.startToCompleteMin,
        detergentAddedAt: s.detergentAddedAt,
        softenerAddedAt: s.softenerAddedAt,
        skipped: false,
        reached: true,
      };
    });
  }, [process, order]);


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

  const handleClaim = () => runAction(() => claim(orderId, order?.tokenNumber || '', order?.userId, order?.vendorId));
  const handleStart = () => runAction(() => startStep(orderId, process?.id), () => clearActiveHelperTask());
  const handleComplete = () => {
    // Quality and Packaging verification required for packaging step

    if (cur === 'packaging' && !showPackagingVerification) {
      setShowPackagingVerification(true);
      return;
    }
    runAction(() => completeStep(orderId, process?.id), () => {
      clearActiveHelperTask();
      navigation.goBack();
    });
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
      const res = await printLabels(orderId, n, process?.id);
      if (res.ok) {
        // Physical label printing popup disabled per user request so scanning starts immediately
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
    setScanError(null);
    setActionError(null);

    const totalCount = garments?.count || 0;
    if (totalCount === 0) return;

    const currentAssigned = optimisticSeqsRef.current;
    if (currentAssigned.length >= totalCount) {
      setScannerVisible(false);
      return;
    }

    let targetSeq: number | undefined;
    if (typeof data === 'string' && data.startsWith(`SPNZ:${orderId}:`)) {
      const parts = data.split(':');
      const parsed = parseInt(parts[2], 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= totalCount) {
        if (!currentAssigned.includes(parsed)) {
          targetSeq = parsed;
        } else {
          return;
        }
      }
    }

    // Dummy QR fallback: pick the first un-assigned sequence number
    if (!targetSeq) {
      targetSeq = Array.from({ length: totalCount })
        .map((_, i) => i + 1)
        .find(seq => !currentAssigned.includes(seq));
    }

    if (!targetSeq) {
      setScannerVisible(false);
      return;
    }

    // Optimistically update immediately
    const nextAssigned = [...currentAssigned, targetSeq];
    optimisticSeqsRef.current = nextAssigned;
    setOptimisticSeqs(nextAssigned);

    if (nextAssigned.length >= totalCount) {
      setTimeout(() => setScannerVisible(false), 500);
    }

    // Dispatch scanGarment in background without blocking camera frame rate
    const expectedQr = `SPNZ:${orderId}:${targetSeq}`;
    scanGarment(orderId, expectedQr, process?.id).then(res => {
      if (!res.ok && res.error !== 'already_registered') {
        optimisticSeqsRef.current = optimisticSeqsRef.current.filter((s: number) => s !== targetSeq);
        setOptimisticSeqs(optimisticSeqsRef.current);
        setScanError(friendlyScanError(res.error));
      }
    }).catch(err => {
      console.warn('scanGarment error:', err);
    });
  };

  const handleTagAll = async () => {
    const totalCount = garments?.count || 0;
    if (totalCount === 0) return;
    const all = Array.from({ length: totalCount }, (_, i) => i + 1);
    optimisticSeqsRef.current = all;
    setOptimisticSeqs(all);
    setScannerVisible(false);

    try {
      const res = await tagAllGarments(orderId, process?.id);
      if (!res.ok) {
        const missing = all.filter((s: number) => !registeredSeqs.includes(s));
        for (const seq of missing) {
          await scanGarment(orderId, `SPNZ:${orderId}:${seq}`, process?.id);
        }
      }
    } catch (e) {
      console.warn('tagAllGarments failed', e);
    }
  };

  const handleToggleGarment = async (seq: number) => {
    if (effectiveRegisteredSeqs.includes(seq)) {
      optimisticSeqsRef.current = optimisticSeqsRef.current.filter((s: number) => s !== seq);
      setOptimisticSeqs(optimisticSeqsRef.current);
      await unregisterGarment(orderId, seq, process?.id);
    } else {
      const nextAssigned = [...optimisticSeqsRef.current, seq];
      optimisticSeqsRef.current = nextAssigned;
      setOptimisticSeqs(nextAssigned);
      await scanGarment(orderId, `SPNZ:${orderId}:${seq}`, process?.id);
    }
  };

  const handleSubmitTagging = () => runAction(() => submitTagging(orderId, process?.id), () => {
    clearActiveHelperTask();
    navigation.goBack();
  });

  const handleCancelOrder = async (reason: string, note: string) => {
    if (!order) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await cancelOrder(orderId, order.userId, reason, note);
      if (!res.ok) setActionError(friendlyActionError(res.error));
      else {
        setActionSuccess("Order cancelled successfully.");
        setTimeout(() => setActionSuccess(null), 5000);
      }
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
      else {
        setActionSuccess(`${isDelivery ? 'Delivery' : 'Pickup'} rescheduled successfully.`);
        setTimeout(() => setActionSuccess(null), 5000);
      }
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
      else {
        setActionSuccess("Delivery verified successfully.");
        setTimeout(() => setActionSuccess(null), 5000);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleUnassignPickup = async () => {
    setBusy(true);
    try {
      const res = await useOpsProcessStore.getState().unassignPickup(orderId, order?.userId || '');
      setBusy(false);
      if (!res.ok) setActionError(friendlyActionError(res.error || 'unknown'));
    } catch (e: any) {
      setBusy(false);
      setActionError(friendlyActionError(e?.message || 'request_failed'));
    }
  };

  const handleUnassignDelivery = () => {
    setShowReturnDeliveryModal(true);
  };

  const handleConfirmReturnDelivery = async (options: ReturnDeliveryOptions) => {
    setBusy(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const targetUserId = order?.userId || orderProcesses[0]?.userId || '';
      const res = await useOpsProcessStore.getState().unassignDelivery(orderId, targetUserId, options);
      setBusy(false);
      if (!res.ok) {
        const msg = friendlyActionError(res.error || 'unknown');
        setActionError(msg);
        throw new Error(msg);
      } else {
        const successMsg = options.resetSlot
          ? 'Order unassigned and returned to Store Ready Rack (slot reset for reschedule).'
          : 'Order unassigned and returned to Store Ready Rack.';
        setActionSuccess(successMsg);
        setTimeout(() => setActionSuccess(null), 5000);
      }
    } catch (e: any) {
      setBusy(false);
      const msg = friendlyActionError(e?.message || 'request_failed');
      setActionError(msg);
      throw new Error(msg);
    }
  };

  const handleUnassignHelper = async (clearStartedAt = false) => {
    if (!process || !order) return;
    setBusy(true);
    try {
      const res = await useOpsProcessStore.getState().unassignStep(order.id, process.id, order.userId || '', clearStartedAt);
      setBusy(false);
      if (!res.ok) setActionError(friendlyActionError(res.error || 'unknown'));
    } catch (e: any) {
      setBusy(false);
      setActionError(friendlyActionError(e?.message || 'request_failed'));
    }
  };

  const handleUndoMachineStart = () => {
    if (!process || !order) return;
    setShowResetMachineModal(true);
  };

  const handleConfirmResetMachine = async () => {
    await handleUnassignHelper(true);
    setActionSuccess('Machine cycle reset. Order moved back to queue.');
    setTimeout(() => setActionSuccess(null), 5000);
  };

  const handleConfirmEmergencyOverride = async (reason: string) => {
    await handleComplete();
    setActionSuccess(`Emergency override executed (${reason}). Cycle completed.`);
    setTimeout(() => setActionSuccess(null), 5000);
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

  const isMachineCapacityFull = useMemo(() => {
    if (!cur || (cur !== 'getting_washed' && cur !== 'getting_dried' && cur !== 'getting_ironed')) return false;
    const isWash = cur === 'getting_washed';
    const isDry = cur === 'getting_dried';
    const maxCapacity = isWash ? resources.washers : isDry ? resources.dryers : resources.ironingStations;
    const running = processes.filter(
      p => currentStep(p) === cur && !!p.stages?.[cur]?.startedAt && !p.stages?.[cur]?.completedAt && p.orderId !== orderId
    ).length;
    return running >= maxCapacity;
  }, [cur, processes, resources, orderId]);

  const machineBadge = useMemo(() => {
    if (curStage?.machineName) return curStage.machineName;
    if (!cur || (cur !== 'getting_washed' && cur !== 'getting_dried')) return null;
    const isWash = cur === 'getting_washed';
    const names = isWash
      ? (resources.washerNames || ['Washer 1', 'Washer 2'])
      : (resources.dryerNames || ['Dryer 1', 'Dryer 2']);

    const runningForStep = processes
      .filter(p => currentStep(p) === cur && !!p.stages?.[cur]?.startedAt && !p.stages?.[cur]?.completedAt)
      .sort((a, b) => {
        const aStart = a.stages?.[cur]?.startedAt;
        const bStart = b.stages?.[cur]?.startedAt;
        const aMs = typeof (aStart as any)?.toMillis === 'function' ? (aStart as any).toMillis() : new Date((aStart as any) || 0).getTime();
        const bMs = typeof (bStart as any)?.toMillis === 'function' ? (bStart as any).toMillis() : new Date((bStart as any) || 0).getTime();
        return aMs - bMs;
      });

    if (started) {
      const idx = runningForStep.findIndex(p => p.orderId === orderId);
      const assignedName = names[idx >= 0 ? idx : 0] || (isWash ? 'Washer' : 'Dryer');
      return assignedName;
    } else {
      const freeIdx = runningForStep.length;
      if (freeIdx >= names.length) {
        return 'All in Use';
      }
      const nextMachine = names[freeIdx] || names[0];
      return nextMachine;
    }
  }, [cur, started, processes, orderId, resources]);

  const statusLabel = !process
    ? order?.status === 'pickup_completed' ? 'Ready to tag' : (order?.status?.replace('_', ' ') || 'Pending')
    : done ? 'Complete' : cur ? stepLabel(cur) : 'No steps';

  const stepArr = process?.steps || [];
  const currentIndex = cur ? stepArr.indexOf(cur) : (done ? stepArr.length : 0);

  // View sections based on stage
  const renderTagging = () => {
    if (garments?.count == null) {
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
              {busy ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold">Save & Start Scan</Text>}
            </TouchableOpacity>
          </View>
          {printError && <Text className="text-red-500 text-sm mt-2 font-medium">{printError}</Text>}
        </View>
      );
    }

    const allRegistered = (garments?.count || 0) > 0 && effectiveCount >= (garments?.count || 0);

    return (
      <View className="bg-white rounded-xl p-5 mb-4 shadow-sm border border-gray-100">
        <Text className="text-gray-900 font-bold mb-4 text-lg">Garment Scanning</Text>
        
        <View className="flex-row items-center justify-between mb-4 bg-gray-50 p-4 rounded-xl border border-gray-100">
          <View>
            <Text className="text-gray-900 font-bold text-2xl">{effectiveCount} / {garments?.count ?? 0}</Text>
            <Text className="text-gray-500 text-xs uppercase tracking-wider">Garments Scanned</Text>
          </View>
          <View className="flex-row items-center gap-2">
            {!allRegistered && (
              <TouchableOpacity
                onPress={handleTagAll}
                disabled={busy}
                className="px-3 py-2.5 rounded-xl bg-purple-50 border border-purple-200 active:bg-purple-100"
              >
                <Text className="text-purple-700 font-bold text-xs">⚡ Tag All</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => setScannerVisible(true)}
              disabled={busy || allRegistered}
              className={`w-12 h-12 rounded-full items-center justify-center ${allRegistered ? 'bg-green-100' : 'bg-[#994bff]'}`}
            >
              <Play size={20} color={allRegistered ? '#22c55e' : '#fff'} />
            </TouchableOpacity>
          </View>
        </View>

        {scanError && <Text className="text-red-500 text-sm mb-4 font-medium">{scanError}</Text>}

        <View className="flex-row flex-wrap gap-2 mb-6">
          {Array.from({ length: garments?.count || 0 }).map((_, i) => {
            const seq = i + 1;
            const isScanned = effectiveRegisteredSeqs.includes(seq);
            return (
              <TouchableOpacity 
                key={seq} 
                onPress={() => handleToggleGarment(seq)}
                disabled={busy}
                className={`w-12 h-12 rounded-xl items-center justify-center border-2 active:opacity-75 ${isScanned ? 'bg-green-50 border-green-500' : 'bg-gray-50 border-gray-200'}`}
              >
                <Text className={`font-bold ${isScanned ? 'text-green-700' : 'text-gray-400'}`}>{seq}</Text>
              </TouchableOpacity>
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
      const isSupervisor = activeRole === 'supervisor' || activeRole === 'admin';
      return (
        <View className="bg-white rounded-xl p-5 mb-4 shadow-sm border border-gray-100">
          <Text className="text-gray-900 font-bold mb-3 text-base">Ready for Tagging</Text>
          <View className="flex-col gap-3">
            <TouchableOpacity
              onPress={handleClaim}
              disabled={busy}
              className={`h-14 rounded-xl items-center justify-center flex-row ${busy ? 'bg-gray-200' : 'bg-[#994bff]'}`}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-lg">Claim & Start Tagging</Text>}
            </TouchableOpacity>
            {isSupervisor && (
              <TouchableOpacity
                onPress={() => setShowAssignHelperModal(true)}
                disabled={busy}
                className="h-12 rounded-xl items-center justify-center flex-row border border-[#994bff] bg-purple-50"
              >
                <UserPlus size={18} color="#994bff" className="mr-2" />
                <Text className="text-[#994bff] font-bold text-base">Assign to Helper</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      );
    }

    // Supervisor controls for assigning / unassigning
    const renderSupervisorControls = () => {
      if (activeRole !== 'supervisor') return null;
      if (!cur) return null;
      
      const hasAssignee = !!curStage?.assignee;
      const isMachine = cur === 'getting_washed' || cur === 'getting_dried' || cur === 'getting_ironed';
      
      return (
        <View className="mb-4 bg-gray-50 p-3 rounded-lg border border-gray-200">
          <Text className="text-gray-500 font-bold mb-2 text-xs uppercase tracking-widest">Supervisor Action</Text>
          {hasAssignee ? (
            <View className="flex-row items-center justify-between flex-wrap gap-2">
              <Text className="text-gray-700 font-bold text-sm">Assigned to: {curStage.assigneeName}</Text>
              <View className="flex-row items-center gap-2">
                {started && isMachine && (
                  <TouchableOpacity onPress={handleUndoMachineStart} className="bg-amber-50 border border-amber-300 px-2.5 py-1.5 rounded flex-row items-center">
                    <Undo2 size={12} color="#d97706" className="mr-1" />
                    <Text className="text-amber-800 font-bold text-xs">Reset / Outside Machine</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => handleUnassignHelper(started)} className="bg-red-50 border border-red-200 px-3 py-1.5 rounded">
                  <Text className="text-red-700 font-bold text-xs">Unassign</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowAssignHelperModal(true)} className="bg-purple-50 border border-purple-200 px-3 py-1.5 rounded">
                  <Text className="text-purple-700 font-bold text-xs">Re-assign</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View className="flex-row items-center justify-between">
              <TouchableOpacity onPress={() => setShowAssignHelperModal(true)} className="bg-purple-50 border border-purple-200 py-2 px-3 rounded items-center flex-row justify-center flex-1 mr-2">
                <UserPlus size={16} color="#994bff" className="mr-2" />
                <Text className="text-purple-700 font-bold text-sm">Assign Step to Helper</Text>
              </TouchableOpacity>
              {started && isMachine && (
                <TouchableOpacity onPress={handleUndoMachineStart} className="bg-amber-50 border border-amber-300 px-3 py-2 rounded flex-row items-center">
                  <Undo2 size={14} color="#d97706" className="mr-1" />
                  <Text className="text-amber-800 font-bold text-xs">Reset / Outside Machine</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      );
    };

    // If someone else has claimed it and we aren't supervisor, show waiting
    if (cur && curStage?.assignee && !isAssignee) {
      return (
        <View className="bg-gray-50 rounded-xl p-5 mb-4 border border-gray-200 items-center">
          <Text className="text-gray-500 font-bold">In progress by {curStage.assigneeName || 'another worker'}</Text>
        </View>
      );
    }

    if (cur === 'tagging' && (!curStage?.assignee || isAssignee)) {
      if (activeRole && !canStartStage(activeRole as any, cur) && activeRole !== 'supervisor' && activeRole !== 'admin') {
        return (
          <View className="bg-gray-50 rounded-xl p-5 mb-4 border border-gray-200 items-center">
            {renderSupervisorControls()}
            <Text className="text-gray-500 font-bold">Ready for {stepLabel(cur)}.</Text>
            <Text className="text-gray-400 text-xs mt-1">Please switch to the appropriate role to process.</Text>
          </View>
        );
      }
      return (
        <View>
          {renderSupervisorControls()}
          {renderTagging()}
        </View>
      );
    }

    if (cur && (!curStage?.assignee || isAssignee)) {
      if (activeRole && !canStartStage(activeRole as any, cur) && activeRole !== 'supervisor' && activeRole !== 'admin') {
        return (
          <View className="bg-gray-50 rounded-xl p-5 mb-4 border border-gray-200 items-center">
            {renderSupervisorControls()}
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
            totalGarments={garments?.count || 0}
            onPrint={async (bundles: number) => {
              const res = await useOpsProcessStore.getState().printBundleLabels(orderId, bundles, process?.id);
              if (res.ok) {
                // Physical bundle print popup disabled per user request
                return true;
              }
              return false;
            }}
            onComplete={async (payload: any) => {
              setShowPackagingVerification(false);
              const res = await useOpsProcessStore.getState().completePackaging(orderId, payload, process?.id);
              if (res.ok) navigation.goBack();
              else setActionError(friendlyActionError(res.error));
            }}
          />
        );
      }

      const isMachineStep = cur === 'getting_washed' || cur === 'getting_dried';
      const MachineIcon = cur === 'getting_washed' ? Droplets : Sun;

      return (
        <View className="bg-white rounded-xl p-5 mb-4 shadow-sm border border-gray-100">
          {renderSupervisorControls()}
          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-gray-900 font-bold text-base">{stepLabel(cur)}</Text>
            {isMachineStep && machineBadge && (
              <View className="bg-purple-50 border border-purple-200 px-3 py-1 rounded-full">
                <Text className="text-[#994bff] font-extrabold text-xs uppercase tracking-wider">
                  {started ? `In ${machineBadge}` : `Assign to: ${machineBadge}`}
                </Text>
              </View>
            )}
          </View>
          {!started ? (
            <View>
              {isMachineCapacityFull ? (
                <View>
                  <TouchableOpacity
                    onPress={() => {
                      const stepTitle = cur === 'getting_washed' ? `${resources.washers} Washers` : cur === 'getting_dried' ? `${resources.dryers} Dryers` : `${resources.ironingStations} Irons`;
                      setActionError(`All ${stepTitle} are currently running in the store. Please wait for an active cycle to finish and unload before starting this order.`);
                    }}
                    className="h-14 rounded-xl items-center justify-center flex-row bg-gray-100 border border-gray-300"
                  >
                    <Lock size={18} color="#64748b" className="mr-2" />
                    <Text className="text-gray-600 font-bold text-base">
                      All {cur === 'getting_washed' ? 'Washers' : cur === 'getting_dried' ? 'Dryers' : 'Irons'} in Use ({cur === 'getting_washed' ? resources.washers : cur === 'getting_dried' ? resources.dryers : resources.ironingStations} Running)
                    </Text>
                  </TouchableOpacity>
                  <Text className="text-gray-400 text-xs text-center mt-2">
                    This order is waiting outside the machine. Unload a finished machine first.
                  </Text>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={handleStart}
                  disabled={busy}
                  className={`h-14 rounded-xl items-center justify-center flex-row ${busy ? 'bg-gray-200' : 'bg-orange-500'}`}
                >
                  {busy ? <ActivityIndicator color="#fff" /> : (
                    <View className="flex-row items-center gap-2">
                      {isMachineStep && <MachineIcon size={20} color="#fff" />}
                      <Text className="text-white font-bold text-lg">
                        {isMachineStep && machineBadge ? `Start ${stepLabel(cur)} (${machineBadge})` : `Start ${stepLabel(cur)}`}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View>
              {cur === 'getting_washed' ? (
                <WasherCycleMonitor
                  startedAt={curStage?.startedAt}
                  detergentAddedAt={curStage?.detergentAddedAt}
                  softenerAddedAt={curStage?.softenerAddedAt}
                  onAddDetergent={async () => {
                    if (order && process) {
                      await useOpsProcessStore.getState().markChemicalAdded(order.id, process.id, 'detergent');
                    }
                  }}
                  onAddSoftener={async () => {
                    if (order && process) {
                      await useOpsProcessStore.getState().markChemicalAdded(order.id, process.id, 'softener');
                    }
                  }}
                />
              ) : isMachineStep ? (
                <View className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4 items-center flex-row justify-center">
                  <ActivityIndicator color="#f97316" size="small" className="mr-2" />
                  <Text className="text-orange-700 font-bold">Machine Running</Text>
                </View>
              ) : null}

              {(() => {
                const cycleStartedAtMs = curStage?.startedAt
                  ? (typeof (curStage.startedAt as any).toMillis === 'function'
                      ? (curStage.startedAt as any).toMillis()
                      : new Date((curStage.startedAt as any)).getTime())
                  : 0;
                const machineElapsedSec = cycleStartedAtMs > 0 ? Math.floor((Date.now() - cycleStartedAtMs) / 1000) : 0;
                const isCycleLocked = isMachineStep && machineElapsedSec < 1800;
                const cycleLockMinLeft = Math.max(1, Math.ceil((1800 - machineElapsedSec) / 60));

                if (isCycleLocked) {
                  return (
                    <View>
                      <TouchableOpacity
                        onPress={() => {
                          if (activeRole === 'supervisor' || activeRole === 'admin') {
                            setShowEmergencyOverrideModal(true);
                          }
                        }}
                        className="h-14 rounded-xl items-center justify-center flex-row bg-gray-100 border border-gray-200 mb-2 active:opacity-80"
                      >
                        <Lock size={18} color="#94a3b8" className="mr-2" />
                        <Text className="text-gray-500 font-bold text-base">
                          Unload Enabled in {cycleLockMinLeft}m
                        </Text>
                      </TouchableOpacity>

                      {(activeRole === 'supervisor' || activeRole === 'admin') && (
                        <TouchableOpacity
                          onPress={() => setShowEmergencyOverrideModal(true)}
                          className="py-2.5 items-center active:opacity-75"
                        >
                          <Text className="text-red-500 font-semibold text-xs">Supervisor Emergency Override</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                }

                return (
                  <TouchableOpacity
                    onPress={handleComplete}
                    disabled={busy}
                    className={`h-14 rounded-xl items-center justify-center flex-row ${busy ? 'bg-gray-200' : 'bg-green-500'}`}
                  >
                    {busy ? <ActivityIndicator color="#fff" /> : (
                      <View className="flex-row items-center gap-2">
                        {isMachineStep && <Check size={20} color="#fff" />}
                        <Text className="text-white font-bold text-lg">{isMachineStep ? 'Unload & Complete' : `Complete ${stepLabel(cur)}`}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })()}
            </View>
          )}
        </View>
      );
    }
    
    if (order?.status === 'ready' && isSupervisor) {
      return (
        <View className="bg-white rounded-xl p-5 mb-4 border border-gray-200">
          <Text className="text-gray-900 font-bold mb-4">Delivery Dispatch</Text>
          {!order.deliveryDate || !order.deliveryTime ? (
            <Text className="text-gray-500 mb-4 text-sm">Order is ready for delivery.</Text>
          ) : (
            <Text className="text-gray-600 mb-4 text-sm font-medium">Scheduled for {order.deliveryDate}, {order.deliveryTime}</Text>
          )}
          <View className="flex-row gap-3">
            <TouchableOpacity
              onPress={() => setShowAssignRiderModal(true)}
              disabled={busy}
              className="flex-1 h-14 rounded-xl items-center justify-center bg-blue-50 border border-blue-200"
            >
              <Text className="font-bold text-sm text-blue-700">Assign Rider</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleMarkOutForDelivery}
              disabled={busy}
              className="flex-1 h-14 rounded-xl items-center justify-center bg-orange-500"
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-sm text-center">Auto-Assign & Dispatch</Text>}
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    // Handle out_for_delivery state directly (independent of process existence)
    if (order?.status === 'out_for_delivery') {
      if (isSupervisor) {
        return (
          <View className="bg-white rounded-xl p-5 mb-4 border border-gray-200">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-gray-900 font-bold text-base">Out for Delivery</Text>
              <View className="bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-full">
                <Text className="text-blue-700 text-xs font-bold">Rider Dispatched</Text>
              </View>
            </View>
            
            <Text className="text-gray-500 text-xs mb-3">
              Order is currently out for delivery. You can reassign to another rider or unassign and return order to ready status.
            </Text>

            <View className="flex-row gap-2 mb-4">
              <TouchableOpacity
                onPress={() => setShowAssignRiderModal(true)}
                disabled={busy}
                className="flex-1 h-11 rounded-xl items-center justify-center bg-blue-50 border border-blue-200"
              >
                <Text className="font-bold text-xs text-blue-700">Reassign Rider</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleUnassignDelivery}
                disabled={busy}
                className="flex-1 h-11 rounded-xl items-center justify-center bg-amber-50 border border-amber-200"
              >
                <Text className="font-bold text-xs text-amber-700">Unassign / Return</Text>
              </TouchableOpacity>
            </View>

            <View className="border-t border-gray-100 pt-3">
              <Text className="text-gray-900 font-bold mb-2 text-sm">Verify Delivery OTP</Text>
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
          </View>
        );
      }
      return (
        <View className="bg-blue-50 rounded-xl p-5 mb-4 border border-blue-200 items-center">
          <Text className="text-blue-700 font-bold text-lg">Out for Delivery</Text>
        </View>
      );
    }

    if (order?.status === 'delivered') {
      return (
        <View className="bg-green-50 rounded-xl p-5 mb-4 border border-green-200 items-center">
          <Text className="text-green-700 font-bold text-lg">Order Delivered</Text>
        </View>
      );
    }

    if (order?.status === 'ready' && !isSupervisor) {
      return (
        <View className="bg-green-50 rounded-xl p-5 mb-4 border border-green-200 items-center">
          <Text className="text-green-700 font-bold text-lg">Order Ready for Delivery</Text>
        </View>
      );
    }

    if (done) {
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
        <View style={modalContainerStyle}>
          {/* Process Tabs */}
        {orderProcesses.length > 1 && (
          <View className="flex-row flex-wrap gap-2 mb-4">
            {orderProcesses.map(p => {
              const isSel = p.id === selectedProcessId;
              return (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => setSelectedProcessId(p.id)}
                  className={`px-4 py-2 rounded-xl flex-row items-center border ${isSel ? 'bg-[#994bff] border-[#994bff]' : 'bg-white border-gray-200 shadow-sm'}`}
                >
                  <Text className={`font-bold ${isSel ? 'text-white' : 'text-gray-600'}`}>
                    {p.serviceLabel || p.serviceType}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        )}

        {/* Header */}
        <View className="flex-row items-center justify-between mb-4 z-10">
          <TouchableOpacity onPress={() => navigation.goBack()} className="w-10 h-10 rounded-full bg-white items-center justify-center shadow-sm border border-gray-100 shrink-0">
            <X size={20} color="#64748b" />
          </TouchableOpacity>
          <View className="flex-1 items-center mx-2">
            <View className="flex-row items-center flex-wrap gap-2 justify-center">
              <Text className="text-gray-900 font-bold text-lg shrink-0">#{orderId.slice(-6).toUpperCase()}</Text>
              {(() => {
                const tokenChips = parseOrderTokens(order?.tokens, order?.tokenNumber || process?.tokenNumber, order?.items);
                if (tokenChips.length === 0) return null;
                return tokenChips.map((c, i) => (
                  <View key={i} className="bg-amber-100 px-2 py-0.5 rounded border border-amber-200">
                    <Text className="text-amber-800 font-bold text-xs">
                      T-{c.token}{c.serviceLabel ? ` (${c.serviceLabel.replace(/Wash & /g, 'W&')})` : ''}
                    </Text>
                  </View>
                ));
              })()}
            </View>
            {process && <WorkflowSteps steps={stepArr} currentIndex={currentIndex} />}
          </View>
          <View className="flex-row gap-2 items-center shrink-0">
            <View className={`rounded-full px-3 py-1 border justify-center h-8 ${done ? 'bg-green-50 border-green-200' : 'bg-purple-50 border-purple-200'}`}>
              <Text className={`text-xs font-bold ${done ? 'text-green-700' : 'text-purple-700'}`}>{statusLabel}</Text>
            </View>
            {isSupervisor && (
              <TouchableOpacity onPress={() => setShowMenu(!showMenu)} className="w-10 h-10 rounded-full bg-white items-center justify-center shadow-sm border border-gray-100">
                <MoreHorizontal size={20} color="#64748b" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {showMenu && isSupervisor && (
          <View className="absolute top-16 right-5 bg-white rounded-xl shadow-lg border border-gray-100 z-50 overflow-hidden w-52">
            {(order?.status === 'placed' || order?.status === 'confirmed' || order?.status === 'ready') && (
              <TouchableOpacity onPress={() => { setShowMenu(false); setShowRescheduleModal(true); }} className="p-4 border-b border-gray-100 flex-row items-center">
                <Calendar size={16} color="#64748b" className="mr-3" />
                <Text className="text-gray-700 font-medium">{order?.status === 'ready' ? 'Schedule Delivery' : 'Reschedule Pickup'}</Text>
              </TouchableOpacity>
            )}
            {(order?.status === 'placed' || order?.status === 'confirmed' || order?.status === 'ready' || order?.status === 'out_for_delivery') && (
              <TouchableOpacity
                onPress={() => {
                  setShowMenu(false);
                  setShowAssignRiderModal(true);
                }}
                className="p-4 border-b border-gray-100 flex-row items-center"
              >
                <UserPlus size={16} color="#3b82f6" className="mr-3" />
                <Text className="text-blue-700 font-medium">
                  {order?.status === 'out_for_delivery' ? 'Reassign Rider' : 'Assign Rider'}
                </Text>
              </TouchableOpacity>
            )}
            {(order?.status === 'placed' || order?.status === 'confirmed') && (
              <TouchableOpacity onPress={() => { setShowMenu(false); handleUnassignPickup(); }} className="p-4 border-b border-gray-100 flex-row items-center">
                <Undo2 size={16} color="#f59e0b" className="mr-3" />
                <Text className="text-amber-600 font-medium">Unassign Pickup</Text>
              </TouchableOpacity>
            )}
            {(order?.status === 'ready' || order?.status === 'out_for_delivery') && (
              <TouchableOpacity onPress={() => { setShowMenu(false); handleUnassignDelivery(); }} className="p-4 border-b border-gray-100 flex-row items-center">
                <Undo2 size={16} color="#f59e0b" className="mr-3" />
                <Text className="text-amber-600 font-medium">Unassign Delivery</Text>
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

        {/* Enhanced Customer Info for Supervisor — all relevant order details */}
        <View className="mb-6 bg-white p-5 rounded-xl shadow-sm border border-gray-100 z-0">
          <View className="items-center mb-4">
            <Text className="text-gray-900 text-lg font-bold">{order?.customerName || 'Unknown customer'}</Text>
            <Text className="text-gray-500 text-sm mt-1">{order ? serviceSummary(order) : '—'}</Text>
          </View>

          {(activeRole === 'supervisor' || activeRole === 'admin') && order && (
            <View className="border-t border-gray-100 pt-4 mt-2">
              {/* Order identity */}
              <View className="flex-row items-center mb-3 justify-between">
                <View className="flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text className="text-gray-900 font-bold text-lg">#{orderId.slice(-6).toUpperCase()}</Text>
                    {order.isUrgent && (
                      <View className="bg-red-500 px-2 py-0.5 rounded-full">
                        <Text className="text-white text-[10px] font-black tracking-wide uppercase">⚡ URGENT</Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-gray-500 text-xs">Order ID: {orderId}</Text>
                </View>
                <View className="items-end">
                  {(() => {
                    const tokenChips = parseOrderTokens(order.tokens, order.tokenNumber, order.items);
                    if (tokenChips.length === 0) return null;
                    return (
                      <View className="items-end gap-1 mb-1">
                        {tokenChips.map((c, i) => (
                          <View key={i} className="bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                            <Text className="text-amber-800 font-bold text-xs">
                              Token #{c.token}{c.serviceLabel ? ` · ${c.serviceLabel}` : ''}
                            </Text>
                          </View>
                        ))}
                      </View>
                    );
                  })()}
                  <View className="bg-gray-100 px-2 py-0.5 rounded-full mt-1">
                    <Text className="text-xs font-bold text-gray-600 uppercase">{order.status.replace(/_/g, ' ')}</Text>
                  </View>
                </View>
              </View>

              {order.pickupNote ? (
                <View className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
                  <Text className="text-amber-800 text-xs font-bold uppercase mb-0.5">Rider Pickup Note</Text>
                  <Text className="text-amber-900 text-sm font-medium">{order.pickupNote}</Text>
                </View>
              ) : null}

              {/* Dates / timelines */}
              <View className="bg-gray-50 rounded-xl p-3 mb-3">
                <View className="flex-row justify-between mb-1">
                  <Text className="text-gray-500 text-xs">Placed</Text>
                  <Text className="text-gray-700 text-xs font-medium">{fmtDT(order.createdAt)}</Text>
                </View>
                {order.pickupDetails ? (
                  <View className="flex-row justify-between mb-1">
                    <Text className="text-gray-500 text-xs">Pickup slot</Text>
                    <Text className={`text-xs font-bold ${order.pickupDetails.isInstant ? 'text-amber-600' : 'text-gray-700'}`}>
                      {slotLabel(order)}
                    </Text>
                  </View>
                ) : null}
                {order.deliveryDate ? (
                  <View className="flex-row justify-between mb-1">
                    <Text className="text-gray-500 text-xs">Delivery</Text>
                    <Text className="text-gray-700 text-xs font-medium">{order.deliveryDate} {order.deliveryTime || ''}</Text>
                  </View>
                ) : null}
                {order && (order as any).pickedUpAt ? (
                  <View className="flex-row justify-between">
                    <Text className="text-gray-500 text-xs">Picked up</Text>
                    <Text className="text-gray-700 text-xs font-medium">{fmtDT((order as any).pickedUpAt)}</Text>
                  </View>
                ) : null}
              </View>

              {/* Customer contact */}
              <View className="flex-row items-center mb-3">
                <View className="w-8 h-8 rounded-full bg-purple-50 items-center justify-center mr-3">
                  <Phone size={14} color="#994bff" />
                </View>
                <TouchableOpacity
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    Linking.openURL(`tel:${order.customerPhone}`);
                  }}
                  className="self-start py-0.5"
                  style={{ alignSelf: 'flex-start' }}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Text className="text-gray-900 font-medium">{order.customerPhone}</Text>
                  <Text className="text-gray-500 text-xs">Tap to call</Text>
                </TouchableOpacity>
              </View>

              {/* OTPs */}
              <View className="flex-row flex-wrap gap-2 mb-3">
                {order.pickupOTP ? (
                  <View className="bg-blue-50 px-2 py-1 rounded border border-blue-200">
                    <Text className="text-blue-700 text-xs font-bold">Pickup OTP: {order.pickupOTP}</Text>
                  </View>
                ) : null}
                {order.storeOTP ? (
                  <View className="bg-purple-50 px-2 py-1 rounded border border-purple-200">
                    <Text className="text-purple-700 text-xs font-bold">Store OTP: {order.storeOTP}</Text>
                  </View>
                ) : null}
                {order.deliveryOTP ? (
                  <View className="bg-green-50 px-2 py-1 rounded border border-green-200">
                    <Text className="text-green-700 text-xs font-bold">Delivery OTP: {order.deliveryOTP}</Text>
                  </View>
                ) : null}
              </View>

              {/* Address + directions */}
              <View className="flex-row items-center mb-3">
                <View className="w-8 h-8 rounded-full bg-purple-50 items-center justify-center mr-3">
                  <MapPin size={14} color="#994bff" />
                </View>
                <View className="flex-1">
                  <Text className="text-gray-900 font-medium leading-tight">
                    {typeof order.address === 'string' ? order.address : (order.address?.formattedAddress || order.address?.line1 || 'No address')}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      const dest = order.latitude ? `${order.latitude},${order.longitude}` : (order.address?.formattedAddress || order.address?.line1 || order.address);
                      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`).catch(() => {});
                    }}
                    className="flex-row items-center mt-1"
                  >
                    <Navigation size={12} color="#3b82f6" />
                    <Text className="text-info text-xs font-bold ml-1">Get Directions</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Item breakdown */}
              <View className="bg-gray-50 rounded-lg p-3 mt-2">
                <Text className="text-xs font-bold text-gray-500 uppercase mb-2">Item Breakdown</Text>
                {order.items?.map((item: any, idx: number) => {
                  const { title, details } = formatItemSummary(item);
                  const sid = String(item.serviceType || item.serviceId || '').toLowerCase();
                  const itemToken = order.tokens?.[item.serviceType] || order.tokens?.[item.serviceId] || order.tokens?.[sid];
                  return (
                    <View key={idx} className="flex-row justify-between mb-2 pb-1.5 border-b border-gray-200/60 last:border-b-0">
                      <View className="flex-1 mr-2">
                        <View className="flex-row items-center flex-wrap gap-1.5">
                          <Text className="text-gray-900 font-bold text-sm">{title}</Text>
                          {details ? (
                            <View className="bg-gray-200/80 px-1.5 py-0.5 rounded">
                              <Text className="text-gray-700 text-xs font-medium">{details}</Text>
                            </View>
                          ) : null}
                          {itemToken ? (
                            <View className="bg-amber-100 border border-amber-300 px-1.5 py-0.5 rounded">
                              <Text className="text-amber-800 text-xs font-bold">Token #{itemToken}</Text>
                            </View>
                          ) : null}
                        </View>
                        {item.specialInstructions ? <Text className="text-gray-400 text-xs mt-0.5">{item.specialInstructions}</Text> : null}
                      </View>
                      <Text className="text-gray-700 font-bold text-sm">
                        {item.totalPrice ? `₹${item.totalPrice}` : ''}
                      </Text>
                    </View>
                  );
                })}
                <View className="flex-row justify-between pt-2 mt-1 border-t border-gray-200">
                  <Text className="text-gray-900 font-bold text-sm">Total</Text>
                  <Text className="text-gray-900 font-bold">₹{orderTotal(order)}</Text>
                </View>
                {order.paymentStatus ? (
                  <View className="mt-2">
                    <View className="self-start bg-gray-200 px-2 py-0.5 rounded">
                      <Text className="text-xs font-bold text-gray-700 uppercase">{order.paymentStatus}</Text>
                    </View>
                  </View>
                ) : null}
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

        {!!actionSuccess && (
          <View className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4 flex-row items-center gap-2">
            <CheckCircle2 color="#16a34a" size={20} />
            <Text className="text-green-700 font-medium flex-1">{actionSuccess}</Text>
          </View>
        )}

        {renderActionState()}

        {/* Garment Count & Scan Details Card */}
        {garmentCountDisplay != null && garmentCountDisplay > 0 && isTaggingDone && (
          <View className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 mb-4">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-3">
                <View className="w-10 h-10 rounded-full bg-purple-50 items-center justify-center">
                  <Shirt size={20} color="#994bff" />
                </View>
                <View>
                  <Text className="text-gray-900 font-bold text-base">
                    {garmentCountDisplay} Garment{garmentCountDisplay > 1 ? 's' : ''} Tagged
                  </Text>
                  <Text className="text-gray-500 text-xs">
                    All barcode labels scanned & verified
                  </Text>
                </View>
              </View>
              <View className="bg-green-50 border border-green-200 px-2.5 py-1 rounded-full flex-row items-center gap-1">
                <CheckCircle2 size={13} color="#16a34a" />
                <Text className="text-green-700 text-xs font-bold">Verified</Text>
              </View>
            </View>
          </View>
        )}

        {/* Quality & Packaging Photos Gallery */}
        {packagingPhotos.length > 0 && (
          <View className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 mb-4">
            <View className="flex-row items-center justify-between mb-2">
              <View className="flex-row items-center gap-2">
                <Camera size={18} color="#994bff" />
                <Text className="text-gray-900 font-bold text-base">Packaging & Quality Proof</Text>
              </View>
              <View className="flex-row items-center gap-1.5">
                {bundlesCount ? (
                  <View className="bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                    <Text className="text-amber-800 text-xs font-bold">📦 {bundlesCount} Bundle{bundlesCount > 1 ? 's' : ''}</Text>
                  </View>
                ) : null}
                <View className="bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-full">
                  <Text className="text-purple-700 text-xs font-bold">{packagingPhotos.length} photo{packagingPhotos.length > 1 ? 's' : ''}</Text>
                </View>
              </View>
            </View>

            <Text className="text-gray-500 text-xs mb-3">
              Tap any photo to view full-screen packaging proof.
            </Text>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {packagingPhotos.map((photoUri, idx) => (
                <TouchableOpacity
                  key={idx}
                  onPress={() => setPreviewImage(photoUri)}
                  activeOpacity={0.8}
                  className="rounded-xl overflow-hidden border border-gray-200 bg-gray-100 shadow-sm relative"
                  style={{ width: 96, height: 96 }}
                >
                  <Image
                    source={{ uri: photoUri }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="cover"
                  />
                  <View className="absolute bottom-1 right-1 bg-black/60 rounded px-1.5 py-0.5 flex-row items-center gap-0.5">
                    <Eye size={10} color="#fff" />
                    <Text className="text-white text-[9px] font-bold">View</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
        
        {/* Step-by-Step Stage Timings & Timeline */}
        {timelineEvents.length > 0 && (
          <View className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 mt-1 mb-4">
            <View className="flex-row items-center justify-between mb-4">
              <View className="flex-row items-center gap-2">
                <Clock size={18} color="#994bff" />
                <Text className="text-gray-900 font-bold text-base">Stage Timings & Timeline</Text>
              </View>
              <Text className="text-gray-400 text-xs">{timelineEvents.length} stages recorded</Text>
            </View>

            {timelineEvents.map((event, idx, arr) => {
              const ts = event.completedAt || event.startedAt || event.acceptedAt;
              const ms = ts ? ((ts as any).toMillis?.() || (ts as any).seconds * 1000 || (ts as any)._seconds * 1000 || (typeof ts === 'number' ? ts : 0)) : 0;
              const dateStr = ms ? new Date(ms).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
              const isCompleted = !!event.completedAt;

              return (
                <View key={idx} className="flex-row mb-4 last:mb-0">
                  <View className="items-center mr-3">
                    <View className={`w-4 h-4 rounded-full items-center justify-center ${isCompleted ? 'bg-green-500' : 'bg-orange-400'}`}>
                      {isCompleted ? <Check size={10} color="#fff" /> : <View className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </View>
                    {idx < arr.length - 1 && <View className="w-0.5 flex-1 bg-gray-200 my-1" />}
                  </View>
                  <View className="flex-1 pb-1">
                    <View className="flex-row items-center justify-between flex-wrap gap-1">
                      <Text className="text-gray-900 font-bold text-sm">{event.label}</Text>
                      <View className="flex-row items-center gap-1.5">
                        {typeof event.acceptToCompleteMin === 'number' && (
                          <View className="bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                            <Text className="text-green-700 text-[11px] font-bold">
                              {event.acceptToCompleteMin}m total
                            </Text>
                          </View>
                        )}
                        {typeof event.startToCompleteMin === 'number' && event.startToCompleteMin !== event.acceptToCompleteMin && (
                          <View className="bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                            <Text className="text-blue-700 text-[11px] font-bold">
                              {event.startToCompleteMin}m run
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>

                    <View className="flex-row items-center gap-2 mt-1">
                      {event.assigneeName ? (
                        <Text className="text-gray-600 text-xs font-medium">By {event.assigneeName}</Text>
                      ) : null}
                      {event.assigneeName && dateStr ? <Text className="text-gray-300 text-xs">·</Text> : null}
                      {dateStr ? <Text className="text-gray-500 text-xs">{dateStr}</Text> : null}
                    </View>

                    {/* Milestones if wash cycle */}
                    {(event.step === 'getting_washed' || event.step === 'wash') && ((event as any).detergentAddedAt || (event as any).softenerAddedAt) && (
                      <View className="flex-row gap-2 mt-1.5">
                        {(event as any).detergentAddedAt && (
                          <View className="bg-purple-50 border border-purple-200 px-2 py-0.5 rounded flex-row items-center gap-1">
                            <Check size={10} color="#994bff" />
                            <Text className="text-purple-700 text-[10px] font-bold">Detergent @ 13m</Text>
                          </View>
                        )}
                        {(event as any).softenerAddedAt && (
                          <View className="bg-purple-50 border border-purple-200 px-2 py-0.5 rounded flex-row items-center gap-1">
                            <Check size={10} color="#994bff" />
                            <Text className="text-purple-700 text-[10px] font-bold">Softener @ 21m</Text>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}
        </View>
      </ScrollView>

      {/* Full-screen Photo Preview Modal */}
      <Modal
        visible={!!previewImage}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setPreviewImage(null)}
      >
        <View className="flex-1 bg-black/90 justify-center items-center p-4">
          <TouchableOpacity
            onPress={() => setPreviewImage(null)}
            className="absolute top-12 right-6 w-11 h-11 rounded-full bg-white/20 items-center justify-center z-50 border border-white/20"
          >
            <X size={22} color="#fff" />
          </TouchableOpacity>
          {previewImage && (
            <Image
              source={{ uri: previewImage }}
              className="w-full h-4/5 rounded-2xl"
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>

      <QRScanner 
        visible={scannerVisible} 
        onClose={() => setScannerVisible(false)} 
        onScan={handleScan}
        actionType="Garment Label"
        continuous={true}
        progressText={`${effectiveCount} / ${garments?.count || 0} Garments Scanned`}
        currentCount={effectiveCount}
        totalCount={garments?.count || 0}
        onManualScanNext={() => handleScan('DUMMY')}
        onBypassAll={handleTagAll}
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
            isDelivery={order?.status === 'ready' || order?.status === 'out_for_delivery'}
            onAssign={async (riderId) => {
              const isDelivery = order?.status === 'ready' || order?.status === 'out_for_delivery';
              const res = await useOpsProcessStore.getState().assignTaskToRider(orderId, order?.userId || '', riderId, isDelivery);
              if (!res.ok) setActionError(friendlyActionError(res.error));
            }}
          />
          <ReturnDeliveryModal
            visible={showReturnDeliveryModal}
            onClose={() => setShowReturnDeliveryModal(false)}
            orderId={orderId}
            customerName={order?.customerName || ''}
            currentSlot={order?.deliveryDate && order?.deliveryTime ? `${order.deliveryDate} • ${order.deliveryTime}` : undefined}
            onConfirm={handleConfirmReturnDelivery}
            onSwitchToReassign={() => {
              setShowReturnDeliveryModal(false);
              setShowAssignRiderModal(true);
            }}
          />
          <EmergencyOverrideModal
            visible={showEmergencyOverrideModal}
            onClose={() => setShowEmergencyOverrideModal(false)}
            onConfirm={handleConfirmEmergencyOverride}
            orderId={orderId}
            stageName={cur ? stepLabel(cur) : 'Current Stage'}
            machineName={curStage?.machineName}
            cycleLockMinLeft={cycleLockMinLeft}
          />
          <ResetMachineCycleModal
            visible={showResetMachineModal}
            onClose={() => setShowResetMachineModal(false)}
            onConfirm={handleConfirmResetMachine}
            orderId={orderId}
            stageName={cur ? stepLabel(cur) : 'Current Stage'}
            machineName={curStage?.machineName}
          />
          {order && (
            <AssignHelperModal
              visible={showAssignHelperModal}
              onClose={() => setShowAssignHelperModal(false)}
              processId={process?.id || order.id}
              stepName={cur ? stepLabel(cur) : 'Tagging'}
              onAssign={async (helperId) => {
                if (process) {
                  const res = await useOpsProcessStore.getState().assignStepToHelper(order.id, process.id, order.userId || '', helperId);
                  if (!res.ok) setActionError(friendlyActionError(res.error));
                } else {
                  const res = await useOpsProcessStore.getState().claim(
                    order.id,
                    order.tokenNumber,
                    order.userId,
                    order.vendorId,
                    helperId
                  );
                  if (!res.ok) setActionError(friendlyActionError(res.error));
                }
              }}
              onUnassign={async () => {
                await handleUnassignHelper(started);
              }}
            />
          )}
        </>
      )}


    </KeyboardAvoidingView>
  );
}
