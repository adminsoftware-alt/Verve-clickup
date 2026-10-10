import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication and get a reference to the service
export const auth = getAuth(app);
export const db = getFirestore(app);

// Storage and messaging are reached for, not started up.
//
// Both used to be initialised here at module scope, which pulled their SDKs into whatever imported
// this file -- and this file is imported by the auth gate, so they were in the first download for
// everybody. Nothing in the app asks for storage at all, and messaging belongs to the old v1 push
// that is switched off. Asking for them loads them; not asking costs nothing.
export const getStorageLazily = async () => {
  const { getStorage } = await import('firebase/storage');
  return getStorage(app);
};

// Conditional, because messaging is not supported in every browser.
export const messaging = async () => {
  const { getMessaging, isSupported } = await import('firebase/messaging');
  return (await isSupported()) ? getMessaging(app) : null;
};
