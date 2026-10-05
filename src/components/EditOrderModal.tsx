import React, { useEffect, useState } from 'react';
import { View, Text, Modal, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { X, Minus, Plus, AlertTriangle } from 'lucide-react-native';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';
import { SHOE_EDIT_CATEGORIES, calculateItemPrice, calculateDeliveryFee } from '../utils/editPricing';

interface EditOrderModalProps {
  visible: boolean;
  onClose: () => void;
  order: any; // FeedOrder with items
}

export function EditOrderModal({ visible, onClose, order }: EditOrderModalProps) {
  const [items, setItems] = useState<any[]>([]);
  const [itemTotal, setItemTotal] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [grandTotal, setGrandTotal] = useState(0);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (order && order.items) {
      const initialItems = JSON.parse(JSON.stringify(order.items)).map((it: any) => {
        const sid = (it.serviceId || it.serviceType || '').toLowerCase();
        const isWF = sid === 'wash_fold';
        const isWI = sid === 'wash_iron';
        const isIroningOnly = sid === 'ironing' || sid === 'ironing_addon' || it.serviceName?.toLowerCase().includes('ironing');
        return {
          ...it,
          serviceId: sid,
          serviceType: it.serviceType || sid,
          weight: it.weight || ((isWF || isWI) ? 5 : undefined),
          ironingEnabled: isWF ? Boolean(it.ironingEnabled) : undefined,
          ironingCount: isWF && it.ironingEnabled ? (it.ironingCount || 0) : (isIroningOnly ? (it.ironingCount || it.clothesCount || it.quantity || 1) : 0),
          clothesCount: (isWF || isWI) ? undefined : it.clothesCount,
        };
      });
      setItems(initialItems);
      setDiscount(order.billDetails?.discount || 0);
      const fee = order.billDetails?.deliveryFee || 0;
      setDeliveryFee(fee);
      const initialItemTotal = order.billDetails?.itemTotal || order.totalAmount || 0;
      setItemTotal(initialItemTotal);
      setGrandTotal(order.billDetails?.total || order.totalAmount || 0);
    }
  }, [order]);

  // Recalculate totals whenever items change
  useEffect(() => {
    const newItemTotal = items.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
    setItemTotal(newItemTotal);
    const newDeliveryFee = calculateDeliveryFee(items);
    setDeliveryFee(newDeliveryFee);
    setGrandTotal(newItemTotal + newDeliveryFee - discount);
  }, [items, discount]);

  const updateItem = (index: number, updates: any) => {
    const newItems = [...items];
    const current = newItems[index];
    const sid = (current.serviceId || current.serviceType || '').toLowerCase();
    const updatedItem = {
      ...current,
      ...updates,
      serviceId: sid,
      serviceType: current.serviceType || sid,
    };

    // Update derived fields
    if (sid === 'blanket_wash') {
      updatedItem.blanketQuantity = (updatedItem.singleBlanketCount || 0) + (updatedItem.doubleBlanketCount || 0);
      const parts = [];
      if (updatedItem.singleBlanketCount > 0) parts.push(`${updatedItem.singleBlanketCount} Single`);
      if (updatedItem.doubleBlanketCount > 0) parts.push(`${updatedItem.doubleBlanketCount} Double`);
      updatedItem.description = parts.join(', ');
    }
    if (sid === 'ironing') {
      updatedItem.ironingPrice = (updatedItem.ironingCount || updatedItem.clothesCount || 0) * 10;
    }
    if (sid === 'premium_laundry') {
      const weight = updatedItem.weight || 5;
      const estClothes = Math.round(weight * 3);
      updatedItem.clothesCount = estClothes;
      updatedItem.ironingCount = estClothes;
      updatedItem.ironingEnabled = true;
      updatedItem.ironingPrice = 0;
      updatedItem.quantity = 1;
    }
    if (sid === 'shoe_clean') {
      const shoeItems = updatedItem.shoeItems || [];
      const subtotal = shoeItems.reduce((sum: number, s: any) => sum + (s.quantity || 0) * (s.price || 0), 0);
      const totalCount = shoeItems.reduce((sum: number, s: any) => sum + (s.quantity || 0), 0);
      updatedItem.shoeSubtotal = subtotal;
      updatedItem.shoeCount = totalCount;
      updatedItem.shoeQuantity = totalCount;
      updatedItem.quantity = totalCount;
      updatedItem.deliveryFee = totalCount > 0 ? 50 : 0;
      updatedItem.description = shoeItems.filter((s: any) => s.quantity > 0).map((s: any) => `${s.name} ×${s.quantity}`).join(', ');
    }

    // Recalculate price
    updatedItem.totalPrice = calculateItemPrice(updatedItem);

    if (sid === 'wash_fold' && !updatedItem.isCreditItem) {
      updatedItem.quantity = 1;
      const maxPieces = Math.round((updatedItem.weight || 5) * 3);
      if (!updatedItem.ironingEnabled) {
        updatedItem.ironingCount = 0;
      } else if (updatedItem.ironingCount > maxPieces) {
        updatedItem.ironingCount = maxPieces;
      }
    }

    newItems[index] = updatedItem;
    setItems(newItems);
  };

  const updateShoeCount = (itemIndex: number, categoryId: string, delta: number) => {
    const currentItem = items[itemIndex];
    const existingItems: any[] = currentItem.shoeItems ? [...currentItem.shoeItems] : [];

    const counts: Record<string, number> = {};
    SHOE_EDIT_CATEGORIES.forEach((cat) => {
      const found = existingItems.find((s: any) => s.type === cat.id);
      counts[cat.id] = found ? (found.quantity || 0) : 0;
    });

    if (existingItems.length === 0 && (currentItem.shoeQuantity || currentItem.shoeCount || 0) > 0) {
      counts['canvas_sports'] = currentItem.shoeQuantity || currentItem.shoeCount || 0;
    }

    counts[categoryId] = Math.max(0, (counts[categoryId] || 0) + delta);

    const updatedShoeItems = SHOE_EDIT_CATEGORIES
      .filter((cat) => (counts[cat.id] || 0) > 0)
      .map((cat) => ({
        type: cat.id,
        name: cat.name,
        quantity: counts[cat.id],
        price: cat.price,
      }));

    updateItem(itemIndex, { shoeItems: updatedShoeItems });
  };

  const handleSave = async () => {
    if (!order) return;
    setProcessing(true);
    try {
      const callable = httpsCallable(functions, 'opsProcessing');
      const res: any = await callable({
        orderId: order.id,
        action: 'editOrder',
        items,
        totalAmount: grandTotal,
        billDetails: {
          ...(order.billDetails || {}),
          itemTotal,
          discount,
          deliveryFee,
          total: grandTotal
        }
      });
      if (res.data?.ok) {
        Alert.alert('Success', 'Order updated successfully');
        onClose();
      } else {
        Alert.alert('Error', res.data?.error || 'Failed to update order');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to update order');
    } finally {
      setProcessing(false);
    }
  };

  if (!visible) return null;

  const CounterRow = ({ label, value, onDecrement, onIncrement, disableDecrement }: any) => (
    <View>
      <Text className="text-xs text-gray-500 font-medium mb-2">{label}</Text>
      <View className="flex-row items-center gap-3">
        <TouchableOpacity
          onPress={onDecrement}
          disabled={disableDecrement}
          className={`w-10 h-10 rounded-lg items-center justify-center ${disableDecrement ? 'bg-gray-100' : 'bg-gray-200'}`}
        >
          <Minus size={16} color={disableDecrement ? '#d1d5db' : '#1f2937'} />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-gray-900 min-w-[40px] text-center">{value}</Text>
        <TouchableOpacity
          onPress={onIncrement}
          className="w-10 h-10 rounded-lg bg-gray-200 items-center justify-center"
        >
          <Plus size={16} color="#1f2937" />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View className="flex-1 bg-white">
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-4 border-b border-gray-200">
          <Text className="text-xl font-bold text-gray-900">Edit Order</Text>
          <TouchableOpacity onPress={onClose} className="w-9 h-9 rounded-full bg-gray-100 items-center justify-center">
            <X size={18} color="#6b7280" />
          </TouchableOpacity>
        </View>

        {/* Warning Banner */}
        <View className="mx-4 mt-3 flex-row items-center bg-amber-50 border border-amber-200 rounded-xl p-3 gap-2">
          <AlertTriangle size={18} color="#d97706" />
          <Text className="flex-1 text-amber-800 text-xs">
            Actual weight is verified at pickup. Changes are allowed only before processing starts.
          </Text>
        </View>

        {/* Items List */}
        <ScrollView className="flex-1 px-4 pt-4" contentContainerStyle={{ paddingBottom: 160 }}>
          {items.map((item, index) => {
            const sid = (item.serviceId || item.serviceType || '').toLowerCase();
            return (
              <View key={index} className="mb-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
                {/* Item Header */}
                <View className="flex-row justify-between mb-3">
                  <Text className="text-base font-bold text-gray-900">{item.serviceName || item.name || item.serviceType}</Text>
                  <Text className="text-base font-bold text-blue-600">₹{item.totalPrice}</Text>
                </View>

                {/* Wash & Fold */}
                {sid === 'wash_fold' && !item.isCreditItem && (
                  <View className="gap-3">
                    <CounterRow
                      label="Adjust Weight (₹85/kg)"
                      value={`${item.weight || 5} kg`}
                      onDecrement={() => updateItem(index, { weight: Math.max(5, (item.weight || 5) - 1) })}
                      onIncrement={() => updateItem(index, { weight: Math.min(50, (item.weight || 5) + 1) })}
                      disableDecrement={(item.weight || 5) <= 5}
                    />
                    {Boolean(item.ironingEnabled) && (item.ironingCount || 0) > 0 && (
                      <CounterRow
                        label="Ironing Count (₹18/pc)"
                        value={item.ironingCount || 0}
                        onDecrement={() => updateItem(index, { ironingCount: Math.max(0, (item.ironingCount || 0) - 1) })}
                        onIncrement={() => updateItem(index, { ironingCount: (item.ironingCount || 0) + 1 })}
                        disableDecrement={(item.ironingCount || 0) <= 0}
                      />
                    )}
                  </View>
                )}

                {/* Wash & Fold Credit */}
                {sid === 'wash_fold' && item.isCreditItem && (
                  <View className="gap-3">
                    <Text className="text-xs text-blue-600">Subscription Item (Paid via Credit)</Text>
                    <CounterRow
                      label="Adjust Weight"
                      value={`${item.weight || 5} kg`}
                      onDecrement={() => updateItem(index, { weight: Math.max(5, (item.weight || 5) - 1) })}
                      onIncrement={() => updateItem(index, { weight: Math.min(50, (item.weight || 5) + 1) })}
                      disableDecrement={(item.weight || 5) <= 5}
                    />
                  </View>
                )}

                {/* Wash & Iron */}
                {sid === 'wash_iron' && (
                  <CounterRow
                    label="Adjust Weight (₹140/kg)"
                    value={`${item.weight || 5} kg`}
                    onDecrement={() => updateItem(index, { weight: Math.max(5, (item.weight || 5) - 1) })}
                    onIncrement={() => updateItem(index, { weight: Math.min(50, (item.weight || 5) + 1) })}
                    disableDecrement={(item.weight || 5) <= 5}
                  />
                )}

                {/* Steam Iron (standalone) */}
                {sid === 'ironing' && (
                  <CounterRow
                    label="Number of Pieces (₹10/pc)"
                    value={item.ironingCount || item.clothesCount || 0}
                    onDecrement={() => updateItem(index, {
                      ironingCount: Math.max(1, (item.ironingCount || item.clothesCount || 0) - 1),
                      clothesCount: Math.max(1, (item.ironingCount || item.clothesCount || 0) - 1),
                    })}
                    onIncrement={() => updateItem(index, {
                      ironingCount: (item.ironingCount || item.clothesCount || 0) + 1,
                      clothesCount: (item.ironingCount || item.clothesCount || 0) + 1,
                    })}
                    disableDecrement={(item.ironingCount || item.clothesCount || 0) <= 1}
                  />
                )}

                {/* Ironing Add-on */}
                {(sid === 'ironing_addon' || (item.serviceName?.toLowerCase().includes('ironing') && sid !== 'ironing')) && (
                  <CounterRow
                    label="Ironing Count (₹18/pc)"
                    value={item.ironingCount || item.clothesCount || 0}
                    onDecrement={() => updateItem(index, {
                      ironingCount: Math.max(0, (item.ironingCount || item.clothesCount || 0) - 1),
                      clothesCount: Math.max(0, (item.ironingCount || item.clothesCount || 0) - 1),
                    })}
                    onIncrement={() => updateItem(index, {
                      ironingCount: (item.ironingCount || item.clothesCount || 0) + 1,
                      clothesCount: (item.ironingCount || item.clothesCount || 0) + 1,
                    })}
                    disableDecrement={(item.ironingCount || item.clothesCount || 0) <= 0}
                  />
                )}

                {/* Premium Laundry */}
                {sid === 'premium_laundry' && (
                  <View className="gap-3">
                    <CounterRow
                      label="Adjust Weight (₹200/kg)"
                      value={`${item.weight || 5} kg`}
                      onDecrement={() => updateItem(index, { weight: Math.max(5, (item.weight || 5) - 1) })}
                      onIncrement={() => updateItem(index, { weight: Math.min(50, (item.weight || 5) + 1) })}
                      disableDecrement={(item.weight || 5) <= 5}
                    />
                    <View className="flex-row items-center justify-between">
                      <View className="bg-purple-100 px-2 py-0.5 rounded">
                        <Text className="text-purple-700 font-bold text-[10px]">STEAM PRESS INCLUDED</Text>
                      </View>
                      <Text className="text-gray-500 text-xs">~{Math.round((item.weight || 5) * 3)} clothes · Free delivery</Text>
                    </View>
                  </View>
                )}

                {/* Shoe Clean */}
                {sid === 'shoe_clean' && (
                  <View className="gap-3">
                    <Text className="text-xs text-gray-500 font-medium">Adjust Footwear Quantities</Text>
                    {SHOE_EDIT_CATEGORIES.map((cat) => {
                      const currentCount = item.shoeItems?.find((s: any) => s.type === cat.id)?.quantity ||
                        (cat.id === 'canvas_sports' && (!item.shoeItems || item.shoeItems.length === 0) ? (item.shoeQuantity || item.shoeCount || 0) : 0);
                      return (
                        <CounterRow
                          key={cat.id}
                          label={`${cat.name} (₹${cat.price}/pair)`}
                          value={currentCount}
                          onDecrement={() => updateShoeCount(index, cat.id, -1)}
                          onIncrement={() => updateShoeCount(index, cat.id, 1)}
                          disableDecrement={currentCount <= 0}
                        />
                      );
                    })}
                    <View className="pt-2 border-t border-gray-200">
                      <Text className="text-gray-500 text-xs">
                        Footwear Subtotal: ₹{item.shoeSubtotal || 0} + Pickup & Delivery: ₹{(item.shoeSubtotal || 0) > 0 ? (item.deliveryFee ?? 50) : 0}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Blanket Wash */}
                {sid === 'blanket_wash' && (
                  <View className="gap-3">
                    <CounterRow
                      label="Single Blankets (₹299)"
                      value={item.singleBlanketCount || 0}
                      onDecrement={() => updateItem(index, { singleBlanketCount: Math.max(0, (item.singleBlanketCount || 0) - 1) })}
                      onIncrement={() => updateItem(index, { singleBlanketCount: (item.singleBlanketCount || 0) + 1 })}
                      disableDecrement={(item.singleBlanketCount || 0) <= 0}
                    />
                    <CounterRow
                      label="Double Blankets (₹399)"
                      value={item.doubleBlanketCount || 0}
                      onDecrement={() => updateItem(index, { doubleBlanketCount: Math.max(0, (item.doubleBlanketCount || 0) - 1) })}
                      onIncrement={() => updateItem(index, { doubleBlanketCount: (item.doubleBlanketCount || 0) + 1 })}
                      disableDecrement={(item.doubleBlanketCount || 0) <= 0}
                    />
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>

        {/* Bottom Bill Summary + Save */}
        <View className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 pb-8 shadow-lg">
          <View className="gap-1 mb-4">
            <View className="flex-row justify-between">
              <Text className="text-gray-500 text-sm">Item Total</Text>
              <Text className="text-gray-700 text-sm">₹{itemTotal}</Text>
            </View>
            {deliveryFee > 0 && (
              <View className="flex-row justify-between">
                <Text className="text-gray-500 text-sm">Pick up & Delivery Fee</Text>
                <Text className="text-gray-700 text-sm">₹{deliveryFee}</Text>
              </View>
            )}
            {discount > 0 && (
              <View className="flex-row justify-between">
                <Text className="text-green-600 text-sm">Applied Discount</Text>
                <Text className="text-green-600 text-sm">-₹{discount}</Text>
              </View>
            )}
            <View className="flex-row justify-between mt-2 pt-2 border-t border-gray-200">
              <Text className="text-gray-900 font-bold text-base">Updated Total</Text>
              <Text className="text-blue-600 font-bold text-lg">₹{grandTotal}</Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={handleSave}
            disabled={processing}
            className={`h-14 rounded-xl items-center justify-center ${processing ? 'bg-gray-300' : 'bg-blue-600'}`}
          >
            {processing ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-base">Save Changes</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
