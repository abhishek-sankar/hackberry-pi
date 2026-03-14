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
import { useFrameSource, CapturedFrame } from "./FrameSourceContext";

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
  walkingAssistMode: boolean;
  setWalkingAssistMode: (on: boolean) => void;
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
  continuous: false,
  addsPunctuation: true,
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
  const { sendCommand, walkingState } = usePi();
  const { lastFrame, captureFrame } = useFrameSource();
  const [sourceMode, setSourceMode] = useState<SourceMode>("pi_live");
  const sourceModeRef = useRef<SourceMode>("pi_live");
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [speechState, setSpeechState] = useState<SpeechState>("idle");
  const [micState, setMicState] = useState<MicState>("idle");
  const [lastFrameAgeMs, setLastFrameAgeMs] = useState<number | null>(null);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [lastHazard, setLastHazard] = useState<HazardState | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<PickedVideoAsset | null>(null);
  const [appDebugEvents, setAppDebugEvents] = useState<DebugEvent[]>([]);
  const [walkingAssistMode, setWalkingAssistMode] = useState(false);
  const stationaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoStoppedRef = useRef(false);
  const startPiAssistRef = useRef<() => void>(() => {});
  const captureFrameRef = useRef(captureFrame);
  useEffect(() => { captureFrameRef.current = captureFrame; }, [captureFrame]);
  const clientRef = useRef<RealtimeSessionClient | null>(null);
  const shouldListenRef = useRef(false);
  const restartRecognitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consumedFrameId = useRef<number | null>(null);

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

  const stopRealtime = useCallback(() => {
    if (sourceModeRef.current === "pi_live") {
      sendCommand({ type: "command", action: "stop_stream" });
    }
    shouldListenRef.current = false;
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
    clientRef.current = null;
    setSessionState("idle");
    setSpeechState("idle");
    setMicState((prev) => (prev === "denied" ? prev : "idle"));
  }, [sendCommand]); // sourceMode accessed via ref — stable identity

  const startListening = useCallback(async () => {
    console.log("[AssistContext] startListening: start");
    shouldListenRef.current = true;
    setMicState("requesting");
    let useOnDeviceRecognition = false;
    try {
      useOnDeviceRecognition = ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
      console.log("[AssistContext] startListening: supportsOnDevice =", useOnDeviceRecognition);
    } catch (e) {
      console.error("[AssistContext] startListening: supportsOnDeviceRecognition threw:", e);
    }

    console.log("[AssistContext] startListening: calling .start() — iOS will prompt for permissions natively");
    setMicState("ready");
    try {
      ExpoSpeechRecognitionModule.start({
        ...speechRecognitionOptions,
        requiresOnDeviceRecognition: false,
      });
      console.log("[AssistContext] startListening: .start() returned");
    } catch (e) {
      console.error("[AssistContext] startListening: .start() threw:", e);
      setMicState("error");
    }
  }, [appendDebug]);

  const ensureClient = useCallback(() => {
    console.log("[AssistContext] ensureClient called, existing:", !!clientRef.current);
    if (!clientRef.current) {
      console.log("[AssistContext] creating new RealtimeSessionClient");
      clientRef.current = new RealtimeSessionClient({
        onSessionState: (state) => {
          console.log("[AssistContext] sessionState →", state);
          setSessionState(state);
          if (state === "connected") {
            console.log("[AssistContext] connected — triggering first captureFrame");
            void captureFrameRef.current();
          }
        },
        onPartialText: setPartialTranscript,
        onResponse: (text, meta) => {
          console.log("[AssistContext] onResponse, latency:", meta.latencyMs, "text:", text.slice(0, 60));
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
          console.log("[AssistContext] triggering next captureFrame");
          void captureFrameRef.current();
        },
        onError: (message) => {
          console.error("[AssistContext] realtime error:", message);
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
      console.log("[AssistContext] startSession called, mode:", mode);
      try {
        if (mode !== "pi_live") {
          sendCommand({ type: "command", action: "stop_stream" });
        }
        const client = ensureClient();
        console.log("[AssistContext] ensureClient done:", !!client);
        sourceModeRef.current = mode;
        setSourceMode(mode);
        client.setSourceMode(mode);
        console.log("[AssistContext] calling client.connect");
        client.connect(mode);
        console.log("[AssistContext] client.connect returned");
        if (mode === "pi_live") {
          console.log("[AssistContext] skipping mic — isolating frame→OpenAI loop first");
          shouldListenRef.current = false;
          setMicState("idle");
          // TODO: re-enable once frame pipeline confirmed working
          // await startListening();
        } else {
          shouldListenRef.current = false;
          setMicState("idle");
        }
      } catch (e) {
        console.error("[AssistContext] startSession threw:", e);
        appendDebug("start_session_error", { message: String(e) });
        setSessionState("error");
      }
    },
    [appendDebug, ensureClient, sendCommand, startListening]
  );

  const startPiAssist = useCallback(() => {
    console.log("[AssistContext] startPiAssist called");
    sendCommand({ type: "command", action: "set_stream_config", fps: DEFAULT_PI_STREAM_FPS });
    sendCommand({ type: "command", action: "start_stream" });
    startSession("pi_live").catch((e) => {
      console.error("[AssistContext] startPiAssist unhandled rejection:", e);
      appendDebug("start_pi_assist_error", { message: String(e) });
      setSessionState("error");
    });
  }, [appendDebug, sendCommand, startSession]);

  const stopPiAssist = useCallback(() => {
    console.log("[AssistContext] stopPiAssist called");
    sendCommand({ type: "command", action: "stop_stream" });
    stopRealtime();
    sourceModeRef.current = "pi_live";
    setSourceMode("pi_live");
  }, [sendCommand, stopRealtime]);

  const startReplayAssist = useCallback(() => {
    void startSession("video_replay");
  }, [startSession]);

  const stopReplayAssist = useCallback(() => {
    stopRealtime();
    sourceModeRef.current = "video_replay";
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

  useSpeechRecognitionEvent("end", () => {
    if (!shouldListenRef.current) {
      setMicState("ready");
      return;
    }

    restartRecognitionTimer.current = setTimeout(() => {
      ExpoSpeechRecognitionModule.start({
        ...speechRecognitionOptions,
        requiresOnDeviceRecognition:
          ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
      });
    }, 250);
  });

  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript?.trim();
    if (!transcript) {
      return;
    }

    setPartialTranscript(transcript);
    if (event.isFinal) {
      ensureClient().sendUserText(transcript);
      appendDebug("user_utterance", { transcript });
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    appendDebug("speech_recognition_error", {
      error: event.error,
      message: event.message,
    });
    setMicState(event.error === "not-allowed" ? "denied" : "error");
  });

  useEffect(() => {
    if (sourceMode !== "pi_live" || sessionState !== "connected" || !lastFrame) {
      return;
    }

    // Walking assist gate — skip frames when not walking
    if (walkingAssistMode && walkingState !== 'walking') {
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
  }, [appendDebug, ensureClient, lastFrame, sessionState, sourceMode, walkingAssistMode, walkingState]);

  // Keep a stable ref to startPiAssist for use inside the timer callback
  useEffect(() => { startPiAssistRef.current = startPiAssist; }, [startPiAssist]);

  // Walking assist: 5-min stationary timer + auto-resume
  useEffect(() => {
    if (!walkingAssistMode) {
      if (stationaryTimerRef.current) {
        clearTimeout(stationaryTimerRef.current);
        stationaryTimerRef.current = null;
      }
      return;
    }

    if (walkingState === 'walking') {
      if (stationaryTimerRef.current) {
        clearTimeout(stationaryTimerRef.current);
        stationaryTimerRef.current = null;
      }
      // Auto-resume if session was stopped by the timer
      if (autoStoppedRef.current && sessionState === 'idle') {
        autoStoppedRef.current = false;
        startPiAssistRef.current();
      }
    } else {
      // Stationary or unknown — start timer if not already running
      if (!stationaryTimerRef.current) {
        stationaryTimerRef.current = setTimeout(() => {
          stationaryTimerRef.current = null;
          autoStoppedRef.current = true;
          stopRealtime();
        }, 5 * 60 * 1000);
      }
    }

    return () => {
      if (stationaryTimerRef.current) {
        clearTimeout(stationaryTimerRef.current);
        stationaryTimerRef.current = null;
      }
    };
  }, [walkingAssistMode, walkingState, sessionState, stopRealtime]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "background") {
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
      walkingAssistMode,
      setWalkingAssistMode,
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
      walkingAssistMode,
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