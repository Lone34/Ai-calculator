import Constants from 'expo-constants';
import { Platform } from 'react-native';

function getExpoHost() {
  const candidates = [
    Constants.expoConfig?.hostUri,
    Constants.manifest2?.extra?.expoGo?.debuggerHost,
    Constants.manifest?.debuggerHost,
  ];

  for (const candidate of candidates) {
    if (candidate) {
      return candidate.split(':')[0];
    }
  }

  if (Platform.OS === 'android') {
    return '10.0.2.2';
  }

  return 'localhost';
}

export const API_URL = `http://${getExpoHost()}:8000/api`;
