import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, SafeAreaView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { API_URL } from '../config/api';

export default function RegisterScreen({ navigation, route }) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const { setToken } = route.params;

  const handleRegister = async () => {
    try {
      const res = await axios.post(`${API_URL}/auth/register/`, { username, email, password });
      if (res.data.token) {
        await AsyncStorage.setItem('userToken', res.data.token);
        setToken(res.data.token);
      }
    } catch (err) {
      Alert.alert("Registration Failed", JSON.stringify(err.response?.data) || "Error occurred");
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-[#0B0D17]">
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1 justify-center px-8">
      <View className="items-center mb-10">
        <Text className="text-4xl text-white font-bold">Join Ai Calculator</Text>
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
          placeholder="Email Address" 
          placeholderTextColor="#666"
          value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
        />
        <TextInput 
          className="w-full bg-white/5 text-white px-5 py-4 rounded-2xl border border-white/10 text-lg"
          placeholder="Password" 
          placeholderTextColor="#666"
          secureTextEntry
          value={password} onChangeText={setPassword}
        />
      </View>
      
      <TouchableOpacity onPress={handleRegister} className="w-full bg-[#7C3AED] rounded-2xl py-4 shadow-[0_0_20px_rgba(124,58,237,0.4)] active:opacity-80">
        <Text className="text-center text-white font-bold text-xl">Create Account</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.goBack()} className="mt-8 items-center">
        <Text className="text-gray-400 text-lg">Already have an account? <Text className="text-white font-bold">Sign In</Text></Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
