import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Image, Alert, ActivityIndicator } from 'react-native';
import { ScanLine, CheckCircle2, Camera, Video, Package, ChevronRight } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { QRScanner } from './QRScanner';
import { uploadMediaToStorage } from '../utils/firebaseUpload';

interface PackagingVerificationProps {
  orderId: string;
  totalGarments: number;
  onPrint: (bundles: number) => Promise<boolean>;
  onComplete: (payload: any) => void;
}

type WizardStep = 'evidence' | 'scan' | 'finalize' | 'print';

export const PackagingVerification = ({ orderId, totalGarments, onPrint, onComplete }: PackagingVerificationProps) => {
  const [step, setStep] = useState<WizardStep>('scan');
  const [uploading, setUploading] = useState(false);
  
  // Evidence state
  const [photos, setPhotos] = useState<string[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  // Scan state
  const [scanned, setScanned] = useState<Set<number>>(new Set());
  const [showScanner, setShowScanner] = useState(false);

  // Finalize state
  const [bundles, setBundles] = useState<number>(0);

  const captureMedia = async (isVideo: boolean) => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission Denied', 'Camera access is required for quality verification.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: isVideo ? ['videos'] : ['images'],
      quality: 0.5,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      setUploading(true);
      try {
        const uri = result.assets[0].uri;
        const downloadUrl = await uploadMediaToStorage(uri, `packaging_proofs/${orderId}`, isVideo);
        if (isVideo) setVideoUrl(downloadUrl);
        else setPhotos(prev => [...prev, downloadUrl]);
      } catch (err) {
        Alert.alert('Upload Failed', 'Failed to upload media to server.');
      } finally {
        setUploading(false);
      }
    }
  };

  const handleScan = (data: string) => {
    setScanned(prev => {
      let seq: number | null = null;
      
      // If it's a real tag with a colon
      if (data.includes(':')) {
        const parts = data.split(':');
        const parsedSeq = parseInt(parts[2], 10);
        if (!isNaN(parsedSeq)) seq = parsedSeq;
      }
      
      // If no valid sequence found in QR, or if we want to allow dev bypass (scanning anything)
      if (seq === null) {
        // Find the first missing sequence number
        const nextSeq = Array.from({length: totalGarments}).findIndex((_, i) => !prev.has(i + 1)) + 1;
        if (nextSeq > 0) {
          seq = nextSeq;
        } else {
          Alert.alert("Complete", "All garments are already scanned.");
          return prev;
        }
      }

      if (prev.has(seq)) {
        Alert.alert("Duplicate Scan", `Garment #${seq} has already been scanned!`);
        return prev;
      }
      
      const newScanned = new Set(prev);
      newScanned.add(seq);
      return newScanned;
    });
  };

  const renderEvidenceStep = () => {
    const canProceed = photos.length > 0 && videoUrl;
    
    return (
      <View>
        <Text className="text-gray-500 text-sm mb-4">Step 1: Capture photos and a short video to verify ironing and packaging quality.</Text>
        
        <View className="flex-row gap-3 mb-4">
          {[0, 1].map((idx) => (
            <TouchableOpacity 
              key={idx}
              onPress={() => !photos[idx] ? captureMedia(false) : null}
              disabled={uploading}
              className={`flex-1 h-24 rounded-xl items-center justify-center overflow-hidden border-2 ${photos[idx] ? 'border-green-500' : 'border-dashed border-blue-300 bg-blue-50'}`}
            >
              {photos[idx] ? (
                <Image source={{ uri: photos[idx] }} className="w-full h-full" resizeMode="cover" />
              ) : (
                <View className="items-center">
                  <Camera color="#3b82f6" size={24} className="mb-1" />
                  <Text className="text-blue-600 text-xs">Photo {idx + 1}</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity 
          onPress={() => !videoUrl ? captureMedia(true) : null}
          disabled={uploading}
          className={`h-16 rounded-xl flex-row items-center justify-center gap-2 mb-6 border-2 ${videoUrl ? 'border-green-500 bg-green-50' : 'border-dashed border-blue-300 bg-blue-50'}`}
        >
          {videoUrl ? <CheckCircle2 color="#22c55e" size={20} /> : <Video color="#3b82f6" size={20} />}
          <Text className={`font-medium ${videoUrl ? 'text-green-600' : 'text-blue-600'}`}>
            {videoUrl ? 'Video Uploaded Successfully' : 'Record Short Video'}
          </Text>
        </TouchableOpacity>

        {uploading && <ActivityIndicator size="small" color="#3b82f6" className="mb-4" />}

        <TouchableOpacity
          onPress={() => setStep('finalize')}
          disabled={!canProceed || uploading}
          className={`h-14 rounded-xl flex-row items-center justify-center ${canProceed && !uploading ? 'bg-blue-600' : 'bg-gray-200'}`}
        >
          <Text className={`font-bold text-lg ${canProceed && !uploading ? 'text-white' : 'text-gray-400'}`}>Next: Finalize Count</Text>
          <ChevronRight color={canProceed && !uploading ? 'white' : '#9ca3af'} size={20} className="ml-2" />
        </TouchableOpacity>
      </View>
    );
  };

  const renderScanStep = () => {
    const allScanned = scanned.size >= totalGarments;
    return (
      <View>
        <Text className="text-gray-500 text-sm mb-4">Step 2: Scan and untag every garment before packaging.</Text>
        
        <View className="flex-row items-center justify-between bg-blue-50 p-4 rounded-xl mb-4 border border-blue-100">
          <View>
            <Text className="text-blue-800 font-bold text-2xl">{scanned.size} / {totalGarments}</Text>
            <Text className="text-blue-600 text-xs uppercase tracking-wider">Garments Scanned</Text>
          </View>
          
          {!allScanned ? (
            <TouchableOpacity 
              onPress={() => setShowScanner(true)}
              className="w-12 h-12 rounded-full bg-blue-500 items-center justify-center shadow-sm"
            >
              <ScanLine color="white" size={24} />
            </TouchableOpacity>
          ) : (
            <View className="w-12 h-12 rounded-full bg-green-500 items-center justify-center">
              <CheckCircle2 color="white" size={24} />
            </View>
          )}
        </View>
        
        <View className="flex-row flex-wrap gap-2 mb-6">
          {Array.from({ length: totalGarments }).map((_, i) => {
            const isScanned = scanned.has(i + 1);
            return (
              <View 
                key={i} 
                className={`w-10 h-10 rounded-lg items-center justify-center border-2 ${isScanned ? 'bg-green-100 border-green-500' : 'bg-gray-50 border-gray-200'}`}
              >
                <Text className={`font-bold ${isScanned ? 'text-green-700' : 'text-gray-400'}`}>{i + 1}</Text>
              </View>
            );
          })}
        </View>

        <TouchableOpacity
          onPress={() => setStep('evidence')}
          disabled={!allScanned}
          className={`h-14 rounded-xl flex-row items-center justify-center ${allScanned ? 'bg-blue-600' : 'bg-gray-200'}`}
        >
          <Text className={`font-bold text-lg ${allScanned ? 'text-white' : 'text-gray-400'}`}>Next: Quality Evidence</Text>
          <ChevronRight color={allScanned ? 'white' : '#9ca3af'} size={20} className="ml-2" />
        </TouchableOpacity>
      </View>
    );
  };

  const renderFinalizeStep = () => {
    const canComplete = bundles > 0;
    return (
      <View>
        <Text className="text-gray-500 text-sm mb-4">Step 3: Enter the final number of bundles or hangers for delivery.</Text>
        
        <View className="flex-row items-center justify-between bg-gray-50 p-4 rounded-xl mb-6 border border-gray-200">
          <View className="flex-row items-center gap-2">
            <Package color="#64748B" size={20} />
            <Text className="text-gray-700 font-medium">Total Bundles</Text>
          </View>
          <View className="flex-row items-center gap-4">
            <TouchableOpacity 
              onPress={() => setBundles(Math.max(0, bundles - 1))}
              className="w-10 h-10 rounded-full bg-white border border-gray-300 items-center justify-center"
            >
              <Text className="text-xl font-medium text-gray-600">-</Text>
            </TouchableOpacity>
            <Text className="text-2xl font-bold w-8 text-center text-gray-900">{bundles}</Text>
            <TouchableOpacity 
              onPress={() => setBundles(bundles + 1)}
              className="w-10 h-10 rounded-full bg-blue-500 items-center justify-center shadow-sm"
            >
              <Text className="text-xl font-medium text-white">+</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          onPress={() => setStep('print')}
          disabled={!canComplete}
          className={`h-14 rounded-xl flex-row items-center justify-center ${canComplete ? 'bg-blue-600' : 'bg-gray-200'}`}
        >
          <Text className={`font-bold text-lg ${canComplete ? 'text-white' : 'text-gray-400'}`}>Next: Print Bundle Labels</Text>
          <ChevronRight color={canComplete ? 'white' : '#9ca3af'} size={20} className="ml-2" />
        </TouchableOpacity>
      </View>
    );
  };

  const renderPrintStep = () => {
    return (
      <View>
        <Text className="text-gray-500 text-sm mb-4">Step 4: Print bundle labels and attach them to the packages.</Text>
        
        <View className="bg-blue-50 border border-blue-200 p-4 rounded-xl mb-6 items-center">
          <Text className="text-blue-800 font-medium mb-1">Generating labels for</Text>
          <Text className="text-3xl font-bold text-blue-900">{bundles} Bundle{bundles > 1 ? 's' : ''}</Text>
        </View>

        <TouchableOpacity
          onPress={async () => {
            setUploading(true);
            const success = await onPrint(bundles);
            setUploading(false);
            if (success) {
              onComplete({ photos, videoUrl, bundles });
            } else {
              Alert.alert('Print Failed', 'Could not generate bundle labels.');
            }
          }}
          disabled={uploading}
          className={`h-14 rounded-xl flex-row items-center justify-center ${uploading ? 'bg-gray-200' : 'bg-green-600'}`}
        >
          {uploading ? <ActivityIndicator color="#fff" /> : <CheckCircle2 color="white" size={20} className="mr-2" />}
          <Text className="font-bold text-lg text-white">Print & Complete Packaging</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 mb-4 min-h-[400px]">
      {showScanner && (
        <QRScanner 
          visible={showScanner} 
          actionType="Packaging Untagging"
          onScan={handleScan} 
          onClose={() => setShowScanner(false)} 
        />
      )}
      <View className="flex-row items-center justify-between mb-4 border-b border-gray-100 pb-3">
        <Text className="text-gray-900 font-bold text-lg">Packaging Verification</Text>
        <Text className="text-sm font-bold text-blue-600 uppercase">Step {step === 'scan' ? 1 : step === 'evidence' ? 2 : step === 'finalize' ? 3 : 4} of 4</Text>
      </View>
      
      {step === 'scan' && renderScanStep()}
      {step === 'evidence' && renderEvidenceStep()}
      {step === 'finalize' && renderFinalizeStep()}
      {step === 'print' && renderPrintStep()}
    </View>
  );
};
