import React, { memo } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import {
  MapPin,
  Phone,
  Navigation,
  Clock,
  Package,
  Bike,
  Tag,
} from 'lucide-react-native';
import { timeAgo, formatItemSummary, parseOrderTokens } from '../../utils/orderFeed';

export interface RiderTaskCardProps {
  type: 'pickup' | 'delivery';
  orderNumber: string;
  customerName?: string | null;
  customerPhone?: string | null;
  status: string;
  createdAt?: unknown;
  items?: Array<{
    serviceName?: string;
    serviceType?: string;
    serviceId?: string;
    name?: string;
    quantity?: number;
    unit?: string;
    weight?: number;
    ironingCount?: number;
    ironingEnabled?: boolean;
    clothesCount?: number;
    singleBlanketCount?: number;
    doubleBlanketCount?: number;
    blanketQuantity?: number;
    blanketType?: string;
    description?: string;
    specialInstructions?: string;
    isCreditItem?: boolean;
    totalPrice?: number;
  }>;
  totalAmount?: number;
  paymentStatus?: string;
  pickupAddress?: string | null;
  deliveryAddress?: string | null;
  slot?: string;
  pickupSlot?: string;
  deliveryDate?: string | null;
  deliveryTime?: string | null;
  notes?: string;
  tokenNumber?: string | null;
  tokens?: Record<string, string> | null;
  bundleCount?: number;
  lat?: number;
  lng?: number;
  showStatusPill?: boolean;
  onPrimary?: () => void;
  primaryLabel?: string;
  onEdit?: () => void;
}

const openDirections = (addr: string, p: RiderTaskCardProps) => {
  let dest = addr;
  if (p.lat && p.lng) {
    dest = `${p.lat},${p.lng}`;
  }
  if (!dest) return;
  Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`).catch(() =>
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dest)}`)
  );
};

