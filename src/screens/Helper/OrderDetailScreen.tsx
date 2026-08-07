import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { X, Printer, ScanLine, CheckCircle2, Play } from 'lucide-react-native';
import { QRScanner } from '../../components/QRScanner';
import { useAuthStore } from '../../store/authStore';
import { useOpsProcessStore, OpsProcessingResult } from '../../store/opsProcessStore';
import { useOrderFeedStore } from '../../store/orderFeedStore';
import { serviceSummary } from '../../utils/orderFeed';
import { currentStep, isDone, stage, stepLabel } from '../../utils/opsProcess';
import { opsTimeline } from '../../utils/opsTimeline';
import { printGarmentLabels } from '../../utils/labelPrint';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'OrderDetail'>;

// Map server error codes (the httpsCallable returns them as res.data.error) to
// friendly copy for the garment flow.
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

const fmtTime = (v: unknown): string => {
  if (!v) return '—';
  let ms: number;
  if (typeof (v as any).toDate === 'function') ms = (v as any).toDate().getTime();
  else if (typeof (v as any).seconds === 'number') ms = (v as any).seconds * 1000;
  else ms = new Date(v as any).getTime();
  if (Number.isNaN(ms)) return '—';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
};

const fmtDuration = (ms?: number): string => {
  if (ms == null) return '';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
};

