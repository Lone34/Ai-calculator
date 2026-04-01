import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { 
  View, Text, TextInput, ScrollView, SafeAreaView, TouchableOpacity, 
  KeyboardAvoidingView, Platform, StyleSheet, ActivityIndicator, Image, 
  Keyboard, Modal, Animated, Dimensions 
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import Markdown from 'react-native-markdown-display';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import axios from 'axios';
import { API_URL } from '../config/api';

const SCREEN_WIDTH = Dimensions.get('window').width;

// ── Colors & Styles ──
const COLORS = {
  background: '#0B0D17',
  card: '#151722',
  primary: '#7C3AED',
  text: '#FFFFFF',
  textMuted: '#9CA3AF',
  bubbleUser: '#7C3AED',
  bubbleAI: 'rgba(255,255,255,0.05)',
  border: 'rgba(255,255,255,0.1)',
  error: '#EF4444',
  drawerBg: '#121420',
};

const markdownStyles = StyleSheet.create({
  body: { color: '#E5E7EB', fontSize: 16, lineHeight: 24 },
  heading1: { color: '#FFF', marginTop: 10, marginBottom: 5 },
  heading2: { color: '#FFF', marginTop: 10, marginBottom: 5 },
  heading3: { color: '#FFF', marginTop: 10, marginBottom: 5 },
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
  bullet_list: { marginVertical: 5 },
  ordered_list: { marginVertical: 5 },
  list_item: { marginVertical: 2 },
  paragraph: { marginVertical: 4 },
});

// ── Chat Bubble Component ──
const ChatBubble = memo(({ message, onImagePress }) => {
  const isUser = message.role === 'user';
  
  const copyToClipboard = async () => {
    if (message.text) {
      if (Clipboard.setStringAsync) {
        await Clipboard.setStringAsync(message.text);
      } else {
        Clipboard.setString(message.text);
      }
    }
  };

  return (
    <View style={[styles.bubbleContainer, isUser ? styles.bubbleContainerUser : styles.bubbleContainerAI]}>
      {/* Avatar */}
      {!isUser && (
        <View style={styles.avatarAI}>
          <Ionicons name="sparkles" size={16} color={COLORS.primary} />
        </View>
      )}
      
      {/* Content */}
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAI]}>
        {message.image && (
          <TouchableOpacity activeOpacity={0.8} onPress={() => onImagePress(message.image)}>
            <Image 
              source={{ uri: message.image }} 
              style={styles.messageImage} 
              resizeMode="cover"
            />
          </TouchableOpacity>
        )}
        
        {message.text ? (
          isUser ? (
             <Text style={[styles.messageText, { color: '#FFF' }]}>
               {message.text}
             </Text>
          ) : (
             <Markdown style={markdownStyles}>
               {message.text}
             </Markdown>
          )
        ) : null}

        {/* Action Row for AI */}
        {!isUser && message.text && !message.error && (
            <TouchableOpacity style={styles.copyBtn} onPress={copyToClipboard} hitSlop={10}>
                <Ionicons name="copy-outline" size={14} color={COLORS.textMuted} />
                <Text style={styles.copyText}>Copy</Text>
            </TouchableOpacity>
        )}
      </View>
    </View>
  );
});

