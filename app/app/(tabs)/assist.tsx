import { View, Text, Image, Pressable, StyleSheet, SafeAreaView } from "react-native";
import { useEffect, useRef } from "react";
import * as Haptics from "expo-haptics";
import { usePi } from "../../contexts/PiContext";

export default function AssistScreen() {
  const { lastFrame, lastAlert, lastTranscript, connected, latency, clearAlert, sendCommand } =
    usePi();
  const alertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Trigger haptic on new alert
  useEffect(() => {
    if (lastAlert) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

      // Auto-clear after 5 seconds
      if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
      alertTimerRef.current = setTimeout(clearAlert, 5000);
    }
    return () => {
      if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
    };
  }, [lastAlert, clearAlert]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Alert Banner */}
      {lastAlert && (
        <Pressable style={styles.alertBanner} onPress={clearAlert}>
          <Text style={styles.alertIcon}>!</Text>
          <Text style={styles.alertText}>{lastAlert}</Text>
        </Pressable>
      )}

      {/* Camera Preview */}
      <View style={styles.cameraContainer}>
        {lastFrame ? (
          <Image
            source={{ uri: `data:image/jpeg;base64,${lastFrame}` }}
            style={styles.cameraPreview}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderIcon}>
              {connected ? "..." : "!"}
            </Text>
            <Text style={styles.placeholderText}>
              {connected ? "Waiting for camera feed..." : "Not connected to Pi"}
            </Text>
          </View>
        )}

        {/* Latency pill overlay */}
        {latency !== null && (
          <View style={styles.latencyPill}>
            <Text style={styles.latencyText}>{latency}ms</Text>
          </View>
        )}
      </View>

      {/* Transcript */}
      {lastTranscript && (
        <View style={styles.transcriptContainer}>
          <Text style={styles.transcriptText} numberOfLines={3}>
            {lastTranscript}
          </Text>
        </View>
      )}

      {/* Status Strip */}
      <View style={styles.statusStrip}>
        <View style={styles.statusItem}>
          <View
            style={[
              styles.statusDot,
              connected ? styles.dotGreen : styles.dotRed,
            ]}
          />
          <Text style={styles.statusLabel}>
            {connected ? "Connected" : "Offline"}
          </Text>
        </View>
        <View style={styles.statusItem}>
          <Text style={styles.statusLabel}>
            {lastFrame ? "Camera Active" : "No Feed"}
          </Text>
        </View>
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <Pressable
          style={styles.stopBtn}
          onPress={() => sendCommand({ type: "command", action: "stop" })}
        >
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
  alertIcon: {
    fontSize: 20,
    fontWeight: "900",
    color: "#fff",
    backgroundColor: "#B71C1C",
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
  },
  placeholderIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  placeholderText: {
    fontSize: 16,
    color: "#666",
  },
  latencyPill: {
    position: "absolute",
    top: 12,
    right: 12,
    backgroundColor: "#00000099",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  latencyText: {
    color: "#4FC3F7",
    fontSize: 12,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
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
  controls: {
    flexDirection: "row",
    justifyContent: "center",
    padding: 12,
    paddingBottom: 8,
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
});
