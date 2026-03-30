import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { View, Text, Pressable, SafeAreaView, Dimensions, FlatList, Modal, ScrollView, Platform, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';

const { width } = Dimensions.get('window');
const bWidth = (width * 0.9) / 4 - 8;
const bHeight = bWidth * 0.8;

const API_URL = 'http://10.99.170.36:8000/api';

const SINGLE_OPERATORS = ['+', '-', '*', '/'];
const FUNCTIONS = ['sin(', 'cos(', 'tan(', 'log(', 'sqrt(', 'asin(', 'acos('];

// Format result to strip unnecessary trailing zeros
const formatResult = (value) => {
  if (!value || value === 'Error' || value === '...') return value;
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  if (Number.isInteger(num)) return num.toString();
  return parseFloat(num.toFixed(10)).toString();
};

// ── Pre-computed styles (created ONCE at module level) ──
const BTN_DEFAULT = { backgroundColor: 'rgba(255,255,255,0.05)' };
const BTN_TRANSPARENT = { backgroundColor: 'transparent' };
const BTN_RED = { backgroundColor: 'rgba(239,68,68,0.1)' };
const BTN_PURPLE = { backgroundColor: 'rgba(124,58,237,0.8)' };
const BTN_WHITE = { backgroundColor: '#FFF' };

const TEXT_WHITE = { color: '#FFF' };
const TEXT_RED = { color: '#F87171' };
const TEXT_GRAY = { color: '#9CA3AF' };
const TEXT_BLACK = { color: '#000', fontWeight: '700' };

const getTextStyle = (textColor) => {
  switch (textColor) {
    case 'red': return TEXT_RED;
    case 'gray': return TEXT_GRAY;
    case 'black': return TEXT_BLACK;
    default: return TEXT_WHITE;
  }
};

// ── KeyButton: extracted & memoized, only re-renders if props change ──
const KeyButton = memo(({ label, display, color, textColor, bgStyle, onPress }) => {
  const handlePress = useCallback(() => {
    onPress(label);
  }, [label, onPress]);

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      style={({ pressed }) => [
        styles.btn,
        color !== 'transparent' && styles.btnBorder,
        bgStyle,
        pressed && styles.btnPressed,
      ]}
    >
      <Text style={[styles.btnText, getTextStyle(textColor)]}>
        {display || label}
      </Text>
    </Pressable>
  );
});

