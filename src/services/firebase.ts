// Firebase Web SDK configuration - matches existing SpinZo pattern
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  signInWithPhoneNumber,
  RecaptchaVerifier,
  PhoneAuthProvider,
  signOut,
  onAuthStateChanged,
  Auth,
  User,
  ConfirmationResult,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
  Timestamp,
  Firestore,
  serverTimestamp,
  increment,
  collectionGroup,
  writeBatch,
  runTransaction,
  DocumentReference,
  DocumentSnapshot,
  QuerySnapshot,
  QueryDocumentSnapshot,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore';
import { firebaseConfig } from './firebaseConfig';
import { Platform } from 'react-native';

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;

// Only initialize on web or when native Firebase is not available
if (Platform.OS === 'web') {
  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  auth = getAuth(app);
  auth.useDeviceLanguage();
  db = getFirestore(app);
}

export {
  app,
  auth,
  db,
  // Firebase Auth
  signInWithPhoneNumber,
  RecaptchaVerifier,
  PhoneAuthProvider,
  signOut,
  onAuthStateChanged,
  ConfirmationResult,
  // Firestore
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
  Timestamp,
  serverTimestamp,
  increment,
  collectionGroup,
  writeBatch,
  runTransaction,
  DocumentReference,
  DocumentSnapshot,
  QuerySnapshot,
  QueryDocumentSnapshot,
  arrayUnion,
  arrayRemove,
};

export type { Auth, User, FirebaseApp };
