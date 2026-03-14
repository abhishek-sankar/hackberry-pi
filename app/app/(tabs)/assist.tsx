import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { DEFAULT_LIVE_CAPTURE_INTERVAL_MS } from "../../lib/config";
import { useAssist } from "../../contexts/AssistContext";

type CameraViewRef = React.ComponentRef<typeof CameraView>;

export default function AssistScreen() {
  const isFocused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const {
    hasApiKey,
    isLiveActive,
    lastHazard,
    lastTranscript,
    partialTranscript,
    speechState,
    sessionState,
    micState,
    lastFrameAgeMs,
    startLiveAssist,
    stopLiveAssist,
    clearHazard,
    ingestLiveFrame,
  } = useAssist();
  const cameraRef = useRef<CameraViewRef | null>(null);
  const alertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHapticRef = useRef<{ key: string; at: number } | null>(null);
  const captureInFlightRef = useRef(false);
  const frameIdRef = useRef(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraMountError, setCameraMountError] = useState<string | null>(null);
  const [lastCaptureSize, setLastCaptureSize] = useState<{ width: number; height: number } | null>(
    null
  );

  useFocusEffect(
    useCallback(() => {
      setCameraReady(false);
      setCameraMountError(null);
      if (!hasApiKey) {
        stopLiveAssist();
        return undefined;
      }

      if (!permission?.granted && permission?.canAskAgain !== false) {
        void requestPermission();
      }

      return () => {
        stopLiveAssist();
      };
    }, [hasApiKey, permission?.canAskAgain, requestPermission, stopLiveAssist])
  );

  useEffect(() => {
    if (!isFocused || !hasApiKey || !permission?.granted || !cameraReady || cameraMountError) {
      if (sessionStartTimerRef.current) {
        clearTimeout(sessionStartTimerRef.current);
        sessionStartTimerRef.current = null;
      }
      return;
    }

    if (!isLiveActive) {
      console.info("[assist] camera ready, scheduling live session start");
      sessionStartTimerRef.current = setTimeout(() => {
        console.info("[assist] starting live session");
        startLiveAssist();
      }, 750);
    }

    return () => {
      if (sessionStartTimerRef.current) {
        clearTimeout(sessionStartTimerRef.current);
        sessionStartTimerRef.current = null;
      }
    };
  }, [
    cameraMountError,
    cameraReady,
    hasApiKey,
    isFocused,
    isLiveActive,
    permission?.granted,
    startLiveAssist,
  ]);

  useEffect(() => {
    if (lastHazard) {
      const hapticKey = `${lastHazard.category}:${lastHazard.text}`;
      const now = Date.now();
      const shouldNotify =
        !lastHapticRef.current ||
        lastHapticRef.current.key !== hapticKey ||
        now - lastHapticRef.current.at > 6000;

      if (shouldNotify) {
        lastHapticRef.current = { key: hapticKey, at: now };
        if (lastHazard.isUrgent) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        } else {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
      }
    }

    if (lastHazard?.isUrgent) {
      if (alertTimerRef.current) {
        clearTimeout(alertTimerRef.current);
      }
      alertTimerRef.current = setTimeout(clearHazard, 5000);
    }

    return () => {
      if (alertTimerRef.current) {
        clearTimeout(alertTimerRef.current);
      }
    };
  }, [clearHazard, lastHazard]);

  useEffect(() => {
    if (
      !isFocused ||
      !permission?.granted ||
      !cameraReady ||
      cameraMountError !== null ||
      !isLiveActive ||
      sessionState !== "connected" ||
      !cameraRef.current
    ) {
      if (captureTimerRef.current) {
        clearTimeout(captureTimerRef.current);
        captureTimerRef.current = null;
      }
      captureInFlightRef.current = false;
      return;
    }

    const captureNextFrame = () => {
      if (!cameraRef.current || captureInFlightRef.current) {
        captureTimerRef.current = setTimeout(captureNextFrame, DEFAULT_LIVE_CAPTURE_INTERVAL_MS);
        return;
      }

      console.info("[assist] capturing live frame");
      captureInFlightRef.current = true;
      void cameraRef.current
        .takePictureAsync({
          base64: true,
          quality: 0.35,
          shutterSound: false,
        })
        .then((picture) => {
          if (!picture?.base64) {
            console.info("[assist] capture returned without base64");
            return;
          }

          const width = picture.width ?? 0;
          const height = picture.height ?? 0;
          setLastCaptureSize({ width, height });
          frameIdRef.current += 1;
          console.info("[assist] live frame ready", {
            frameId: frameIdRef.current,
            width,
            height,
          });
          ingestLiveFrame({
            data: picture.base64,
            capturedAt: Date.now() / 1000,
            frameId: frameIdRef.current,
            width,
            height,
            sizeBytes: Math.round(picture.base64.length * 0.75),
          });
        })
        .catch((error: unknown) => {
          console.warn("[assist] camera capture failed", error);
        })
        .finally(() => {
          captureInFlightRef.current = false;
          captureTimerRef.current = setTimeout(captureNextFrame, DEFAULT_LIVE_CAPTURE_INTERVAL_MS);
        });
    };

    console.info("[assist] session connected, scheduling first frame");
    captureTimerRef.current = setTimeout(captureNextFrame, 1500);

    return () => {
      if (captureTimerRef.current) {
        clearTimeout(captureTimerRef.current);
        captureTimerRef.current = null;
      }
      captureInFlightRef.current = false;
    };
  }, [
    cameraMountError,
    cameraReady,
    ingestLiveFrame,
    isFocused,
    isLiveActive,
    permission?.granted,
    sessionState,
  ]);

  const previewBlocked =
    cameraMountError !== null || (permission?.granted === false && permission.canAskAgain === false);
  const showCamera = permission?.granted === true;
  const statusText = !hasApiKey
    ? "Missing OpenAI API key"
    : !permission
      ? "Checking camera access..."
      : cameraMountError
        ? "Camera failed to start"
      : previewBlocked
        ? "Camera access blocked"
        : !showCamera
          ? "Waiting for camera permission..."
          : !cameraReady
            ? "Starting rear camera..."
            : isLiveActive
              ? sessionState === "connected"
                ? "Live guidance active"
                : "Connecting live guidance..."
              : "Preview ready";

  return (
    <SafeAreaView style={styles.container}>
      {lastHazard && (
        <Pressable
          style={[
            styles.alertBanner,
            !lastHazard.isUrgent && styles.crossingBanner,
          ]}
          onPress={clearHazard}
        >
          <Text style={styles.alertIcon}>
            {lastHazard.category === "crossing" ? ">" : "!"}
          </Text>
          <Text style={styles.alertText}>{lastHazard.text}</Text>
        </Pressable>
      )}

      <View style={styles.cameraContainer}>
        {showCamera ? (
          <CameraView
            ref={cameraRef}
            style={styles.cameraPreview}
            active={isFocused}
            facing="back"
            animateShutter={false}
            onCameraReady={() => {
              console.info("[assist] camera preview ready");
              setCameraReady(true);
            }}
            onMountError={(event) => {
              const message = event.message || "unknown_camera_error";
              console.error("[assist] camera mount error", message);
              setCameraMountError(message);
              setCameraReady(false);
              stopLiveAssist();
            }}
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderIcon}>
              {previewBlocked || !hasApiKey ? "!" : "..."}
            </Text>
            <Text style={styles.placeholderText}>{statusText}</Text>
            {cameraMountError ? (
              <Text style={styles.placeholderSubtext}>{cameraMountError}</Text>
            ) : previewBlocked && (
              <Text style={styles.placeholderSubtext}>
                Enable camera access in system settings to use live assist.
              </Text>
            )}
          </View>
        )}

        <View style={styles.overlayTop}>
          <View style={styles.statusPill}>
            <Text style={styles.statusPillText}>{statusText}</Text>
          </View>
        </View>
      </View>

      {(lastTranscript || partialTranscript) && (
        <View style={styles.transcriptContainer}>
          <Text style={styles.transcriptText} numberOfLines={4}>
            {lastTranscript ?? partialTranscript}
          </Text>
        </View>
      )}

      <View style={styles.statusStrip}>
        <View style={styles.statusItem}>
          <View
            style={[
              styles.statusDot,
              showCamera && cameraReady ? styles.dotGreen : styles.dotRed,
            ]}
          />
          <Text style={styles.statusLabel}>
            {showCamera && cameraReady ? "Camera Ready" : "Camera Blocked"}
          </Text>
        </View>
        <View style={styles.statusItem}>
          <Text style={styles.statusLabel}>
            {lastCaptureSize ? `${lastCaptureSize.width}x${lastCaptureSize.height}` : "No Frames"}
          </Text>
        </View>
        <View style={styles.statusItem}>
          <Text style={styles.statusLabel}>{sessionState}</Text>
        </View>
      </View>

      <View style={styles.metaStrip}>
        <Text style={styles.metaLabel}>Mic: {micState}</Text>
        <Text style={styles.metaLabel}>Speech: {speechState}</Text>
        <Text style={styles.metaLabel}>
          Frame age: {lastFrameAgeMs !== null ? `${lastFrameAgeMs}ms` : "--"}
        </Text>
      </View>

      <View style={styles.controls}>
        <Pressable
          style={[
            styles.secondaryBtn,
            (!showCamera || !cameraReady || !hasApiKey) && styles.disabledBtn,
          ]}
          disabled={!showCamera || !cameraReady || !hasApiKey}
          onPress={startLiveAssist}
        >
          <Text style={styles.secondaryBtnText}>Start</Text>
        </Pressable>
        <Pressable style={styles.stopBtn} onPress={stopLiveAssist}>
          <Text style={styles.stopBtnText}>Stop</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
  },
  alertBanner: {
    backgroundColor: "#D32F2F",
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 20,
    gap: 12,
  },
  crossingBanner: {
    backgroundColor: "#C67A1E",
  },
  alertIcon: {
    fontSize: 20,
    fontWeight: "900",
    color: "#fff",
    backgroundColor: "#00000033",
    width: 32,
    height: 32,
    borderRadius: 16,
    textAlign: "center",
    lineHeight: 32,
    overflow: "hidden",
  },
  alertText: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
  },
  cameraContainer: {
    flex: 1,
    margin: 12,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#111",
  },
  cameraPreview: {
    width: "100%",
    height: "100%",
  },
  placeholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 28,
  },
  placeholderIcon: {
    fontSize: 48,
    marginBottom: 12,
    color: "#d4dee2",
  },
  placeholderText: {
    fontSize: 16,
    color: "#c9d7de",
    textAlign: "center",
  },
  placeholderSubtext: {
    fontSize: 13,
    color: "#7f97a3",
    textAlign: "center",
    marginTop: 10,
    lineHeight: 18,
  },
  overlayTop: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
    flexDirection: "row",
    justifyContent: "flex-start",
  },
  statusPill: {
    backgroundColor: "#000000aa",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: "100%",
  },
  statusPillText: {
    color: "#d9f3ff",
    fontSize: 12,
    fontWeight: "700",
  },
  transcriptContainer: {
    marginHorizontal: 12,
    marginBottom: 8,
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#333",
  },
  transcriptText: {
    color: "#ccc",
    fontSize: 14,
    lineHeight: 20,
  },
  statusStrip: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: "#111",
    marginHorizontal: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  statusItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotGreen: {
    backgroundColor: "#4CAF50",
  },
  dotRed: {
    backgroundColor: "#F44336",
  },
  statusLabel: {
    color: "#888",
    fontSize: 13,
    fontWeight: "500",
  },
  metaStrip: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginHorizontal: 12,
    marginBottom: 8,
  },
  metaLabel: {
    color: "#6d8d98",
    fontSize: 12,
    fontWeight: "600",
  },
  controls: {
    flexDirection: "row",
    justifyContent: "center",
    padding: 12,
    paddingBottom: 8,
    gap: 12,
  },
  secondaryBtn: {
    backgroundColor: "#14404d",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  secondaryBtnText: {
    color: "#c9eef9",
    fontSize: 16,
    fontWeight: "700",
  },
  stopBtn: {
    backgroundColor: "#D32F2F",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 48,
  },
  stopBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  disabledBtn: {
    opacity: 0.5,
  },
});
