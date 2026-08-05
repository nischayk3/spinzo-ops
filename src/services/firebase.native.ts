// Firebase Native SDK - matches existing SpinZo pattern
// Uses @react-native-firebase for Android/iOS
import { Platform } from 'react-native';

let auth: any;
let db: any;

if (Platform.OS !== 'web') {
  const rnFirebase = require('@react-native-firebase/app');
  const rnAuth = require('@react-native-firebase/auth');
  const rnFirestore = require('@react-native-firebase/firestore');

  auth = rnAuth.default();
  db = rnFirestore.default();
}

// Export native auth/firestore for native platforms
// Web will use the modular SDK from firebase.ts instead
export { auth, db };

// Re-export Firestore helper functions as no-ops that will use the native SDK
export const serverTimestamp = () => require('@react-native-firebase/firestore').default.FieldValue.serverTimestamp();
export const increment = (n: number) => require('@react-native-firebase/firestore').default.FieldValue.increment(n);
export const arrayUnion = (...items: any[]) => require('@react-native-firebase/firestore').default.FieldValue.arrayUnion(...items);
export const arrayRemove = (...items: any[]) => require('@react-native-firebase/firestore').default.FieldValue.arrayRemove(...items);

export type { FirebaseApp } from 'firebase/app';
