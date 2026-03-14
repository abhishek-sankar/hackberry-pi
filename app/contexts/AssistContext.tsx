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
import { MAX_FRAME_AGE_MS, OPENAI_API_KEY } from "../lib/config";
import { RealtimeSessionClient } from "../lib/realtime";
import type {
  DebugEvent,
  HazardState,
  MicState,
  PickedVideoAsset,
  SessionState,
  SourceMode,
  SpeechState,
  VisionFrame,
} from "../lib/types";

interface AssistContextValue {
  hasApiKey: boolean;
  sourceMode: SourceMode;
  sessionState: SessionState;
  speechState: SpeechState;
  micState: MicState;
  isLiveActive: boolean;
  lastFrameAgeMs: number | null;
  lastTranscript: string | null;
  partialTranscript: string;
  lastHazard: HazardState | null;
  selectedVideo: PickedVideoAsset | null;
  appDebugEvents: DebugEvent[];
  startLiveAssist: () => void;
  stopLiveAssist: () => void;
  startReplayAssist: () => void;
  stopReplayAssist: () => void;
  clearHazard: () => void;
  pickVideo: () => Promise<void>;
  ingestLiveFrame: (frame: VisionFrame) => void;
  ingestReplayFrame: (frame: VisionFrame) => void;
}

const AssistContext = createContext<AssistContextValue | null>(null);

let appDebugIdCounter = 0;
const ENABLE_LIVE_SPEECH_RECOGNITION = false;
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

const ACTION_PATTERN = /ACTION:\s*(WALK|WAIT|PAUSE_LOOK|CROSSING_PREP)\b([\s\S]*)/i;

