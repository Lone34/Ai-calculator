import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  PanResponder,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import Markdown from 'react-native-markdown-display';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import ViewShot from 'react-native-view-shot';
import axios from 'axios';
import { API_URL } from '../config/api';

const CANVAS_BG = '#0A0F1B';
const COLOR_SWATCHES = ['#D5E3FF', '#7DD3FC', '#34D399', '#F59E0B', '#F97316', '#F43F5E'];

const SOLVER_PROMPT = [
  'Analyze this hand-drawn math sketch carefully.',
  'Identify equations, labels, graph axes, geometry marks, and any written values.',
  'Then provide:',
  '1) A clean interpretation of the problem.',
  '2) Step-by-step solution.',
  '3) If graph-related, include intercepts, slope/shape notes, and a small point table.',
  '4) If geometry-related, include the key formula and substitutions clearly.',
  '5) End exactly with: The final answer is ...',
  '6) If a visual is useful, add exactly one fenced code block labeled plotjson.',
  'The plotjson block must be strict JSON using one of these schemas:',
  '{"type":"graph2d","xMin":-10,"xMax":10,"yMin":-10,"yMax":10,"functions":[{"expr":"x^2","color":"#38BDF8"}]}',
  '{"type":"geometry","domain":{"xMin":-1,"xMax":11,"yMin":-1,"yMax":11},"points":[{"id":"A","x":0,"y":0},{"id":"B","x":8,"y":0}],"segments":[["A","B"]],"circles":[{"center":"A","radius":8}]}',
  'Use plain Markdown only and no LaTeX.',
].join('\n');

const VISUAL_BLOCK_REGEX = /```(?:plotjson|visualjson|graphjson|json)?\s*([\s\S]*?)```/gi;
const SUPPORTED_VISUAL_TYPES = new Set(['graph2d', 'geometry']);
const SKETCH_TITLE_REGEX = /(Sketch Solve|hand-drawn math sk)/i;
const ALLOWED_IDENTIFIERS = new Set([
  'x', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'sqrt', 'abs', 'log', 'ln', 'exp', 'pow', 'pi', 'e',
]);

const toNumber = (value, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toPoint = (value) => {
  if (Array.isArray(value) && value.length >= 2) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }
  if (value && typeof value === 'object') {
    const x = Number(value.x);
    const y = Number(value.y);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }
  return null;
};

const extractSketchInstruction = (rawQuery = '') => {
  if (typeof rawQuery !== 'string' || !rawQuery.trim()) return '';
  const firstLine = rawQuery.split('\n')[0].trim();
  return firstLine
    .replace(/^Sketch Solve Request:\s*/i, '')
    .replace(/^Sketch Solve:\s*/i, '')
    .trim();
};

const formatSessionTitle = (title = '') => (
  String(title || '')
    .replace(/^AI Solve:\s*/i, '')
    .trim()
);

const parseVisualSpecFromSolution = (responseText) => {
  if (typeof responseText !== 'string') {
    return { cleanText: '', visualSpec: null };
  }
  VISUAL_BLOCK_REGEX.lastIndex = 0;
  let cleanText = responseText;
  let visualSpec = null;
  let match;
  while ((match = VISUAL_BLOCK_REGEX.exec(responseText)) !== null) {
    const jsonText = match[1]?.trim();
    if (!jsonText) continue;
    try {
      const parsed = JSON.parse(jsonText);
      const visualType = parsed?.type;
      if (SUPPORTED_VISUAL_TYPES.has(visualType)) {
        visualSpec = parsed;
        cleanText = cleanText.replace(match[0], '');
        break;
      }
    } catch (error) {
      // Ignore invalid JSON blocks and continue scanning.
    }
  }
  cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();
  return {
    cleanText: cleanText || responseText.trim(),
    visualSpec,
  };
};

const normalizeExpression = (expression) => (
  expression
    .replace(/\bX\b/g, 'x')
    .replace(/π/g, 'pi')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/\^/g, '**')
);

const compileGraphFunction = (expression) => {
  if (typeof expression !== 'string') return null;
  const normalized = normalizeExpression(expression.trim());
  if (!normalized) return null;
  if (!/^[0-9a-zA-Z_+\-*/().,\s*]*$/.test(normalized)) return null;
  const identifiers = normalized.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
  for (const identifier of identifiers) {
    if (!ALLOWED_IDENTIFIERS.has(identifier)) return null;
  }
  const runtimeExpr = normalized.replace(/\bln\(/g, 'log(');
  let evaluator;
  try {
    evaluator = new Function(
      'x',
      `
        const sin = Math.sin;
        const cos = Math.cos;
        const tan = Math.tan;
        const asin = Math.asin;
        const acos = Math.acos;
        const atan = Math.atan;
        const sqrt = Math.sqrt;
        const abs = Math.abs;
        const log = Math.log;
        const exp = Math.exp;
        const pow = Math.pow;
        const pi = Math.PI;
        const e = Math.E;
        return (${runtimeExpr});
      `,
    );
  } catch (error) {
    return null;
  }
  return (x) => {
    try {
      const y = evaluator(x);
      if (typeof y !== 'number' || !Number.isFinite(y)) return null;
      return y;
    } catch (error) {
      return null;
    }
  };
};

const chooseTickStep = (min, max, targetTickCount = 8) => {
  const range = Math.abs(max - min);
  if (!Number.isFinite(range) || range === 0) return 1;
  const rough = range / Math.max(2, targetTickCount);
  const base = 10 ** Math.floor(Math.log10(rough));
  const candidates = [1, 2, 5, 10];
  for (const candidate of candidates) {
    const step = candidate * base;
    if (step >= rough) return step;
  }
  return 10 * base;
};

const buildTicks = (min, max, step) => {
  if (!Number.isFinite(step) || step <= 0) return [];
  const ticks = [];
  const start = Math.ceil(min / step) * step;
  for (let value = start, i = 0; value <= max + step * 0.25 && i < 300; value += step, i += 1) {
    ticks.push(Number(value.toFixed(6)));
  }
  return ticks;
};

const buildFunctionPath = ({ fn, xMin, xMax, yMin, yMax, width, height, samples }) => {
  let d = '';
  let started = false;
  const yRange = Math.max(1e-9, yMax - yMin);
  for (let i = 0; i <= samples; i += 1) {
    const x = xMin + ((xMax - xMin) * i) / samples;
    const y = fn(x);
    if (y === null || !Number.isFinite(y) || Math.abs(y) > 1e9) {
      started = false;
      continue;
    }
    if (y < yMin - yRange * 5 || y > yMax + yRange * 5) {
      started = false;
      continue;
    }
    const px = ((x - xMin) / (xMax - xMin)) * width;
    const py = height - ((y - yMin) / (yMax - yMin)) * height;
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      started = false;
      continue;
    }
    if (!started) {
      d += `M ${px.toFixed(2)} ${py.toFixed(2)} `;
      started = true;
    } else {
      d += `L ${px.toFixed(2)} ${py.toFixed(2)} `;
    }
  }
  return d.trim();
};

