import { Platform } from 'react-native';
import { storage, ref, uploadBytes, uploadString, getDownloadURL } from '../config/firebase';

export async function uploadMediaToStorage(uri: string, path: string, isVideo: boolean = false): Promise<string> {
  const timestamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const extension = isVideo ? 'mp4' : 'jpg';
  const mimeType = isVideo ? 'video/mp4' : 'image/jpeg';
  const fullPath = `${path}/media_${timestamp}.${extension}`;
  const storageRef = ref(storage, fullPath);

  try {
    // Case 1: Base64 data URI
    if (uri.startsWith('data:')) {
      const base64Data = uri.split(',')[1];
      await uploadString(storageRef, base64Data, 'base64', { contentType: mimeType });
      return await getDownloadURL(storageRef);
    }

    // Case 2: Native Android / iOS (APK) using @react-native-firebase/storage native putFile
    if (Platform.OS !== 'web' && typeof (storageRef as any).putFile === 'function') {
      await (storageRef as any).putFile(uri, { contentType: mimeType });
      return await getDownloadURL(storageRef);
    }

    // Case 3: Web or fallback using blob upload
    const response = await fetch(uri);
    const blob = await response.blob();
    await uploadBytes(storageRef, blob, { contentType: mimeType });
    return await getDownloadURL(storageRef);
  } catch (err) {
    console.error('Error uploading media to storage:', err);
    throw err;
  }
}

