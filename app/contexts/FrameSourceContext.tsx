import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { CameraView, useCameraPermissions } from "expo-camera";
import { usePi } from "./PiContext";

/** Minimal frame shape — compatible with RealtimeSessionClient.sendVisualFrame */
export type CapturedFrame = {
  data: string;
  capturedAt: number;
  frameId: number;
  width: number;
  height: number;
  sizeBytes: number;
};

export type FrameSourceMode = "phone" | "pi";

interface FrameSourceContextValue {
  frameSourceMode: FrameSourceMode;
  setFrameSourceMode: (mode: FrameSourceMode) => void;
  lastFrame: CapturedFrame | null;
  cameraRef: React.RefObject<CameraView | null>;
  cameraPermission: boolean;
  requestCameraPermission: () => Promise<void>;
  /** Call this to trigger a single capture. AssistContext drives the cadence. */
  captureFrame: () => Promise<void>;
}

const FrameSourceContext = createContext<FrameSourceContextValue | null>(null);

const CAPTURE_INTERVAL_MS = 1000; // kept for reference, no longer used directly

export function FrameSourceProvider({ children }: { children: React.ReactNode }) {
  const { lastFrame: piLastFrame } = usePi();
  const [permission, requestPermission] = useCameraPermissions();
  const [frameSourceMode, setFrameSourceMode] = useState<FrameSourceMode>("phone");
  const [lastFrame, setLastFrame] = useState<CapturedFrame | null>(null);
  const cameraRef = useRef<CameraView | null>(null);
  const capturingRef = useRef(false);
  const frameIdRef = useRef(0);

  const captureFrame = useCallback(async () => {
    if (frameSourceMode !== "phone") {
      console.log("[FrameSource] captureFrame skipped: mode is", frameSourceMode);
      return;
    }
    if (!permission?.granted) {
      console.log("[FrameSource] captureFrame skipped: no camera permission");
      return;
    }
    if (capturingRef.current) {
      console.log("[FrameSource] captureFrame skipped: already capturing");
      return;
    }
    if (!cameraRef.current) {
      console.log("[FrameSource] captureFrame skipped: cameraRef is null");
      return;
    }
    capturingRef.current = true;
    try {
      console.log("[FrameSource] taking picture...");
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.5,
      });
      if (!photo?.base64) {
        console.warn("[FrameSource] takePictureAsync returned no base64");
        return;
      }
      console.log(`[FrameSource] captured frame #${frameIdRef.current + 1} (${photo.width}x${photo.height}, ~${Math.round(photo.base64.length * 0.75 / 1024)}KB)`);
      setLastFrame({
        data: photo.base64,
        capturedAt: Date.now() / 1000,
        frameId: ++frameIdRef.current,
        width: photo.width,
        height: photo.height,
        sizeBytes: Math.round(photo.base64.length * 0.75),
      });
    } catch (e) {
      console.error("[FrameSource] takePictureAsync error:", e);
    } finally {
      capturingRef.current = false;
    }
  }, [frameSourceMode, permission?.granted]);

  // Pi: mirror piLastFrame — currently null, populated when Pi camera is implemented
  useEffect(() => {
    if (frameSourceMode !== "pi" || !piLastFrame) return;
    // piLastFrame is PiFrame — extract the fields CapturedFrame needs
    setLastFrame({
      data: piLastFrame.data,
      capturedAt: piLastFrame.capturedAt,
      frameId: piLastFrame.frameId,
      width: piLastFrame.width,
      height: piLastFrame.height,
      sizeBytes: piLastFrame.sizeBytes,
    });
  }, [frameSourceMode, piLastFrame]);

  const requestCameraPermission = useCallback(async () => {
    await requestPermission();
  }, [requestPermission]);

  return (
    <FrameSourceContext.Provider
      value={{
        frameSourceMode,
        setFrameSourceMode,
        lastFrame,
        cameraRef,
        cameraPermission: permission?.granted ?? false,
        requestCameraPermission,
        captureFrame,
      }}
    >
      {children}
    </FrameSourceContext.Provider>
  );
}

export function useFrameSource() {
  const context = useContext(FrameSourceContext);
  if (!context) {
    throw new Error("useFrameSource must be used within a FrameSourceProvider");
  }
  return context;
}