const normalizeGeometrySpec = (spec) => {
  const pointMap = {};
  const points = [];
  if (Array.isArray(spec.points)) {
    spec.points.forEach((point, index) => {
      const id = String(point?.id || point?.label || `P${index + 1}`);
      const x = Number(point?.x);
      const y = Number(point?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        pointMap[id] = { id, x, y };
        points.push({ id, x, y });
      }
    });
  } else if (spec.points && typeof spec.points === 'object') {
    Object.entries(spec.points).forEach(([id, pointValue]) => {
      const point = toPoint(pointValue);
      if (point) {
        pointMap[id] = { id, ...point };
        points.push({ id, ...point });
      }
    });
  }

  const resolvePoint = (input) => {
    if (typeof input === 'string') return pointMap[input] || null;
    return toPoint(input);
  };

  const segments = [];
  if (Array.isArray(spec.segments)) {
    spec.segments.forEach((segment) => {
      let fromInput;
      let toInput;
      if (Array.isArray(segment) && segment.length >= 2) {
        fromInput = segment[0];
        toInput = segment[1];
      } else if (segment && typeof segment === 'object') {
        fromInput = segment.from;
        toInput = segment.to;
      }
      const from = resolvePoint(fromInput);
      const to = resolvePoint(toInput);
      if (from && to) segments.push({ from, to });
    });
  }

  const circles = [];
  if (Array.isArray(spec.circles)) {
    spec.circles.forEach((circle) => {
      if (!circle || typeof circle !== 'object') return;
      const center = resolvePoint(circle.center || { x: circle.cx, y: circle.cy });
      const radius = Number(circle.radius || circle.r);
      if (center && Number.isFinite(radius) && radius > 0) {
        circles.push({ center, radius });
      }
    });
  }

  let xMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;

  const includePoint = (point) => {
    xMin = Math.min(xMin, point.x);
    xMax = Math.max(xMax, point.x);
    yMin = Math.min(yMin, point.y);
    yMax = Math.max(yMax, point.y);
  };

  points.forEach(includePoint);
  circles.forEach(({ center, radius }) => {
    includePoint({ x: center.x - radius, y: center.y - radius });
    includePoint({ x: center.x + radius, y: center.y + radius });
  });

  const domain = spec.domain && typeof spec.domain === 'object'
    ? {
        xMin: toNumber(spec.domain.xMin, xMin),
        xMax: toNumber(spec.domain.xMax, xMax),
        yMin: toNumber(spec.domain.yMin, yMin),
        yMax: toNumber(spec.domain.yMax, yMax),
      }
    : { xMin, xMax, yMin, yMax };

  if (!Number.isFinite(domain.xMin) || !Number.isFinite(domain.xMax) || domain.xMax <= domain.xMin) {
    domain.xMin = -10;
    domain.xMax = 10;
  }
  if (!Number.isFinite(domain.yMin) || !Number.isFinite(domain.yMax) || domain.yMax <= domain.yMin) {
    domain.yMin = -10;
    domain.yMax = 10;
  }
  return { points, segments, circles, domain };
};

