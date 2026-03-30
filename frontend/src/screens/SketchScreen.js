import React from 'react';
import { View, Text, SafeAreaView } from 'react-native';

export default function SketchScreen() {
  return (
    <SafeAreaView className="flex-1 bg-[#0B0D17] items-center justify-center">
      <Text className="text-aether-accent text-2xl font-bold">Sketch Geometry</Text>
      <Text className="text-gray-400 mt-2">Interactive drawing canvas coming soon...</Text>
    </SafeAreaView>
  );
}
