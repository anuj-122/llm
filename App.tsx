import React, { useState, useRef, useEffect } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Alert,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Platform,
  PermissionsAndroid,
} from "react-native";
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import Tts from 'react-native-tts';
import { initLlama, releaseAllLlama } from "llama.rn";
import { downloadModel } from "./src/api/model";
import ProgressBar from "./src/components/ProgressBar";
import RNFS from "react-native-fs";
import axios from "axios";

type Message = {
  role: "user" | "assistant";
  content: string;
  audioPath?: string;
  timestamp?: number;
};

function App(): React.JSX.Element {
  const INITIAL_CONVERSATION: Message[] = [
    {
      role: "assistant",
      content: "Hello! I'm Voxtral. Select a model below to begin.",
      timestamp: Date.now()
    },
  ];

  const audioRecorderPlayerRef = useRef<any>(null);
  
  const [conversation, setConversation] = useState<Message[]>(INITIAL_CONVERSATION);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [aiContext, setAiContext] = useState<any>(null);
  const [downloadSpeed, setDownloadSpeed] = useState<string>("");
  const [lastUpdateTime, setLastUpdateTime] = useState<number>(0);
  const [lastBytesWritten, setLastBytesWritten] = useState<number>(0);
  const [recordingTime, setRecordingTime] = useState<number>(0);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const VOXTAL_MODELS = [
    {
      name: "mistralai_Voxtral-Mini-3B-2507-Q4_K_S.gguf",
      size: "2.38GB",
      recommended: false
    },
    {
      name: "mistralai_Voxtral-Mini-3B-2507-Q4_K_M.gguf",
      size: "2.47GB",
      recommended: true
    },
    {
      name: "mistralai_Voxtral-Mini-3B-2507-Q5_K_M.gguf",
      size: "2.87GB",
      recommended: false
    },
  ];

  useEffect(() => {
    // Initialize audio recorder
    const initAudio = async () => {
      try {
        if (typeof AudioRecorderPlayer === 'function') {
          audioRecorderPlayerRef.current = new AudioRecorderPlayer();
        } else if (AudioRecorderPlayer?.default) {
          audioRecorderPlayerRef.current = new AudioRecorderPlayer.default();
        } else {
          audioRecorderPlayerRef.current = AudioRecorderPlayer;
        }
        audioRecorderPlayerRef.current.setSubscriptionDuration(0.1);
      } catch (error) {
        console.error('Audio init error:', error);
        Alert.alert("Error", "Audio recording not available");
      }
    };

    // Initialize TTS
    const initTTS = async () => {
      try {
        await Tts.setDefaultLanguage('en-US');
        await Tts.setDefaultRate(0.5);
        await Tts.setDefaultPitch(1.0);

        Tts.addEventListener('tts-start', () => setIsSpeaking(true));
        Tts.addEventListener('tts-finish', () => setIsSpeaking(false));
        Tts.addEventListener('tts-cancel', () => setIsSpeaking(false));
      } catch (error) {
        console.error('TTS init error:', error);
      }
    };

    initAudio();
    initTTS();

    return () => {
      releaseResources();
      Tts.removeEventListener('tts-start');
      Tts.removeEventListener('tts-finish');
      Tts.removeEventListener('tts-cancel');
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    };
  }, []);

  const releaseResources = async () => {
    try {
      if (isRecording && audioRecorderPlayerRef.current?.stopRecorder) {
        await audioRecorderPlayerRef.current.stopRecorder();
        setIsRecording(false);
        if (recordingIntervalRef.current) {
          clearInterval(recordingIntervalRef.current);
        }
      }
      Tts.stop();
      if (aiContext) {
        await aiContext.release();
      }
      await releaseAllLlama();
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  };

  const calculateDownloadSpeed = (bytesWritten: number, timeNow: number) => {
    if (lastUpdateTime > 0) {
      const timeDiff = (timeNow - lastUpdateTime) / 1000; // in seconds
      const bytesDiff = bytesWritten - lastBytesWritten;
      const speedKbps = (bytesDiff / timeDiff) / 1024;
      
      if (speedKbps > 1024) {
        return `${(speedKbps / 1024).toFixed(1)} MB/s`;
      }
      return `${speedKbps.toFixed(1)} KB/s`;
    }
    return "Calculating...";
  };

  const downloadAndLoadModel = async (modelName: string) => {
    setIsDownloading(true);
    setProgress(0);
    setDownloadSpeed("");
    setLastUpdateTime(0);
    setLastBytesWritten(0);
    
    try {
      const modelUrl = `https://huggingface.co/bartowski/mistralai_Voxtral-Mini-3B-2507-GGUF/resolve/main/${modelName}`;
      console.log('Starting download from:', modelUrl);

      const freeSpace = await RNFS.getFSInfo();
      if (freeSpace.freeSpace < 3 * 1024 * 1024 * 1024) {
        throw new Error("Not enough storage space (need at least 3GB free)");
      }

      const destPath = await downloadModel(
        modelName,
        modelUrl,
        (bytesWritten, contentLength) => {
          const progress = (bytesWritten / contentLength) * 100;
          const roundedProgress = Math.round(progress);
          setProgress(roundedProgress);
          
          const now = Date.now();
          const speed = calculateDownloadSpeed(bytesWritten, now);
          setDownloadSpeed(speed);
          
          setLastUpdateTime(now);
          setLastBytesWritten(bytesWritten);
        }
      );

      console.log('Download completed to:', destPath);
      await loadModel(destPath);
      
    } catch (error) {
      console.error('Download error:', error);
      Alert.alert(
        "Download Failed",
        error.message || "Failed to download model. Please check your internet connection.",
        [{ text: "OK" }]
      );
    } finally {
      setIsDownloading(false);
    }
  };

  const loadModel = async (modelPath: string) => {
    setIsLoading(true);
    try {
      if (aiContext) {
        await aiContext.release();
        setAiContext(null);
      }

      const config = {
        model: modelPath,
        n_ctx: 2048,
        n_gpu_layers: 1,
      };

      const context = await initLlama(config);
      setAiContext(context);
      setSelectedModel(modelPath.split('/').pop() || "");
      setConversation([
        { 
          role: "assistant", 
          content: "Hello! I'm Voxtral. Press the microphone to talk to me.",
          timestamp: Date.now()
        }
      ]);
      Alert.alert("Success", "Voxtral model loaded and ready!");
    } catch (error) {
      console.error('Model load error:', error);
      Alert.alert("Error", "Failed to load model. Try restarting the app.");
    } finally {
      setIsLoading(false);
    }
  };

  const requestAudioPermission = async (): Promise<boolean> => {
    if (Platform.OS === 'android') {
      try {
        const grants = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
        ]);

        return (
          grants['android.permission.RECORD_AUDIO'] === PermissionsAndroid.RESULTS.GRANTED &&
          grants['android.permission.WRITE_EXTERNAL_STORAGE'] === PermissionsAndroid.RESULTS.GRANTED
        );
      } catch (err) {
        console.warn(err);
        return false;
      }
    }
    return true;
  };

  const startRecording = async () => {
    try {
      const timestamp = new Date().getTime();
      const path = Platform.select({
        ios: `${RNFS.DocumentDirectoryPath}/voxtral_recording_${timestamp}.m4a`,
        android: `${RNFS.DocumentDirectoryPath}/voxtral_recording_${timestamp}.mp4`,
      });

      // Ensure directory exists
      const dir = path.substring(0, path.lastIndexOf('/'));
      if (!(await RNFS.exists(dir))) {
          await RNFS.mkdir(dir);
      }

      console.log('Starting recorder at path:', path);
      const uri = await audioRecorderPlayerRef.current.startRecorder(path);
      setAudioPath(uri);
      setIsRecording(true);
      setRecordingTime(0);
      
      // Start timer
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
      
      console.log(`Recording started at: ${uri}`);
    } catch (error) {
      console.error('Failed to start recording:', error);
      setIsRecording(false);
      Alert.alert("Error", "Failed to start recording. Please check app permissions and try again.");
    }
  };

  const handleStartRecording = async () => {
    if (!aiContext) {
      Alert.alert("Model Not Loaded", "Please load a Voxtral model first.");
      return;
    }

    if (isSpeaking) {
      Tts.stop();
      setIsSpeaking(false);
    }

    const hasPermission = await requestAudioPermission();
    if (hasPermission) {
      await startRecording();
    }
  };

  const stopRecording = async () => {
    if (!isRecording) return;
    
    try {
      setIsRecording(false);
      setIsLoading(true);
      
      // Clear recording timer
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
      
      // Stop the recorder
      const result = await audioRecorderPlayerRef.current.stopRecorder();
      setAudioPath(result);
      
      // Verify file exists
      const fileExists = await RNFS.exists(result);
      if (!fileExists) {
        throw new Error('Recording file not found');
      }

      // Get file info
      const fileInfo = await RNFS.stat(result);
      if (fileInfo.size < 1024) {
        throw new Error('Recording file is too small');
      }

      // Process with AI
      const response = await aiContext.completion({
        messages: [
          { role: "system", content: "You are Voxtral, a helpful voice assistant. Listen to the user's audio and respond naturally and concisely." },
          { role: "user", content: "[AUDIO]" }
        ],
        audio_path: result,
      });

      const userMessage = response.choices[0]?.message?.content || "Could not transcribe audio.";
      const aiResponse = await getAIResponse(userMessage);
      
      setConversation(prev => [
        ...prev,
        { 
          role: "user", 
          content: userMessage, 
          audioPath: result,
          timestamp: Date.now()
        },
        { 
          role: "assistant", 
          content: aiResponse,
          timestamp: Date.now()
        }
      ]);
      
      speakText(aiResponse);
      
    } catch (error) {
      console.error('Recording processing error:', error);
      Alert.alert("Error", `Failed to process recording: ${error.message}`);
    } finally {
      setIsLoading(false);
      setRecordingTime(0);
    }
  };

  const getAIResponse = async (userInput: string) => {
    try {
      const conversationHistory = conversation.map(msg => ({ role: msg.role, content: msg.content }));
      const response = await aiContext.completion({
        messages: [
          ...conversationHistory,
          { role: "user", content: userInput }
        ],
        temperature: 0.7,
        max_tokens: 500,
      });
      
      return response.choices[0]?.message?.content || "I didn't quite understand that. Could you try again?";
    } catch (error) {
      console.error('AI response error:', error);
      return "Sorry, I encountered an error while thinking.";
    }
  };

  const playRecording = async (path: string) => {
    try {
      await audioRecorderPlayerRef.current.startPlayer(path);
      audioRecorderPlayerRef.current.addPlayBackListener((e: any) => {
        if (e.current_position === e.duration) {
          audioRecorderPlayerRef.current.stopPlayer();
        }
      });
    } catch (e) {
      console.error("Could not play audio:", e);
      Alert.alert("Error", "Could not play the recording.");
    }
  };

  const speakText = (text: string) => {
    Tts.stop();
    Tts.speak(text);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView 
        style={styles.scrollView} 
        contentContainerStyle={styles.contentContainer}
        ref={ref => {
          if (ref) {
            setTimeout(() => ref.scrollToEnd({ animated: true }), 100);
          }
        }}
      >
        <View style={styles.header}>
          <Image 
            source={{uri: 'https://huggingface.co/front/assets/huggingface_logo-noborder.svg'}} 
            style={styles.logo} 
          />
          <Text style={styles.title}>Voxtral Voice Chat</Text>
        </View>
        
        {!aiContext ? (
          <View style={styles.modelSelection}>
            <Text style={styles.subtitle}>Select Voxtral Model</Text>
            {VOXTAL_MODELS.map((model) => (
              <TouchableOpacity
                key={model.name}
                style={[
                  styles.modelButton,
                  model.recommended && styles.recommendedModel
                ]}
                onPress={() => downloadAndLoadModel(model.name)}
                disabled={isDownloading || isLoading}
              >
                <Text style={styles.modelName}>{model.name}</Text>
                <Text style={styles.modelSize}>{model.size}</Text>
                {model.recommended && (
                  <Text style={styles.recommendedBadge}>Recommended</Text>
                )}
              </TouchableOpacity>
            ))}
            
            {isDownloading && (
              <View style={styles.progressContainer}>
                <Text style={styles.progressText}>
                  Downloading... {progress}% ({downloadSpeed})
                </Text>
                <ProgressBar progress={progress} />
                <Text style={styles.progressNote}>
                  This may take several minutes depending on your connection
                </Text>
              </View>
            )}
            {isLoading && <ActivityIndicator size="large" color="#4a8cff" style={{marginTop: 20}} />}

          </View>
        ) : (
          <View style={styles.chatContainer}>
            <Text style={styles.modelInfo}>Using: {selectedModel}</Text>
            
            {conversation.map((msg, index) => (
              <View 
                key={`${msg.timestamp}-${index}`} 
                style={[
                  styles.messageBubble, 
                  msg.role === 'user' ? styles.userBubble : styles.aiBubble
                ]}
              >
                {msg.role === 'user' && msg.audioPath && (
                  <TouchableOpacity 
                    onPress={() => playRecording(msg.audioPath!)} 
                    style={styles.playButton}
                  >
                    <Text style={styles.playButtonText}>▶ Play Recording</Text>
                  </TouchableOpacity>
                )}
                <Text style={msg.role === 'user' ? styles.userMessageText : styles.aiMessageText}>
                  {msg.content}
                </Text>
                {msg.role === "assistant" && (
                  <TouchableOpacity 
                    onPress={() => speakText(msg.content)}
                    style={styles.speakButton}
                    disabled={isSpeaking}
                  >
                    <Text style={styles.speakButtonText}>
                      {isSpeaking ? '🔊 Speaking...' : '🔊 Speak Response'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.bottomContainer}>
        {aiContext ? (
          <TouchableOpacity
            style={[
              styles.recordButton,
              isRecording && styles.recordingButton,
              (isLoading || isSpeaking) && styles.disabledButton
            ]}
            onPress={isRecording ? stopRecording : handleStartRecording}
            disabled={isLoading || (isSpeaking && !isRecording)}
          >
            {isRecording && (
              <Text style={styles.recordingTimer}>{formatTime(recordingTime)}</Text>
            )}
            <Text style={styles.recordButtonText}>
              {isLoading ? 'Processing...' : 
               isRecording ? '🛑 Stop Recording' : '🎤 Start Recording'}
            </Text>
            {(isLoading || isSpeaking) && !isRecording && (
              <ActivityIndicator color="#fff" style={styles.loadingIndicator} />
            )}
          </TouchableOpacity>
        ) : (
          <Text style={styles.instructionText}>
            Select a model to begin voice chat
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  logo: {
    width: 32,
    height: 32,
    marginRight: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  modelSelection: {
    padding: 20,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 20,
    color: '#444',
    textAlign: 'center',
  },
  modelButton: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  recommendedModel: {
    borderColor: '#4a8cff',
    borderWidth: 2,
  },
  modelName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  modelSize: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  recommendedBadge: {
    position: 'absolute',
    top: -10,
    right: 10,
    backgroundColor: '#4a8cff',
    color: '#fff',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    fontSize: 10,
    fontWeight: 'bold',
    overflow: 'hidden',
  },
  progressContainer: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#f0f4f8',
    borderRadius: 10,
  },
  progressText: {
    textAlign: 'center',
    marginBottom: 10,
    color: '#333',
    fontWeight: '500',
  },
  progressNote: {
    textAlign: 'center',
    fontSize: 12,
    color: '#666',
    marginTop: 5,
  },
  chatContainer: {
    padding: 15,
    paddingBottom: 100,
  },
  modelInfo: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginBottom: 15,
  },
  messageBubble: {
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
    maxWidth: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 1,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#4a8cff',
    marginLeft: '20%',
  },
  aiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginRight: '20%',
  },
  userMessageText: {
    color: '#fff',
    fontSize: 16,
  },
  aiMessageText: {
    color: '#333',
    fontSize: 16,
  },
  playButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    padding: 5,
    borderRadius: 5,
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  playButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
  speakButton: {
    backgroundColor: '#f0f0f0',
    padding: 8,
    borderRadius: 5,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  speakButtonText: {
    color: '#333',
    fontSize: 12,
    fontWeight: '500',
  },
  bottomContainer: {
    padding: 15,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  recordButton: {
    backgroundColor: '#4a8cff',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    minHeight: 50,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  recordingButton: {
    backgroundColor: '#ff4a4a',
  },
  disabledButton: {
    backgroundColor: '#a0a0a0',
  },
  recordButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  recordingTimer: {
    color: '#fff',
    fontSize: 14,
    marginBottom: 5,
  },
  loadingIndicator: {
    marginLeft: 10,
  },
  instructionText: {
    textAlign: 'center',
    color: '#666',
    paddingVertical: 10,
  },
});

export default App;