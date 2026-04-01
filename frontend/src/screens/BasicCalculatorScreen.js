import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dimensions,
  Modal,
  Platform,
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

const STORAGE_HISTORY_KEY = 'ai_calc_history_v4';
const STORAGE_MEMORY_KEY = 'ai_calc_memory_v4';
const STORAGE_ANGLE_MODE_KEY = 'ai_calc_angle_mode_v4';
const LEGACY_STORAGE_HISTORY_KEY = 'aether_calc_history_v3';
const LEGACY_STORAGE_MEMORY_KEY = 'aether_calc_memory_v3';
const LEGACY_STORAGE_ANGLE_MODE_KEY = 'aether_calc_angle_mode_v3';

const LAYOUT = {
  screenPadding: 14,
  gap: 8,
  mainColumns: 4,
  sciColumns: 6,
};

const SCREEN_WIDTH = Dimensions.get('window').width;
const CONTENT_WIDTH = SCREEN_WIDTH - LAYOUT.screenPadding * 2;

const MAIN_BUTTON_SIZE = Math.floor(
  (CONTENT_WIDTH - LAYOUT.gap * (LAYOUT.mainColumns - 1)) / LAYOUT.mainColumns,
);

const SCI_PAGES = [
  [
    { label: 'sin', token: 'sin(' },
    { label: 'cos', token: 'cos(' },
    { label: 'tan', token: 'tan(' },
    { label: 'asin', token: 'asin(' },
    { label: 'acos', token: 'acos(' },
    { label: 'atan', token: 'atan(' },
    { label: 'log', token: 'log(' },
    { label: 'ln', token: 'ln(' },
    { label: '√', token: 'sqrt(' },
    { label: '∛', token: 'cbrt(' },
    { label: 'abs', token: 'abs(' },
    { label: 'exp', token: 'exp(' },
  ],
  [
    { label: 'sinh', token: 'sinh(' },
    { label: 'cosh', token: 'cosh(' },
    { label: 'tanh', token: 'tanh(' },
    { label: 'x²', token: '^2' },
    { label: 'x³', token: '^3' },
    { label: 'xʸ', token: '^' },
    { label: 'π', token: 'π' },
    { label: 'e', token: 'E' },
    { label: '!', token: '!' },
    { label: '%', token: '%' },
    { label: 'rand', token: 'rand()' },
    { label: '1/x', action: 'inverse' },
  ],
];

const MAIN_ROWS = [
  [
    { label: 'C', variant: 'danger' },
    { label: '⌫', variant: 'danger' },
    { label: '(', variant: 'ghost' },
    { label: ')', variant: 'ghost' },
  ],
  [
    { label: '7', variant: 'default' },
    { label: '8', variant: 'default' },
    { label: '9', variant: 'default' },
    { label: '÷', variant: 'operator' },
  ],
  [
    { label: '4', variant: 'default' },
    { label: '5', variant: 'default' },
    { label: '6', variant: 'default' },
    { label: '×', variant: 'operator' },
  ],
  [
    { label: '1', variant: 'default' },
    { label: '2', variant: 'default' },
    { label: '3', variant: 'default' },
    { label: '-', variant: 'operator' },
  ],
  [
    { label: '0', variant: 'default' },
    { label: '.', variant: 'default' },
    { label: 'ANS', variant: 'ghost' },
    { label: '+', variant: 'operator' },
  ],
  [
    { label: '±', variant: 'ghost' },
    { label: 'M+', variant: 'ghost' },
    { label: 'M-', variant: 'ghost' },
    { label: '=', variant: 'equals' },
  ],
];

