import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getAuth, Auth } from 'firebase/auth';
import { getFunctions, Functions } from 'firebase/functions';

export const firebaseConfig = {
  apiKey: 'AIzaSyBnwzJVax1qx2oN3nf7INqpXLF8rVrUWqw',
  authDomain: 'spin-it-a135a.firebaseapp.com',
  projectId: 'spin-it-a135a',
  storageBucket: 'spin-it-a135a.firebasestorage.app',
  messagingSenderId: '597897149776',
  appId: '1:597897149776:web:c9a7d4b5c2291f8b35c055',
};

let app: FirebaseApp;
let db: Firestore;
let auth: Auth;
let functions: Functions;

// Ensure Firebase is only initialized once
if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApp();
}

db = getFirestore(app);
auth = getAuth(app);
functions = getFunctions(app, 'us-central1');

export { app, db, auth, functions };
