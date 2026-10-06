import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { 
  getFirestore,
  Firestore,
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
  Unsubscribe
} from 'firebase/firestore';
import { 
  getAuth, 
  Auth,
  onAuthStateChanged,
  signInWithPhoneNumber,
  signOut,
  ConfirmationResult
} from 'firebase/auth';
import { getFunctions, Functions, httpsCallable } from 'firebase/functions';
import { getStorage, FirebaseStorage, ref, uploadBytes, uploadString, getDownloadURL } from 'firebase/storage';

export const firebaseConfig = {
  apiKey: 'AIzaSyBnwzJVax1qx2oN3nf7INqpXLF8rVrUWqw',
  authDomain: 'spin-it-a135a.firebaseapp.com',
  projectId: 'spin-it-a135a',
  storageBucket: 'spin-it-a135a.firebasestorage.app',
  messagingSenderId: '597897149776',
  appId: '1:597897149776:web:c9a7d4b5c2291f8b35c055',
};

// Ensure Firebase is only initialized once
const app: FirebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db: Firestore = getFirestore(app);
const auth: Auth = getAuth(app);
const functions: Functions = getFunctions(app, 'us-central1');
const storage: FirebaseStorage = getStorage(app);

export { 
  app, 
  db, 
  auth, 
  functions, 
  httpsCallable,
  storage,
  ref,
  uploadBytes,
  uploadString,
  getDownloadURL,
  // Auth exports
  onAuthStateChanged,
  signInWithPhoneNumber,
  signOut,
  type ConfirmationResult,
  // Firestore exports
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
};

