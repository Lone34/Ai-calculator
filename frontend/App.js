import React, { useState, useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';

import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import BasicCalculatorScreen from './src/screens/BasicCalculatorScreen';
import AIChatScreen from './src/screens/AIChatScreen';
import SketchScreen from './src/screens/SketchScreen';
import CameraScreen from './src/screens/CameraScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

import { Ionicons } from '@expo/vector-icons';

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          if (route.name === 'Calculator') {
            iconName = focused ? 'calculator' : 'calculator-outline';
          } else if (route.name === 'AI Solve') {
            iconName = focused ? 'sparkles' : 'sparkles-outline';
          } else if (route.name === 'Sketch') {
            iconName = focused ? 'pencil' : 'pencil-outline';
          } else if (route.name === 'Scan') {
            iconName = focused ? 'camera' : 'camera-outline';
          }
          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarStyle: {
          backgroundColor: '#0B0D17',
          borderTopColor: 'rgba(255, 255, 255, 0.05)',
          borderTopWidth: 1,
          paddingBottom: 8,
          paddingTop: 8,
          height: 60,
        },
        tabBarActiveTintColor: '#7C3AED',
        tabBarInactiveTintColor: '#666',
      })}
    >
      <Tab.Screen name="Calculator" component={BasicCalculatorScreen} />
      <Tab.Screen name="AI Solve" component={AIChatScreen} />
      <Tab.Screen name="Sketch" component={SketchScreen} />
      <Tab.Screen name="Scan" component={CameraScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [userToken, setUserToken] = useState(null);

  useEffect(() => {
    const bootstrapAsync = async () => {
      let token;
      try {
        token = await AsyncStorage.getItem('userToken');
      } catch (e) {
        console.error("Token restore failed");
      }
      setUserToken(token);
      setIsLoading(false);
    };

    bootstrapAsync();
  }, []);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0B0D17' }}>
        <ActivityIndicator size="large" color="#7C3AED" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {userToken == null ? (
          <>
            <Stack.Screen name="Login" component={LoginScreen} initialParams={{ setToken: setUserToken }} />
            <Stack.Screen name="Register" component={RegisterScreen} initialParams={{ setToken: setUserToken }} />
          </>
        ) : (
          <Stack.Screen name="MainTabs" component={TabNavigator} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