const FUNCTION_SUFFIXES = [
  'asin(',
  'acos(',
  'atan(',
  'sinh(',
  'cosh(',
  'tanh(',
  'sqrt(',
  'cbrt(',
  'sin(',
  'cos(',
  'tan(',
  'log(',
  'ln(',
  'abs(',
  'exp(',
  'rand(',
  'ANS',
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const formatNumber = (value) => {
  if (!Number.isFinite(value)) return 'Error';
  const safeValue = Math.abs(value) < 1e-14 ? 0 : value;
  const absValue = Math.abs(safeValue);
  if (absValue > 0 && (absValue >= 1e12 || absValue < 1e-9)) {
    return safeValue.toExponential(8).replace(/\.?0+e/, 'e');
  }
  const rounded = Number.parseFloat(safeValue.toFixed(12));
  return `${rounded}`;
};

const isOperator = (token) => ['+', '-', '×', '÷', '^'].includes(token);

const parenBalance = (expression) => {
  let balance = 0;
  for (const ch of expression) {
    if (ch === '(') balance += 1;
    if (ch === ')') balance -= 1;
  }
  return balance;
};

const removeLastToken = (expression) => {
  if (!expression) return '';
  for (const suffix of FUNCTION_SUFFIXES) {
    if (expression.endsWith(suffix)) {
      return expression.slice(0, -suffix.length);
    }
  }
  return expression.slice(0, -1);
};

const needsImplicitMultiply = (expression, nextToken) => {
  if (!expression || !nextToken) return false;
  if (isOperator(nextToken) || nextToken === ')' || nextToken === '%' || nextToken === '!') return false;
  const prevChar = expression[expression.length - 1];
  const nextStartsNumber = /^[0-9.]/.test(nextToken);
  if (/[0-9.]$/.test(prevChar) && nextStartsNumber) return false;
  const prevEndsValue = expression.endsWith('ANS')
    || /[0-9πE)!%]$/.test(expression);
  const nextStartsValue = nextToken === 'ANS'
    || nextToken === 'π'
    || nextToken === 'E'
    || nextToken === '('
    || /^[0-9.]/.test(nextToken)
    || /^[a-z]/i.test(nextToken);
  return prevEndsValue && nextStartsValue;
};

const factorial = (n) => {
  if (!Number.isFinite(n)) throw new Error('Invalid factorial');
  if (n < 0 || !Number.isInteger(n)) throw new Error('Factorial supports non-negative integers only');
  if (n > 170) throw new Error('Factorial overflow');
  let result = 1;
  for (let i = 2; i <= n; i += 1) result *= i;
  return result;
};

const findOperandStart = (expression, endIndex) => {
  if (endIndex < 0) return -1;
  if (expression[endIndex] === ')') {
    let depth = 1;
    for (let i = endIndex - 1; i >= 0; i -= 1) {
      if (expression[i] === ')') depth += 1;
      else if (expression[i] === '(') depth -= 1;
      if (depth === 0) return i;
    }
    return -1;
  }
  let i = endIndex;
  while (i >= 0 && /[A-Za-z0-9_.]/.test(expression[i])) {
    i -= 1;
  }
  return i + 1;
};

const wrapFactorials = (expression) => {
  let output = expression;
  let safety = 0;
  while (output.includes('!') && safety < 120) {
    const bangIndex = output.indexOf('!');
    const start = findOperandStart(output, bangIndex - 1);
    if (start < 0 || start >= bangIndex) {
      throw new Error('Invalid factorial usage');
    }
    const operand = output.slice(start, bangIndex);
    output = `${output.slice(0, start)}fact(${operand})${output.slice(bangIndex + 1)}`;
    safety += 1;
  }
  if (output.includes('!')) throw new Error('Factorial parse failed');
  return output;
};

const normalizeExpressionForEval = (inputExpression, ansValue) => {
  let expression = inputExpression.replace(/\s+/g, '');
  expression = expression.replace(/(-?\d+(?:\.\d+)?)[eE]([+-]?\d+)/g, '($1*10^($2))');
  expression = expression.replace(/×/g, '*').replace(/÷/g, '/');
  expression = expression.replace(/ANS/g, `(${ansValue})`);
  expression = expression.replace(/π/g, 'PI');

  // Convert percent postfix to division by 100 (supports nested simple operands).
  const percentPattern = /((?:\d*\.?\d+|PI|E|\([^()]*\)))%/g;
  for (let i = 0; i < 60; i += 1) {
    const next = expression.replace(percentPattern, '($1/100)');
    if (next === expression) break;
    expression = next;
  }

  expression = wrapFactorials(expression);
  expression = expression.replace(/\^/g, '**');

  if (!/^[0-9A-Za-z_+\-*/().,]*$/.test(expression)) {
    throw new Error('Unsupported expression');
  }
  return expression;
};