// ── Main Screen ──
export default function BasicCalculatorScreen() {
  const [equation, setEquation] = useState('');
  const [displayState, setDisplayState] = useState({ hasResult: false, isEvaluating: false });
  const [history, setHistory] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const flatListRef = useRef(null);

  // Refs to avoid stale closures in handleTap — this is THE key optimization
  const equationRef = useRef('');
  const stateRef = useRef({ hasResult: false, isEvaluating: false });
  const sessionIdRef = useRef(null);

  // Keep refs in sync
  useEffect(() => { equationRef.current = equation; }, [equation]);
  useEffect(() => { stateRef.current = displayState; }, [displayState]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  useEffect(() => {
    fetchOrCreateSession();
  }, []);

  const fetchOrCreateSession = async () => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      const res = await axios.get(`${API_URL}/active-session/`, {
        headers: { Authorization: `Token ${token}` }
      });
      setSessionId(res.data.id);
      sessionIdRef.current = res.data.id;
      setHistory(res.data.interactions || []);
      setLoading(false);
    } catch (e) {
      console.error("Session Error", e?.response?.data || e);
      setLoading(false);
    }
  };

  const clearHistory = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      await axios.delete(`${API_URL}/sessions/${sessionIdRef.current}/clear_history/`, {
        headers: { Authorization: `Token ${token}` }
      });
      setHistory([]);
      setModalVisible(false);
    } catch (e) {
      console.error(e);
    }
  }, []);

  // handleTap with ZERO dependencies — reads from refs, never recreates
  const handleTap = useCallback(async (val) => {
    const eq = equationRef.current;
    const { hasResult, isEvaluating } = stateRef.current;

    if (val === 'C') {
      setEquation('');
      setDisplayState({ hasResult: false, isEvaluating: false });
      return;
    }

    if (val === '⌫') {
      if (hasResult) {
        setEquation('');
        setDisplayState(s => ({ ...s, hasResult: false }));
      } else {
        setEquation(prev => prev.slice(0, -1));
      }
      return;
    }

    if (val === '=') {
      if (!eq || isEvaluating || hasResult) return;
      const currentEq = eq;
      setDisplayState(s => ({ ...s, isEvaluating: true }));

      try {
        const token = await AsyncStorage.getItem('userToken');
        setHistory(prev => [...prev, { id: Date.now(), role: 'user', raw_query: currentEq }]);
        setEquation('...');

        const res = await axios.post(
          `${API_URL}/sessions/${sessionIdRef.current}/evaluate_instant/`,
          { raw_query: currentEq },
          { headers: { Authorization: `Token ${token}` } }
        );

        const formattedResult = formatResult(res.data.result);
        setEquation(formattedResult);
        setDisplayState({ hasResult: true, isEvaluating: false });
        fetchOrCreateSession();
      } catch (e) {
        console.error("Evaluation Error", e);
        setEquation('Error');
        setDisplayState({ hasResult: true, isEvaluating: false });
      }
      return;
    }

    const isOperator = SINGLE_OPERATORS.includes(val);
    const isFunction = FUNCTIONS.includes(val);

    if (hasResult || eq === 'Error') {
      if (isOperator && hasResult && eq !== 'Error') {
        setDisplayState(s => ({ ...s, hasResult: false }));
        setEquation(prev => prev + val);
      } else {
        setEquation(val);
        setDisplayState(s => ({ ...s, hasResult: false }));
      }
    } else {
      setEquation(prev => {
        // Smart operator replacement
        if (isOperator && prev.length > 0) {
          const lastChar = prev[prev.length - 1];
          if (SINGLE_OPERATORS.includes(lastChar)) {
            return prev.slice(0, -1) + val;
          }
        }
        // Smart function replacement
        if (isFunction) {
          for (const fn of FUNCTIONS) {
            if (prev.endsWith(fn)) {
              return prev.slice(0, -fn.length) + val;
            }
          }
        }
        return prev + val;
      });
    }
  }, []); // ← ZERO dependencies, reads from refs

  const openModal = useCallback(() => setModalVisible(true), []);
  const closeModal = useCallback(() => setModalVisible(false), []);

  const renderHistoryItem = useCallback(({ item }) => (
    <Pressable
      onPress={() => {
        setEquation(item.role === 'user' ? item.raw_query : item.content_text);
        setDisplayState(s => ({ ...s, hasResult: item.role !== 'user' }));
        setModalVisible(false);
      }}
      style={[
        styles.historyRow,
        { justifyContent: item.role === 'user' ? 'flex-end' : 'flex-start' },
      ]}
    >
      <View style={[
        styles.historyBubble,
        item.role === 'user' ? styles.historyUser : styles.historySystem,
      ]}>
        <Text style={styles.historyText}>
          {item.role === 'user' ? item.raw_query : item.content_text}
        </Text>
      </View>
    </Pressable>
  ), []);

  const historyKeyExtractor = useCallback((item) => item.id.toString(), []);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Aether Standard</Text>
        <Pressable onPress={openModal} hitSlop={10} style={styles.historyBtn}>
          <Ionicons name="time-outline" size={26} color="#7C3AED" />
        </Pressable>
      </View>

      {/* Display */}
      <View style={styles.display}>
        <Text
          style={[styles.displayText, { fontSize: equation.length > 12 ? 45 : 75 }]}
          numberOfLines={2}
          adjustsFontSizeToFit
        >
          {equation || '0'}
        </Text>
      </View>

      {/* Function Drawer */}
      <View style={styles.drawer}>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
          {/* Page 1 */}
          <View style={styles.drawerPage}>
            <KeyButton label="sqrt(" display="√" color="transparent" textColor="gray" bgStyle={BTN_TRANSPARENT} onPress={handleTap} />
            <KeyButton label="**" display="^" color="transparent" textColor="gray" bgStyle={BTN_TRANSPARENT} onPress={handleTap} />
            <KeyButton label="%" display="%" color="transparent" textColor="gray" bgStyle={BTN_TRANSPARENT} onPress={handleTap} />
            <View style={styles.swipeHint}>
              <Text style={styles.swipeHintText}>{'Swipe\n→'}</Text>
            </View>
          </View>
          {/* Page 2 */}
          <View style={styles.drawerPage}>
            <KeyButton label="sin(" display="sin" color="transparent" textColor="gray" bgStyle={BTN_TRANSPARENT} onPress={handleTap} />
            <KeyButton label="cos(" display="cos" color="transparent" textColor="gray" bgStyle={BTN_TRANSPARENT} onPress={handleTap} />
            <KeyButton label="tan(" display="tan" color="transparent" textColor="gray" bgStyle={BTN_TRANSPARENT} onPress={handleTap} />
            <KeyButton label="log(" display="log" color="transparent" textColor="gray" bgStyle={BTN_TRANSPARENT} onPress={handleTap} />
            <KeyButton label="pi" display="π" color="transparent" textColor="gray" bgStyle={BTN_TRANSPARENT} onPress={handleTap} />
            <KeyButton label="E" display="e" color="transparent" textColor="gray" bgStyle={BTN_TRANSPARENT} onPress={handleTap} />
            <KeyButton label="asin(" display="sin⁻¹" color="transparent" textColor="gray" bgStyle={BTN_TRANSPARENT} onPress={handleTap} />
            <KeyButton label="acos(" display="cos⁻¹" color="transparent" textColor="gray" bgStyle={BTN_TRANSPARENT} onPress={handleTap} />
          </View>
        </ScrollView>
      </View>

      {/* Number Pad */}
      <View style={styles.pad}>
        <KeyButton label="C" textColor="red" bgStyle={BTN_RED} onPress={handleTap} />
        <KeyButton label="(" textColor="gray" bgStyle={BTN_DEFAULT} onPress={handleTap} />
        <KeyButton label=")" textColor="gray" bgStyle={BTN_DEFAULT} onPress={handleTap} />
        <KeyButton label="⌫" textColor="red" bgStyle={BTN_RED} onPress={handleTap} />

        <KeyButton label="7" bgStyle={BTN_DEFAULT} onPress={handleTap} />
        <KeyButton label="8" bgStyle={BTN_DEFAULT} onPress={handleTap} />
        <KeyButton label="9" bgStyle={BTN_DEFAULT} onPress={handleTap} />
        <KeyButton label="/" display="÷" bgStyle={BTN_PURPLE} onPress={handleTap} />

        <KeyButton label="4" bgStyle={BTN_DEFAULT} onPress={handleTap} />
        <KeyButton label="5" bgStyle={BTN_DEFAULT} onPress={handleTap} />
        <KeyButton label="6" bgStyle={BTN_DEFAULT} onPress={handleTap} />
        <KeyButton label="*" display="×" bgStyle={BTN_PURPLE} onPress={handleTap} />

        <KeyButton label="1" bgStyle={BTN_DEFAULT} onPress={handleTap} />
        <KeyButton label="2" bgStyle={BTN_DEFAULT} onPress={handleTap} />
        <KeyButton label="3" bgStyle={BTN_DEFAULT} onPress={handleTap} />
        <KeyButton label="-" bgStyle={BTN_PURPLE} onPress={handleTap} />

        <KeyButton label="0" bgStyle={BTN_DEFAULT} onPress={handleTap} />
        <KeyButton label="." bgStyle={BTN_DEFAULT} onPress={handleTap} />
        <KeyButton label="=" textColor="black" bgStyle={BTN_WHITE} onPress={handleTap} />
        <KeyButton label="+" bgStyle={BTN_PURPLE} onPress={handleTap} />
      </View>

      {/* History Modal */}
      <Modal animationType="slide" transparent visible={modalVisible} onRequestClose={closeModal}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Calculation History</Text>
            <Pressable onPress={closeModal}>
              <Ionicons name="close-circle" size={30} color="#666" />
            </Pressable>
          </View>

          <FlatList
            ref={flatListRef}
            data={history}
            keyExtractor={historyKeyExtractor}
            contentContainerStyle={{ padding: 16 }}
            renderItem={renderHistoryItem}
            ListEmptyComponent={<Text style={styles.emptyText}>No history available for this session</Text>}
          />

          <Pressable onPress={clearHistory} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>Clear History</Text>
          </Pressable>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// ── StyleSheet (created once, no GC pressure) ──
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0D17' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 24, paddingTop: Platform.OS === 'android' ? 48 : 16, paddingBottom: 8,
  },
  headerTitle: { color: '#6B7280', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 2, fontSize: 11 },
  historyBtn: { padding: 8, borderRadius: 20, marginTop: 4 },
  display: { flex: 1, alignItems: 'flex-end', justifyContent: 'flex-end', paddingHorizontal: 24, paddingBottom: 16 },
  displayText: { color: '#7C3AED', fontWeight: '700', letterSpacing: 2, textAlign: 'right' },
  drawer: {
    height: 140, marginBottom: 8,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
    backgroundColor: '#090b10', paddingVertical: 8,
  },
  drawerPage: {
    width, paddingHorizontal: width * 0.05,
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', alignContent: 'flex-start',
  },
  swipeHint: { width: bWidth, height: bHeight, justifyContent: 'center', alignItems: 'center' },
  swipeHintText: { color: '#4B5563', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', textAlign: 'center' },
  pad: { paddingBottom: 16, paddingHorizontal: '5%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },

  // Button
  btn: { width: bWidth, height: bHeight, margin: 4, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  btnBorder: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  btnPressed: { opacity: 0.5 },
  btnText: { fontSize: 22, fontWeight: '500' },

  // Modal
  modalContainer: { flex: 1, backgroundColor: '#151722', marginTop: 48, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 24, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  modalTitle: { color: '#FFF', fontSize: 20, fontWeight: '700' },
  historyRow: { marginVertical: 8, width: '100%', flexDirection: 'row' },
  historyBubble: { padding: 16, borderRadius: 24, maxWidth: '85%' },
  historyUser: { backgroundColor: '#7C3AED', borderTopRightRadius: 6 },
  historySystem: { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderTopLeftRadius: 6 },
  historyText: { color: '#FFF', fontSize: 18, fontWeight: '300' },
  emptyText: { color: '#6B7280', textAlign: 'center', marginTop: 40 },
  clearBtn: { margin: 24, padding: 16, backgroundColor: 'rgba(239,68,68,0.2)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.5)', borderRadius: 16, alignItems: 'center' },
  clearBtnText: { color: '#F87171', fontWeight: '700', fontSize: 18 },
});
