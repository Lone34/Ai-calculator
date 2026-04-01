import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import axios from 'axios';
import { API_URL } from '../config/api';

const formatCurrency = (amountPaise, currency = 'INR') => {
  const value = Number(amountPaise || 0) / 100;
  if (!Number.isFinite(value)) return `${currency} 0.00`;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency || 'INR'} ${value.toFixed(2)}`;
  }
};

const formatDate = (rawValue) => {
  if (!rawValue) return 'N/A';
  const date = new Date(rawValue);
  if (Number.isNaN(date.getTime())) return 'N/A';
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
};

const getCycleLabel = (cycle) => {
  if (cycle === 'D15') return '15 Days';
  if (cycle === 'M1') return 'Monthly';
  if (cycle === 'Y1') return 'Yearly';
  return 'Custom';
};

const buildCheckoutHtml = ({ orderId, amountPaise, currency, razorpayKeyId, prefill, planName }) => {
  const options = {
    key: razorpayKeyId,
    amount: String(amountPaise),
    currency,
    name: 'Ai Calculator',
    description: `${planName} subscription`,
    order_id: orderId,
    prefill: {
      name: prefill?.name || '',
      email: prefill?.email || '',
    },
    theme: {
      color: '#0EA5E9',
    },
  };
  const optionsJson = JSON.stringify(options).replace(/</g, '\\u003c');

  return `
<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <style>
      body {
        margin: 0;
        padding: 0;
        background: #050b14;
        color: #e5f7ff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .box {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        gap: 12px;
      }
    </style>
    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  </head>
  <body>
    <div class="box">
      <div>Opening secure Razorpay checkout...</div>
    </div>
    <script>
      function sendMessage(payload) {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify(payload));
        }
      }
      try {
        var options = ${optionsJson};
        options.handler = function (response) {
          sendMessage({ type: 'success', payload: response });
        };
        options.modal = {
          ondismiss: function () {
            sendMessage({ type: 'dismiss' });
          }
        };
        var rzp = new Razorpay(options);
        rzp.on('payment.failed', function (response) {
          sendMessage({ type: 'failed', payload: response && response.error ? response.error : response });
        });
        setTimeout(function () {
          rzp.open();
        }, 150);
      } catch (error) {
        sendMessage({ type: 'failed', payload: { description: (error && error.message) || 'Checkout failed to initialize.' } });
      }
    </script>
  </body>