const markdownStyles = StyleSheet.create({
  body: { color: '#E5F2FF', fontSize: 15, lineHeight: 23 },
  heading1: { color: '#F8FBFF' },
  heading2: { color: '#F8FBFF' },
  heading3: { color: '#F8FBFF' },
  paragraph: { marginVertical: 5 },
  strong: { color: '#FFFFFF', fontWeight: '700' },
  code_block: {
    backgroundColor: 'rgba(11, 18, 32, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(125, 211, 252, 0.18)',
    color: '#C7E8FF',
    borderRadius: 10,
    padding: 10,
    marginVertical: 6,
  },
  code_inline: {
    backgroundColor: 'rgba(51, 65, 85, 0.6)',
    color: '#BAE6FD',
    borderRadius: 6,
    paddingHorizontal: 4,
  },
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const buildPath = (points) => {
  if (!points || points.length === 0) return '';
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x} ${p.y} L ${p.x + 0.1} ${p.y + 0.1}`;
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const midX = (prev.x + curr.x) / 2;
    const midY = (prev.y + curr.y) / 2;
    d += ` Q ${prev.x} ${prev.y} ${midX} ${midY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
};

const ToolButton = ({ icon, label, active, onPress }) => (
  <Pressable onPress={onPress} style={[styles.toolButton, active && styles.toolButtonActive]}>
    <Ionicons name={icon} size={18} color={active ? '#03131F' : '#A5B4C7'} />
    <Text style={[styles.toolButtonText, active && styles.toolButtonTextActive]}>{label}</Text>
  </Pressable>
);

const ActionButton = ({ icon, label, onPress, danger, disabled }) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    style={[
      styles.actionButton,
      danger && styles.actionButtonDanger,
      disabled && styles.actionButtonDisabled,
    ]}
  >
    <Ionicons name={icon} size={16} color={danger ? '#FCA5A5' : '#C7E8FF'} />
    <Text style={[styles.actionButtonText, danger && styles.actionButtonTextDanger]}>{label}</Text>
  </Pressable>
);

export default function SketchScreen() {
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const canvasRef = useRef(null);
  const canvasSizeRef = useRef({ width: 0, height: 0 });
  const autoSolveTimerRef = useRef(null);
  const currentStrokeRef = useRef(null);
  const drawSettingsRef = useRef({ tool: 'pen', color: COLOR_SWATCHES[0], width: 3 });

  const [tool, setTool] = useState('pen');
  const [strokeColor, setStrokeColor] = useState(COLOR_SWATCHES[0]);
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(false);
  const [autoSolve, setAutoSolve] = useState(false);

  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [strokes, setStrokes] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [currentStroke, setCurrentStroke] = useState(null);

  const [sessionId, setSessionId] = useState(null);
  const [isSolving, setIsSolving] = useState(false);
  const [solution, setSolution] = useState('');
  const [visualSpec, setVisualSpec] = useState(null);
  const [solverCommand, setSolverCommand] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [solvedAt, setSolvedAt] = useState('');
  const [historyVisible, setHistoryVisible] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyItems, setHistoryItems] = useState([]);
  const [historyBusySessionId, setHistoryBusySessionId] = useState(null);
  const [visualViewportWidth, setVisualViewportWidth] = useState(0);
  const [isVisualFullscreen, setIsVisualFullscreen] = useState(false);
  const [visualZoom, setVisualZoom] = useState(1);

  useEffect(() => {
    drawSettingsRef.current = { tool, color: strokeColor, width: strokeWidth };
  }, [tool, strokeColor, strokeWidth]);

  useEffect(() => {
    canvasSizeRef.current = canvasSize;
  }, [canvasSize]);

  const beginStroke = useCallback((x, y) => {
    const size = canvasSizeRef.current;
    if (!size.width || !size.height) return;
    const boundedX = clamp(x, 0, size.width);
    const boundedY = clamp(y, 0, size.height);
    const settings = drawSettingsRef.current;
    const stroke = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      color: settings.tool === 'eraser' ? CANVAS_BG : settings.color,
      width: settings.tool === 'eraser' ? Math.max(12, settings.width * 4) : settings.width,
      points: [{ x: boundedX, y: boundedY }],
    };
    currentStrokeRef.current = stroke;
    setCurrentStroke(stroke);
    setRedoStack([]);
  }, []);

  const extendStroke = useCallback((x, y) => {
    if (!currentStrokeRef.current) return;
    const size = canvasSizeRef.current;
    const boundedX = clamp(x, 0, size.width);
    const boundedY = clamp(y, 0, size.height);
    const active = currentStrokeRef.current;
    const lastPoint = active.points[active.points.length - 1];
    const dx = boundedX - lastPoint.x;
    const dy = boundedY - lastPoint.y;
    if (dx * dx + dy * dy < 2.5) return;
    const next = {
      ...active,
      points: [...active.points, { x: boundedX, y: boundedY }],
    };
    currentStrokeRef.current = next;
    setCurrentStroke(next);
  }, []);

  const commitStroke = useCallback(() => {
    const active = currentStrokeRef.current;
    if (!active || active.points.length === 0) {
      currentStrokeRef.current = null;
      setCurrentStroke(null);
      return;
    }
    setStrokes((prev) => [...prev, active]);
    currentStrokeRef.current = null;
    setCurrentStroke(null);
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        beginStroke(evt.nativeEvent.locationX, evt.nativeEvent.locationY);
      },
      onPanResponderMove: (evt) => {
        extendStroke(evt.nativeEvent.locationX, evt.nativeEvent.locationY);
      },
      onPanResponderRelease: commitStroke,
      onPanResponderTerminate: commitStroke,
    }),
  ).current;

  const undoLast = useCallback(() => {
    setStrokes((prev) => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];
      setRedoStack((redoPrev) => [...redoPrev, last]);
      return prev.slice(0, -1);
    });
  }, []);

  const redoLast = useCallback(() => {
    setRedoStack((prev) => {
      if (!prev.length) return prev;
      const restored = prev[prev.length - 1];
      setStrokes((strokePrev) => [...strokePrev, restored]);
      return prev.slice(0, -1);
    });
  }, []);

  const clearCanvas = useCallback(() => {
    setStrokes([]);
    setRedoStack([]);
    currentStrokeRef.current = null;
    setCurrentStroke(null);
  }, []);

  const newSketch = useCallback(() => {
    clearCanvas();
    setSessionId(null);
    setSolution('');
    setVisualSpec(null);
    setSolverCommand('');
    setErrorMessage('');
    setSolvedAt('');
    setIsVisualFullscreen(false);
    setVisualZoom(1);
  }, [clearCanvas]);

  const copySolution = useCallback(async () => {
    if (!solution) return;
    if (Clipboard.setStringAsync) {
      await Clipboard.setStringAsync(solution);
    } else {
      Clipboard.setString(solution);
    }
  }, [solution]);

  const fetchSketchHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) throw new Error('Missing auth token');
      const res = await axios.get(`${API_URL}/sessions/?type=ai`, {
        headers: { Authorization: `Token ${token}` },
      });
      const sessions = Array.isArray(res.data) ? res.data : [];
      const mapped = sessions
        .map((session) => {
          const interactions = Array.isArray(session?.interactions) ? session.interactions : [];
          const hasImageInput = interactions.some((item) => item?.input_type === 'image');
          const cleanTitle = formatSessionTitle(session?.title);
          const isSketchSession = hasImageInput || SKETCH_TITLE_REGEX.test(cleanTitle);
          if (!isSketchSession) return null;

          const latestUser = [...interactions].reverse().find((item) => item?.role === 'user' && item?.raw_query);
          const latestAi = [...interactions].reverse().find((item) => item?.role === 'ai' && item?.content_text);
          const instruction = extractSketchInstruction(latestUser?.raw_query || cleanTitle);
          const answerPreview = (latestAi?.content_text || '').replace(/\s+/g, ' ').trim();

          return {
            id: session.id,
            title: instruction || cleanTitle || 'Sketch Session',
            updatedAt: session.updated_at || session.created_at || '',
            answerPreview: answerPreview.slice(0, 180),
          };
        })
        .filter(Boolean)
        .sort((a, b) => {
          const ta = new Date(a.updatedAt || 0).getTime();
          const tb = new Date(b.updatedAt || 0).getTime();
          return tb - ta;
        });

      setHistoryItems(mapped);
    } catch (error) {
      setHistoryError(error?.response?.data?.error || error.message || 'Failed to load history.');
      setHistoryItems([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const openHistory = useCallback(() => {
    setHistoryVisible(true);
    fetchSketchHistory();
  }, [fetchSketchHistory]);

  const closeHistory = useCallback(() => {
    setHistoryVisible(false);
  }, []);

  const loadHistorySession = useCallback(async (targetSessionId) => {
    if (!targetSessionId) return;
    setHistoryBusySessionId(targetSessionId);
    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) throw new Error('Missing auth token');
      const res = await axios.get(`${API_URL}/sessions/${targetSessionId}/`, {
        headers: { Authorization: `Token ${token}` },
      });
      const interactions = Array.isArray(res.data?.interactions) ? res.data.interactions : [];
      const latestAi = [...interactions].reverse().find((item) => item?.role === 'ai' && item?.content_text);
      const latestUser = [...interactions].reverse().find((item) => item?.role === 'user' && item?.raw_query);
      const parsedResponse = parseVisualSpecFromSolution(latestAi?.content_text || 'No answer found in this session.');

      setSessionId(targetSessionId);
      setSolution(parsedResponse.cleanText || 'No answer found in this session.');
      setVisualSpec(parsedResponse.visualSpec);
      setSolverCommand(extractSketchInstruction(latestUser?.raw_query || ''));
      setSolvedAt(
        latestAi?.created_at
          ? new Date(latestAi.created_at).toISOString().slice(11, 19)
          : new Date().toISOString().slice(11, 19),
      );
      setErrorMessage('');
      setIsVisualFullscreen(false);
      setVisualZoom(1);
      setHistoryVisible(false);
    } catch (error) {
      setErrorMessage(error?.response?.data?.error || error.message || 'Failed to load session.');
    } finally {
      setHistoryBusySessionId(null);
    }
  }, []);

  const deleteHistorySession = useCallback((targetSessionId) => {
    if (!targetSessionId) return;
    Alert.alert('Delete Session', 'Delete this sketch history item?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setHistoryBusySessionId(targetSessionId);
          try {
            const token = await AsyncStorage.getItem('userToken');
            if (!token) throw new Error('Missing auth token');
            await axios.delete(`${API_URL}/ai-solve/?session_id=${targetSessionId}`, {
              headers: { Authorization: `Token ${token}` },
            });
            setHistoryItems((prev) => prev.filter((item) => item.id !== targetSessionId));
            if (sessionId === targetSessionId) {
              setSessionId(null);
            }
          } catch (error) {
            setErrorMessage(error?.response?.data?.error || error.message || 'Delete failed.');
          } finally {
            setHistoryBusySessionId(null);
          }
        },
      },
    ]);
  }, [sessionId]);

  const openVisualFullscreen = useCallback(() => {
    setVisualZoom(1);
    setIsVisualFullscreen(true);
  }, []);

  const closeVisualFullscreen = useCallback(() => {
    setIsVisualFullscreen(false);
  }, []);

  const zoomVisualIn = useCallback(() => {
    setVisualZoom((prev) => clamp(Number((prev + 0.25).toFixed(2)), 0.6, 3));
  }, []);

  const zoomVisualOut = useCallback(() => {
    setVisualZoom((prev) => clamp(Number((prev - 0.25).toFixed(2)), 0.6, 3));
  }, []);

  const resetVisualZoom = useCallback(() => {
    setVisualZoom(1);
  }, []);

  const solveSketch = useCallback(async (silent = false) => {
    if (isSolving) return;
    if (!strokes.length) {
      if (!silent) {
        Alert.alert('Nothing to solve', 'Draw a problem first, then tap Solve.');
      }
      return;
    }

    try {
      setIsSolving(true);
      setErrorMessage('');
      const token = await AsyncStorage.getItem('userToken');
      if (!token) {
        throw new Error('Authentication token missing. Please log in again.');
      }
      if (!canvasRef.current?.capture) {
        throw new Error('Could not capture sketch image.');
      }

      const imageBase64 = await canvasRef.current.capture();
      const userInstruction = solverCommand.trim();
      const requestLine = userInstruction
        ? `Sketch Solve Request: ${userInstruction}`
        : 'Sketch Solve Request: Solve the sketched math problem clearly.';
      const messagePayload = `${requestLine}\n\n${SOLVER_PROMPT}`;
      const res = await axios.post(
        `${API_URL}/ai-solve/`,
        {
          message: messagePayload,
          image: imageBase64,
          image_mime: 'image/png',
          session_id: sessionId,
        },
        { headers: { Authorization: `Token ${token}` } },
      );

      if (res.data?.session_id) {
        setSessionId(res.data.session_id);
      }
      const rawResponse = res.data?.response || 'No response generated.';
      const parsedResponse = parseVisualSpecFromSolution(rawResponse);
      setSolution(parsedResponse.cleanText || 'Generated visual answer.');
      setVisualSpec(parsedResponse.visualSpec);
      setSolvedAt(new Date().toISOString().slice(11, 19));
    } catch (error) {
      const msg = error?.response?.data?.error || error.message || 'Failed to solve sketch.';
      setErrorMessage(msg);
    } finally {
      setIsSolving(false);
    }
  }, [isSolving, sessionId, solverCommand, strokes.length]);

  useEffect(() => {
    if (!autoSolve || isSolving || currentStroke || !strokes.length) return undefined;
    autoSolveTimerRef.current = setTimeout(() => {
      solveSketch(true);
    }, 900);
    return () => {
      if (autoSolveTimerRef.current) {
        clearTimeout(autoSolveTimerRef.current);
      }
    };
  }, [autoSolve, currentStroke, isSolving, solveSketch, strokes.length]);

  const renderStroke = (stroke) => {
    if (stroke.points.length === 1) {
      const p = stroke.points[0];
      return <Circle key={stroke.id} cx={p.x} cy={p.y} r={stroke.width / 2} fill={stroke.color} />;
    }
    return (
      <Path
        key={stroke.id}
        d={buildPath(stroke.points)}
        stroke={stroke.color}
        strokeWidth={stroke.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    );
  };

  const gridStep = 24;
  const gridLines = [];
  if (showGrid && canvasSize.width && canvasSize.height) {
    for (let x = 0; x <= canvasSize.width; x += gridStep) {
      const major = x % (gridStep * 5) === 0;
      gridLines.push(
        <Line
          key={`gx-${x}`}
          x1={x}
          y1={0}
          x2={x}
          y2={canvasSize.height}
          stroke={major ? 'rgba(107, 114, 128, 0.28)' : 'rgba(107, 114, 128, 0.14)'}
          strokeWidth={major ? 1.2 : 1}
        />,
      );
    }
    for (let y = 0; y <= canvasSize.height; y += gridStep) {
      const major = y % (gridStep * 5) === 0;
      gridLines.push(
        <Line
          key={`gy-${y}`}
          x1={0}
          y1={y}
          x2={canvasSize.width}
          y2={y}
          stroke={major ? 'rgba(107, 114, 128, 0.28)' : 'rgba(107, 114, 128, 0.14)'}
          strokeWidth={major ? 1.2 : 1}
        />,
      );
    }
  }

  const centerX = canvasSize.width / 2;
  const centerY = canvasSize.height / 2;
  const finalAnswerMatch = solution.match(/The final answer is\s*(.*)/i);
  const finalAnswer = finalAnswerMatch?.[1]?.trim();

  const getVisualScene = (visualWidth, visualHeight) => {
    if (!visualSpec || !SUPPORTED_VISUAL_TYPES.has(visualSpec.type)) return null;

    if (visualSpec.type === 'graph2d') {
      let xMin = toNumber(visualSpec.xMin, -10);
      let xMax = toNumber(visualSpec.xMax, 10);
      let yMin = toNumber(visualSpec.yMin, -10);
      let yMax = toNumber(visualSpec.yMax, 10);
      if (xMax <= xMin) {
        xMin = -10;
        xMax = 10;
      }
      if (yMax <= yMin) {
        yMin = -10;
        yMax = 10;
      }

      const mapX = (x) => ((x - xMin) / (xMax - xMin)) * visualWidth;
      const mapY = (y) => visualHeight - ((y - yMin) / (yMax - yMin)) * visualHeight;
      const tickX = chooseTickStep(xMin, xMax, 8);
      const tickY = chooseTickStep(yMin, yMax, 8);
      const ticksX = buildTicks(xMin, xMax, tickX);
      const ticksY = buildTicks(yMin, yMax, tickY);

      const rawFunctions = Array.isArray(visualSpec.functions) ? visualSpec.functions : [];
      const functionSpecs = rawFunctions
        .map((item, index) => {
          const expr = typeof item === 'string' ? item : item?.expr || item?.equation;
          const color = typeof item === 'object' ? item?.color : null;
          const fn = compileGraphFunction(expr);
          if (!fn) return null;
          return {
            id: `fn-${index}`,
            expr,
            color: color || COLOR_SWATCHES[index % COLOR_SWATCHES.length],
            fn,
            samples: clamp(toNumber(item?.samples, 240), 80, 480),
          };
        })
        .filter(Boolean);

      return {
        title: 'Rendered Graph',
        legendItems: functionSpecs.map((item) => ({ id: item.id, color: item.color, label: item.expr })),
        footnote: null,
        node: (
          <Svg width={visualWidth} height={visualHeight}>
            {ticksX.map((tick) => {
              const px = mapX(tick);
              const isAxis = Math.abs(tick) < tickX / 2;
              return (
                <Line
                  key={`vgrid-x-${tick}`}
                  x1={px}
                  y1={0}
                  x2={px}
                  y2={visualHeight}
                  stroke={isAxis ? 'rgba(125,211,252,0.68)' : 'rgba(71,85,105,0.28)'}
                  strokeWidth={isAxis ? 1.4 : 1}
                />
              );
            })}
            {ticksY.map((tick) => {
              const py = mapY(tick);
              const isAxis = Math.abs(tick) < tickY / 2;
              return (
                <Line
                  key={`vgrid-y-${tick}`}
                  x1={0}
                  y1={py}
                  x2={visualWidth}
                  y2={py}
                  stroke={isAxis ? 'rgba(125,211,252,0.68)' : 'rgba(71,85,105,0.28)'}
                  strokeWidth={isAxis ? 1.4 : 1}
                />
              );
            })}

            {functionSpecs.map((fnSpec) => {
              const d = buildFunctionPath({
                fn: fnSpec.fn,
                xMin,
                xMax,
                yMin,
                yMax,
                width: visualWidth,
                height: visualHeight,
                samples: fnSpec.samples,
              });
              if (!d) return null;
              return (
                <Path
                  key={fnSpec.id}
                  d={d}
                  stroke={fnSpec.color}
                  strokeWidth={2.2}
                  fill="none"
                  strokeLinecap="round"
                />
              );
            })}

            <SvgText x={8} y={18} fill="#88A9C7" fontSize="11">x: [{xMin}, {xMax}]</SvgText>
            <SvgText x={8} y={34} fill="#88A9C7" fontSize="11">y: [{yMin}, {yMax}]</SvgText>
          </Svg>
        ),
      };
    }

    if (visualSpec.type === 'geometry') {
      const geometry = normalizeGeometrySpec(visualSpec);
      const { points, segments, circles, domain } = geometry;
      const mapX = (x) => ((x - domain.xMin) / (domain.xMax - domain.xMin)) * visualWidth;
      const mapY = (y) => visualHeight - ((y - domain.yMin) / (domain.yMax - domain.yMin)) * visualHeight;
      const tickX = chooseTickStep(domain.xMin, domain.xMax, 7);
      const tickY = chooseTickStep(domain.yMin, domain.yMax, 7);

      return {
        title: 'Rendered Diagram',
        legendItems: [],
        footnote: `Points: ${points.length} • Segments: ${segments.length} • Circles: ${circles.length}`,
        node: (
          <Svg width={visualWidth} height={visualHeight}>
            {buildTicks(domain.xMin, domain.xMax, tickX).map((tick) => (
              <Line
                key={`geom-grid-x-${tick}`}
                x1={mapX(tick)}
                y1={0}
                x2={mapX(tick)}
                y2={visualHeight}
                stroke="rgba(71,85,105,0.26)"
                strokeWidth={1}
              />
            ))}
            {buildTicks(domain.yMin, domain.yMax, tickY).map((tick) => (
              <Line
                key={`geom-grid-y-${tick}`}
                x1={0}
                y1={mapY(tick)}
                x2={visualWidth}
                y2={mapY(tick)}
                stroke="rgba(71,85,105,0.26)"
                strokeWidth={1}
              />
            ))}

            {segments.map((segment, index) => (
              <Line
                key={`segment-${index}`}
                x1={mapX(segment.from.x)}
                y1={mapY(segment.from.y)}
                x2={mapX(segment.to.x)}
                y2={mapY(segment.to.y)}
                stroke="#38BDF8"
                strokeWidth={2.2}
              />
            ))}

            {circles.map((circle, index) => (
              <Circle
                key={`circle-${index}`}
                cx={mapX(circle.center.x)}
                cy={mapY(circle.center.y)}
                r={Math.abs((circle.radius / (domain.xMax - domain.xMin)) * visualWidth)}
                stroke="#34D399"
                strokeWidth={2}
                fill="rgba(52,211,153,0.08)"
              />
            ))}

            {points.map((point) => (
              <React.Fragment key={`point-${point.id}`}>
                <Circle
                  cx={mapX(point.x)}
                  cy={mapY(point.y)}
                  r={3.6}
                  fill="#F8FAFC"
                />
                <SvgText
                  x={mapX(point.x) + 6}
                  y={mapY(point.y) - 5}
                  fill="#DFF4FF"
                  fontSize="12"
                >
                  {point.id}
                </SvgText>
              </React.Fragment>
            ))}
          </Svg>
        ),
      };
    }

    return null;
  };

  const previewWidth = clamp((visualViewportWidth || 320) - 2, 240, 520);
  const previewHeight = Math.round(previewWidth * 0.72);
  const fullscreenWidth = clamp(previewWidth * visualZoom, 280, 1800);
  const fullscreenHeight = Math.round(fullscreenWidth * 0.72);

  const renderVisualAnswer = () => {
    const scene = getVisualScene(previewWidth, previewHeight);
    if (!scene) return null;

    return (
      <View style={styles.visualCard}>
        <View style={styles.visualHeader}>
          <Text style={styles.visualTitle}>{scene.title}</Text>
          <View style={styles.visualHeaderActions}>
            <Text style={styles.visualMeta}>from AI plotjson</Text>
            <Pressable onPress={openVisualFullscreen} style={styles.visualExpandButton}>
              <Ionicons name="expand-outline" size={14} color="#CDEFFF" />
              <Text style={styles.visualExpandText}>Full</Text>
            </Pressable>
          </View>
        </View>

        <View
          style={styles.visualCanvasWrap}
          onLayout={(event) => {
            const width = event.nativeEvent.layout.width;
            if (width > 0 && Math.abs(width - visualViewportWidth) > 2) {
              setVisualViewportWidth(width);
            }
          }}
        >
          {scene.node}
        </View>

        {scene.legendItems.length > 0 && (
          <View style={styles.visualLegend}>
            {scene.legendItems.map((item) => (
              <View key={`legend-${item.id}`} style={styles.visualLegendItem}>
                <View style={[styles.visualLegendSwatch, { backgroundColor: item.color }]} />
                <Text style={styles.visualLegendText}>{item.label}</Text>
              </View>
            ))}
          </View>
        )}

        {!!scene.footnote && <Text style={styles.visualFootnote}>{scene.footnote}</Text>}
      </View>
    );
  };

  const fullscreenScene = getVisualScene(fullscreenWidth, fullscreenHeight);

  return (
    <SafeAreaView style={[styles.screen, { paddingBottom: Math.max(tabBarHeight, 8), paddingTop: Math.max(insets.top, 8) }]}>
      <View style={styles.bgOrbOne} />
      <View style={styles.bgOrbTwo} />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <Text style={styles.heroEyebrow}>AI CALCULATOR LAB</Text>
            <Pressable onPress={openHistory} style={styles.historyOpenButton}>
              <Ionicons name="time-outline" size={15} color="#C9EAFE" />
              <Text style={styles.historyOpenButtonText}>History</Text>
            </Pressable>
          </View>
          <Text style={styles.heroTitle}>Sketch Solve</Text>
          <Text style={styles.heroSubtitle}>
            Draw equations, graphs, or geometry. Ai Calculator interprets your sketch and solves it instantly.
          </Text>
        </View>

        <View style={styles.panel}>
          <View style={styles.toolsRow}>
            <ToolButton icon="pencil-outline" label="Pen" active={tool === 'pen'} onPress={() => setTool('pen')} />
            <ToolButton icon="trash-outline" label="Eraser" active={tool === 'eraser'} onPress={() => setTool('eraser')} />
            <ActionButton icon="arrow-undo" label="Undo" onPress={undoLast} disabled={!strokes.length} />
            <ActionButton icon="arrow-redo" label="Redo" onPress={redoLast} disabled={!redoStack.length} />
            <ActionButton icon="close-circle-outline" label="Clear" onPress={clearCanvas} danger disabled={!strokes.length} />
          </View>

          <View style={styles.quickSettingsRow}>
            <View style={styles.colorRow}>
              {COLOR_SWATCHES.map((color) => (
                <Pressable
                  key={color}
                  onPress={() => {
                    setTool('pen');
                    setStrokeColor(color);
                  }}
                  style={[styles.swatch, { backgroundColor: color }, strokeColor === color && styles.swatchActive]}
                />
              ))}
            </View>
            <View style={styles.widthButtons}>
              {[2, 3, 5].map((w) => (
                <Pressable
                  key={w}
                  onPress={() => {
                    setTool('pen');
                    setStrokeWidth(w);
                  }}
                  style={[styles.widthPill, strokeWidth === w && styles.widthPillActive]}
                >
                  <Text style={[styles.widthPillText, strokeWidth === w && styles.widthPillTextActive]}>{w}px</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.togglesRow}>
            <View style={styles.toggleItem}>
              <Text style={styles.toggleLabel}>Graph Grid</Text>
              <Switch value={showGrid} onValueChange={setShowGrid} trackColor={{ true: '#0EA5E9', false: '#334155' }} />
            </View>
            <View style={styles.toggleItem}>
              <Text style={styles.toggleLabel}>Axes</Text>
              <Switch value={showAxes} onValueChange={setShowAxes} trackColor={{ true: '#0EA5E9', false: '#334155' }} />
            </View>
            <View style={styles.toggleItem}>
              <Text style={styles.toggleLabel}>Auto Solve</Text>
              <Switch value={autoSolve} onValueChange={setAutoSolve} trackColor={{ true: '#0EA5E9', false: '#334155' }} />
            </View>
          </View>

          <View style={styles.canvasShell}>
            <View style={styles.canvasHeader}>
              <Text style={styles.canvasTitle}>Smart Canvas</Text>
              <Text style={styles.canvasHint}>{tool === 'eraser' ? 'Erase strokes' : 'Draw your problem clearly'}</Text>
            </View>

            <ViewShot ref={canvasRef} options={{ format: 'png', quality: 1, result: 'base64' }} style={styles.canvasShot}>
              <View
                style={styles.canvasViewport}
                onLayout={(event) => {
                  const { width, height } = event.nativeEvent.layout;
                  setCanvasSize({ width, height });
                }}
                {...panResponder.panHandlers}
              >
                <Svg width="100%" height="100%">
                  {gridLines}
                  {showAxes && !!canvasSize.width && !!canvasSize.height && (
                    <>
                      <Line x1={0} y1={centerY} x2={canvasSize.width} y2={centerY} stroke="rgba(186,230,253,0.65)" strokeWidth={1.5} />
                      <Line x1={centerX} y1={0} x2={centerX} y2={canvasSize.height} stroke="rgba(186,230,253,0.65)" strokeWidth={1.5} />
                      <Path d={`M ${canvasSize.width - 10} ${centerY - 5} L ${canvasSize.width} ${centerY} L ${canvasSize.width - 10} ${centerY + 5}`} stroke="rgba(186,230,253,0.75)" strokeWidth={1.5} fill="none" />
                      <Path d={`M ${centerX - 5} 10 L ${centerX} 0 L ${centerX + 5} 10`} stroke="rgba(186,230,253,0.75)" strokeWidth={1.5} fill="none" />
                    </>
                  )}
                  {strokes.map(renderStroke)}
                  {currentStroke && renderStroke(currentStroke)}
                </Svg>
              </View>
            </ViewShot>
          </View>

          <View style={styles.commandCard}>
            <Text style={styles.commandLabel}>Instruction For This Sketch</Text>
            <TextInput
              style={styles.commandInput}
              value={solverCommand}
              onChangeText={setSolverCommand}
              multiline
              maxLength={420}
              placeholder='Example: "Solve only the circle area and render the graph cleanly."'
              placeholderTextColor="#6F859D"
              textAlignVertical="top"
            />
            <Text style={styles.commandHintText}>
              Add exactly what you want: solve steps, only final answer, only graph, or geometry labels.
            </Text>
          </View>

          <View style={styles.primaryActions}>
            <Pressable style={[styles.solveButton, isSolving && styles.solveButtonDisabled]} onPress={() => solveSketch(false)} disabled={isSolving}>
              {isSolving ? <ActivityIndicator color="#032031" /> : <Ionicons name="flash" size={18} color="#032031" />}
              <Text style={styles.solveButtonText}>{isSolving ? 'Solving...' : 'Solve Instantly'}</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={newSketch}>
              <Ionicons name="sparkles-outline" size={16} color="#C7E8FF" />
              <Text style={styles.secondaryButtonText}>New Sketch</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.resultPanel}>
          <View style={styles.resultHeader}>
            <View>
              <Text style={styles.resultTitle}>Result</Text>
              <Text style={styles.resultMeta}>
                {solvedAt ? `Last solved at ${solvedAt} UTC` : 'Draw and tap Solve to generate an answer'}
              </Text>
            </View>
            <Pressable style={styles.copyButton} onPress={copySolution} disabled={!solution}>
              <Ionicons name="copy-outline" size={16} color={solution ? '#B7E8FF' : '#64748B'} />
            </Pressable>
          </View>

          {!!errorMessage && (
            <View style={styles.errorBanner}>
              <Ionicons name="warning-outline" size={16} color="#FCA5A5" />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          {finalAnswer ? (
            <View style={styles.finalAnswerCard}>
              <Text style={styles.finalAnswerLabel}>Final Answer</Text>
              <Text style={styles.finalAnswerText}>{finalAnswer}</Text>
            </View>
          ) : null}

          {renderVisualAnswer()}

          {solution ? (
            <Markdown style={markdownStyles}>{solution}</Markdown>
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="grid-outline" size={18} color="#64748B" />
              <Text style={styles.emptyStateText}>
                Tip: Keep labels and equation text clear. Turn on Axes for graph sketches.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      <Modal visible={historyVisible} transparent animationType="slide" onRequestClose={closeHistory}>
        <SafeAreaView style={styles.historyModalScreen}>
          <View style={styles.historyModalSheet}>
            <View style={styles.historyModalHeader}>
              <Text style={styles.historyModalTitle}>Sketch History</Text>
              <View style={styles.historyModalHeaderActions}>
                <Pressable onPress={fetchSketchHistory} style={styles.historyHeaderButton}>
                  <Ionicons name="refresh" size={16} color="#D4ECFF" />
                </Pressable>
                <Pressable onPress={closeHistory} style={styles.historyHeaderButton}>
                  <Ionicons name="close" size={18} color="#D4ECFF" />
                </Pressable>
              </View>
            </View>

            {historyLoading ? (
              <View style={styles.historyLoadingBox}>
                <ActivityIndicator size="small" color="#7DD3FC" />
                <Text style={styles.historyLoadingText}>Loading sketch history...</Text>
              </View>
            ) : historyError ? (
              <View style={styles.historyErrorBox}>
                <Ionicons name="warning-outline" size={16} color="#FCA5A5" />
                <Text style={styles.historyErrorText}>{historyError}</Text>
              </View>
            ) : historyItems.length === 0 ? (
              <View style={styles.historyEmptyBox}>
                <Ionicons name="albums-outline" size={18} color="#7A8FA7" />
                <Text style={styles.historyEmptyText}>No sketch sessions yet.</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={styles.historyList}>
                {historyItems.map((item) => {
                  const updatedLabel = item.updatedAt
                    ? new Date(item.updatedAt).toISOString().replace('T', ' ').slice(0, 16)
                    : 'Unknown time';
                  const rowBusy = historyBusySessionId === item.id;
                  return (
                    <View key={item.id} style={styles.historyItem}>
                      <Pressable
                        onPress={() => loadHistorySession(item.id)}
                        style={[styles.historyItemMain, rowBusy && styles.historyItemMainDisabled]}
                        disabled={rowBusy}
                      >
                        <Text style={styles.historyItemTitle} numberOfLines={2}>
                          {item.title || 'Sketch session'}
                        </Text>
                        <Text style={styles.historyItemMeta}>Updated: {updatedLabel}</Text>
                        <Text style={styles.historyItemPreview} numberOfLines={2}>
                          {item.answerPreview || 'No answer preview yet.'}
                        </Text>
                      </Pressable>

                      <View style={styles.historyItemActions}>
                        <Pressable
                          onPress={() => loadHistorySession(item.id)}
                          style={styles.historyActionButton}
                          disabled={rowBusy}
                        >
                          {rowBusy ? (
                            <ActivityIndicator size="small" color="#CFEBFF" />
                          ) : (
                            <Ionicons name="open-outline" size={16} color="#CFEBFF" />
                          )}
                        </Pressable>
                        <Pressable
                          onPress={() => deleteHistorySession(item.id)}
                          style={[styles.historyActionButton, styles.historyDeleteButton]}
                          disabled={rowBusy}
                        >
                          <Ionicons name="trash-outline" size={16} color="#FCA5A5" />
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </SafeAreaView>
      </Modal>

      <Modal visible={isVisualFullscreen && !!fullscreenScene} transparent animationType="fade" onRequestClose={closeVisualFullscreen}>
        <SafeAreaView style={styles.visualModalScreen}>
          <View style={styles.visualModalHeader}>
            <Pressable onPress={closeVisualFullscreen} style={styles.visualModalCloseButton}>
              <Ionicons name="close" size={20} color="#D9EEFF" />
            </Pressable>
            <Text style={styles.visualModalTitle}>Visual Output</Text>
            <View style={styles.visualZoomControls}>
              <Pressable onPress={zoomVisualOut} style={styles.visualZoomButton}>
                <Ionicons name="remove" size={16} color="#D9EEFF" />
              </Pressable>
              <Text style={styles.visualZoomText}>{Math.round(visualZoom * 100)}%</Text>
              <Pressable onPress={zoomVisualIn} style={styles.visualZoomButton}>
                <Ionicons name="add" size={16} color="#D9EEFF" />
              </Pressable>
              <Pressable onPress={resetVisualZoom} style={styles.visualZoomResetButton}>
                <Text style={styles.visualZoomResetText}>Fit</Text>
              </Pressable>
            </View>
          </View>

          <ScrollView style={styles.visualModalScroll} contentContainerStyle={styles.visualModalScrollContent}>
            <ScrollView horizontal contentContainerStyle={styles.visualModalHorizontalContent}>
              <View style={styles.visualModalCard}>
                <View style={styles.visualModalCanvasFrame}>
                  {fullscreenScene?.node}
                </View>
                {fullscreenScene?.legendItems?.length > 0 && (
                  <View style={styles.visualLegend}>
                    {fullscreenScene.legendItems.map((item) => (
                      <View key={`modal-legend-${item.id}`} style={styles.visualLegendItem}>
                        <View style={[styles.visualLegendSwatch, { backgroundColor: item.color }]} />
                        <Text style={styles.visualLegendText}>{item.label}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {!!fullscreenScene?.footnote && (
                  <Text style={styles.visualFootnote}>{fullscreenScene.footnote}</Text>
                )}
              </View>
            </ScrollView>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#060A14',
  },
  bgOrbOne: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(14,165,233,0.16)',
    top: -70,
    right: -60,
  },
  bgOrbTwo: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(34,197,94,0.12)',
    bottom: -80,
    left: -70,
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 22,
    gap: 14,
  },
  heroCard: {
    borderRadius: 20,
    padding: 16,
    backgroundColor: 'rgba(10, 17, 30, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.22)',
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroEyebrow: {
    color: '#7DD3FC',
    fontSize: 11,
    letterSpacing: 1.6,
    fontWeight: '700',
    marginBottom: 6,
  },
  historyOpenButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.36)',
    backgroundColor: 'rgba(11, 26, 40, 0.7)',
  },
  historyOpenButtonText: {
    color: '#C9EAFE',
    fontSize: 11,
    fontWeight: '700',
  },
  heroTitle: {
    color: '#F8FBFF',
    fontSize: 28,
    fontWeight: '800',
  },
  heroSubtitle: {
    marginTop: 8,
    color: '#94A3B8',
    fontSize: 14,
    lineHeight: 20,
  },
  panel: {
    borderRadius: 20,
    padding: 12,
    gap: 10,
    backgroundColor: 'rgba(8, 13, 24, 0.96)',
    borderWidth: 1,
    borderColor: 'rgba(71,85,105,0.35)',
  },
  toolsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  toolButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(51,65,85,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(100,116,139,0.38)',
  },
  toolButtonActive: {
    backgroundColor: '#7DD3FC',
    borderColor: '#BAE6FD',
  },
  toolButtonText: {
    color: '#A5B4C7',
    fontWeight: '600',
    fontSize: 12,
  },
  toolButtonTextActive: {
    color: '#03131F',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(71,85,105,0.6)',
    backgroundColor: 'rgba(15,23,42,0.6)',
  },
  actionButtonDanger: {
    borderColor: 'rgba(239,68,68,0.5)',
    backgroundColor: 'rgba(127,29,29,0.2)',
  },
  actionButtonDisabled: {
    opacity: 0.45,
  },
  actionButtonText: {
    color: '#C7E8FF',
    fontSize: 12,
    fontWeight: '600',
  },
  actionButtonTextDanger: {
    color: '#FCA5A5',
  },
  quickSettingsRow: {
    gap: 10,
  },
  colorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  swatch: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(15,23,42,0.9)',
  },
  swatchActive: {
    borderColor: '#E2E8F0',
    transform: [{ scale: 1.05 }],
  },
  widthButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  widthPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(71,85,105,0.55)',
    backgroundColor: 'rgba(15,23,42,0.58)',
  },
  widthPillActive: {
    borderColor: '#7DD3FC',
    backgroundColor: 'rgba(14,165,233,0.22)',
  },
  widthPillText: {
    color: '#9FB2C8',
    fontSize: 12,
    fontWeight: '700',
  },
  widthPillTextActive: {
    color: '#DFF4FF',
  },
  togglesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  toggleItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(15,23,42,0.64)',
    borderWidth: 1,
    borderColor: 'rgba(71,85,105,0.42)',
  },
  toggleLabel: {
    color: '#C0D5EA',
    fontSize: 12,
    fontWeight: '600',
  },
  canvasShell: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.25)',
    backgroundColor: '#070C16',
  },
  canvasHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(125,211,252,0.16)',
  },
  canvasTitle: {
    color: '#DBF2FF',
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 0.4,
  },
  canvasHint: {
    color: '#82A6C6',
    fontSize: 12,
    fontWeight: '500',
  },
  canvasShot: {
    height: 300,
    backgroundColor: CANVAS_BG,
  },
  canvasViewport: {
    flex: 1,
    backgroundColor: CANVAS_BG,
  },
  commandCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.25)',
    backgroundColor: 'rgba(7,19,31,0.85)',
    padding: 10,
    gap: 8,
  },
  commandLabel: {
    color: '#DFF4FF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  commandInput: {
    minHeight: 76,
    maxHeight: 130,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(71,85,105,0.55)',
    backgroundColor: 'rgba(15,23,42,0.68)',
    color: '#EDF7FF',
    paddingHorizontal: 11,
    paddingVertical: 9,
    fontSize: 14,
    lineHeight: 20,
  },
  commandHintText: {
    color: '#89A9C6',
    fontSize: 12,
    lineHeight: 17,
  },
  primaryActions: {
    flexDirection: 'row',
    gap: 8,
  },
  solveButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#7DD3FC',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  solveButtonDisabled: {
    opacity: 0.6,
  },
  solveButtonText: {
    color: '#032031',
    fontWeight: '800',
    fontSize: 15,
  },
  secondaryButton: {
    paddingHorizontal: 13,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.3)',
    backgroundColor: 'rgba(14, 22, 35, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  secondaryButtonText: {
    color: '#C7E8FF',
    fontSize: 13,
    fontWeight: '700',
  },
  resultPanel: {
    borderRadius: 20,
    padding: 14,
    minHeight: 170,
    backgroundColor: 'rgba(8, 13, 24, 0.96)',
    borderWidth: 1,
    borderColor: 'rgba(71,85,105,0.35)',
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  resultTitle: {
    color: '#EAF6FF',
    fontSize: 18,
    fontWeight: '800',
  },
  resultMeta: {
    marginTop: 2,
    color: '#7D95AD',
    fontSize: 12,
  },
  copyButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(71,85,105,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.75)',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.42)',
    backgroundColor: 'rgba(127,29,29,0.25)',
  },
  errorText: {
    color: '#FECACA',
    flex: 1,
    fontSize: 13,
  },
  finalAnswerCard: {
    marginBottom: 10,
    padding: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(45,212,191,0.35)',
    backgroundColor: 'rgba(15,118,110,0.16)',
  },
  finalAnswerLabel: {
    color: '#5EEAD4',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  finalAnswerText: {
    color: '#E6FFFA',
    fontSize: 16,
    fontWeight: '700',
  },
  visualCard: {
    marginBottom: 12,
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.35)',
    backgroundColor: 'rgba(3,17,30,0.8)',
    gap: 8,
  },
  visualHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  visualHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  visualTitle: {
    color: '#DFF4FF',
    fontSize: 14,
    fontWeight: '700',
  },
  visualMeta: {
    color: '#8CB4D7',
    fontSize: 11,
    fontWeight: '600',
  },
  visualExpandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.34)',
    backgroundColor: 'rgba(14,22,35,0.9)',
  },
  visualExpandText: {
    color: '#CDEFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  visualCanvasWrap: {
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.28)',
    backgroundColor: '#07131F',
  },
  visualLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  visualLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(71,85,105,0.5)',
    backgroundColor: 'rgba(15,23,42,0.55)',
  },
  visualLegendSwatch: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  visualLegendText: {
    color: '#BFD9EE',
    fontSize: 12,
  },
  visualFootnote: {
    color: '#8CB4D7',
    fontSize: 12,
  },
  historyModalScreen: {
    flex: 1,
    backgroundColor: 'rgba(0, 8, 15, 0.6)',
    justifyContent: 'flex-end',
  },
  historyModalSheet: {
    maxHeight: '78%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: 'rgba(56,189,248,0.34)',
    backgroundColor: 'rgba(4, 13, 24, 0.98)',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 14,
  },
  historyModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(71,85,105,0.5)',
  },
  historyModalTitle: {
    color: '#E7F5FF',
    fontSize: 18,
    fontWeight: '800',
  },
  historyModalHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  historyHeaderButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(71,85,105,0.6)',
    backgroundColor: 'rgba(15,23,42,0.75)',
  },
  historyLoadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
  },
  historyLoadingText: {
    color: '#A7C8E6',
    fontSize: 13,
  },
  historyErrorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.45)',
    backgroundColor: 'rgba(127,29,29,0.2)',
  },
  historyErrorText: {
    color: '#FECACA',
    flex: 1,
    fontSize: 13,
  },
  historyEmptyBox: {
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  historyEmptyText: {
    color: '#8BA4BC',
    fontSize: 14,
  },
  historyList: {
    gap: 10,
    paddingBottom: 8,
  },
  historyItem: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(71,85,105,0.45)',
    backgroundColor: 'rgba(15,23,42,0.58)',
    padding: 10,
    flexDirection: 'row',
    gap: 10,
  },
  historyItemMain: {
    flex: 1,
    gap: 3,
  },
  historyItemMainDisabled: {
    opacity: 0.6,
  },
  historyItemTitle: {
    color: '#E3F4FF',
    fontSize: 14,
    fontWeight: '700',
  },
  historyItemMeta: {
    color: '#8EADC8',
    fontSize: 11,
  },
  historyItemPreview: {
    color: '#B6D0E7',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  historyItemActions: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  historyActionButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.38)',
    backgroundColor: 'rgba(11,26,40,0.8)',
  },
  historyDeleteButton: {
    borderColor: 'rgba(248,113,113,0.45)',
    backgroundColor: 'rgba(127,29,29,0.25)',
  },
  visualModalScreen: {
    flex: 1,
    backgroundColor: 'rgba(3, 8, 15, 0.97)',
  },
  visualModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(71,85,105,0.5)',
    backgroundColor: 'rgba(2, 10, 18, 0.95)',
  },
  visualModalCloseButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(71,85,105,0.6)',
    backgroundColor: 'rgba(15,23,42,0.76)',
  },
  visualModalTitle: {
    color: '#D9EEFF',
    fontSize: 16,
    fontWeight: '700',
  },
  visualZoomControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  visualZoomButton: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(71,85,105,0.6)',
    backgroundColor: 'rgba(15,23,42,0.76)',
  },
  visualZoomText: {
    color: '#CFEAFC',
    fontSize: 12,
    minWidth: 42,
    textAlign: 'center',
    fontWeight: '700',
  },
  visualZoomResetButton: {
    paddingHorizontal: 10,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.42)',
    backgroundColor: 'rgba(14,165,233,0.18)',
  },
  visualZoomResetText: {
    color: '#CCF0FF',
    fontSize: 12,
    fontWeight: '700',
  },
  visualModalScroll: {
    flex: 1,
  },
  visualModalScrollContent: {
    paddingVertical: 12,
  },
  visualModalHorizontalContent: {
    paddingHorizontal: 12,
  },
  visualModalCard: {
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.36)',
    backgroundColor: 'rgba(3,17,30,0.9)',
    gap: 8,
  },
  visualModalCanvasFrame: {
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.3)',
    backgroundColor: '#07131F',
  },
  emptyState: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(71,85,105,0.36)',
    backgroundColor: 'rgba(15,23,42,0.56)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  emptyStateText: {
    color: '#94A3B8',
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
});
