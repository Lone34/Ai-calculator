import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, SafeAreaView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

// Ensure this IP matches your computer's local network IP where Django is running
const API_URL = 'http://10.99.170.36:8000/api';

export default function LoginScreen({ navigation, route }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  
  // App.js passes down the setToken method here
  const { setToken } = route.params;

  const handleLogin = async () => {
    try {
      const res = await axios.post(`${API_URL}/auth/login/`, { username, password });
      if (res.data.token) {
        await AsyncStorage.setItem('userToken', res.data.token);
        setToken(res.data.token);
      }
    } catch (err) {
      Alert.alert("Login Failed", err.response?.data?.error || "Incorrect Credentials");
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-[#0B0D17]">
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1 justify-center px-8">
      <View className="items-center mb-12">
        <Text className="text-5xl text-[#7C3AED] font-bold tracking-tight">aether</Text>
        <Text className="text-gray-400 text-lg tracking-widest uppercase mt-2">Math Engine</Text>
      </View>
      
      <View className="space-y-4 mb-8">
        <TextInput 
          className="w-full bg-white/5 text-white px-5 py-4 rounded-2xl border border-white/10 text-lg"
          placeholder="Username" 
          placeholderTextColor="#666"
          value={username} onChangeText={setUsername} autoCapitalize="none"
        />
        <TextInput 
          className="w-full bg-white/5 text-white px-5 py-4 rounded-2xl border border-white/10 text-lg"
          placeholder="Password" 
          placeholderTextColor="#666"
          secureTextEntry
          value={password} onChangeText={setPassword}
        />
      </View>
      
      <TouchableOpacity onPress={handleLogin} className="w-full bg-[#7C3AED] rounded-2xl py-4 shadow-[0_0_20px_rgba(124,58,237,0.4)] active:opacity-80">
        <Text className="text-center text-white font-bold text-xl">Sign In</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.navigate('Register', { setToken })} className="mt-8 items-center">
        <Text className="text-gray-400 text-lg">New to Aether? <Text className="text-white font-bold">Create Account</Text></Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
