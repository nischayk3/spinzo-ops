import firebase from '@react-native-firebase/app';
import authInstance, { onAuthStateChanged, signInWithPhoneNumber, signOut, ConfirmationResult } from '@react-native-firebase/auth';
import firestore, {
  collection,
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
  deleteField
} from '@react-native-firebase/firestore';
import functionsInstance from '@react-native-firebase/functions';
import storageInstance from '@react-native-firebase/storage';

// Native SDK initializes automatically via google-services.json
const firebaseApp = firebase.apps.length > 0 ? firebase.app() : firebase.app();

// Export instances to match web API
export const auth = authInstance();
export const db = firestore();
export const functions = functionsInstance();
export const storage = storageInstance();

// Export modular-style functions from Native SDK
export {
  firebaseApp as app,
  onAuthStateChanged,
  signInWithPhoneNumber,
  signOut,
  type ConfirmationResult,
  collection,
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
  deleteField
};
