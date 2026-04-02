import Constants from 'expo-constants';
import { Platform } from 'react-native';

const EXPLICIT_API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL;
const EXPLICIT_API_SCHEME = process.env.EXPO_PUBLIC_API_SCHEME || 'http';
const EXPLICIT_API_PORT = process.env.EXPO_PUBLIC_API_PORT || '8000';
const EXPLICIT_API_HOST = process.env.EXPO_PUBLIC_API_HOST;

function normalizeBaseUrl(url) {
  return `${String(url || '').replace(/\/+$/, '')}`;
}

function extractHost(rawValue) {
  if (!rawValue) return null;
  let value = String(rawValue).trim();
  if (!value) return null;
  value = value.replace(/^https?:\/\//, '');
  value = value.split('/')[0];
  value = value.split('?')[0];
  const host = value.split(':')[0]?.trim();
  if (!host) return null;
  return host;
}

function isIPv4(host) {
  if (!host) return false;
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false;
    const value = Number(part);
    return value >= 0 && value <= 255;
  });
}

function getExpoHostCandidate() {
  const candidates = [
    EXPLICIT_API_HOST,
    Constants.expoConfig?.hostUri,
    Constants.manifest2?.extra?.expoGo?.debuggerHost,
    Constants.manifest?.debuggerHost,
  ];

  const parsedHosts = [];
  for (const candidate of candidates) {
    const host = extractHost(candidate);
    if (!host || host === 'localhost' || host === '127.0.0.1') continue;
    parsedHosts.push(host);
  }

  const ipv4Host = parsedHosts.find((host) => isIPv4(host));
  if (ipv4Host) return ipv4Host;

  if (parsedHosts.length > 0) {
    return parsedHosts[0];
  }

  if (Platform.OS === 'android') {
    return '10.0.2.2';
  }

  return 'localhost';
  return 'localhost';
}

function resolveApiBaseUrl() {
  if (EXPLICIT_API_BASE) {
    return normalizeBaseUrl(EXPLICIT_API_BASE);
  }
  const host = getExpoHostCandidate();
  return normalizeBaseUrl(`${EXPLICIT_API_SCHEME}://${host}:${EXPLICIT_API_PORT}/api`);
}

export const API_URL = resolveApiBaseUrl();