export default function AISolveScreen() {
  const tabBarHeight = useBottomTabBarHeight();
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const scrollViewRef = useRef(null);

  // New State for Upgrades
  const [fullScreenImage, setFullScreenImage] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const slideAnim = useRef(new Animated.Value(-SCREEN_WIDTH * 0.75)).current; // Drawer hidden by default

  const loadSessions = async () => {
      try {
          const token = await AsyncStorage.getItem('userToken');
          if (!token) return;
          const res = await axios.get(`${API_URL}/sessions/?type=ai`, {
              headers: { Authorization: `Token ${token}` }
          });
          setSessions(res.data);
      } catch (err) {
          console.error("Failed to load sessions", err);
      }
  };

  useEffect(() => {
    startNewChat();
    loadSessions();
  }, []);

  const startNewChat = () => {
    setCurrentSessionId(null);
    setMessages([
      {
        id: 'welcome',
        role: 'ai',
        text: 'Hi! I am Ai Calculator Assistant. I can help you solve math problems step-by-step. You can type a question like "Solve 2x + 5 = 15" or send me a picture of your homework!'
      }
    ]);
    closeDrawer();
  };

  const loadSessionChat = async (sessionId) => {
      try {
        const token = await AsyncStorage.getItem('userToken');
        const res = await axios.get(`${API_URL}/sessions/${sessionId}/`, {
            headers: { Authorization: `Token ${token}` }
        });
        
        const loadedMessages = res.data.interactions.map(int => ({
            id: int.id,
            role: int.role,
            text: int.role === 'ai' ? int.content_text : int.raw_query,
            image: null // Real image fetching omitted for brevity 
        }));

        setCurrentSessionId(sessionId);
        setMessages(loadedMessages.length > 0 ? loadedMessages : []);
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
              startNewChat();
          }
      } catch (err) {
          console.error("Failed to delete session", err);
          alert("Could not delete this chat.");
      }
  };

  const toggleDrawer = () => {
      const toValue = isDrawerOpen ? -SCREEN_WIDTH * 0.75 : 0;
      if (!isDrawerOpen) loadSessions();
      Animated.timing(slideAnim, {
          toValue,
          duration: 250,
          useNativeDriver: true
      }).start(() => setIsDrawerOpen(!isDrawerOpen));
  };
  
  const closeDrawer = () => {
    if (isDrawerOpen) toggleDrawer();
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      alert('Sorry, we need camera roll permissions to upload images.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      setSelectedImage(result.assets[0]);
    }
  };

  const removeImage = () => {
    setSelectedImage(null);
  };

  const sendMessage = async () => {
    if (!inputText.trim() && !selectedImage) return;

    const newUserMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: inputText.trim(),
      image: selectedImage?.uri,
    };

    const apiText = inputText.trim();
    const apiImageBase64 = selectedImage?.base64;
    const apiImageMime = selectedImage?.mimeType || 'image/jpeg';
    
    setMessages(prev => [...prev, newUserMessage]);
    setInputText('');
    setSelectedImage(null);
    setIsLoading(true);
    Keyboard.dismiss();

    try {
      const token = await AsyncStorage.getItem('userToken');
      
      const chatHistory = messages
        .filter(m => m.id !== 'welcome' && m.text && !m.error)
        .map(m => ({ role: m.role, text: m.text }));

      const payload = {
        message: apiText,
        history: chatHistory,
        session_id: currentSessionId,
        ...(apiImageBase64 && { 
            image: apiImageBase64,
            image_mime: apiImageMime
        })
      };

      const res = await axios.post(`${API_URL}/ai-solve/`, payload, {
        headers: { Authorization: `Token ${token}` }
      });

      const aiResponse = {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        text: res.data.response,
        model: res.data.model,
      };

      if (res.data.session_id) {
          setCurrentSessionId(res.data.session_id);
      }
      setMessages(prev => [...prev, aiResponse]);
    } catch (error) {
      console.error("AI Solve Error:", error.response?.data || error);
      const errorMsg = error.response?.data?.error || "Network error. Please try again.";
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        text: `Sorry, I ran into an issue finding the solution: ${errorMsg}`,
        error: true
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
            <TouchableOpacity onPress={toggleDrawer} style={styles.iconBtn} hitSlop={10}>
                <Ionicons name="menu-outline" size={26} color={COLORS.textMuted} />
            </TouchableOpacity>
            
            <View style={styles.headerTitleContainer}>
                <Ionicons name="sparkles" size={20} color={COLORS.primary} />
                <Text style={styles.headerTitle}>AI Solve</Text>
            </View>

            <TouchableOpacity onPress={startNewChat} style={styles.iconBtn} hitSlop={10}>
                <Ionicons name="create-outline" size={24} color={COLORS.textMuted} />
            </TouchableOpacity>
        </View>

        {/* Chat Area */}
        <ScrollView
            ref={scrollViewRef}
            style={styles.chatArea}
            contentContainerStyle={[styles.chatContent, { paddingBottom: tabBarHeight + 16 }]}
            onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
            keyboardShouldPersistTaps="handled"
        >
            {messages.map((msg) => (
            <ChatBubble key={msg.id} message={msg} onImagePress={setFullScreenImage} />
            ))}
            
            {isLoading && (
            <View style={[styles.bubbleContainer, styles.bubbleContainerAI]}>
                <View style={styles.avatarAI}>
                <Ionicons name="sparkles" size={16} color={COLORS.primary} />
                </View>
                <View style={[styles.bubble, styles.bubbleAI, styles.loadingBubble]}>
                <ActivityIndicator size="small" color={COLORS.primary} />
                <Text style={styles.loadingText}>Ai Calculator is thinking...</Text>
                </View>
            </View>
            )}
        </ScrollView>

        {/* Input Area */}
        <View style={[styles.inputContainer, { paddingBottom: Math.max(tabBarHeight, 12) }]}>
            {selectedImage && (
            <View style={styles.imagePreviewContainer}>
                <Image source={{ uri: selectedImage.uri }} style={styles.imagePreview} />
                <TouchableOpacity style={styles.removeImageBtn} onPress={removeImage}>
                <Ionicons name="close-circle" size={24} color="#FFF" />
                </TouchableOpacity>
            </View>
            )}

            <View style={styles.inputRow}>
            <TouchableOpacity style={styles.attachBtn} onPress={pickImage} disabled={isLoading}>
                <Ionicons name="image-outline" size={24} color={COLORS.textMuted} />
            </TouchableOpacity>
            
            <TextInput
                style={styles.textInput}
                placeholder="Ask a math question..."
                placeholderTextColor={COLORS.textMuted}
                value={inputText}
                onChangeText={setInputText}
                multiline
                maxLength={1000}
                editable={!isLoading}
            />

            <TouchableOpacity 
                style={[styles.sendBtn, (!inputText.trim() && !selectedImage) && styles.sendBtnDisabled]} 
                onPress={sendMessage}
                disabled={(!inputText.trim() && !selectedImage) || isLoading}
            >
                <Ionicons name="send" size={20} color="#FFF" />
            </TouchableOpacity>
            </View>
        </View>
      </KeyboardAvoidingView>

      {/* Drawer Overlay */}
      {isDrawerOpen && (
          <TouchableOpacity style={styles.drawerOverlay} onPress={closeDrawer} activeOpacity={1} />
      )}

      {/* Animated Sidebar Drawer */}
      <Animated.View style={[styles.drawerContainer, { transform: [{ translateX: slideAnim }] }]}>
          <SafeAreaView style={{ flex: 1 }}>
              <View style={styles.drawerHeader}>
                 <Text style={styles.drawerTitle}>Chat History</Text>
              </View>
              <ScrollView style={{ flex: 1 }}>
                  <TouchableOpacity style={styles.newChatBtnDrawer} onPress={startNewChat}>
                      <Ionicons name="add" size={20} color="#FFF" />
                      <Text style={styles.newChatBtnText}>New Chat</Text>
                  </TouchableOpacity>
                  
                  <View style={styles.historyList}>
                      {sessions.map(sess => (
                          <View key={sess.id} style={[styles.historyItemContent, currentSessionId === sess.id && styles.historyItemActive]}>
                              <TouchableOpacity 
                                  style={styles.historyItemMain}
                                  onPress={() => loadSessionChat(sess.id)}
                              >
                                  <Ionicons name="chatbubble-outline" size={18} color={COLORS.textMuted} style={styles.historyIcon} />
                                  <Text style={styles.historyText} numberOfLines={1}>{sess.title.replace('AI Solve: ', '')}</Text>
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

      {/* Full Screen Image Modal */}
      <Modal visible={!!fullScreenImage} transparent={true} animationType="fade">
          <View style={styles.modalOverlay}>
              <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setFullScreenImage(null)}>
                  <Ionicons name="close" size={32} color="#FFF" />
              </TouchableOpacity>
              {fullScreenImage && (
                 <Image source={{ uri: fullScreenImage }} style={styles.fullScreenImage} resizeMode="contain" />
              )}
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
  
  // Chat Area
  chatArea: { flex: 1 },
  chatContent: { padding: 16, paddingBottom: 32 },
  bubbleContainer: { flexDirection: 'row', marginBottom: 16, alignItems: 'flex-end' },
  bubbleContainerUser: { justifyContent: 'flex-end' },
  bubbleContainerAI: { justifyContent: 'flex-start' },
  
  avatarAI: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(124,58,237,0.2)',
    justifyContent: 'center', alignItems: 'center', marginRight: 8,
  },
  bubble: { maxWidth: '80%', padding: 14, borderRadius: 20 },
  bubbleUser: { backgroundColor: COLORS.bubbleUser, borderBottomRightRadius: 4 },
  bubbleAI: { backgroundColor: COLORS.bubbleAI, borderWidth: 1, borderColor: COLORS.border, borderBottomLeftRadius: 4 },
  
  messageText: { fontSize: 16, lineHeight: 24 },
  messageImage: { width: 220, height: 220, borderRadius: 12, marginBottom: 8 },
  
  copyBtn: { flexDirection: 'row', alignItems: 'center', marginTop: 10, alignSelf: 'flex-start', padding: 4 },
  copyText: { color: COLORS.textMuted, fontSize: 12, marginLeft: 4 },

  loadingBubble: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  loadingText: { color: COLORS.textMuted, fontSize: 14 },
  
  // Input Area
  inputContainer: {
    backgroundColor: COLORS.card, paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  imagePreviewContainer: { position: 'relative', alignSelf: 'flex-start', marginBottom: 12 },
  imagePreview: { width: 80, height: 80, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border },
  removeImageBtn: { position: 'absolute', top: -8, right: -8, backgroundColor: '#000', borderRadius: 12, elevation: 2 },
  
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  attachBtn: { padding: 8, paddingBottom: 10 },
  textInput: {
    flex: 1, minHeight: 44, maxHeight: 120,
    backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 22,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
    color: '#FFF', fontSize: 16,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  sendBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.1)' },

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

  // Modal Image
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  modalCloseBtn: { position: 'absolute', top: 50, right: 20, zIndex: 100, padding: 10 },
  fullScreenImage: { width: '100%', height: '80%' }
});
