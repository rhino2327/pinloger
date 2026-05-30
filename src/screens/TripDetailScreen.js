import React from 'react';
import { View, StyleSheet } from 'react-native';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import ScheduleScreen from './ScheduleScreen';
import CostScreen from './CostScreen';
import MembersScreen from './MembersScreen';

const Tab = createMaterialTopTabNavigator();

export default function TripDetailScreen({ route }) {
  const { trip } = route.params;

  return (
    <Tab.Navigator
      screenOptions={{
        tabBarStyle: { backgroundColor: '#16213e' },
        tabBarIndicatorStyle: { backgroundColor: '#e94560' },
        tabBarLabelStyle: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
        tabBarActiveTintColor: '#e94560',
        tabBarInactiveTintColor: '#aaa',
      }}
    >
      <Tab.Screen
        name="Schedule"
        component={ScheduleScreen}
        options={{ tabBarLabel: '일정' }}
        initialParams={{ trip }}
      />
      <Tab.Screen
        name="Cost"
        component={CostScreen}
        options={{ tabBarLabel: '비용' }}
        initialParams={{ trip }}
      />
      <Tab.Screen
        name="Members"
        component={MembersScreen}
        options={{ tabBarLabel: '설정' }}
        initialParams={{ trip }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
});
