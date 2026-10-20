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
  Zap,
  Edit3,
  Store,
  AlertTriangle,
} from 'lucide-react-native';
import { timeAgo, formatItemSummary, parseOrderTokens, formatDisplayPhone } from '../../utils/orderFeed';
import { extractLocality } from '../../utils/smartRoute';
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
  isOverdue?: boolean;
  unpaidAmount?: number;
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

const getInitials = (name?: string | null) => {
  if (!name) return '?';
  const clean = name.trim();
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
};

function RiderTaskCardInner(p: RiderTaskCardProps) {
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
      onPress={() => p.onPrimary?.()}
      className={`bg-white rounded-3xl mb-5 border overflow-hidden shadow-md active:opacity-98 ${
        isCurrentActive
          ? 'border-2 border-purple-600 shadow-lg shadow-purple-600/20'
          : isInTransit
          ? 'border border-emerald-400 shadow-md shadow-emerald-500/15'
          : 'border border-slate-200/90 shadow-md shadow-slate-300/50'
      }`}
    >
      {/* Active Mission Top Banner */}
      {isCurrentActive && (
        <View className="bg-purple-600 px-4 py-2 flex-row items-center justify-between">
          <View className="flex-row items-center">
            <Zap size={13} color="#FFFFFF" />
            <Text className="text-white font-black text-xs uppercase tracking-wider ml-1.5">
              CURRENT MISSION • STOP 1
            </Text>
          </View>
          <Text className="text-purple-100 font-extrabold text-[11px] uppercase tracking-wide">
            {isInTransit ? 'Store Handover' : 'Next Action'}
          </Text>
        </View>
      )}

      {/* Customer Identity Hero Header: Unmistakable distinct visual anchor */}
      <View
        className={`px-4 py-3.5 border-b flex-row items-center justify-between ${
          isInTransit
            ? 'bg-emerald-50/90 border-emerald-100'
            : isPickup
            ? 'bg-purple-50/90 border-purple-100'
            : 'bg-blue-50/90 border-blue-100'
        }`}
      >
        <View className="flex-row items-center flex-1 mr-2">
          {/* Avatar with Customer Initial or Store Icon */}
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
              <Store size={20} color="#FFFFFF" />
            ) : (
              <Text className="text-white font-black text-base uppercase">
                {getInitials(p.customerName)}
              </Text>
            )}
          </View>

          {/* Customer Name, Stop sequence, Order ID */}
          <View className="flex-1">
            <View className="flex-row items-center flex-wrap gap-1.5 mb-0.5">
              {p.stopNumber ? (
                <View
                  className={`px-2 py-0.5 rounded-md shadow-xs ${
                    isInTransit
                      ? 'bg-emerald-700'
                      : isPickup
                      ? 'bg-purple-700'
                      : 'bg-blue-700'
                  }`}
                >
                  <Text className="text-white font-black text-[11px] tracking-wider">
                    STOP {p.stopNumber}
                  </Text>
                </View>
              ) : null}

              <Text className="text-slate-700 font-black text-xs tracking-tight">
                #{p.orderNumber}
              </Text>

              {p.createdAt ? (
                <Text className="text-slate-400 font-bold text-[11px]">
                  • {timeAgo(p.createdAt)}
                </Text>
              ) : null}
            </View>

            <Text className="text-slate-950 font-black text-lg tracking-tight" numberOfLines={1}>
              {p.customerName || (p.customerPhone ? formatDisplayPhone(p.customerPhone) : (isInTransit ? 'SpinZo Store Hub' : 'Customer'))}
            </Text>

            {p.locality ? (
              <Text className="text-slate-500 font-extrabold text-[11px] uppercase tracking-wide mt-0.5" numberOfLines={1}>
                📍 {p.locality}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Right Action: Direct Phone Call button or Store pill */}
        {p.customerPhone && !isInTransit ? (
          <Pressable
            onPress={(e) => {
              e?.stopPropagation?.();
              Linking.openURL(`tel:${p.customerPhone}`);
            }}
            accessibilityLabel={`Call ${p.customerName || p.customerPhone}`}
            className="w-10 h-10 rounded-2xl bg-emerald-500 active:bg-emerald-600 items-center justify-center shadow-xs"
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Phone size={16} color="#FFFFFF" />
          </Pressable>
        ) : isInTransit ? (
          <View className="bg-emerald-600 px-2.5 py-1 rounded-xl shadow-xs">
            <Text className="text-white font-black text-[10px] uppercase tracking-wider">
              STORE DROP
            </Text>
          </View>
        ) : null}
      </View>

      {/* Card Body Container */}
      <View className="p-4">
        {/* Overdue Alert Strip (Inside Card) */}
        {p.isOverdue && (
          <View className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 flex-row items-center">
            <AlertTriangle size={14} color="#DC2626" className="mr-2 shrink-0" />
            <Text className="text-red-700 font-black text-xs uppercase tracking-wide">
              Overdue — Priority Delivery Required
            </Text>
          </View>
        )}

        {/* Unpaid Warning Strip (Inside Card) */}
        {typeof p.unpaidAmount === 'number' && p.unpaidAmount > 0 && (
          <View className="bg-amber-50 border border-amber-300 rounded-xl px-3 py-2 mb-3 flex-row items-center justify-between">
            <View className="flex-row items-center flex-1 mr-2">
              <AlertTriangle size={14} color="#D97706" className="mr-1.5 shrink-0" />
              <Text className="text-amber-950 font-black text-xs">
                UNPAID: ₹{p.unpaidAmount}
              </Text>
            </View>
            <Text className="text-amber-800 text-[11px] font-bold">Collect Cash / UPI</Text>
          </View>
        )}

        {/* Quick Status & Micro-Badges Bar */}
        <View className="flex-row items-center flex-wrap gap-1.5 mb-3">
          {p.isUrgent ? (
            <View className="bg-red-600 px-2.5 py-1 rounded-lg flex-row items-center shadow-xs">
              <Zap size={10} color="#FFFFFF" className="mr-1" />
              <Text className="text-white font-black text-[10px] uppercase">URGENT</Text>
            </View>
          ) : null}

          {p.loadUnits && p.loadUnits > 1 ? (
            <View className="bg-purple-100 border border-purple-300 px-2.5 py-1 rounded-lg">
              <Text className="text-purple-950 font-black text-[10px] uppercase">🐘 BULKY LOAD</Text>
            </View>
          ) : null}

          {p.onToggleUrgent && (
            <Pressable
              onPress={(e) => {
                e?.stopPropagation?.();
                p.onToggleUrgent?.();
              }}
              className={`flex-row items-center px-2.5 py-1 rounded-lg border active:opacity-80 ${
                p.isUrgent
                  ? 'bg-red-50 border-red-300'
                  : 'bg-slate-50 border-slate-200 active:bg-slate-100'
              }`}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Zap size={11} color={p.isUrgent ? '#DC2626' : '#64748B'} className="mr-1" />
              <Text className={`text-[10px] font-black uppercase ${
                p.isUrgent ? 'text-red-700' : 'text-slate-600'
              }`}>
                {p.isUrgent ? 'Marked Urgent' : 'Mark Urgent'}
              </Text>
            </Pressable>
          )}

          {p.onEditPickupNote && (
            <Pressable
              onPress={(e) => {
                e?.stopPropagation?.();
                p.onEditPickupNote?.();
              }}
              className={`flex-row items-center px-2.5 py-1 rounded-lg border active:opacity-80 ${
                p.pickupNote
                  ? 'bg-amber-100 border-amber-300'
                  : 'bg-slate-50 border-slate-200 active:bg-slate-100'
              }`}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Edit3 size={11} color={p.pickupNote ? '#B45309' : '#64748B'} className="mr-1" />
              <Text className={`text-[10px] font-black ${
                p.pickupNote ? 'text-amber-950' : 'text-slate-600'
              }`}>
                {p.pickupNote ? 'Edit Note' : 'Add Note'}
              </Text>
            </Pressable>
          )}
        </View>

        {/* Pickup Note Card (Amber callout with tap-to-edit) */}
        {p.pickupNote ? (
          <Pressable
            onPress={(e) => {
              e?.stopPropagation?.();
              p.onEditPickupNote?.();
            }}
            className="bg-amber-50 border border-amber-300 p-3 rounded-2xl mb-3 active:bg-amber-100"
          >
            <View className="flex-row items-center justify-between mb-0.5">
              <Text className="text-amber-950 font-black text-[10px] uppercase tracking-wider">📝 Pickup Note</Text>
              {p.onEditPickupNote && (
                <Text className="text-amber-800 text-[10px] font-black underline">Edit</Text>
              )}
            </View>
            <Text className="text-slate-900 text-xs font-semibold leading-4">{p.pickupNote}</Text>
          </Pressable>
        ) : null}

        {/* Time Slot Pill */}
        {slotDisplay ? (() => {
          const isInstant = Boolean(slotDisplay && slotDisplay.toLowerCase().includes('instant'));
          return (
            <View
              className={`flex-row items-center mb-2.5 px-3 py-2 rounded-xl border ${
                isInstant ? 'bg-amber-50 border-amber-300' : 'bg-slate-50 border-slate-200'
              }`}
            >
              {isInstant ? <Zap size={14} color="#B45309" /> : <Clock size={14} color="#475569" />}
              <Text className={`font-black text-xs ml-1.5 ${isInstant ? 'text-amber-950' : 'text-slate-800'}`}>
                {isInstant ? '⚡ Instant' : (isPickup ? 'Pickup Window' : 'Delivery Window')}:{' '}
                <Text className="font-bold text-slate-700">
                  {slotDisplay.replace(/^Instant\s*[•\-–]\s*/i, '')}
                </Text>
              </Text>
            </View>
          );
        })() : null}

        {/* Destination Section: Store Drop vs Customer Pickup/Delivery */}
        {isInTransit ? (
          /* Store Drop Strip */
          <View className="mb-3 bg-emerald-50 border border-emerald-200 p-3 rounded-2xl flex-row items-center justify-between">
            <View className="flex-row items-center flex-1 mr-2">
              <View className="w-8 h-8 rounded-xl bg-emerald-600 items-center justify-center mr-2.5">
                <Store size={15} color="#FFFFFF" />
              </View>
              <View className="flex-1">
                <Text className="text-emerald-950 font-black text-xs">Drop at SpinZo Store Hub</Text>
                <Text className="text-emerald-800 text-[11px] font-semibold mt-0.5" numberOfLines={1}>
                  {p.customerName ? `From ${p.customerName}${p.locality ? ` • ${p.locality}` : ''}` : 'In bag ready for store'}
                </Text>
              </View>
            </View>
            <Pressable
              onPress={(e) => {
                e?.stopPropagation?.();
                openDirections(targetAddress, targetLat, targetLng);
              }}
              className="bg-emerald-600 px-3 py-2 rounded-xl flex-row items-center active:bg-emerald-700 shadow-xs"
            >
              <Navigation size={12} color="#FFFFFF" className="mr-1" />
              <Text className="text-white text-xs font-black">Directions</Text>
            </Pressable>
          </View>
        ) : targetAddress ? (
          /* Customer Address with integrated Directions Action */
          <View className="mb-3 bg-slate-50 border border-slate-200 p-3 rounded-2xl">
            <View className="flex-row items-start justify-between">
              <View className="flex-row items-start flex-1 mr-2">
                <View className="w-6 h-6 rounded-lg bg-blue-600 items-center justify-center mr-2 mt-0.5 shadow-xs">
                  <MapPin size={12} color="#FFFFFF" />
                </View>
                <View className="flex-1">
                  <Text className="text-slate-400 font-black text-[9px] uppercase tracking-wider mb-0.5">
                    {isPickup ? 'Pickup Location' : 'Delivery Location'}
                  </Text>
                  <Text className="text-slate-900 text-xs font-bold leading-5">
                    {targetAddress}
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={(e) => {
                  e?.stopPropagation?.();
                  openDirections(targetAddress, targetLat, targetLng);
                }}
                className="bg-blue-600 active:bg-blue-700 px-3 py-2 rounded-xl flex-row items-center shadow-xs self-start"
              >
                <Navigation size={12} color="#FFFFFF" className="mr-1" />
                <Text className="text-white text-xs font-black">Directions</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* Order items + breakdown */}
        {p.items && p.items.length > 0 ? (
          <View className="mb-3 pt-2.5 border-t border-slate-100">
            <Text className="text-slate-500 text-[10px] font-black uppercase tracking-wider mb-1.5">
              Order Items ({p.items.length})
            </Text>
            <View className="gap-1.5 mb-2">
              {(p.items as any[]).map((it, idx) => {
                const { title, details, price, notes } = formatItemSummary(it);
                const sid = String(it.serviceType || it.serviceId || '').toLowerCase();
                const itemToken = p.tokens?.[it.serviceType] || p.tokens?.[it.serviceId] || p.tokens?.[sid];
                return (
                  <View key={idx} className="bg-slate-50/80 p-2.5 rounded-xl border border-slate-200">
                    <View className="flex-row items-center justify-between">
                      <View className="flex-1 mr-2">
                        <View className="flex-row items-center flex-wrap gap-1.5">
                          <Text className="text-slate-950 font-extrabold text-xs">{title}</Text>
                          {details ? (
                            <View className="bg-blue-600 px-1.5 py-0.2 rounded">
                              <Text className="text-white text-[10px] font-black">{details}</Text>
                            </View>
                          ) : null}
                          {itemToken ? (
                            <View className="bg-amber-400 px-1.5 py-0.2 rounded shadow-xs">
                              <Text className="text-slate-950 text-[10px] font-black">T-{itemToken}</Text>
                            </View>
                          ) : null}
                        </View>
                        {notes ? (
                          <Text className="text-slate-500 text-[11px] mt-0.5 font-medium italic">{notes}</Text>
                        ) : null}
                      </View>
                      {price ? (
                        <Text className="text-slate-950 font-black text-xs">{price}</Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* Tokens / Instructions if not rendered inside items */}
        {(() => {
          const tokenChips = !itemsHaveTokens ? parseOrderTokens(p.tokens, p.tokenNumber, p.items) : [];
          const hasTokens = tokenChips.length > 0;
          const hasNotes = Boolean(p.notes);

          if (!hasTokens && !hasNotes) return null;

          return (
            <View className="mb-3 gap-1.5">
              {hasTokens && (
                <View className="flex-row flex-wrap items-center gap-1">
                  {tokenChips.map((c, idx) => (
                    <View key={idx} className="bg-amber-400 px-2 py-0.5 rounded-md flex-row items-center shadow-xs">
                      <Tag size={10} color="#0F172A" className="mr-1" />
                      <Text className="text-slate-950 text-[11px] font-black">
                        T-{c.token}
                        {c.serviceLabel ? <Text className="text-slate-800 font-bold"> ({c.serviceLabel})</Text> : null}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {hasNotes && (
                <View className="bg-amber-50 border border-amber-200 p-2 rounded-lg">
                  <Text className="text-amber-950 text-[11px] font-semibold">
                    <Text className="font-black uppercase">Instructions: </Text>{p.notes}
                  </Text>
                </View>
              )}
            </View>
          );
        })()}

        {/* Total, Payment Status & Bundles Row */}
        <View className="flex-row items-center justify-between pt-2.5 mb-3.5 border-t border-slate-100">
          <View className="flex-row items-center">
            {typeof p.totalAmount === 'number' && (
              <View className="flex-row items-center mr-3">
                <Text className="text-slate-400 text-[11px] uppercase font-black mr-1">Total:</Text>
                <Text className="text-slate-950 font-black text-base">₹{p.totalAmount}</Text>
              </View>
            )}
            {typeof p.bundleCount === 'number' && (
              <View className="bg-blue-600 px-2.5 py-0.5 rounded-lg shadow-xs">
                <Text className="text-white text-[11px] font-black">
                  {p.bundleCount} bundle{p.bundleCount !== 1 ? 's' : ''}
                </Text>
              </View>
            )}
          </View>

          {p.paymentStatus ? (
            <View
              className={`px-3 py-1 rounded-lg ${
                p.paymentStatus.toLowerCase() === 'paid'
                  ? 'bg-emerald-100 border border-emerald-300'
                  : 'bg-amber-100 border border-amber-300'
              }`}
            >
              <Text
                className={`text-[10px] uppercase font-black ${
                  p.paymentStatus.toLowerCase() === 'paid' ? 'text-emerald-950' : 'text-amber-950'
                }`}
              >
                {p.paymentStatus.toLowerCase() === 'paid' ? 'PAID ONLINE' : 'COLLECT CASH / UPI'}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Actions (Tactile 48px CTAs) */}
        <View className="flex-row gap-2">
          {p.onEdit ? (
            <Pressable
              onPress={p.onEdit}
              className="bg-amber-50 active:bg-amber-100 border border-amber-300 rounded-2xl h-12 px-4 items-center justify-center"
            >
              <Text className="text-amber-950 font-black text-xs uppercase tracking-wide">Edit</Text>
            </Pressable>
          ) : null}
          {p.onPrimary && p.primaryLabel ? (
            <Pressable
              onPress={p.onPrimary}
              className={`flex-1 h-12 items-center justify-center rounded-2xl shadow-md ${
                isInTransit
                  ? 'bg-emerald-600 active:bg-emerald-700 shadow-emerald-600/30'
                  : isPickup
                  ? 'bg-purple-600 active:bg-purple-700 shadow-purple-600/30'
                  : 'bg-blue-600 active:bg-blue-700 shadow-blue-600/30'
              }`}
            >
              <Text className="text-white font-black text-sm uppercase tracking-wider">
                {p.primaryLabel}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export const RiderTaskCard = memo(RiderTaskCardInner);