function RiderTaskCardInner(p: RiderTaskCardProps) {
  const isPickup = p.type === 'pickup';
  const addr = isPickup ? p.pickupAddress : p.deliveryAddress;
  const slotDisplay = (p.pickupSlot || p.slot || (p.deliveryDate && p.deliveryTime ? `${p.deliveryDate} • ${p.deliveryTime}` : (p.deliveryDate || p.deliveryTime || '')) || '').trim();

  return (
    <Pressable
      onPress={p.onPrimary}
      className="bg-bgSurface rounded-xl p-4 mb-3 border border-bgSurfaceLight active:opacity-90 cursor-pointer"
    >
      {/* Header: order number + customer + time */}
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center">
          <View className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${isPickup ? 'bg-info/15' : 'bg-primary/15'}`}>
            {isPickup ? <Bike size={18} color="#3B82F6" /> : <Package size={18} color="#994BFF" />}
          </View>
          <View>
            <Text className="text-textPrimary font-bold text-lg">#{p.orderNumber}</Text>
            {p.customerName ? (
              <Text className="text-textSecondary text-sm">{p.customerName}</Text>
            ) : null}
          </View>
        </View>
        {p.createdAt ? (
          <View className="flex-row items-center">
            <Clock size={13} color="#94A3B8" />
            <Text className="text-textMuted text-xs ml-1">{timeAgo(p.createdAt)}</Text>
          </View>
        ) : null}
      </View>

      {/* Address row */}
      {addr ? (
        <View className="flex-row items-start mb-3 bg-bgDark p-3 rounded-lg border border-bgSurfaceLight/40">
          <View className="w-8 h-8 rounded-full bg-bgSurfaceLight items-center justify-center mr-3">
            <MapPin size={14} color="#3B82F6" />
          </View>
          <View className="flex-1">
            <Text className="text-textSecondary text-sm leading-tight mb-2">{addr}</Text>
            <Pressable
              onPress={() => openDirections(addr, p)}
              className="flex-row items-center cursor-pointer"
            >
              <Navigation size={12} color="#3B82F6" className="mr-1" />
              <Text className="text-info text-xs font-bold">Get Directions</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Slot / times (cleanly formatted, never shows empty clock) */}
      {slotDisplay ? (
        <View className="flex-row items-center mb-3 bg-bgDark/60 px-3 py-2 rounded-lg border border-bgSurfaceLight/50">
          <Clock size={14} color="#22c55e" />
          <Text className="text-textSecondary text-xs ml-2 font-medium">
            <Text className="text-textMuted font-bold uppercase">{isPickup ? 'Pickup: ' : 'Delivery: '}</Text>
            {slotDisplay}
          </Text>
        </View>
      ) : null}

      {/* Order items + breakdown */}
      {p.items && p.items.length > 0 ? (
        <View className="mb-3 pt-3 border-t border-bgSurfaceLight">
          <Text className="text-textMuted text-[11px] font-bold uppercase tracking-wider mb-2">Order Items</Text>
          <View className="gap-2 mb-2.5">
            {(p.items as any[]).map((it, idx) => {
              const { title, details, price, notes } = formatItemSummary(it);
              const sid = String(it.serviceType || it.serviceId || '').toLowerCase();
              const itemToken = p.tokens?.[it.serviceType] || p.tokens?.[it.serviceId] || p.tokens?.[sid];
              return (
                <View key={idx} className="bg-bgDark/60 p-2.5 rounded-lg border border-bgSurfaceLight/60">
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1 mr-2">
                      <View className="flex-row items-center flex-wrap gap-1.5">
                        <Text className="text-textPrimary font-semibold text-sm">{title}</Text>
                        {details ? (
                          <View className="bg-info/10 border border-info/30 px-2 py-0.5 rounded">
                            <Text className="text-info text-xs font-bold">{details}</Text>
                          </View>
                        ) : null}
                        {itemToken ? (
                          <View className="bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded">
                            <Text className="text-warning text-xs font-bold">Token #{itemToken}</Text>
                          </View>
                        ) : null}
                      </View>
                      {notes ? (
                        <Text className="text-textMuted text-xs mt-1 italic">{notes}</Text>
                      ) : null}
                    </View>
                    {price ? (
                      <Text className="text-textSecondary font-bold text-sm">{price}</Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>

          {typeof p.totalAmount === 'number' && (
            <View className="flex-row items-center justify-between pt-2 border-t border-bgSurfaceLight/40">
              <View className="flex-row items-center">
                <Text className="text-textMuted text-xs uppercase font-bold mr-1.5">Total:</Text>
                <Text className="text-textPrimary font-extrabold text-base">₹{p.totalAmount}</Text>
              </View>
              {p.paymentStatus ? (
                <View className={`px-2 py-0.5 rounded ${p.paymentStatus.toLowerCase() === 'paid' ? 'bg-success/20' : 'bg-warning/20'}`}>
                  <Text className={`text-xs uppercase font-bold ${p.paymentStatus.toLowerCase() === 'paid' ? 'text-success' : 'text-warning'}`}>
                    {p.paymentStatus}
                  </Text>
                </View>
              ) : null}
            </View>
          )}
        </View>
      ) : null}

      {/* Customer phone */}
      {p.customerPhone ? (
        <Pressable
          onPress={() => Linking.openURL(`tel:${p.customerPhone}`)}
          className="flex-row items-center mb-3 cursor-pointer"
        >
          <Phone size={14} color="#94A3B8" />
          <Text className="text-info text-sm ml-2 font-medium">{p.customerPhone}</Text>
        </Pressable>
      ) : null}

      {/* Tokens / Bundles / Notes */}
      {(() => {
        const tokenChips = parseOrderTokens(p.tokens, p.tokenNumber, p.items);
        const hasTokens = tokenChips.length > 0;
        const hasBundles = typeof p.bundleCount === 'number';
        const hasNotes = Boolean(p.notes);

        if (!hasTokens && !hasBundles && !hasNotes) return null;

        return (
          <View className="mb-3 gap-2">
            {(hasTokens || hasBundles) && (
              <View className="flex-row flex-wrap items-center gap-1.5">
                {tokenChips.map((c, idx) => (
                  <View key={idx} className="bg-primary/15 border border-primary/40 px-2.5 py-1 rounded-md flex-row items-center">
                    <Tag size={12} color="#22c55e" className="mr-1.5" />
                    <Text className="text-primary text-xs font-bold">
                      Token #{c.token}
                      {c.serviceLabel ? <Text className="text-textMuted font-normal"> ({c.serviceLabel})</Text> : null}
                    </Text>
                  </View>
                ))}

                {hasBundles && (
                  <View className="bg-info/10 border border-info/30 px-2.5 py-1 rounded-md">
                    <Text className="text-info text-xs font-bold">{p.bundleCount} bundle{p.bundleCount !== 1 ? 's' : ''}</Text>
                  </View>
                )}
              </View>
            )}

            {hasNotes && (
              <View className="bg-amber-500/10 border border-amber-500/30 p-2.5 rounded-lg">
                <Text className="text-amber-400 text-xs font-medium">
                  <Text className="font-bold">Instructions: </Text>{p.notes}
                </Text>
              </View>
            )}
          </View>
        );
      })()}

      {/* Actions */}
      <View className="flex-row gap-2">
        {p.onEdit ? (
          <Pressable
            onPress={p.onEdit}
            className="flex-1 bg-amber-500/15 border border-amber-500/40 rounded-lg h-11 items-center justify-center cursor-pointer"
          >
            <Text className="text-amber-500 font-bold">Edit Order</Text>
          </Pressable>
        ) : null}
        {p.onPrimary && p.primaryLabel ? (
          <Pressable
            onPress={p.onPrimary}
            className={`flex-1 h-11 items-center justify-center rounded-lg ${isPickup ? 'bg-info/15 border border-info/40' : 'bg-primary/15 border border-primary/40'}`}
          >
            <Text className={`font-bold ${isPickup ? 'text-info' : 'text-primary'}`}>{p.primaryLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

export const RiderTaskCard = memo(RiderTaskCardInner);
