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
import { timeAgo } from '../../utils/orderFeed';

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
    quantity?: number;
    unit?: string;
    weight?: number;
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
        <View className="flex-row items-start mb-3 bg-bgDark p-3 rounded-lg">
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

      {/* Slot / times */}
      {(p.pickupSlot || p.slot || (p.deliveryDate && p.deliveryTime)) ? (
        <View className="flex-row items-center mb-3">
          <Clock size={14} color="#22c55e" />
          <Text className="text-textSecondary text-sm ml-2">
            {p.pickupSlot || p.slot || (p.deliveryDate && p.deliveryTime) ? `${p.deliveryDate || ''} ${p.deliveryTime || ''}`.trim() : ''}
          </Text>
        </View>
      ) : null}

      {/* Order items + total */}
      {p.items && p.items.length > 0 ? (
        <View className="mb-3 pt-3 border-t border-bgSurfaceLight">
          {(p.items as any[]).map((it, idx) => (
            <Text key={idx} className="text-textSecondary text-sm mb-0.5">
              • {it.serviceName || it.serviceType}{it.quantity ? ` ×${it.quantity}` : ''}
            </Text>
          ))}
          {typeof p.totalAmount === 'number' && (
            <View className="flex-row items-center justify-between mt-1">
              <Text className="text-textPrimary font-bold">₹{p.totalAmount}</Text>
              {p.paymentStatus ? (
                <View className="bg-bgSurfaceLight px-2 py-0.5 rounded">
                  <Text className="text-textSecondary text-xs uppercase font-bold">{p.paymentStatus}</Text>
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
          <Text className="text-info text-sm ml-2">{p.customerPhone}</Text>
        </Pressable>
      ) : null}

      {/* Token + notes */}
      {(p.tokenNumber || p.notes) ? (
        <View className="flex-row flex-wrap items-center mb-3">
          {p.tokenNumber ? (
            <View className="bg-bgSurfaceLight px-2 py-1 rounded-md mr-2">
              <Text className="text-textSecondary text-xs font-medium">Token #{p.tokenNumber}</Text>
            </View>
          ) : null}
          {typeof p.bundleCount === 'number' ? (
            <View className="bg-primary/10 px-2 py-1 rounded-md mr-2">
              <Text className="text-primary text-xs font-medium">{p.bundleCount} bundle{p.bundleCount !== 1 ? 's' : ''}</Text>
            </View>
          ) : null}
          {p.notes ? (
            <Text className="text-info text-xs">{p.notes}</Text>
          ) : null}
        </View>
      ) : null}

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