const evaluateExpression = (rawExpression, angleMode, ansValue) => {
  const normalized = normalizeExpressionForEval(rawExpression, ansValue);
  const toRad = angleMode === 'DEG'
    ? (value) => value * (Math.PI / 180)
    : (value) => value;
  const fromRad = angleMode === 'DEG'
    ? (value) => value * (180 / Math.PI)
    : (value) => value;

  const scopeNames = [
    'PI', 'E', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
    'sinh', 'cosh', 'tanh', 'sqrt', 'cbrt', 'abs', 'exp',
    'pow', 'log', 'ln', 'fact', 'rand',
  ];

  const scopeValues = [
    Math.PI,
    Math.E,
    (x) => Math.sin(toRad(x)),
    (x) => Math.cos(toRad(x)),
    (x) => Math.tan(toRad(x)),
    (x) => fromRad(Math.asin(x)),
    (x) => fromRad(Math.acos(x)),
    (x) => fromRad(Math.atan(x)),
    (x) => Math.sinh(x),
    (x) => Math.cosh(x),
    (x) => Math.tanh(x),
    (x) => Math.sqrt(x),
    (x) => Math.cbrt(x),
    (x) => Math.abs(x),
    (x) => Math.exp(x),
    (x, y) => Math.pow(x, y),
    (x) => Math.log10(x),
    (x) => Math.log(x),
    (x) => factorial(x),
    () => Math.random(),
  ];

  const fn = new Function(...scopeNames, `'use strict'; return (${normalized});`);
  const result = fn(...scopeValues);
  if (!Number.isFinite(result)) throw new Error('Math error');
  return result;
};

const parseStoredNumber = (value, fallback = 0) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

