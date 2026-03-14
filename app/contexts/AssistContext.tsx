import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, AppStateStatus } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Speech from "expo-speech";
import {
  AVAudioSessionCategory,
  AVAudioSessionCategoryOptions,
  AVAudioSessionMode,
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { DEFAULT_PI_STREAM_FPS, MAX_FRAME_AGE_MS, OPENAI_API_KEY } from "../lib/config";
import { RealtimeSessionClient } from "../lib/realtime";
import type {
  DebugEvent,
  HazardState,
  MicState,
  PickedVideoAsset,
  SessionState,
  SourceMode,
  SpeechState,
} from "../lib/types";
import { usePi } from "./PiContext";

interface AssistContextValue {
  hasApiKey: boolean;
  sourceMode: SourceMode;
  sessionState: SessionState;
  speechState: SpeechState;
  micState: MicState;
  lastFrameAgeMs: number | null;
  lastTranscript: string | null;
  partialTranscript: string;
  lastHazard: HazardState | null;
  selectedVideo: PickedVideoAsset | null;
  appDebugEvents: DebugEvent[];
  startPiAssist: () => void;
  stopPiAssist: () => void;
  startReplayAssist: () => void;
  stopReplayAssist: () => void;
  clearHazard: () => void;
  pickVideo: () => Promise<void>;
  ingestReplayFrame: (frame: {
    data: string;
    capturedAt: number;
    frameId: number;
    width: number;
    height: number;
    sizeBytes: number;
  }) => void;
}

const AssistContext = createContext<AssistContextValue | null>(null);

let appDebugIdCounter = 0;
const speechRecognitionOptions = {
  lang: "en-US",
  interimResults: true,
  continuous: true,
  addsPunctuation: true,
  iosCategory: {
    category: AVAudioSessionCategory.playAndRecord,
    categoryOptions: [
      AVAudioSessionCategoryOptions.defaultToSpeaker,
      AVAudioSessionCategoryOptions.allowBluetooth,
      AVAudioSessionCategoryOptions.allowBluetoothA2DP,
    ],
    mode: AVAudioSessionMode.voiceChat,
  },
  iosVoiceProcessingEnabled: true,
  volumeChangeEventOptions: {
    enabled: true,
    intervalMillis: 120,
  },
};

function parseHazard(text: string, capturedAt: number): HazardState | null {
  const alertMatch = text.match(/ALERT:\s*([^\n]+)/i);
  if (alertMatch?.[1]) {
    return {
      category: "hazard",
      text: alertMatch[1].trim(),
      isUrgent: true,
      capturedAt,
    };
  }

  const crossingMatch = text.match(/CROSSING:\s*([^\n]+)/i);
  if (crossingMatch?.[1]) {
    return {
      category: "crossing",
      text: crossingMatch[1].trim(),
      isUrgent: false,
      capturedAt,
    };
  }

  const actionMatch = text.match(/ACTION:\s*(WALK|WAIT|PAUSE_LOOK|CROSSING_PREP)\s*(.*)/i);
  if (actionMatch) {
    const action = actionMatch[1].toUpperCase();
    const guidance = actionMatch[2]?.trim() || action;
    if (action === "WAIT" || action === "PAUSE_LOOK") {
      return {
        category: "hazard",
        text: guidance,
        isUrgent: action === "WAIT",
        capturedAt,
      };
    }
    if (action === "CROSSING_PREP") {
      return {
        category: "crossing",
        text: guidance,
        isUrgent: false,
        capturedAt,
      };
    }
  }

  return null;
}

export function AssistProvider({ children }: { children: React.ReactNode }) {
  const { lastFrame, sendCommand } = usePi();
  const [sourceMode, setSourceMode] = useState<SourceMode>("pi_live");
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [speechState, setSpeechState] = useState<SpeechState>("idle");
  const [micState, setMicState] = useState<MicState>("idle");
  const [lastFrameAgeMs, setLastFrameAgeMs] = useState<number | null>(null);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [lastHazard, setLastHazard] = useState<HazardState | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<PickedVideoAsset | null>(null);
  const [appDebugEvents, setAppDebugEvents] = useState<DebugEvent[]>([]);
  const clientRef = useRef<RealtimeSessionClient | null>(null);
  const shouldListenRef = useRef(false);
  const restartRecognitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consumedFrameId = useRef<number | null>(null);
  const userInterruptionActiveRef = useRef(false);

  const appendDebug = useCallback((event: string, payload: Record<string, unknown> = {}) => {
    setAppDebugEvents((prev) => [
      ...prev.slice(-199),
      {
        id: ++appDebugIdCounter,
        event,
        payload,
        timestamp: Date.now() / 1000,
        source: "app",
      },
    ]);
  }, []);

  const speakGuidance = useCallback((text: string, isUrgent: boolean) => {
    if (isUrgent) {
      Speech.stop();
    }
    Speech.speak(text, {
      language: "en-US",
      rate: 1.0,
      onStart: () => setSpeechState("speaking"),
      onDone: () => setSpeechState("idle"),
      onStopped: () => setSpeechState("idle"),
      onError: () => setSpeechState("error"),
    });
  }, []);

  const interruptAssistantForUser = useCallback(() => {
    if (sourceMode !== "pi_live") {
      return;
    }
    if (userInterruptionActiveRef.current) {
      return;
    }
    userInterruptionActiveRef.current = true;
    Speech.stop();
    clientRef.current?.cancelResponse();
    setSpeechState("idle");
    appendDebug("user_barge_in_detected", { sourceMode });
  }, [appendDebug, sourceMode]);

  const stopRealtime = useCallback(() => {
    if (sourceMode === "pi_live") {
      sendCommand({ type: "command", action: "stop_stream" });
    }
    shouldListenRef.current = false;
    userInterruptionActiveRef.current = false;
    if (restartRecognitionTimer.current) {
      clearTimeout(restartRecognitionTimer.current);
      restartRecognitionTimer.current = null;
    }
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // Ignore state errors when the recognizer is already stopped.
    }
    Speech.stop();
    clientRef.current?.disconnect();
    setSessionState("idle");
    setSpeechState("idle");
    setMicState((prev) => (prev === "denied" ? prev : "idle"));
  }, [sendCommand, sourceMode]);

  const startListening = useCallback(async () => {
    shouldListenRef.current = true;
    setMicState("requesting");
    const useOnDeviceRecognition =
      ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
    const permission = useOnDeviceRecognition
      ? await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync()
      : await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      setMicState("denied");
      appendDebug("mic_permission_denied");
      return;
    }

    setMicState("ready");
    ExpoSpeechRecognitionModule.start({
      ...speechRecognitionOptions,
      requiresOnDeviceRecognition: useOnDeviceRecognition,
    });
  }, [appendDebug, sourceMode]);

  const ensureClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new RealtimeSessionClient({
        onSessionState: setSessionState,
        onPartialText: setPartialTranscript,
        onResponse: (text, meta) => {
          setLastTranscript(text);
          setPartialTranscript("");
          if (meta.capturedAt) {
            setLastFrameAgeMs(Math.round(Date.now() - meta.capturedAt * 1000));
          }
          const hazard = parseHazard(text, meta.capturedAt ?? Date.now() / 1000);
          setLastHazard(hazard);
          appendDebug("realtime_response", {
            sourceMode: meta.sourceMode,
            latencyMs: meta.latencyMs,
            text,
          });
          speakGuidance(text, Boolean(hazard?.isUrgent));
        },
        onError: (message) => {
          appendDebug("realtime_error", { message });
          setSessionState("error");
        },
        onDebug: appendDebug,
      });
    }

    return clientRef.current;
  }, [appendDebug, speakGuidance]);

  const startSession = useCallback(
    async (mode: SourceMode) => {
      if (mode !== "pi_live") {
        sendCommand({ type: "command", action: "stop_stream" });
      }
      const client = ensureClient();
      setSourceMode(mode);
      client.setSourceMode(mode);
      client.connect(mode);
      if (mode === "pi_live") {
        await startListening();
      } else {
        shouldListenRef.current = false;
        userInterruptionActiveRef.current = false;
        setMicState("idle");
      }
    },
    [ensureClient, sendCommand, startListening]
  );

  const startPiAssist = useCallback(() => {
    sendCommand({ type: "command", action: "set_stream_config", fps: DEFAULT_PI_STREAM_FPS });
    sendCommand({ type: "command", action: "start_stream" });
    void startSession("pi_live");
  }, [sendCommand, startSession]);

  const stopPiAssist = useCallback(() => {
    sendCommand({ type: "command", action: "stop_stream" });
    stopRealtime();
    setSourceMode("pi_live");
  }, [sendCommand, stopRealtime]);

  const startReplayAssist = useCallback(() => {
    void startSession("video_replay");
  }, [startSession]);

  const stopReplayAssist = useCallback(() => {
    stopRealtime();
    setSourceMode("video_replay");
  }, [stopRealtime]);

  const clearHazard = useCallback(() => setLastHazard(null), []);

  const pickVideo = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      appendDebug("video_permission_denied");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      quality: 1,
      allowsEditing: false,
    });

    if (result.canceled || !result.assets[0]) {
      return;
    }

    const asset = result.assets[0];
    setSelectedVideo({
      uri: asset.uri,
      fileName: asset.fileName ?? null,
      durationMs: asset.duration ?? null,
      width: asset.width ?? null,
      height: asset.height ?? null,
    });
    appendDebug("video_selected", {
      fileName: asset.fileName ?? asset.uri.split("/").pop() ?? "video",
      durationMs: asset.duration ?? null,
    });
  }, [appendDebug]);

  const ingestReplayFrame = useCallback(
    (frame: {
      data: string;
      capturedAt: number;
      frameId: number;
      width: number;
      height: number;
      sizeBytes: number;
    }) => {
      if (sourceMode !== "video_replay" || sessionState !== "connected") {
        return;
      }

      const ageMs = Date.now() - frame.capturedAt * 1000;
      setLastFrameAgeMs(Math.round(ageMs));
      if (ageMs > MAX_FRAME_AGE_MS) {
        appendDebug("replay_frame_dropped_stale", { frameId: frame.frameId, ageMs });
        return;
      }

      appendDebug("replay_frame_ingested", {
        frameId: frame.frameId,
        ageMs,
        width: frame.width,
        height: frame.height,
        sizeBytes: frame.sizeBytes,
      });
      ensureClient().sendVisualFrame(frame);
    },
    [appendDebug, ensureClient, sessionState, sourceMode]
  );

  useSpeechRecognitionEvent("start", () => {
    setMicState("listening");
  });

  useSpeechRecognitionEvent("soundstart", () => {
    interruptAssistantForUser();
  });

  useSpeechRecognitionEvent("volumechange", (event) => {
    if (event.value > 1 && speechState === "speaking") {
      interruptAssistantForUser();
    }
  });

  useSpeechRecognitionEvent("end", () => {
    shouldListenRef.current = false;
    if (restartRecognitionTimer.current) {
      clearTimeout(restartRecognitionTimer.current);
    }
    restartRecognitionTimer.current = setTimeout(() => {
      if (sourceMode !== "pi_live" || sessionState !== "connected" || micState === "denied") {
        setMicState((prev) => (prev === "denied" ? prev : "idle"));
        return;
      }
      void startListening();
    }, 250);
  });

  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript?.trim();
    if (!transcript) {
      return;
    }

    setPartialTranscript(transcript);
    if (event.isFinal) {
      shouldListenRef.current = false;
      userInterruptionActiveRef.current = false;
      ensureClient().sendUserText(transcript);
      appendDebug("user_utterance", { transcript });
      setPartialTranscript("");
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    appendDebug("speech_recognition_error", {
      error: event.error,
      message: event.message,
    });
    shouldListenRef.current = false;
    userInterruptionActiveRef.current = false;
    setMicState(event.error === "not-allowed" ? "denied" : "error");
  });

  useEffect(() => {
    if (sourceMode !== "pi_live" || sessionState !== "connected" || !lastFrame) {
      return;
    }

    if (lastFrame.frameId === consumedFrameId.current) {
      return;
    }

    consumedFrameId.current = lastFrame.frameId;
    const ageMs = Date.now() - lastFrame.capturedAt * 1000;
    setLastFrameAgeMs(Math.round(ageMs));
    if (ageMs > MAX_FRAME_AGE_MS) {
      appendDebug("pi_frame_dropped_stale", { frameId: lastFrame.frameId, ageMs });
      return;
    }

    ensureClient().sendVisualFrame(lastFrame);
  }, [appendDebug, ensureClient, lastFrame, sessionState, sourceMode]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state !== "active") {
        stopRealtime();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [stopRealtime]);

  useEffect(() => {
    return () => {
      stopRealtime();
    };
  }, [stopRealtime]);

  const value = useMemo<AssistContextValue>(
    () => ({
      hasApiKey: OPENAI_API_KEY.length > 0,
      sourceMode,
      sessionState,
      speechState,
      micState,
      lastFrameAgeMs,
      lastTranscript,
      partialTranscript,
      lastHazard,
      selectedVideo,
      appDebugEvents,
      startPiAssist,
      stopPiAssist,
      startReplayAssist,
      stopReplayAssist,
      clearHazard,
      pickVideo,
      ingestReplayFrame,
    }),
    [
      appDebugEvents,
      clearHazard,
      ingestReplayFrame,
      lastFrameAgeMs,
      lastHazard,
      lastTranscript,
      micState,
      partialTranscript,
      pickVideo,
      selectedVideo,
      sessionState,
      sourceMode,
      speechState,
      startPiAssist,
      startReplayAssist,
      stopPiAssist,
      stopReplayAssist,
    ]
  );

  return <AssistContext.Provider value={value}>{children}</AssistContext.Provider>;
}

export function useAssist() {
  const context = useContext(AssistContext);
  if (!context) {
    throw new Error("useAssist must be used within an AssistProvider");
  }
  return context;
}
