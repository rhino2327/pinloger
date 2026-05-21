import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { onAuthStateChanged } from 'firebase/auth';
import { Text, View, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { auth } from '../config/firebase';

import LoginScreen from '../screens/LoginScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
import HomeScreen from '../screens/HomeScreen';
import TripDetailScreen from '../screens/TripDetailScreen';
import CommunityScreen from '../screens/CommunityScreen';
import ExchangeScreen from '../screens/ExchangeScreen';
import MyScreen from '../screens/MyScreen';
import ProfileScreen from '../screens/ProfileScreen';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarStyle: {
          backgroundColor: '#16213e',
          borderTopColor: '#0f3460',
          height: 56 + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: 'bold' },
        tabBarActiveTintColor: '#e94560',
        tabBarInactiveTintColor: '#aaa',
        headerShown: false,
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarLabel: '내 여행',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20 }}>✈️</Text>,
        }}
      />
      <Tab.Screen
        name="Exchange"
        component={ExchangeScreen}
        options={{
          tabBarLabel: '환율',
          tabBarIcon: () => <Text style={{ fontSize: 20 }}>💱</Text>,
        }}
      />
      <Tab.Screen
        name="Community"
        component={CommunityScreen}
        options={{
          tabBarLabel: '커뮤니티',
          tabBarIcon: () => <Text style={{ fontSize: 20 }}>🌍</Text>,
        }}
      />
      <Tab.Screen
        name="MyTrips"
        component={MyScreen}
        options={{
          tabBarLabel: 'MY',
          tabBarIcon: () => <Text style={{ fontSize: 20 }}>🧳</Text>,
        }}
      />
    </Tab.Navigator>
  );
}

function AppStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#16213e' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: 'bold' },
      }}
    >
      <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
      <Stack.Screen
        name="TripDetail"
        component={TripDetailScreen}
        options={({ route }) => ({ title: route.params?.trip?.name || '여행 상세' })}
      />
      <Stack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: '프로필 & 계정', headerShown: true }}
      />
    </Stack.Navigator>
  );
}

export default function AppNavigator() {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => setUser(u));
    return unsubscribe;
  }, []);

  if (user === undefined) return (
    <View style={{ flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color="#e94560" />
    </View>
  );


  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          <Stack.Screen name="App" component={AppStack} />
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen
              name="ForgotPassword"
              component={ForgotPasswordScreen}
              options={{ headerShown: false }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