const formatHistoryTime = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const yyyy = date.getUTCFullYear();
  const mm = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const dd = `${date.getUTCDate()}`.padStart(2, '0');
  const hh = `${date.getUTCHours()}`.padStart(2, '0');
  const min = `${date.getUTCMinutes()}`.padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min} UTC`;
};

const CalculatorButton = memo(({
  label,
  variant,
  onPress,
  small,
}) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [
      styles.key,
      small ? styles.keySmall : styles.keyMain,
      variant === 'operator' && styles.keyOperator,
      variant === 'equals' && styles.keyEquals,
      variant === 'danger' && styles.keyDanger,
      variant === 'ghost' && styles.keyGhost,
      pressed && styles.keyPressed,
    ]}
  >
    <Text
      style={[
        styles.keyText,
        variant === 'equals' && styles.keyTextEquals,
        variant === 'danger' && styles.keyTextDanger,
      ]}
    >
      {label}
    </Text>
  </Pressable>
));

export default function BasicCalculatorScreen() {
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const [expression, setExpression] = useState('');
  const [hasResult, setHasResult] = useState(false);
  const [lastAnswer, setLastAnswer] = useState('0');
  const [memoryValue, setMemoryValue] = useState(0);
  const [angleMode, setAngleMode] = useState('DEG');
  const [history, setHistory] = useState([]);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const loadLocalState = async () => {
      try {
        const [historyRaw, memoryRaw, angleModeRaw, legacyHistoryRaw, legacyMemoryRaw, legacyAngleModeRaw] = await Promise.all([
          AsyncStorage.getItem(STORAGE_HISTORY_KEY),
          AsyncStorage.getItem(STORAGE_MEMORY_KEY),
          AsyncStorage.getItem(STORAGE_ANGLE_MODE_KEY),
          AsyncStorage.getItem(LEGACY_STORAGE_HISTORY_KEY),
          AsyncStorage.getItem(LEGACY_STORAGE_MEMORY_KEY),
          AsyncStorage.getItem(LEGACY_STORAGE_ANGLE_MODE_KEY),
        ]);

        const effectiveHistoryRaw = historyRaw || legacyHistoryRaw;
        const effectiveMemoryRaw = memoryRaw || legacyMemoryRaw;
        const effectiveAngleModeRaw = angleModeRaw || legacyAngleModeRaw;

        if (effectiveHistoryRaw) {
          const parsedHistory = JSON.parse(effectiveHistoryRaw);
          if (Array.isArray(parsedHistory)) {
            setHistory(parsedHistory.slice(0, 200));
          }
        }
        if (effectiveMemoryRaw) {
          setMemoryValue(parseStoredNumber(effectiveMemoryRaw, 0));
        }
        if (effectiveAngleModeRaw === 'DEG' || effectiveAngleModeRaw === 'RAD') {
          setAngleMode(effectiveAngleModeRaw);
        }
      } catch (error) {
        console.error('Failed to load local calculator state', error);
      } finally {
        setIsReady(true);
      }
    };
    loadLocalState();
  }, []);

  useEffect(() => {
    if (!isReady) return;
    AsyncStorage.setItem(STORAGE_HISTORY_KEY, JSON.stringify(history)).catch(() => {});
  }, [history, isReady]);

  useEffect(() => {
    if (!isReady) return;
    AsyncStorage.setItem(STORAGE_MEMORY_KEY, `${memoryValue}`).catch(() => {});
  }, [memoryValue, isReady]);

  useEffect(() => {
    if (!isReady) return;
    AsyncStorage.setItem(STORAGE_ANGLE_MODE_KEY, angleMode).catch(() => {});
  }, [angleMode, isReady]);

  const displayValue = useMemo(() => expression || '0', [expression]);
  const memoryLabel = useMemo(() => formatNumber(memoryValue), [memoryValue]);

  const resetAll = useCallback(() => {
    setExpression('');
    setHasResult(false);
  }, []);

  const backspace = useCallback(() => {
    setExpression((prev) => removeLastToken(prev));
    setHasResult(false);
  }, []);

  const appendToken = useCallback((token) => {
    setExpression((prev) => {
      const current = prev === 'Error' ? '' : prev;
      let base = hasResult && !isOperator(token) ? '' : current;

      if (token === '.') {
        const tail = base.split(/[+\-×÷^()]/).pop() || '';
        if (tail.includes('.')) return base;
        if (!tail || /[A-Za-z%!]$/.test(tail)) {
          if (needsImplicitMultiply(base, '0')) base += '×';
          return `${base}0.`;
        }
      }

      if (isOperator(token)) {
        if (!base && token === '-') return '-';
        if (!base) return base;
        if (/[+\-×÷^]$/.test(base)) {
          return base.slice(0, -1) + token;
        }
        if (base.endsWith('(') && token !== '-') return base;
        return `${base}${token}`;
      }

      if (token === ')') {
        if (!base) return base;
        if (parenBalance(base) <= 0) return base;
        if (/[+\-×÷^(]$/.test(base)) return base;
        return `${base})`;
      }

      if ((token === '%' || token === '!') && (!base || /[+\-×÷^(]$/.test(base))) {
        return base;
      }

      if (needsImplicitMultiply(base, token)) base += '×';
      return `${base}${token}`;
    });
    setHasResult(false);
  }, [hasResult]);

  const toggleSign = useCallback(() => {
    setExpression((prev) => {
      const base = prev === 'Error' ? '' : prev;
      if (!base) return '-';
      if (base.startsWith('-')) return base.slice(1);
      return `-${base}`;
    });
    setHasResult(false);
  }, []);

  const applyInverse = useCallback(() => {
    setExpression((prev) => {
      const base = prev === 'Error' ? '' : prev;
      if (!base) return '1÷(';
      return `1÷(${base})`;
    });
    setHasResult(false);
  }, []);

  const resolveExpressionForEval = useCallback((candidate) => {
    let prepared = candidate || '';
    prepared = prepared.trim();
    if (!prepared) throw new Error('Empty expression');
    while (/[+\-×÷^.]$/.test(prepared) && prepared.length > 1) {
      prepared = prepared.slice(0, -1);
    }
    const balance = parenBalance(prepared);
    if (balance < 0) throw new Error('Parentheses mismatch');
    if (balance > 0) prepared += ')'.repeat(balance);
    return prepared;
  }, []);

  const evaluateCurrent = useCallback(() => {
    try {
      const candidate = expression || lastAnswer;
      const prepared = resolveExpressionForEval(candidate);
      const ansValue = parseStoredNumber(lastAnswer, 0);
      const result = evaluateExpression(prepared, angleMode, ansValue);
      const formattedResult = formatNumber(result);

      const historyItem = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        expression: prepared,
        result: formattedResult,
        createdAt: new Date().toISOString(),
      };

      setExpression(formattedResult);
      setLastAnswer(formattedResult);
      setHasResult(true);
      setHistory((prev) => [historyItem, ...prev].slice(0, 200));
    } catch (error) {
      setExpression('Error');
      setHasResult(true);
    }
  }, [angleMode, expression, lastAnswer, resolveExpressionForEval]);

  const addToMemory = useCallback((sign = 1) => {
    try {
      const candidate = expression || lastAnswer;
      const prepared = resolveExpressionForEval(candidate);
      const ansValue = parseStoredNumber(lastAnswer, 0);
      const result = evaluateExpression(prepared, angleMode, ansValue);
      setMemoryValue((prev) => prev + sign * result);
      setHasResult(true);
    } catch (error) {
      setExpression('Error');
      setHasResult(true);
    }
  }, [angleMode, expression, lastAnswer, resolveExpressionForEval]);

  const handleMainKey = useCallback((key) => {
    if (key === 'C') {
      resetAll();
      return;
    }
    if (key === '⌫') {
      backspace();
      return;
    }
    if (key === '=') {
      evaluateCurrent();
      return;
    }
    if (key === '±') {
      toggleSign();
      return;
    }
    if (key === 'M+') {
      addToMemory(1);
      return;
    }
    if (key === 'M-') {
      addToMemory(-1);
      return;
    }
    appendToken(key);
  }, [addToMemory, appendToken, backspace, evaluateCurrent, resetAll, toggleSign]);

  const handleScientificKey = useCallback((item) => {
    if (item.action === 'inverse') {
      applyInverse();
      return;
    }
    if (item.token) appendToken(item.token);
  }, [appendToken, applyInverse]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    setHistoryVisible(false);
  }, []);

  const deleteHistoryItem = useCallback((id) => {
    setHistory((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const useHistoryItem = useCallback((item) => {
    setExpression(item.expression);
    setHasResult(false);
    setHistoryVisible(false);
  }, []);

  const insertMemory = useCallback(() => {
    const token = `(${formatNumber(memoryValue)})`;
    appendToken(token);
  }, [appendToken, memoryValue]);

  const clearMemory = useCallback(() => {
    setMemoryValue(0);
  }, []);

  const toggleAngleMode = useCallback(() => {
    setAngleMode((prev) => (prev === 'DEG' ? 'RAD' : 'DEG'));
  }, []);

  return (
    <SafeAreaView style={[styles.container, { paddingBottom: Math.max(tabBarHeight, 8), paddingTop: Math.max(insets.top, 8) }]}>
      <View style={styles.bgOrbTop} />
      <View style={styles.bgOrbBottom} />

      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Ai Calculator</Text>
          <Text style={styles.headerSubTitle}>Offline-First Calculator</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={toggleAngleMode} style={styles.modeButton}>
            <Text style={styles.modeText}>{angleMode}</Text>
          </Pressable>
          <Pressable onPress={() => setHistoryVisible(true)} style={styles.iconButton}>
            <Ionicons name="time-outline" size={18} color="#D7F6FF" />
          </Pressable>
        </View>
      </View>

      <View style={styles.displayCard}>
        <Text numberOfLines={2} style={styles.expressionText}>
          {displayValue}
        </Text>
        <Text style={styles.answerText}>{hasResult ? `Ans ${lastAnswer}` : 'Ready'}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaBadge}>M {memoryLabel}</Text>
          <Text style={styles.metaBadge}>No Internet Needed</Text>
        </View>
      </View>

      <View style={styles.memoryRow}>
        <Pressable onPress={clearMemory} style={styles.memoryButton}>
          <Text style={styles.memoryButtonText}>MC</Text>
        </Pressable>
        <Pressable onPress={insertMemory} style={styles.memoryButton}>
          <Text style={styles.memoryButtonText}>MR</Text>
        </Pressable>
        <Pressable onPress={() => appendToken('ANS')} style={styles.memoryButton}>
          <Text style={styles.memoryButtonText}>ANS</Text>
        </Pressable>
      </View>

      <View style={styles.scienceCard}>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
          {SCI_PAGES.map((page, pageIndex) => (
            <View key={`sci-page-${pageIndex}`} style={styles.sciencePage}>
              {page.map((item) => (
                <CalculatorButton
                  key={`${pageIndex}-${item.label}`}
                  label={item.label}
                  variant="ghost"
                  small
                  onPress={() => handleScientificKey(item)}
                />
              ))}
            </View>
          ))}
        </ScrollView>
        <Text style={styles.pageHint}>Swipe for more scientific tools</Text>
      </View>

      <View style={styles.mainPad}>
        {MAIN_ROWS.map((row, rowIndex) => (
          <View key={`row-${rowIndex}`} style={styles.mainRow}>
            {row.map((btn) => (
              <CalculatorButton
                key={`${rowIndex}-${btn.label}`}
                label={btn.label}
                variant={btn.variant}
                onPress={() => handleMainKey(btn.label)}
              />
            ))}
          </View>
        ))}
      </View>

      <Modal visible={historyVisible} transparent animationType="slide" onRequestClose={() => setHistoryVisible(false)}>
        <SafeAreaView style={styles.historyModalOverlay}>
          <View style={styles.historySheet}>
            <View style={styles.historyHeader}>
              <Text style={styles.historyTitle}>Local Calculation History</Text>
              <View style={styles.historyHeaderActions}>
                <Pressable onPress={clearHistory} style={styles.historyAction}>
                  <Ionicons name="trash-outline" size={16} color="#FCA5A5" />
                </Pressable>
                <Pressable onPress={() => setHistoryVisible(false)} style={styles.historyAction}>
                  <Ionicons name="close" size={18} color="#D7F6FF" />
                </Pressable>
              </View>
            </View>

            {history.length === 0 ? (
              <View style={styles.historyEmpty}>
                <Ionicons name="albums-outline" size={18} color="#7B9BB4" />
                <Text style={styles.historyEmptyText}>No local history yet.</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={styles.historyList}>
                {history.map((item) => (
                  <View key={item.id} style={styles.historyRow}>
                    <Pressable style={styles.historyMain} onPress={() => useHistoryItem(item)}>
                      <Text style={styles.historyExpression}>{item.expression}</Text>
                      <Text style={styles.historyResult}>= {item.result}</Text>
                      <Text style={styles.historyTimestamp}>{formatHistoryTime(item.createdAt)}</Text>
                    </Pressable>
                    <Pressable
                      style={styles.historyDelete}
                      onPress={() => deleteHistoryItem(item.id)}
                    >
                      <Ionicons name="trash-outline" size={16} color="#FCA5A5" />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060B16',
    paddingHorizontal: LAYOUT.screenPadding,
    paddingTop: Platform.OS === 'android' ? 28 : 12,
  },
  bgOrbTop: {
    position: 'absolute',
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: 'rgba(56,189,248,0.14)',
    top: -80,
    right: -70,
  },
  bgOrbBottom: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(20,184,166,0.12)',
    bottom: -80,
    left: -60,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerTitle: {
    color: '#E4F9FF',
    fontWeight: '800',
    fontSize: 22,
  },
  headerSubTitle: {
    color: '#7FB0C6',
    fontSize: 12,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  modeButton: {
    minWidth: 54,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(9,30,46,0.85)',
  },
  modeText: {
    color: '#CBEFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(9,30,46,0.85)',
  },
  displayCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.28)',
    backgroundColor: 'rgba(8,18,31,0.92)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    minHeight: 126,
    justifyContent: 'space-between',
  },
  expressionText: {
    color: '#F3FCFF',
    textAlign: 'right',
    fontWeight: '700',
    fontSize: 34,
    lineHeight: 43,
  },
  answerText: {
    color: '#7BE3BC',
    textAlign: 'right',
    fontSize: 13,
    marginTop: 2,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: 8,
  },
  metaBadge: {
    flex: 1,
    textAlign: 'center',
    color: '#90B7CF',
    fontSize: 11,
    borderWidth: 1,
    borderColor: 'rgba(71,85,105,0.5)',
    backgroundColor: 'rgba(15,23,42,0.62)',
    paddingVertical: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },
  memoryRow: {
    flexDirection: 'row',
    gap: LAYOUT.gap,
    marginBottom: 8,
  },
  memoryButton: {
    flex: 1,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(71,85,105,0.6)',
    backgroundColor: 'rgba(15,23,42,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memoryButtonText: {
    color: '#C2E3F8',
    fontWeight: '700',
    fontSize: 12,
  },
  scienceCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(71,85,105,0.45)',
    backgroundColor: 'rgba(9,17,28,0.9)',
    paddingVertical: 10,
    marginBottom: 10,
  },
  sciencePage: {
    width: CONTENT_WIDTH,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: LAYOUT.gap,
    paddingHorizontal: 10,
  },
  pageHint: {
    marginTop: 8,
    textAlign: 'center',
    color: '#6F8AA3',
    fontSize: 11,
  },
  mainPad: {
    gap: LAYOUT.gap,
    marginBottom: 2,
  },
  mainRow: {
    flexDirection: 'row',
    gap: LAYOUT.gap,
  },
  key: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(71,85,105,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(15,23,42,0.75)',
  },
  keyMain: {
    flex: 1,
    minHeight: clamp(MAIN_BUTTON_SIZE, 52, 62),
  },
  keySmall: {
    width: `${(100 / LAYOUT.sciColumns) - 2.2}%`,
    minHeight: 40,
  },
  keyOperator: {
    backgroundColor: 'rgba(14,116,144,0.78)',
    borderColor: 'rgba(103,232,249,0.52)',
  },
  keyEquals: {
    backgroundColor: '#67E8F9',
    borderColor: '#BAE6FD',
  },
  keyDanger: {
    backgroundColor: 'rgba(127,29,29,0.32)',
    borderColor: 'rgba(248,113,113,0.58)',
  },
  keyGhost: {
    backgroundColor: 'rgba(20,32,49,0.85)',
  },
  keyPressed: {
    opacity: 0.62,
  },
  keyText: {
    color: '#E8F6FF',
    fontWeight: '700',
    fontSize: 21,
  },
  keyTextEquals: {
    color: '#05212D',
    fontSize: 24,
  },
  keyTextDanger: {
    color: '#FCA5A5',
  },
  historyModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,7,13,0.68)',
    justifyContent: 'flex-end',
  },
  historySheet: {
    maxHeight: '78%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: 'rgba(125,211,252,0.35)',
    backgroundColor: 'rgba(6,14,24,0.98)',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 14,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(71,85,105,0.45)',
    paddingBottom: 8,
    marginBottom: 8,
  },
  historyTitle: {
    color: '#E8F8FF',
    fontSize: 18,
    fontWeight: '800',
  },
  historyHeaderActions: {
    flexDirection: 'row',
    gap: 8,
  },
  historyAction: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(71,85,105,0.5)',
    backgroundColor: 'rgba(15,23,42,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 30,
    gap: 8,
  },
  historyEmptyText: {
    color: '#86A5BE',
    fontSize: 13,
  },
  historyList: {
    gap: 10,
    paddingBottom: 6,
  },
  historyRow: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(71,85,105,0.45)',
    backgroundColor: 'rgba(15,23,42,0.6)',
    padding: 10,
    flexDirection: 'row',
    gap: 8,
  },
  historyMain: {
    flex: 1,
  },
  historyExpression: {
    color: '#E9F8FF',
    fontSize: 14,
    fontWeight: '700',
  },
  historyResult: {
    color: '#86EFAC',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 3,
  },
  historyTimestamp: {
    color: '#7C9AB2',
    fontSize: 11,
    marginTop: 4,
  },
  historyDelete: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.45)',
    backgroundColor: 'rgba(127,29,29,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