export function OrderDetailScreen({ route, navigation }: Props) {
  const { orderId } = route.params;
  const user = useAuthStore(s => s.user);
  const orders = useOrderFeedStore(s => s.orders);
  const { processes, claim, startStep, completeStep, printLabels, scanGarment, unregisterGarment, submitTagging } =
    useOpsProcessStore();

  const [countText, setCountText] = useState('');
  const [printError, setPrintError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  const order = useMemo(() => orders.find(o => o.id === orderId), [orders, orderId]);
  const process = useMemo(() => processes.find(p => p.orderId === orderId), [processes, orderId]);

  const cur = process ? currentStep(process) : null;
  const done = process ? isDone(process) : false;
  const taggingStage = process?.stages?.tagging;
  const taggingDone = !!taggingStage?.completedAt;
  const garments = process?.garments || {};
  const registered = garments.registered || [];
  const registeredCount = registered.length;

  // The garment flow is the tagging stage up until it's submitted.
  const inTaggingFlow = !!(process && cur === 'tagging' && !taggingDone);
  // Submit is only meaningful once labels have been printed (count set).
  const showSubmit = inTaggingFlow && garments.count != null;

  const runAction = async (fn: () => Promise<OpsProcessingResult>) => {
    setBusy(true);
    setActionError(null);
    const res = await fn();
    if (!res.ok) setActionError(friendlyActionError(res.error));
    setBusy(false);
  };

  const handleClaim = () => runAction(() => claim(orderId));
  const handleStart = () => runAction(() => startStep(orderId));
  const handleComplete = () => runAction(() => completeStep(orderId));

  const handlePrint = async () => {
    const n = Number(countText.trim());
    if (!Number.isInteger(n) || n < 1 || n > 500) {
      setPrintError('Enter a whole number of garments (1–500).');
      return;
    }
    setBusy(true);
    setPrintError(null);
    setActionError(null);
    const res = await printLabels(orderId, n);
    if (res.ok && res.labels) {
      await printGarmentLabels(res.labels, { orderShort: orderId.slice(-6) });
    } else if (!res.ok) {
      setPrintError(friendlyActionError(res.error));
    } else {
      setPrintError('No labels returned. Try again.');
    }
    setBusy(false);
  };

  const handleScan = async (data: string) => {
    setBusy(true);
    setScanError(null);
    const res = await scanGarment(orderId, data);
    if (!res.ok) setScanError(friendlyScanError(res.error));
    setBusy(false);
  };

  const handleUnregister = (seq: number) => {
    runAction(() => unregisterGarment(orderId, seq));
  };

  const handleSubmit = () => {
    runAction(() => submitTagging(orderId));
  };

  const curStage = cur ? stage(process!, cur) : undefined;
  const started = !!curStage?.startedAt;
  const completed = !!curStage?.completedAt;
  const isMine = !!curStage?.assignee && curStage.assignee === user?.id;

  const statusLabel = !process
    ? order?.status === 'pickup_completed'
      ? 'Ready to process'
      : 'Unavailable'
    : done
      ? 'Complete'
      : cur
        ? stepLabel(cur)
        : 'No steps';

  const timeline = useMemo(() => (process ? opsTimeline(process) : []), [process]);

  return (
    <View className="flex-1 bg-bgDark">
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
        {/* Header */}
        <View className="flex-row items-center justify-between mb-4">
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            className="w-10 h-10 rounded-full bg-bgSurface items-center justify-center"
            accessibilityLabel="Close"
          >
            <X size={20} color="#F8FAFC" />
          </TouchableOpacity>
          <Text className="text-textPrimary font-bold text-lg">
            #{orderId.slice(-6).toUpperCase()}
          </Text>
          <View className="bg-bgSurface rounded-full px-3 py-1 border border-bgSurfaceLight">
            <Text className={`text-xs font-bold ${done ? 'text-primary' : 'text-info'}`}>{statusLabel}</Text>
          </View>
        </View>
        <Text className="text-textSecondary text-sm mb-1">{order?.customerName || 'Unknown customer'}</Text>
        <Text className="text-textMuted text-xs mb-5">{order ? serviceSummary(order) : '—'}</Text>

        {/* Main content */}
        {!process ? (
          <View className="bg-bgSurface rounded-xl p-4 mb-3 border border-bgSurfaceLight">
            <Text className="text-textPrimary font-bold mb-1">Claim this order</Text>
            <Text className="text-textSecondary text-sm mb-4">
              Claiming assigns the tagging stage to you and starts the garment flow.
            </Text>
            <TouchableOpacity
              onPress={handleClaim}
              disabled={busy}
              className={`h-12 rounded-xl items-center justify-center flex-row ${busy ? 'bg-bgSurfaceLight' : 'bg-primary'}`}
            >
              {busy ? (
                <ActivityIndicator size="small" color="#0F172A" />
              ) : (
                <>
                  <Play size={18} color="#0F172A" className="mr-2" />
                  <Text className="text-bgDark font-bold">Claim & Start Tagging</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        ) : done ? (
          <View className="bg-primary/15 border border-primary/40 rounded-xl p-4 mb-3 items-center">
            <CheckCircle2 size={28} color="#22C55E" className="mb-1" />
            <Text className="text-primary font-bold">Order Complete</Text>
            <Text className="text-textSecondary text-xs mt-1">All processing steps are done.</Text>
          </View>
        ) : inTaggingFlow ? (
          <View className="bg-bgSurface rounded-xl p-4 mb-3 border border-bgSurfaceLight">
            <Text className="text-textSecondary font-bold text-xs mb-1 tracking-wide">TAGGING</Text>
            {garments.count == null ? (
              <>
                <Text className="text-textPrimary font-bold mb-1">Total Garments Received</Text>
                <Text className="text-textSecondary text-sm mb-3">
                  Print the labels you'll attach to each garment before scanning.
                </Text>
                <TextInput
                  value={countText}
                  onChangeText={setCountText}
                  keyboardType="number-pad"
                  placeholder="e.g. 8"
                  placeholderTextColor="#64748B"
                  className="bg-bgDark rounded-lg px-4 h-12 text-textPrimary mb-3"
                />
                {printError && <Text className="text-error text-xs mb-3 font-bold">{printError}</Text>}
                <TouchableOpacity
                  onPress={handlePrint}
                  disabled={busy}
                  className={`h-12 rounded-xl items-center justify-center flex-row ${busy ? 'bg-bgSurfaceLight' : 'bg-primary'}`}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color="#0F172A" />
                  ) : (
                    <>
                      <Printer size={18} color="#0F172A" className="mr-2" />
                      <Text className="text-bgDark font-bold">Print Labels</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View className="flex-row items-center justify-between mb-3">
                  <Text className="text-textPrimary font-bold">
                    Garments {registeredCount}/{garments.count}
                  </Text>
                  <Text className="text-textMuted text-xs">
                    {registeredCount >= garments.count ? 'All registered' : `${garments.count - registeredCount} left`}
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={() => {
                    setScanError(null);
                    setScannerVisible(true);
                  }}
                  disabled={busy}
                  className="h-12 rounded-xl items-center justify-center flex-row bg-info mb-3"
                >
                  <ScanLine size={18} color="#FFFFFF" className="mr-2" />
                  <Text className="text-white font-bold">Scan Garment QR</Text>
                </TouchableOpacity>

                {scanError && (
                  <View className="bg-error/15 border border-error/40 rounded-lg p-3 mb-3">
                    <Text className="text-error text-xs font-bold">{scanError}</Text>
                  </View>
                )}

                {registered.length === 0 ? (
                  <Text className="text-textMuted text-xs mb-3">
                    No garments registered yet. Scan the printed QR labels to add them.
                  </Text>
                ) : (
                  registered.map(r => (
                    <View
                      key={r.seq}
                      className="flex-row items-center justify-between bg-bgDark rounded-lg px-3 py-2 mb-2"
                    >
                      <View>
                        <Text className="text-textPrimary text-sm font-bold">Garment #{r.seq}</Text>
                        <Text className="text-textMuted text-xs">
                          {r.qr || `SPNZ:${orderId}:${r.seq}`} · {fmtTime(r.scannedAt)}
                        </Text>
                      </View>
                      <TouchableOpacity onPress={() => handleUnregister(r.seq)} hitSlop={10}>
                        <X size={16} color="#94A3B8" />
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </>
            )}
          </View>
        ) : (
          <View className="bg-bgSurface rounded-xl p-4 mb-3 border border-bgSurfaceLight">
            <Text className="text-textSecondary font-bold text-xs mb-1 tracking-wide">CURRENT STEP</Text>
            <Text className="text-textPrimary font-bold text-lg mb-1">{cur ? stepLabel(cur) : '—'}</Text>
            {!started ? (
              <>
                <Text className="text-textSecondary text-sm mb-4">
                  This stage is ready to start. Starting assigns it to you.
                </Text>
                <TouchableOpacity
                  onPress={handleStart}
                  disabled={busy}
                  className={`h-12 rounded-xl items-center justify-center flex-row ${busy ? 'bg-bgSurfaceLight' : 'bg-primary'}`}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color="#0F172A" />
                  ) : (
                    <>
                      <Play size={18} color="#0F172A" className="mr-2" />
                      <Text className="text-bgDark font-bold">Start {cur ? stepLabel(cur) : ''}</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            ) : completed ? (
              <View className="flex-row items-center">
                <CheckCircle2 size={16} color="#22C55E" className="mr-1" />
                <Text className="text-primary font-bold">Complete</Text>
              </View>
            ) : isMine ? (
              <>
                <Text className="text-textSecondary text-sm mb-4">
                  You started this stage. Mark it complete when it's done.
                </Text>
                <TouchableOpacity
                  onPress={handleComplete}
                  disabled={busy}
                  className={`h-12 rounded-xl items-center justify-center flex-row ${busy ? 'bg-bgSurfaceLight' : 'bg-primary'}`}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color="#0F172A" />
                  ) : (
                    <>
                      <CheckCircle2 size={18} color="#0F172A" className="mr-2" />
                      <Text className="text-bgDark font-bold">Complete {cur ? stepLabel(cur) : ''}</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <Text className="text-textSecondary text-sm">
                In progress by {curStage?.assigneeName || 'another staff member'}.
              </Text>
            )}
          </View>
        )}

        {actionError && (
          <View className="bg-error/15 border border-error/40 rounded-lg p-3 mb-3">
            <Text className="text-error text-xs font-bold">{actionError}</Text>
          </View>
        )}

        {/* Timeline */}
        {process && (
          <View className="mt-2">
            <Text className="text-textSecondary font-bold text-xs mb-2 tracking-wide">TIMELINE</Text>
            <View className="bg-bgSurface rounded-xl p-4 border border-bgSurfaceLight">
              {timeline.length === 0 ? (
                <Text className="text-textMuted text-xs">No steps</Text>
              ) : (
                timeline.map(t => {
                  const statusText = t.skipped
                    ? 'Skipped — Not Required'
                    : t.completedAt
                      ? 'Completed'
                      : t.startedAt
                        ? 'In progress'
                        : 'Pending';
                  const dot = t.completedAt ? '#22C55E' : t.startedAt ? '#3B82F6' : '#334155';
                  return (
                    <View key={t.step} className="flex-row mb-3 last:mb-0">
                      <View
                        className="w-2 h-2 rounded-full mt-2 mr-3"
                        style={{ backgroundColor: dot }}
                      />
                      <View className="flex-1">
                        <View className="flex-row items-center justify-between">
                          <Text className="text-textPrimary text-sm font-bold">{t.label}</Text>
                          <Text className={`text-xs font-bold ${t.completedAt ? 'text-primary' : t.startedAt ? 'text-info' : 'text-textMuted'}`}>
                            {statusText}
                          </Text>
                        </View>
                        {t.assigneeName && (
                          <Text className="text-textMuted text-xs mt-0.5">by {t.assigneeName}</Text>
                        )}
                        {(t.startedAt != null || t.completedAt != null) && (
                          <Text className="text-textMuted text-xs mt-0.5">
                            {t.startedAt ? `Start ${fmtTime(t.startedAt)}` : ''}
                            {t.startedAt && t.completedAt ? ' · ' : ''}
                            {t.completedAt ? `Done ${fmtTime(t.completedAt)}` : ''}
                            {t.durationMs != null ? ` · ${fmtDuration(t.durationMs)}` : ''}
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Sticky submit for the garment flow */}
      {showSubmit && (
        <View className="px-4 py-3 border-t border-bgSurfaceLight">
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={busy || registeredCount === 0}
            className={`h-12 rounded-xl items-center justify-center ${busy || registeredCount === 0 ? 'bg-bgSurfaceLight' : 'bg-primary'}`}
          >
            <Text className={`font-bold ${busy || registeredCount === 0 ? 'text-textMuted' : 'text-bgDark'}`}>
              Submit Tagged Garments ({registeredCount})
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <QRScanner
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        onScan={handleScan}
        actionType="garment"
      />
    </View>
  );
}