function sanitizeGuidanceText(text: string): string {
  return text
    .replace(/ACTION:\s*(WALK|WAIT|PAUSE_LOOK|CROSSING_PREP)\b[:\-\s]*/gi, "")
    .replace(/\b(ALERT|CROSSING):\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHazard(text: string, capturedAt: number): HazardState | null {
  const alertMatch = text.match(/ALERT:\s*([^\n]+)/i);
  if (alertMatch?.[1]) {
    return {
      category: "hazard",
      text: sanitizeGuidanceText(alertMatch[1]),
      isUrgent: true,
      capturedAt,
    };
  }

  const crossingMatch = text.match(/CROSSING:\s*([^\n]+)/i);
  if (crossingMatch?.[1]) {
    return {
      category: "crossing",
      text: sanitizeGuidanceText(crossingMatch[1]),
      isUrgent: false,
      capturedAt,
    };
  }

  const actionMatch = text.match(ACTION_PATTERN);
  if (actionMatch) {
    const action = actionMatch[1].toUpperCase();
    const guidance = sanitizeGuidanceText(actionMatch[2] ?? "") || action;
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
  const [sourceMode, setSourceMode] = useState<SourceMode>("phone_live");
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [speechState, setSpeechState] = useState<SpeechState>("idle");
  const [micState, setMicState] = useState<MicState>("idle");
  const [isLiveActive, setIsLiveActive] = useState(false);
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
    if (sourceMode !== "phone_live") {
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
    console.info("[assist-context] stop realtime");
    shouldListenRef.current = false;
    userInterruptionActiveRef.current = false;
    consumedFrameId.current = null;
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
  }, []);

  const startListening = useCallback(async () => {
    console.info("[assist-context] start listening: begin");
    shouldListenRef.current = true;
    setMicState("requesting");
    try {
      const useOnDeviceRecognition =
        ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
      console.info("[assist-context] start listening: permission request", {
        useOnDeviceRecognition,
      });
      const permission = useOnDeviceRecognition
        ? await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync()
        : await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        console.info("[assist-context] start listening: permission denied");
        setMicState("denied");
        appendDebug("mic_permission_denied");
        return;
      }

      setMicState("ready");
      console.info("[assist-context] start listening: module start");
      ExpoSpeechRecognitionModule.start({
        ...speechRecognitionOptions,
        requiresOnDeviceRecognition: useOnDeviceRecognition,
      });
      console.info("[assist-context] start listening: started");
    } catch (error) {
      console.error("[assist-context] start listening failed", error);
      appendDebug("speech_recognition_start_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      setMicState("error");
    }
  }, [appendDebug]);

  const ensureClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new RealtimeSessionClient({
        onSessionState: setSessionState,
        onPartialText: (text) => {
          setPartialTranscript(sanitizeGuidanceText(text));
        },
        onResponse: (text, meta) => {
          const spokenText = sanitizeGuidanceText(text);
          setLastTranscript(spokenText);
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
          if (spokenText) {
            speakGuidance(spokenText, Boolean(hazard?.isUrgent));
          }
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
      console.info("[assist-context] start session", { mode });
      consumedFrameId.current = null;
      const client = ensureClient();
      setSourceMode(mode);
      client.setSourceMode(mode);
      console.info("[assist-context] realtime connect: begin");
      client.connect(mode);
      console.info("[assist-context] realtime connect: initiated");
      if (mode === "phone_live") {
        if (ENABLE_LIVE_SPEECH_RECOGNITION) {
          await startListening();
        } else {
          console.info("[assist-context] live speech recognition disabled");
          shouldListenRef.current = false;
          userInterruptionActiveRef.current = false;
          setMicState("idle");
        }
      } else {
        shouldListenRef.current = false;
        userInterruptionActiveRef.current = false;
        setMicState("idle");
      }
    },
    [ensureClient, startListening]
  );

  const startLiveAssist = useCallback(() => {
    setIsLiveActive(true);
    void startSession("phone_live");
  }, [startSession]);

  const stopLiveAssist = useCallback(() => {
    setIsLiveActive(false);
    stopRealtime();
    setSourceMode("phone_live");
  }, [stopRealtime]);

  const startReplayAssist = useCallback(() => {
    setIsLiveActive(false);
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

  const ingestVisualFrame = useCallback(
    (frame: VisionFrame, expectedMode: SourceMode, staleEvent: string, ingestedEvent: string) => {
      if (sourceMode !== expectedMode || sessionState !== "connected") {
        return;
      }

      if (frame.frameId === consumedFrameId.current) {
        return;
      }

      consumedFrameId.current = frame.frameId;
      const ageMs = Date.now() - frame.capturedAt * 1000;
      setLastFrameAgeMs(Math.round(ageMs));
      if (ageMs > MAX_FRAME_AGE_MS) {
        appendDebug(staleEvent, { frameId: frame.frameId, ageMs });
        return;
      }

      appendDebug(ingestedEvent, {
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

  const ingestLiveFrame = useCallback(
    (frame: VisionFrame) => {
      ingestVisualFrame(frame, "phone_live", "live_frame_dropped_stale", "live_frame_ingested");
    },
    [ingestVisualFrame]
  );

  const ingestReplayFrame = useCallback(
    (frame: VisionFrame) => {
      ingestVisualFrame(
        frame,
        "video_replay",
        "replay_frame_dropped_stale",
        "replay_frame_ingested"
      );
    },
    [ingestVisualFrame]
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
      if (sourceMode !== "phone_live" || sessionState !== "connected" || micState === "denied") {
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
    const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state !== "active") {
        setIsLiveActive(false);
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
      isLiveActive,
      lastFrameAgeMs,
      lastTranscript,
      partialTranscript,
      lastHazard,
      selectedVideo,
      appDebugEvents,
      startLiveAssist,
      stopLiveAssist,
      startReplayAssist,
      stopReplayAssist,
      clearHazard,
      pickVideo,
      ingestLiveFrame,
      ingestReplayFrame,
    }),
    [
      appDebugEvents,
      clearHazard,
      ingestLiveFrame,
      ingestReplayFrame,
      isLiveActive,
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
      startLiveAssist,
      startReplayAssist,
      stopLiveAssist,
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
