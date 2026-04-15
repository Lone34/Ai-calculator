import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, 
  Animated, Dimensions, SafeAreaView, Platform, ScrollView, Modal
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import SignatureScreen from 'react-native-signature-canvas';
import Markdown from 'react-native-markdown-display';
import axios from 'axios';

const API_URL = 'http://10.99.170.36:8000/api';
const SCREEN_WIDTH = Dimensions.get('window').width;

const COLORS = {
  background: '#0B0D17',
  card: '#151722',
  primary: '#7C3AED',
  text: '#FFFFFF',
  textMuted: '#9CA3AF',
  border: 'rgba(255,255,255,0.1)',
  error: '#EF4444',
  drawerBg: '#121420',
};

const markdownStyles = StyleSheet.create({
  body: { color: '#E5E7EB', fontSize: 16, lineHeight: 24 },
  heading1: { color: '#FFF', marginTop: 10, marginBottom: 5 },
  heading2: { color: '#FFF', marginTop: 10, marginBottom: 5 },
  strong: { color: '#FFF', fontWeight: 'bold' },
  em: { fontStyle: 'italic', color: '#D1D5DB' },
  code_inline: {
    backgroundColor: 'rgba(255,255,255,0.1)', color: '#A78BFA',
    borderRadius: 4, paddingHorizontal: 4, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  code_block: {
    backgroundColor: '#000', color: '#A78BFA', padding: 10,
    borderRadius: 8, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginVertical: 5,
  },
  paragraph: { marginVertical: 4 },
});

export default function SketchScreen() {
  const ref = useRef();
  const [penColor, setPenColor] = useState('#FFFFFF');
  const [isLoading, setIsLoading] = useState(false);
  const [resultModalVisible, setResultModalVisible] = useState(false);
  const [currentResult, setCurrentResult] = useState(null);
  
  // Sidebar State
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const slideAnim = useRef(new Animated.Value(-SCREEN_WIDTH * 0.75)).current;

  const loadSessions = async () => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) return;
      const res = await axios.get(`${API_URL}/sessions/?type=sketch`, {
        headers: { Authorization: `Token ${token}` }
      });
      setSessions(res.data);
    } catch (err) {
      console.error("Failed to load sketch sessions", err);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const toggleDrawer = () => {
    const toValue = isDrawerOpen ? -SCREEN_WIDTH * 0.75 : 0;
    if (!isDrawerOpen) loadSessions();
    Animated.timing(slideAnim, {
      toValue, duration: 250, useNativeDriver: true
    }).start(() => setIsDrawerOpen(!isDrawerOpen));
  };

  const closeDrawer = () => {
    if (isDrawerOpen) toggleDrawer();
  };

  const startNewSketch = () => {
    setCurrentSessionId(null);
    setCurrentResult(null);
    ref.current?.clearSignature();
    closeDrawer();
  };

  const loadSessionContent = async (sessionId) => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      const res = await axios.get(`${API_URL}/sessions/${sessionId}/`, {
        headers: { Authorization: `Token ${token}` }
      });
      // Find the last AI interaction to show
      const aiReplies = res.data.interactions.filter(i => i.role === 'ai');
      if (aiReplies.length > 0) {
        setCurrentResult(aiReplies[aiReplies.length - 1].content_text);
        setResultModalVisible(true);
      } else {
        alert("No AI response stored in this sketch session.");
      }
      setCurrentSessionId(sessionId);
      closeDrawer();
    } catch(err) {
      console.error("Error loading chat", err);
    }
  };

  const deleteSession = async (sessionId) => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      await axios.delete(`${API_URL}/ai-solve/?session_id=${sessionId}`, {
        headers: { Authorization: `Token ${token}` }
      });
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      if (currentSessionId === sessionId) {
        startNewSketch();
      }
    } catch (err) {
      console.error("Failed to delete session", err);
    }
  };

  // --- Drawing Actions ---
  const handleClear = () => { ref.current?.clearSignature(); };
  const handleUndo = () => { ref.current?.undo(); };
  
  const handleSolve = () => {
    ref.current?.readSignature();
  };

  const handleOK = async (signature) => {
    // signature is base64 string "data:image/png;base64,......."
    setIsLoading(true);
    try {
      const token = await AsyncStorage.getItem('userToken');
      let base64Data = signature;
      if (signature.includes(',')) {
        base64Data = signature.split(',')[1];
      }

      const payload = {
        message: "Solve the math problem or analyze the sketch strictly from the drawing. Show work clearly.",
        image: base64Data,
        image_mime: "image/png",
        source: "sketch",
        session_id: currentSessionId
      };

      const res = await axios.post(`${API_URL}/ai-solve/`, payload, {
        headers: { Authorization: `Token ${token}` }
      });

      if (res.data.session_id) {
        setCurrentSessionId(res.data.session_id);
      }
      setCurrentResult(res.data.response);
      setResultModalVisible(true);

    } catch (error) {
      console.error("Sketch Solve Error", error);
      alert("Error: " + (error.response?.data?.error || "Could not process sketch."));
    } finally {
      setIsLoading(false);
    }
  };

  const styleWebView = `
    .m-signature-pad {
      box-shadow: none; border: none; background: transparent;
      margin: 0; padding: 0;
    }
    .m-signature-pad--body { border: none; }
    .m-signature-pad--footer { display: none; margin: 0px; }
    body,html { background-color: #0B0D17; margin: 0; padding: 0;}
  `;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={toggleDrawer} style={styles.iconBtn} hitSlop={10}>
          <Ionicons name="menu-outline" size={26} color={COLORS.textMuted} />
        </TouchableOpacity>
        
        <View style={styles.headerTitleContainer}>
          <Ionicons name="pencil" size={20} color={COLORS.primary} />
          <Text style={styles.headerTitle}>Sketch & Solve</Text>
        </View>

        <TouchableOpacity onPress={startNewSketch} style={styles.iconBtn} hitSlop={10}>
          <Ionicons name="add-circle-outline" size={26} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      {/* Canvas Area */}
      <View style={styles.canvasContainer}>
        <SignatureScreen
          ref={ref}
          onOK={handleOK}
          webStyle={styleWebView}
          penColor={penColor}
          penSize={4}
          backgroundColor="rgba(11, 13, 23, 1)"
          autoClear={false}
        />
        
        {/* Loading Overlay */}
        {isLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>Analyzing sketch...</Text>
          </View>
        )}
      </View>

      {/* Toolbar */}
      <View style={styles.toolbar}>
        <View style={styles.toolbarLeft}>
            <TouchableOpacity style={styles.toolBtn} onPress={handleUndo}>
                <Ionicons name="arrow-undo" size={22} color={COLORS.text} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.toolBtn} onPress={handleClear}>
                <Ionicons name="trash-outline" size={22} color={COLORS.error} />
            </TouchableOpacity>
        </View>

        <View style={styles.colorPalette}>
            {['#FFFFFF', '#EF4444', '#3B82F6', '#10B981', '#F59E0B'].map(color => (
                <TouchableOpacity 
                    key={color} 
                    style={[styles.colorBtn, { backgroundColor: color, borderWidth: penColor === color ? 2 : 0, borderColor: COLORS.primary }]}
                    onPress={() => setPenColor(color)}
                />
            ))}
        </View>

        <TouchableOpacity style={styles.solveBtn} onPress={handleSolve} disabled={isLoading}>
            <Ionicons name="sparkles" size={20} color="#FFF" />
            <Text style={styles.solveBtnText}>Solve</Text>
        </TouchableOpacity>
      </View>

      {/* Drawer Overlay */}
      {isDrawerOpen && (
          <TouchableOpacity style={styles.drawerOverlay} onPress={closeDrawer} activeOpacity={1} />
      )}

      {/* Animated Sidebar Drawer */}
      <Animated.View style={[styles.drawerContainer, { transform: [{ translateX: slideAnim }] }]}>
          <SafeAreaView style={{ flex: 1 }}>
              <View style={styles.drawerHeader}>
                  <Text style={styles.drawerTitle}>Sketch History</Text>
              </View>
              <ScrollView style={{ flex: 1 }}>
                  <TouchableOpacity style={styles.newChatBtnDrawer} onPress={startNewSketch}>
                      <Ionicons name="add" size={20} color="#FFF" />
                      <Text style={styles.newChatBtnText}>New Sketch</Text>
                  </TouchableOpacity>
                  
                  <View style={styles.historyList}>
                      {sessions.map(sess => (
                          <View key={sess.id} style={[styles.historyItemContent, currentSessionId === sess.id && styles.historyItemActive]}>
                              <TouchableOpacity style={styles.historyItemMain} onPress={() => loadSessionContent(sess.id)}>
                                  <Ionicons name="pencil-outline" size={18} color={COLORS.textMuted} style={styles.historyIcon} />
                                  <Text style={styles.historyText} numberOfLines={1}>{sess.title.replace('Sketch: ', '')}</Text>
                              </TouchableOpacity>
                              
                              <TouchableOpacity style={styles.deleteChatBtn} onPress={() => deleteSession(sess.id)}>
                                  <Ionicons name="trash-outline" size={16} color={COLORS.error} />
                              </TouchableOpacity>
                          </View>
                      ))}
                  </View>
              </ScrollView>
          </SafeAreaView>
      </Animated.View>

      {/* Result Bottom Sheet / Modal */}
      <Modal
        visible={resultModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setResultModalVisible(false)}
      >
        <View style={styles.modalOverlayContainer}>
            <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>AI Solution</Text>
                    <TouchableOpacity onPress={() => setResultModalVisible(false)} style={styles.closeBtn}>
                        <Ionicons name="close" size={24} color="#FFF" />
                    </TouchableOpacity>
                </View>
                <ScrollView contentContainerStyle={{ padding: 20 }}>
                     {currentResult ? (
                         <Markdown style={markdownStyles}>{currentResult}</Markdown>
                     ) : (
                         <Text style={{color: COLORS.textMuted}}>No result found.</Text>
                     )}
                </ScrollView>
            </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: Platform.OS === 'android' ? 48 : 16, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  headerTitleContainer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  iconBtn: { padding: 4 },

  canvasContainer: {
     flex: 1, position: 'relative',
  },
  loadingOverlay: {
     ...StyleSheet.absoluteFillObject,
     backgroundColor: 'rgba(11, 13, 23, 0.8)',
     justifyContent: 'center', alignItems: 'center',
     zIndex: 10,
  },
  loadingText: { color: COLORS.primary, marginTop: 12, fontSize: 16, fontWeight: '600' },

  toolbar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 12,
      backgroundColor: COLORS.card,
      borderTopWidth: 1, borderTopColor: COLORS.border,
      paddingBottom: Platform.OS === 'ios' ? 24 : 12,
  },
  toolbarLeft: { flexDirection: 'row', gap: 12 },
  toolBtn: { padding: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8 },
  
  colorPalette: { flexDirection: 'row', gap: 8 },
  colorBtn: { width: 28, height: 28, borderRadius: 14, elevation: 2 },

  solveBtn: { 
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: COLORS.primary, paddingHorizontal: 16, paddingVertical: 12, 
      borderRadius: 12 
  },
  solveBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },

  // Drawer
  drawerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10 },
  drawerContainer: { 
      position: 'absolute', top: 0, bottom: 0, left: 0, width: SCREEN_WIDTH * 0.75, 
      backgroundColor: COLORS.drawerBg, zIndex: 20, borderRightWidth: 1, borderRightColor: COLORS.border 
  },
  drawerHeader: { padding: 20, paddingTop: Platform.OS === 'android' ? 50 : 20, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  drawerTitle: { color: "#FFF", fontSize: 18, fontWeight: 'bold' },
  newChatBtnDrawer: { flexDirection: 'row', alignItems: 'center', margin: 20, padding: 12, backgroundColor: 'rgba(124,58,237,0.2)', borderRadius: 8 },
  newChatBtnText: { color: '#FFF', fontWeight: '600', marginLeft: 8 },
  historyList: { paddingHorizontal: 10 },
  
  historyItemContent: { flexDirection: 'row', alignItems: 'center', borderRadius: 8, marginBottom: 4, paddingRight: 8 },
  historyItemActive: { backgroundColor: 'rgba(255,255,255,0.1)' },
  historyItemMain: { flexDirection: 'row', alignItems: 'center', padding: 12, flex: 1 },
  historyIcon: { marginRight: 10 },
  historyText: { color: COLORS.text, fontSize: 14, flex: 1 },
  deleteChatBtn: { padding: 8 },

  // Result Modal
  modalOverlayContainer: {
      flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
      justifyContent: 'flex-end',
  },
  modalContent: {
      backgroundColor: COLORS.card,
      height: '80%',
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
  },
  modalHeader: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      padding: 20, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  modalTitle: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  closeBtn: { padding: 4, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 16 },
});
