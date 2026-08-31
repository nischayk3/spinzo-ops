import { ref, uploadBytes, uploadString, getDownloadURL } from 'firebase/storage';
import { storage } from '../config/firebase';

export async function uploadMediaToStorage(uri: string, path: string, isVideo: boolean = false): Promise<string> {
  const timestamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const extension = isVideo ? 'mp4' : 'jpg';
  const storageRef = ref(storage, `${path}/media_${timestamp}.${extension}`);

  try {
    // Case 1: Base64 data URI
    if (uri.startsWith('data:')) {
      const base64Data = uri.split(',')[1];
      const mimeType = isVideo ? 'video/mp4' : 'image/jpeg';
      await uploadString(storageRef, base64Data, 'base64', { contentType: mimeType });
      return await getDownloadURL(storageRef);
    }

    // Case 2: file:// or http(s):// URI — try blob upload first (works on web)
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      const mimeType = isVideo ? 'video/mp4' : 'image/jpeg';
      await uploadBytes(storageRef, blob, { contentType: mimeType });
      return await getDownloadURL(storageRef);
    } catch (blobError) {
      // Case 3: Fallback for mobile where fetch(file://) fails
      console.warn('Blob upload failed, trying FileSystem fallback:', blobError);
      const { readAsStringAsync } = require('expo-file-system');
      const base64Data = await readAsStringAsync(uri, { encoding: 'base64' });
      const mimeType = isVideo ? 'video/mp4' : 'image/jpeg';
      await uploadString(storageRef, base64Data, 'base64', { contentType: mimeType });
      return await getDownloadURL(storageRef);
    }
  } catch (err) {
    console.error('Error uploading media to storage:', err);
    throw err;
  }
}
