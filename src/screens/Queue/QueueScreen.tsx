import React, { useState, useEffect } from 'react';
import { View, Text, SafeAreaView, ScrollView, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { 
  useOrderStore, 
  HelperOrder, 
  HelperTab,
  OpsStep,
  SERVICE_TYPE_LABELS,
  OPS_STEP_LABELS,
  ServiceType,
  getOrderPipeline
} from '../../store/orderStore';
import { 
  Package, CheckCircle2, ChevronRight, Clock, Droplets, Wind, 
  FoldVertical, Shirt, Inbox, Tag, Play, Square
} from 'lucide-react-native';

// ─── Tab Configuration ───
const TABS: { id: HelperTab; label: string; icon: any; color: string }[] = [
  { id: 'intake', label: 'Intake', icon: Inbox, color: '#F59E0B' },
  { id: 'tagging', label: 'Tagging', icon: Tag, color: '#F97316' },
  { id: 'washing', label: 'Washing', icon: Droplets, color: '#0EA5E9' },
  { id: 'drying', label: 'Drying', icon: Wind, color: '#8B5CF6' },
  { id: 'ironing', label: 'Ironing', icon: Shirt, color: '#EC4899' },
  { id: 'folding', label: 'Folding', icon: FoldVertical, color: '#10B981' },
  { id: 'packaging', label: 'Packaging', icon: Package, color: '#6366F1' },
  { id: 'ready', label: 'Ready', icon: CheckCircle2, color: '#22C55E' },
];

// ─── Filter logic per tab ───
const filterOrdersByTab = (orders: HelperOrder[], tab: HelperTab): HelperOrder[] => {
  switch (tab) {
    case 'intake':
      // Orders that just arrived — no opsStep set yet
      return orders.filter(o => o.status === 'pickup_completed' && !o.opsStep);
    case 'tagging':
      return orders.filter(o => o.opsStep === 'tagging');
    case 'washing':
      return orders.filter(o => o.opsStep === 'washing');
    case 'drying':
      return orders.filter(o => o.opsStep === 'drying');
    case 'ironing':
      return orders.filter(o => o.opsStep === 'ironing');
    case 'folding':
      return orders.filter(o => o.opsStep === 'folding');
    case 'packaging':
      return orders.filter(o => o.opsStep === 'packaging');
    case 'ready':
      return orders.filter(o => o.status === 'ready' || o.opsStep === 'completed');
    default:
      return [];
  }
};

// ─── Time helpers ───
const getTimeAgo = (timestamp: any): string => {
  if (!timestamp) return '';
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

// ─── Live timer component ───
const LiveTimer = ({ startTimestamp }: { startTimestamp: any }) => {
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    const getMs = () => {
      if (!startTimestamp) return 0;
      if (typeof startTimestamp.toDate === 'function') return startTimestamp.toDate().getTime();
      if (startTimestamp.seconds) return startTimestamp.seconds * 1000;
      return new Date(startTimestamp).getTime();
    };

    const tick = () => {
      const startMs = getMs();
      if (!startMs) { setElapsed(''); return; }
      const diffSec = Math.floor((Date.now() - startMs) / 1000);
      const mins = Math.floor(diffSec / 60);
      const secs = diffSec % 60;
      setElapsed(`${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startTimestamp]);

  if (!elapsed) return null;
  return (
    <View className="flex-row items-center bg-warning/20 px-2 py-0.5 rounded">
      <Clock size={12} color="#F59E0B" />
      <Text className="text-warning text-xs font-bold ml-1">{elapsed}</Text>
    </View>
  );
};

// ─── Get item quantity summary ───
const getItemSummary = (item: any): string => {
  if (item.serviceType === 'blanket_wash') {
    return item.description || `${item.blanketQuantity || item.quantity || 0} Blankets`;
  }
  if (item.serviceType === 'ironing') {
    return `${item.ironingCount || item.clothesCount || item.quantity || 0} Clothes`;
  }
  const weightStr = item.weight ? `${item.weight}kg` : `${item.quantity || 1} units`;
  const ironingStr = (item.ironingCount || item.ironingEnabled) ? ` + ${item.ironingCount || 0} Ironing` : '';
  return weightStr + ironingStr;
};

// ─── Inline action button for start/complete ───
const StepActionButton = ({ order, onAction }: { order: HelperOrder; onAction: () => void }) => {
  const isActive = order.stepPhase === 'active';
  
  if (order.status === 'ready' || order.opsStep === 'completed') return null;
  if (!order.opsStep || order.opsStep === 'tagging') return null; // Tagging is handled in OrderDetail

  return (
    <TouchableOpacity
      onPress={(e) => { e.stopPropagation(); onAction(); }}
      className={`flex-row items-center px-3 py-2 rounded-lg ${isActive ? 'bg-success' : 'bg-primary'}`}
      activeOpacity={0.7}
    >
      {isActive ? <Square size={14} color="#fff" /> : <Play size={14} color="#fff" />}
      <Text className="text-white text-xs font-bold ml-1">
        {isActive ? `Complete ${OPS_STEP_LABELS[order.opsStep]}` : `Start ${OPS_STEP_LABELS[order.opsStep]}`}
      </Text>
    </TouchableOpacity>
  );
};

export function QueueScreen() {
  const [activeTab, setActiveTab] = useState<HelperTab>('intake');
  const { orders, isLoading, initializeFirebaseListener, startStep, completeStep } = useOrderStore();
  const navigation = useNavigation<any>();
  const [processingId, setProcessingId] = useState<string | null>(null);
  
  useEffect(() => {
    initializeFirebaseListener();
  }, [initializeFirebaseListener]);

  const filteredOrders = filterOrdersByTab(orders, activeTab);

  const handleInlineAction = async (order: HelperOrder) => {
    if (!order.opsStep || order.opsStep === 'tagging') return;
    
    setProcessingId(order.id);
    try {
      if (order.stepPhase === 'active') {
        await completeStep(order, order.opsStep);
      } else {
        await startStep(order, order.opsStep);
      }
    } catch (error) {
      console.error('Action failed:', error);
    } finally {
      setProcessingId(null);
    }
  };

  const renderOrderCard = ({ item }: { item: HelperOrder }) => {
    const timeAgo = getTimeAgo(item.pickedUpAt || item.createdAt);
    const pipeline = getOrderPipeline(item.items);
    const currentStepIdx = item.opsStep ? pipeline.indexOf(item.opsStep) : -1;
    const isProcessing = processingId === item.id;

    return (
      <TouchableOpacity 
        onPress={() => navigation.navigate('OrderDetail', { orderId: item.id })}
        className="bg-bgSurface rounded-xl p-4 mb-3 border border-bgSurfaceLight"
        activeOpacity={0.7}
      >
        {/* Row 1: Order ID + Phase/Timer */}
        <View className="flex-row items-center justify-between mb-2">
          <View className="flex-row items-center">
            <Text className="text-textPrimary font-bold text-lg">
              #{item.id.slice(-6).toUpperCase()}
            </Text>
            {item.tokenNumber && (
              <View className="bg-primary/20 px-2 py-0.5 rounded ml-2">
                <Text className="text-primary text-xs font-bold">T-{item.tokenNumber}</Text>
              </View>
            )}
            {item.actualItemCount && (
              <View className="bg-bgDark px-2 py-0.5 rounded ml-2">
                <Text className="text-textMuted text-xs">{item.actualItemCount} items</Text>
              </View>
            )}
          </View>
          {item.stepPhase === 'active' && item.currentStepStartedAt && (
            <LiveTimer startTimestamp={item.currentStepStartedAt} />
          )}
        </View>

        {/* Row 2: Customer Name */}
        <Text className="text-textSecondary text-sm mb-2">{item.customerName}</Text>

        {/* Row 3: Service Type Badges */}
        <View className="flex-row flex-wrap gap-1 mb-3">
          {item.items.map((srv: any, idx: number) => (
            <View key={idx} className="bg-bgDark px-2 py-1 rounded-md">
              <Text className="text-textMuted text-xs">
                {SERVICE_TYPE_LABELS[srv.serviceType as ServiceType] || srv.serviceName}
                {' · '}
                {getItemSummary(srv)}
              </Text>
            </View>
          ))}
        </View>

        {/* Row 4: Pipeline progress dots */}
        {item.opsStep && (
          <View className="flex-row items-center mb-3 gap-1">
            {pipeline.map((step, idx) => {
              const isDone = idx < currentStepIdx;
              const isCurrent = idx === currentStepIdx;
              return (
                <View key={step} className="flex-row items-center">
                  {idx > 0 && <View className={`w-3 h-0.5 ${isDone ? 'bg-success' : 'bg-bgSurfaceLight'}`} />}
                  <View className={`w-2 h-2 rounded-full ${
                    isDone ? 'bg-success' : isCurrent ? 'bg-primary' : 'bg-bgSurfaceLight'
                  }`} />
                </View>
              );
            })}
            <Text className="text-textMuted text-xs ml-2">
              {OPS_STEP_LABELS[item.opsStep]}
              {item.stepPhase === 'active' ? ' ⏱' : ''}
            </Text>
          </View>
        )}

        {/* Row 5: Time + Action or Arrow */}
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center">
            <Clock size={13} color="#94A3B8" />
            <Text className="text-textMuted text-xs ml-1">
              {item.pickedUpAt ? `Picked up ${timeAgo}` : `Placed ${timeAgo}`}
            </Text>
          </View>
          {isProcessing ? (
            <ActivityIndicator size="small" color="#3B82F6" />
          ) : (
            <StepActionButton order={item} onAction={() => handleInlineAction(item)} />
          )}
          {(!item.opsStep || item.opsStep === 'tagging' || item.status === 'ready') && (
            <ChevronRight color="#64748B" size={18} />
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-bgDark">
      {/* Header */}
      <View className="px-4 pt-4 pb-2">
        <Text className="text-2xl font-bold text-textPrimary">Helper Queue</Text>
        <Text className="text-textSecondary">In-store order processing</Text>
      </View>

      {/* Tabs */}
      <View className="h-16 mb-2">
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          className="px-4"
          contentContainerStyle={{ alignItems: 'center' }}
        >
          {TABS.map(tab => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            const count = filterOrdersByTab(orders, tab.id).length;
            
            return (
              <TouchableOpacity
                key={tab.id}
                onPress={() => setActiveTab(tab.id)}
                className={`flex-row items-center px-4 py-2 rounded-full mr-2 border ${
                  isActive ? 'bg-bgSurface border-primary' : 'bg-bgDark border-bgSurfaceLight'
                }`}
              >
                <Icon size={14} color={isActive ? tab.color : '#64748B'} />
                <Text className={`font-bold mx-1.5 text-xs ${isActive ? 'text-textPrimary' : 'text-textSecondary'}`}>
                  {tab.label}
                </Text>
                {count > 0 && (
                  <View className={`w-5 h-5 rounded-full items-center justify-center ${
                    isActive ? 'bg-primary' : 'bg-bgSurfaceLight'
                  }`}>
                    <Text className="text-white text-xs font-bold">{count}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Orders List */}
      <View className="flex-1 px-4">
        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#3B82F6" />
            <Text className="text-textSecondary mt-4 font-bold">Syncing Production Orders...</Text>
          </View>
        ) : filteredOrders.length > 0 ? (
          <FlatList
            data={filteredOrders}
            keyExtractor={item => item.id}
            renderItem={renderOrderCard}
            showsVerticalScrollIndicator={false}
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            <CheckCircle2 size={48} color="#22C55E" />
            <Text className="text-textSecondary text-lg font-bold mt-4">Queue is clear!</Text>
            <Text className="text-textMuted text-center mt-2">
              No orders in {TABS.find(t => t.id === activeTab)?.label}.
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