</html>
`;
};

export default function ProfileScreen({ setToken }) {
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState(null);
  const [plans, setPlans] = useState([]);
  const [subscriptionData, setSubscriptionData] = useState(null);
  const [purchaseLoadingPlanId, setPurchaseLoadingPlanId] = useState(null);

  const [checkoutVisible, setCheckoutVisible] = useState(false);
  const [checkoutPayload, setCheckoutPayload] = useState(null);
  const [verifyingPayment, setVerifyingPayment] = useState(false);

  const getAuthHeaders = useCallback(async () => {
    const token = await AsyncStorage.getItem('userToken');
    if (!token) throw new Error('Missing login token.');
    return { Authorization: `Token ${token}` };
  }, []);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    try {
      const headers = await getAuthHeaders();
      const [profileRes, plansRes, subscriptionRes] = await Promise.all([
        axios.get(`${API_URL}/profile/me/`, { headers }),
        axios.get(`${API_URL}/subscriptions/plans/`, { headers }),
        axios.get(`${API_URL}/subscriptions/me/`, { headers }),
      ]);
      setProfile(profileRes.data);
      setPlans(Array.isArray(plansRes.data) ? plansRes.data : []);
      setSubscriptionData(subscriptionRes.data);
    } catch (error) {
      Alert.alert('Profile Error', error?.response?.data?.error || error.message || 'Failed to load profile.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const activeSubscription = subscriptionData?.active_subscription || profile?.subscription || null;
  const hasSubscriptionAccess = Boolean(
    subscriptionData?.has_subscription_access
    ?? profile?.has_subscription_access
    ?? activeSubscription,
  );
  const recentHistory = useMemo(() => (subscriptionData?.history || []).slice(0, 6), [subscriptionData]);

  const handleLogout = useCallback(async () => {
    await AsyncStorage.removeItem('userToken');
    if (typeof setToken === 'function') {
      setToken(null);
    }
  }, [setToken]);

  const startCheckout = useCallback(async (plan) => {
    setPurchaseLoadingPlanId(plan.id);
    try {
      const headers = await getAuthHeaders();
      const res = await axios.post(
        `${API_URL}/subscriptions/create-order/`,
        { plan_id: plan.id },
        { headers },
      );
      const payload = {
        orderId: res.data.order_id,
        amountPaise: res.data.amount_paise,
        currency: res.data.currency,
        razorpayKeyId: res.data.razorpay_key_id,
        prefill: res.data.prefill || {},
        planName: res.data?.plan?.name || plan.name,
      };
      if (!payload.razorpayKeyId) {
        throw new Error('Razorpay key is not configured on server.');
      }
      setCheckoutPayload(payload);
      setCheckoutVisible(true);
    } catch (error) {
      Alert.alert('Purchase Error', error?.response?.data?.error || error.message || 'Could not start payment.');
    } finally {
      setPurchaseLoadingPlanId(null);
    }
  }, [getAuthHeaders]);

  const verifyPayment = useCallback(async ({ orderId, paymentId, signature }) => {
    setVerifyingPayment(true);
    try {
      const headers = await getAuthHeaders();
      await axios.post(
        `${API_URL}/subscriptions/verify-payment/`,
        {
          order_id: orderId,
          payment_id: paymentId,
          signature,
        },
        { headers },
      );
      setCheckoutVisible(false);
      setCheckoutPayload(null);
      await loadData(true);
      Alert.alert('Subscription Activated', 'Your subscription is now active.');
    } catch (error) {
      Alert.alert('Verification Failed', error?.response?.data?.error || error.message || 'Payment verification failed.');
    } finally {
      setVerifyingPayment(false);
    }
  }, [getAuthHeaders, loadData]);

  const handleCheckoutMessage = useCallback(async (event) => {
    let data;
    try {
      data = JSON.parse(event?.nativeEvent?.data || '{}');
    } catch {
      return;
    }
    const type = data?.type;
    if (type === 'dismiss') {
      setCheckoutVisible(false);
      setCheckoutPayload(null);
      return;
    }
    if (type === 'failed') {
      const message = data?.payload?.description || 'Payment failed. Please try again.';
      setCheckoutVisible(false);
      setCheckoutPayload(null);
      Alert.alert('Payment Failed', message);
      return;
    }
    if (type === 'success') {
      const payload = data?.payload || {};
      await verifyPayment({
        orderId: payload.razorpay_order_id,
        paymentId: payload.razorpay_payment_id,
        signature: payload.razorpay_signature,
      });
    }
  }, [verifyPayment]);

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#38BDF8" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { paddingBottom: Math.max(tabBarHeight, 8), paddingTop: Math.max(insets.top, 8) }]}>
      <View style={styles.bgOrbOne} />
      <View style={styles.bgOrbTwo} />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.profileCard}>
          <View>
            <Text style={styles.eyebrow}>ACCOUNT</Text>
            <Text style={styles.nameText}>{profile?.username || 'User'}</Text>
            <Text style={styles.emailText}>{profile?.email || 'No email'}</Text>
          </View>
          <Pressable onPress={handleLogout} style={styles.logoutButton}>
            <Ionicons name="log-out-outline" size={16} color="#FECACA" />
            <Text style={styles.logoutText}>Logout</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Current Subscription</Text>
            <Pressable onPress={() => loadData(true)} style={styles.refreshButton} disabled={refreshing}>
              {refreshing ? (
                <ActivityIndicator size="small" color="#D6F4FF" />
              ) : (
                <Ionicons name="refresh" size={14} color="#D6F4FF" />
              )}
            </Pressable>
          </View>

          {activeSubscription ? (
            <View style={styles.activeCard}>
              <Text style={styles.activePlanName}>{activeSubscription?.plan?.name}</Text>
              <Text style={styles.activeMeta}>Status: {activeSubscription?.status}</Text>
              <Text style={styles.activeMeta}>Valid from: {formatDate(activeSubscription?.starts_at)}</Text>
              <Text style={styles.activeMeta}>Valid until: {formatDate(activeSubscription?.ends_at)}</Text>
            </View>
          ) : hasSubscriptionAccess ? (
            <View style={styles.activeCard}>
              <Text style={styles.activePlanName}>Admin Access</Text>
              <Text style={styles.activeMeta}>Subscription checks bypassed for super admin.</Text>
            </View>
          ) : (
            <View style={styles.inactiveCard}>
              <Ionicons name="warning-outline" size={16} color="#FCD34D" />
              <Text style={styles.inactiveText}>No active subscription. AI Solve is restricted until you subscribe.</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Plans</Text>
          <View style={styles.planList}>
            {plans.map((plan) => {
              const price = Number(plan.price_paise || 0);
              const finalPrice = Number(plan.final_amount_paise || price);
              const discount = Math.max(0, price - finalPrice);
              const isBuying = purchaseLoadingPlanId === plan.id;
              return (
                <View key={plan.id} style={styles.planCard}>
                  <View style={styles.planHead}>
                    <Text style={styles.planName}>{plan.name}</Text>
                    <Text style={styles.planCycle}>{getCycleLabel(plan.billing_cycle)}</Text>
                  </View>
                  <Text style={styles.planDuration}>{plan.duration_days} days validity</Text>
                  <View style={styles.priceRow}>
                    <Text style={styles.finalPrice}>{formatCurrency(finalPrice, plan.currency)}</Text>
                    {discount > 0 && (
                      <Text style={styles.originalPrice}>{formatCurrency(price, plan.currency)}</Text>
                    )}
                  </View>
                  {discount > 0 && (
                    <Text style={styles.discountText}>
                      You save {formatCurrency(discount, plan.currency)}
                    </Text>
                  )}
                  {!!plan.description && (
                    <Text style={styles.planDescription}>{plan.description}</Text>
                  )}

                  <Pressable
                    onPress={() => startCheckout(plan)}
                    style={[styles.buyButton, isBuying && styles.buyButtonDisabled]}
                    disabled={isBuying}
                  >
                    {isBuying ? (
                      <ActivityIndicator size="small" color="#042433" />
                    ) : (
                      <>
                        <Ionicons name="card-outline" size={16} color="#042433" />
                        <Text style={styles.buyButtonText}>Buy Plan</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Subscription History</Text>
          <View style={styles.historyList}>
            {recentHistory.length === 0 ? (
              <Text style={styles.historyEmptyText}>No purchases yet.</Text>
            ) : (
              recentHistory.map((item) => (
                <View key={item.id} style={styles.historyItem}>
                  <Text style={styles.historyPlan}>{item?.plan?.name || 'Plan'}</Text>
                  <Text style={styles.historyMeta}>Status: {item.status}</Text>
                  <Text style={styles.historyMeta}>Amount: {formatCurrency(item.amount_paid_paise, item.currency)}</Text>
                  <Text style={styles.historyMeta}>Created: {formatDate(item.created_at)}</Text>
                </View>
              ))
            )}
          </View>
        </View>
      </ScrollView>

      <Modal visible={checkoutVisible} animationType="slide" onRequestClose={() => setCheckoutVisible(false)}>
        <SafeAreaView style={styles.checkoutContainer}>
          <View style={styles.checkoutHeader}>
            <Text style={styles.checkoutTitle}>Secure Payment</Text>
            <Pressable onPress={() => setCheckoutVisible(false)} style={styles.checkoutCloseButton} disabled={verifyingPayment}>
              <Ionicons name="close" size={18} color="#D8F4FF" />
            </Pressable>
          </View>
          {verifyingPayment && (
            <View style={styles.verifyingBanner}>
              <ActivityIndicator size="small" color="#7DD3FC" />
              <Text style={styles.verifyingText}>Verifying payment...</Text>
            </View>
          )}
          {checkoutPayload ? (
            <WebView
              originWhitelist={['*']}
              source={{ html: buildCheckoutHtml(checkoutPayload) }}
              onMessage={handleCheckoutMessage}
              javaScriptEnabled
              domStorageEnabled
              startInLoadingState
            />
          ) : (
            <View style={styles.emptyCheckout}>
              <Text style={styles.historyEmptyText}>Unable to initialize checkout.</Text>
            </View>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#050B14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: '#050B14',
  },
  bgOrbOne: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(56,189,248,0.12)',
    top: -60,
    right: -70,
  },
  bgOrbTwo: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(20,184,166,0.08)',
    bottom: -70,
    left: -80,
  },
  content: {
    padding: 14,
    gap: 12,
  },
  profileCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.26)',
    backgroundColor: 'rgba(10,19,33,0.92)',
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eyebrow: {
    color: '#7DD3FC',
    fontSize: 11,
    letterSpacing: 1.2,
    fontWeight: '700',
  },
  nameText: {
    marginTop: 2,
    color: '#E5F7FF',
    fontSize: 22,
    fontWeight: '800',
  },
  emailText: {
    color: '#92B4CA',
    fontSize: 13,
    marginTop: 2,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.36)',
    backgroundColor: 'rgba(127,29,29,0.2)',
  },
  logoutText: {
    color: '#FECACA',
    fontSize: 12,
    fontWeight: '700',
  },
  section: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(71,85,105,0.45)',
    backgroundColor: 'rgba(8,15,27,0.95)',
    padding: 12,
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: '#E3F6FF',
    fontSize: 16,
    fontWeight: '700',
  },
  refreshButton: {
    width: 30,
    height: 30,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(71,85,105,0.55)',
    backgroundColor: 'rgba(15,23,42,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.4)',
    backgroundColor: 'rgba(6,78,59,0.2)',
    padding: 10,
    gap: 4,
  },
  activePlanName: {
    color: '#D1FAE5',
    fontSize: 15,
    fontWeight: '700',
  },
  activeMeta: {
    color: '#BFECD8',
    fontSize: 12,
  },
  inactiveCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.4)',
    backgroundColor: 'rgba(113,63,18,0.22)',
    padding: 10,
  },
  inactiveText: {
    flex: 1,
    color: '#FDE68A',
    fontSize: 12,
    lineHeight: 17,
  },
  planList: {
    gap: 10,
  },
  planCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.28)',
    backgroundColor: 'rgba(10,20,36,0.92)',
    padding: 10,
    gap: 6,
  },
  planHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  planName: {
    color: '#E3F6FF',
    fontSize: 14,
    fontWeight: '700',
  },
  planCycle: {
    color: '#7DD3FC',
    fontSize: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.3)',
    backgroundColor: 'rgba(14,116,144,0.25)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  planDuration: {
    color: '#94B6CC',
    fontSize: 12,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  finalPrice: {
    color: '#A7F3D0',
    fontSize: 20,
    fontWeight: '800',
  },
  originalPrice: {
    color: '#6B7280',
    fontSize: 14,
    textDecorationLine: 'line-through',
  },
  discountText: {
    color: '#67E8F9',
    fontSize: 12,
  },
  planDescription: {
    color: '#A4C3D8',
    fontSize: 12,
    lineHeight: 17,
  },
  buyButton: {
    marginTop: 2,
    borderRadius: 10,
    height: 40,
    backgroundColor: '#67E8F9',
    borderWidth: 1,
    borderColor: '#CFFAFE',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  buyButtonDisabled: {
    opacity: 0.6,
  },
  buyButtonText: {
    color: '#042433',
    fontWeight: '800',
    fontSize: 13,
  },
  historyList: {
    gap: 8,
  },
  historyItem: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(71,85,105,0.45)',
    backgroundColor: 'rgba(15,23,42,0.65)',
    padding: 9,
    gap: 3,
  },
  historyPlan: {
    color: '#E5F7FF',
    fontSize: 13,
    fontWeight: '700',
  },
  historyMeta: {
    color: '#8EB1C7',
    fontSize: 11,
  },
  historyEmptyText: {
    color: '#8EAEC3',
    fontSize: 12,
  },
  checkoutContainer: {
    flex: 1,
    backgroundColor: '#050B14',
  },
  checkoutHeader: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(71,85,105,0.45)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  checkoutTitle: {
    color: '#DDF4FF',
    fontSize: 16,
    fontWeight: '700',
  },
  checkoutCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(71,85,105,0.5)',
    backgroundColor: 'rgba(15,23,42,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifyingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(14,116,144,0.2)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(125,211,252,0.35)',
  },
  verifyingText: {
    color: '#B9EFFF',
    fontSize: 12,
  },
  emptyCheckout: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
