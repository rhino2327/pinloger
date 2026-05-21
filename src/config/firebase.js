import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { Platform } from 'react-native';

const firebaseConfig = {
  apiKey: "AIzaSyDrWmsoYUR3eqIUQQ2vGwCVTPxTswZxF7M",
  authDomain: "travel-app-a2ee5.firebaseapp.com",
  projectId: "travel-app-a2ee5",
  storageBucket: "travel-app-a2ee5.firebasestorage.app",
  messagingSenderId: "1007853624616",
  appId: "1:1007853624616:web:eb6a4971a747dcea3ac41d",
};

const app = initializeApp(firebaseConfig);

let auth;
if (Platform.OS === 'web') {
  const { getAuth } = require('firebase/auth');
  auth = getAuth(app);
} else {
  const { initializeAuth, getReactNativePersistence } = require('firebase/auth');
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
}

export { auth, app };
export const db = getFirestore(app);
// Cloud Functions (서울 리전)
export const functions = getFunctions(app, 'asia-northeast3');
