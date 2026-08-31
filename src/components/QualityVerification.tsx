import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Camera, Video, CheckCircle2, Package } from 'lucide-react-native';

interface QualityVerificationProps {
  onComplete: () => void;
}

export const QualityVerification = ({ onComplete }: QualityVerificationProps) => {
  const [photos, setPhotos] = useState<boolean[]>([false, false, false]);
  const [video, setVideo] = useState(false);
  const [bundles, setBundles] = useState<number>(0);

  const takePhoto = (idx: number) => {
    const next = [...photos];
    next[idx] = true;
    setPhotos(next);
  };

  const takeVideo = () => setVideo(true);

  const allDone = photos.every(p => p) && video && bundles > 0;

  return (
    <View className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 mb-4">
      <Text className="text-gray-900 font-bold mb-4">Quality Verification</Text>
      
      <View className="flex-row gap-3 mb-4">
        {[0, 1, 2].map((idx) => (
          <TouchableOpacity 
            key={idx}
            onPress={() => takePhoto(idx)}
            className={`flex-1 h-20 rounded-xl items-center justify-center border-2 ${photos[idx] ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-gray-50'}`}
          >
            {photos[idx] ? <CheckCircle2 color="#22c55e" size={24} /> : <Camera color="#9ca3af" size={24} />}
            <Text className={`text-xs mt-1 ${photos[idx] ? 'text-green-600' : 'text-gray-400'}`}>Photo {idx + 1}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity 
        onPress={takeVideo}
        className={`h-16 rounded-xl flex-row items-center justify-center gap-2 mb-4 border-2 ${video ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-gray-50'}`}
      >
        {video ? <CheckCircle2 color="#22c55e" size={20} /> : <Video color="#9ca3af" size={20} />}
        <Text className={`font-medium ${video ? 'text-green-600' : 'text-gray-500'}`}>
          {video ? 'Video Recorded' : 'Record Short Video'}
        </Text>
      </TouchableOpacity>

      <View className="flex-row items-center justify-between bg-gray-50 p-4 rounded-xl mb-6 border border-gray-200">
        <View className="flex-row items-center gap-2">
          <Package color="#64748B" size={20} />
          <Text className="text-gray-700 font-medium">Bundles / Hangers</Text>
        </View>
        <View className="flex-row items-center gap-4">
          <TouchableOpacity 
            onPress={() => setBundles(Math.max(0, bundles - 1))}
            className="w-8 h-8 rounded-full bg-white border border-gray-300 items-center justify-center"
          >
            <Text className="text-gray-700 font-bold">-</Text>
          </TouchableOpacity>
          <Text className="text-xl font-bold text-gray-900">{bundles}</Text>
          <TouchableOpacity 
            onPress={() => setBundles(bundles + 1)}
            className="w-8 h-8 rounded-full bg-white border border-gray-300 items-center justify-center"
          >
            <Text className="text-gray-700 font-bold">+</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity 
        onPress={onComplete}
        disabled={!allDone}
        className={`h-14 rounded-xl items-center justify-center ${allDone ? 'bg-[#994bff]' : 'bg-gray-200'}`}
      >
        <Text className={`font-bold text-lg ${allDone ? 'text-white' : 'text-gray-400'}`}>Complete Verification</Text>
      </TouchableOpacity>
    </View>
  );
};
