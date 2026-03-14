import { useEffect, useRef } from "react";
import { Image, Pressable, SafeAreaView, StyleSheet, Switch, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useAssist } from "../../contexts/AssistContext";
import { usePi } from "../../contexts/PiContext";

export default function AssistScreen() {
  const { lastFrame, connected, latency, walkingState } = usePi();
  const {
    lastHazard,
    lastTranscript,
    partialTranscript,
    speechState,
    sessionState,
    micState,
    lastFrameAgeMs,
    startPiAssist,
    stopPiAssist,
    clearHazard,
    walkingAssistMode,
    setWalkingAssistMode,
  } = useAssist();
  const alertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (lastHazard?.isUrgent) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
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
        {lastFrame ? (
          <Image
            source={{ uri: `data:image/jpeg;base64,${lastFrame.data}` }}
            style={styles.cameraPreview}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderIcon}>{connected ? "..." : "!"}</Text>
            <Text style={styles.placeholderText}>
              {connected ? "Waiting for camera feed..." : "Not connected to Pi"}
            </Text>
          </View>
        )}

        {latency !== null && (
          <View style={styles.latencyPill}>
            <Text style={styles.latencyText}>{latency}ms</Text>
          </View>
        )}
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
          <View style={[styles.statusDot, connected ? styles.dotGreen : styles.dotRed]} />
          <Text style={styles.statusLabel}>{connected ? "Connected" : "Offline"}</Text>
        </View>
        <View style={styles.statusItem}>
          <Text style={styles.statusLabel}>
            {lastFrame ? `${lastFrame.width}x${lastFrame.height}` : "No Feed"}
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

      <View style={styles.walkingToggleRow}>
        <Text style={styles.walkingToggleLabel}>Walking Assist</Text>
        {walkingAssistMode && (
          <Text style={[
            styles.walkingStatePill,
            walkingState === 'walking' ? styles.pillWalking
            : walkingState === 'still' ? styles.pillStill
            : styles.pillUnknown,
          ]}>
            {walkingState === 'walking' ? '🚶 Walking' : walkingState === 'still' ? '🧍 Still' : '⏳ Warming up'}
          </Text>
        )}
        <Switch
          value={walkingAssistMode}
          onValueChange={setWalkingAssistMode}
          trackColor={{ false: '#333', true: '#1a4a2e' }}
          thumbColor={walkingAssistMode ? '#4CAF50' : '#888'}
        />
      </View>

      <View style={styles.controls}>
        <Pressable style={styles.secondaryBtn} onPress={startPiAssist}>
          <Text style={styles.secondaryBtnText}>Start</Text>
        </Pressable>
        <Pressable style={styles.stopBtn} onPress={stopPiAssist}>
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
  walkingToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 12,
    marginBottom: 8,
    gap: 10,
  },
  walkingToggleLabel: {
    color: "#888",
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  walkingStatePill: {
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pillWalking: {
    backgroundColor: "#1a3a1a",
    color: "#4caf50",
  },
  pillStill: {
    backgroundColor: "#1a1a3a",
    color: "#2196f3",
  },
  pillUnknown: {
    backgroundColor: "#2a2a2a",
    color: "#888",
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
});