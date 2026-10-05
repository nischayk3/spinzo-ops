import { getApp, getApps } from '@react-native-firebase/app';
import { 
  getAuth, 
  onAuthStateChanged, 
  signInWithPhoneNumber, 
  signOut, 
  type ConfirmationResult 
} from '@react-native-firebase/auth';
import {
  getFirestore,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  Timestamp,
  onSnapshot,
  addDoc,
  updateDoc,
  serverTimestamp,
  setDoc,
  deleteDoc,
  limit,
  startAfter,
  writeBatch,
  runTransaction,
  deleteField,
  type Unsubscribe
} from '@react-native-firebase/firestore';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';
import { getStorage, ref, uploadBytes, uploadString, getDownloadURL } from '@react-native-firebase/storage';

// Native SDK initializes automatically via google-services.json
const firebaseApp = getApps().length > 0 ? getApp() : null;

// Export instances to match web API
export const auth: any = getAuth();
export const db: any = getFirestore();
export const functions: any = getFunctions(undefined, 'us-central1');
export const storage: any = getStorage();

// Export modular-style functions from Native SDK
export {
  firebaseApp as app,
  onAuthStateChanged,
  signInWithPhoneNumber,
  signOut,
  type ConfirmationResult,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  Timestamp,
  onSnapshot,
  addDoc,
  updateDoc,
  serverTimestamp,
  setDoc,
  deleteDoc,
  limit,
  startAfter,
  writeBatch,
  runTransaction,
  deleteField,
  httpsCallable,
  ref,
  uploadBytes,
  uploadString,
  getDownloadURL,
  type Unsubscribe
};
