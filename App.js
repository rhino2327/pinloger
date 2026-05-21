import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { auth } from './src/config/firebase';
import { registerPushToken } from './src/utils/notifications';

export default function App() {
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) registerPushToken(user.uid);
    });
    return unsubscribe;
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AppNavigator />
    </SafeAreaProvider>
  );
}
