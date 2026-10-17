import React, { memo, useState } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import {
  MapPin,
  Phone,
  Navigation,
  Clock,
  Package,
  Bike,
  Tag,
  Zap,
  MoreVertical,
  Edit3,
  CheckCircle2,
  Store,
} from 'lucide-react-native';
import { timeAgo, formatItemSummary, parseOrderTokens } from '../../utils/orderFeed';
import { SPINZO_STORE_ADDRESS, SPINZO_STORE_LOCATION } from '../../utils/storeGeo';

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
  stopNumber?: number;
  locality?: string;
  loadUnits?: number;
  showStatusPill?: boolean;
  onPrimary?: () => void;
  primaryLabel?: string;
  onEdit?: () => void;
  isUrgent?: boolean;
  pickupNote?: string;
  onToggleUrgent?: () => void;
  onEditPickupNote?: () => void;
}

const openDirections = (destAddr: string, lat?: number, lng?: number) => {
  let dest = destAddr;
  if (lat && lng) {
    dest = `${lat},${lng}`;
  }
  if (!dest) return;
  Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`).catch(() =>
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dest)}`)
  );
};

function RiderTaskCardInner(p: RiderTaskCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isPickup = p.type === 'pickup';
  const isInTransit = p.status === 'in_transit_to_store';
  const isCurrentActive = p.stopNumber === 1;

  // For orders in transit, destination is SpinZo Store Hub
  const targetAddress = isInTransit ? SPINZO_STORE_ADDRESS : (isPickup ? p.pickupAddress : p.deliveryAddress) || '';
  const targetLat = isInTransit ? SPINZO_STORE_LOCATION.latitude : p.lat;
  const targetLng = isInTransit ? SPINZO_STORE_LOCATION.longitude : p.lng;

  const slotDisplay = (p.pickupSlot || p.slot || (p.deliveryDate && p.deliveryTime ? `${p.deliveryDate} • ${p.deliveryTime}` : (p.deliveryDate || p.deliveryTime || '')) || '').trim();

  // Check if items already have tokens attached so we don't duplicate tokens at the bottom
  const itemsHaveTokens = Boolean(
    p.tokens &&
    p.items?.some(it => {
      const sid = String(it.serviceType || it.serviceId || '').toLowerCase();
      const st = it.serviceType ? p.tokens?.[it.serviceType] : undefined;
      const si = it.serviceId ? p.tokens?.[it.serviceId] : undefined;
      const s = sid ? p.tokens?.[sid] : undefined;
      return Boolean(st || si || s);
    })
  );

  return (
    <Pressable
      onPress={() => {
        if (menuOpen) setMenuOpen(false);
        else p.onPrimary?.();
      }}
      className={`bg-white rounded-3xl p-4 mb-4 border-2 shadow-sm active:opacity-95 overflow-hidden ${
        isCurrentActive
          ? 'border-purple-600 shadow-purple-600/20'
          : isInTransit
          ? 'border-emerald-500 shadow-emerald-500/15'
          : 'border-slate-300 shadow-slate-300/40'
      }`}
    >
      {/* Active Mission Top Banner */}
      {isCurrentActive && (
        <View className="bg-purple-600 -mt-4 -mx-4 mb-3.5 px-4 py-2 flex-row items-center justify-between shadow-xs">
          <View className="flex-row items-center">
            <Zap size={13} color="#FFFFFF" />
            <Text className="text-white font-black text-xs uppercase tracking-wider ml-1.5">
              Current Mission • Stop 1
            </Text>
          </View>
          <Text className="text-purple-100 font-extrabold text-[11px] uppercase tracking-wide">
            {isInTransit ? 'Store Handover' : 'Next Action'}
          </Text>
        </View>
      )}

      {/* Header: Stop badge + Order number + Badges */}
      <View className="flex-row items-start justify-between mb-2.5">
        <View className="flex-row items-start flex-1 mr-2">
          <View
            className={`w-11 h-11 rounded-2xl items-center justify-center mr-3 shadow-xs ${
              isInTransit
                ? 'bg-emerald-600'
                : isPickup
                ? 'bg-purple-600'
                : 'bg-blue-600'
            }`}
          >
            {isInTransit ? (
              <Store size={22} color="#FFFFFF" />
            ) : isPickup ? (
              <Bike size={22} color="#FFFFFF" />
            ) : (
              <Package size={22} color="#FFFFFF" />
            )}
          </View>

          <View className="flex-1">
            <View className="flex-row items-center flex-wrap gap-1.5 mb-1">
              {p.stopNumber ? (
                <View className="bg-purple-700 px-2.5 py-0.5 rounded-lg shadow-xs">
                  <Text className="text-white font-black text-xs tracking-wider">STOP {p.stopNumber}</Text>
                </View>
              ) : null}

              <Text className="text-slate-950 font-black text-lg tracking-tight">#{p.orderNumber}</Text>

              {p.locality ? (
                <View className="bg-slate-900 px-2 py-0.5 rounded-md">
                  <Text className="text-white font-black text-[11px] uppercase tracking-wide">{p.locality}</Text>
                </View>
              ) : null}

              {p.isUrgent ? (
                <View className="bg-red-600 px-2 py-0.5 rounded-md flex-row items-center shadow-xs">
                  <Zap size={10} color="#FFFFFF" className="mr-0.5" />
                  <Text className="text-white font-black text-[10px] uppercase">URGENT</Text>
                </View>
              ) : null}

              {p.loadUnits && p.loadUnits > 1 ? (
                <View className="bg-purple-100 border border-purple-400 px-2 py-0.5 rounded-md">
                  <Text className="text-purple-950 font-black text-[10px] uppercase">🐘 BULKY LOAD</Text>
                </View>
              ) : null}
            </View>

            {p.customerName ? (
              <Text className="text-slate-950 font-black text-base" numberOfLines={1}>
                {p.customerName}
              </Text>
            ) : null}
          </View>
        </View>

        <View className="flex-row items-center gap-1.5 mt-0.5">
          {p.createdAt ? (
            <View className="flex-row items-center bg-slate-100 border border-slate-200 px-2 py-1 rounded-md">
              <Clock size={11} color="#334155" />
              <Text className="text-slate-700 text-xs font-bold ml-1">{timeAgo(p.createdAt)}</Text>
            </View>
          ) : null}

          {isPickup && (p.onToggleUrgent || p.onEditPickupNote) ? (
            <Pressable
              onPress={(e) => {
                e?.stopPropagation?.();
                setMenuOpen(prev => !prev);
              }}
              className="w-8 h-8 rounded-full items-center justify-center bg-slate-100 border border-slate-300"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MoreVertical size={16} color="#0F172A" />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* 3-Dot Dropdown Menu */}
      {menuOpen ? (
        <View className="mb-3 bg-slate-50 border-2 border-slate-300 rounded-xl p-2 gap-1 shadow-md">
          {p.onToggleUrgent && (
            <Pressable
              onPress={(e) => {
                e?.stopPropagation?.();
                setMenuOpen(false);
                p.onToggleUrgent?.();
              }}
              className="flex-row items-center p-2 rounded-lg active:bg-slate-200"
            >
              <Zap size={14} color={p.isUrgent ? '#64748B' : '#DC2626'} className="mr-2" />
              <Text className={`text-xs font-black ${p.isUrgent ? 'text-slate-600' : 'text-red-700'}`}>
                {p.isUrgent ? 'Remove Urgent Mark' : 'Mark as Urgent'}
              </Text>
            </Pressable>
          )}

          {p.onEditPickupNote && (
            <Pressable
              onPress={(e) => {
                e?.stopPropagation?.();
                setMenuOpen(false);
                p.onEditPickupNote?.();
              }}
              className="flex-row items-center p-2 rounded-lg active:bg-slate-200"
            >
              <Edit3 size={14} color="#B45309" className="mr-2" />
              <Text className="text-amber-900 text-xs font-black">
                {p.pickupNote ? 'Edit Pickup Note' : 'Add Pickup Note'}
              </Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {/* Pickup Note Card */}
      {p.pickupNote ? (
        <View className="bg-amber-100 border-2 border-amber-400 p-3 rounded-2xl mb-3 shadow-xs">
          <View className="flex-row items-center justify-between mb-1">
            <Text className="text-amber-950 font-black text-xs uppercase tracking-wide">Pickup Note</Text>
            {p.onEditPickupNote && (
              <Pressable
                onPress={(e) => {
                  e?.stopPropagation?.();
                  p.onEditPickupNote?.();
                }}
              >
                <Text className="text-amber-900 text-xs font-black underline">Edit</Text>
              </Pressable>
            )}
          </View>
          <Text className="text-slate-950 text-xs font-bold leading-5">{p.pickupNote}</Text>
        </View>
      ) : null}

      {/* Status Callout Banner */}
      {isInTransit ? (
        <View className="flex-row items-center mb-3 px-3.5 py-3 rounded-2xl bg-emerald-600 shadow-sm shadow-emerald-600/30">
          <Package size={18} color="#FFFFFF" />
          <View className="ml-2.5 flex-1">
            <Text className="text-white font-black text-xs uppercase tracking-wider">
              🎒 IN YOUR BAG • DROP AT STORE
            </Text>
            <Text className="text-emerald-100 text-[11px] font-bold mt-0.5">
              SpinZo Store Hub (BTM 1st Stage Outer Ring Rd)
            </Text>
          </View>
        </View>
      ) : slotDisplay ? (() => {
        const isInstant = Boolean(slotDisplay && slotDisplay.toLowerCase().includes('instant'));
        return (
          <View
            className={`flex-row items-center mb-3 px-3.5 py-2.5 rounded-2xl border-2 shadow-xs ${
              isInstant ? 'bg-amber-50 border-amber-400' : 'bg-slate-100 border-slate-300'
            }`}
          >
            {isInstant ? <Zap size={16} color="#B45309" /> : <Clock size={16} color="#047857" />}
            <View className="ml-2.5 flex-1 flex-row items-center justify-between flex-wrap">
              <Text className={`font-black text-xs uppercase tracking-wide ${isInstant ? 'text-amber-950' : 'text-slate-700'}`}>
                {isPickup ? (isInstant ? '⚡ Instant Pickup: ' : 'Pickup Window: ') : 'Delivery Window: '}
              </Text>
              <Text className={isInstant ? 'text-slate-950 font-black text-xs' : 'text-slate-900 font-bold text-xs'}>
                {slotDisplay.replace(/^Instant\s*[•\-–]\s*/i, '')}
              </Text>
            </View>
          </View>
        );
      })() : null}

      {/* Address Container */}
      {targetAddress ? (
        <View className="mb-3 bg-slate-100/90 border border-slate-300 p-3.5 rounded-2xl">
          <View className="flex-row items-start mb-2">
            <View className="w-6 h-6 rounded-md bg-blue-600 items-center justify-center mr-2 mt-0.5 shadow-xs">
              <MapPin size={13} color="#FFFFFF" />
            </View>
            <View className="flex-1">
              <Text className="text-slate-500 font-black text-[10px] uppercase tracking-wider mb-0.5">
                {isInTransit ? 'Handover Destination' : isPickup ? 'Pickup Location' : 'Delivery Location'}
              </Text>
              <Text className="text-slate-950 text-xs font-bold leading-5">{targetAddress}</Text>
              {isInTransit && p.pickupAddress && p.pickupAddress !== targetAddress && (
                <Text className="text-slate-500 text-[11px] font-semibold mt-1">
                  Customer origin: {p.pickupAddress}
                </Text>
              )}
            </View>
          </View>
        </View>
      ) : null}

      {/* Quick Actions Bar (Dedicated Large Buttons for Call & Directions) */}
      <View className="flex-row gap-2 mb-3.5">
        {p.customerPhone ? (
          <Pressable
            onPress={(e) => {
              e?.stopPropagation?.();
              Linking.openURL(`tel:${p.customerPhone}`);
            }}
            className="flex-1 h-11 bg-emerald-50 active:bg-emerald-100 border-2 border-emerald-500 rounded-xl flex-row items-center justify-center shadow-xs"
          >
            <Phone size={15} color="#047857" className="mr-1.5" />
            <Text className="text-emerald-950 font-black text-xs">Call Customer</Text>
          </Pressable>
        ) : null}

        {targetAddress ? (
          <Pressable
            onPress={(e) => {
              e?.stopPropagation?.();
              openDirections(targetAddress, targetLat, targetLng);
            }}
            className="flex-1 h-11 bg-blue-600 active:bg-blue-700 rounded-xl flex-row items-center justify-center shadow-xs"
          >
            <Navigation size={14} color="#FFFFFF" className="mr-1.5" />
            <Text className="text-white font-black text-xs">Directions</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Order items + breakdown */}
      {p.items && p.items.length > 0 ? (
        <View className="mb-3.5 pt-3 border-t-2 border-slate-200">
          <Text className="text-slate-900 text-xs font-black uppercase tracking-wider mb-2">Order Items</Text>
          <View className="gap-2 mb-2.5">
            {(p.items as any[]).map((it, idx) => {
              const { title, details, price, notes } = formatItemSummary(it);
              const sid = String(it.serviceType || it.serviceId || '').toLowerCase();
              const itemToken = p.tokens?.[it.serviceType] || p.tokens?.[it.serviceId] || p.tokens?.[sid];
              return (
                <View key={idx} className="bg-slate-50 p-3 rounded-2xl border border-slate-300">
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1 mr-2">
                      <View className="flex-row items-center flex-wrap gap-1.5">
                        <Text className="text-slate-950 font-extrabold text-sm">{title}</Text>
                        {details ? (
                          <View className="bg-blue-600 px-2 py-0.5 rounded">
                            <Text className="text-white text-xs font-black">{details}</Text>
                          </View>
                        ) : null}
                        {itemToken ? (
                          <View className="bg-amber-400 border border-amber-500 px-2 py-0.5 rounded shadow-xs">
                            <Text className="text-slate-950 text-xs font-black">Token #{itemToken}</Text>
                          </View>
                        ) : null}
                      </View>
                      {notes ? (
                        <Text className="text-slate-600 text-xs mt-1 font-medium italic">{notes}</Text>
                      ) : null}
                    </View>
                    {price ? (
                      <Text className="text-slate-950 font-black text-base">{price}</Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>

          {typeof p.totalAmount === 'number' && (
            <View className="flex-row items-center justify-between pt-2.5 border-t border-slate-300">
              <View className="flex-row items-center">
                <Text className="text-slate-700 text-xs uppercase font-black mr-2">Total Amount:</Text>
                <Text className="text-slate-950 font-black text-lg">₹{p.totalAmount}</Text>
              </View>
              {p.paymentStatus ? (
                <View
                  className={`px-3 py-1 rounded-lg border-2 ${
                    p.paymentStatus.toLowerCase() === 'paid'
                      ? 'bg-emerald-600 border-emerald-700'
                      : 'bg-amber-400 border-amber-500'
                  }`}
                >
                  <Text
                    className={`text-xs uppercase font-black ${
                      p.paymentStatus.toLowerCase() === 'paid' ? 'text-white' : 'text-slate-950'
                    }`}
                  >
                    {p.paymentStatus.toLowerCase() === 'paid' ? 'PAID ONLINE' : 'COLLECT CASH / UPI'}
                  </Text>
                </View>
              ) : null}
            </View>
          )}
        </View>
      ) : null}

      {/* Non-duplicate Tokens / Bundles / Instructions */}
      {(() => {
        const tokenChips = !itemsHaveTokens ? parseOrderTokens(p.tokens, p.tokenNumber, p.items) : [];
        const hasTokens = tokenChips.length > 0;
        const hasBundles = typeof p.bundleCount === 'number';
        const hasNotes = Boolean(p.notes);

        if (!hasTokens && !hasBundles && !hasNotes) return null;

        return (
          <View className="mb-3.5 gap-2">
            {(hasTokens || hasBundles) && (
              <View className="flex-row flex-wrap items-center gap-1.5">
                {tokenChips.map((c, idx) => (
                  <View key={idx} className="bg-amber-400 border border-amber-500 px-2.5 py-1 rounded-lg flex-row items-center shadow-xs">
                    <Tag size={12} color="#0F172A" className="mr-1.5" />
                    <Text className="text-slate-950 text-xs font-black">
                      Token #{c.token}
                      {c.serviceLabel ? <Text className="text-slate-800 font-bold"> ({c.serviceLabel})</Text> : null}
                    </Text>
                  </View>
                ))}

                {hasBundles && (
                  <View className="bg-blue-600 px-2.5 py-1 rounded-lg shadow-xs">
                    <Text className="text-white text-xs font-black">{p.bundleCount} bundle{p.bundleCount !== 1 ? 's' : ''}</Text>
                  </View>
                )}
              </View>
            )}

            {hasNotes && (
              <View className="bg-amber-50 border border-amber-300 p-2.5 rounded-xl">
                <Text className="text-amber-950 text-xs font-semibold">
                  <Text className="font-black uppercase">Instructions: </Text>{p.notes}
                </Text>
              </View>
            )}
          </View>
        );
      })()}

      {/* Actions (52px High-Impact Tactile CTA) */}
      <View className="flex-row gap-2 mt-1">
        {p.onEdit ? (
          <Pressable
            onPress={p.onEdit}
            className="bg-amber-50 active:bg-amber-100 border-2 border-amber-400 rounded-2xl h-13 px-4 items-center justify-center shadow-xs"
          >
            <Text className="text-amber-950 font-black text-xs uppercase tracking-wide">Edit Order</Text>
          </Pressable>
        ) : null}
        {p.onPrimary && p.primaryLabel ? (
          <Pressable
            onPress={p.onPrimary}
            className={`flex-1 h-13 items-center justify-center rounded-2xl shadow-lg border-2 ${
              isInTransit
                ? 'bg-emerald-600 active:bg-emerald-700 border-emerald-400 shadow-emerald-600/30'
                : 'bg-purple-600 active:bg-purple-700 border-purple-400 shadow-purple-600/30'
            }`}
          >
            <Text className="text-white font-black text-sm uppercase tracking-wider">
              {isInTransit ? '🏬 Handover to Store (Verify OTP)' : '🔐 Verify Pickup OTP (4-Digit)'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

export const RiderTaskCard = memo(RiderTaskCardInner);
