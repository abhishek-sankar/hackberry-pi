import { useEffect, useRef } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { readAsStringAsync, EncodingType } from "expo-file-system/legacy";
import { useVideoPlayer, VideoView } from "expo-video";
import { getThumbnailAsync } from "expo-video-thumbnails";
import { useAssist } from "../../contexts/AssistContext";

export default function ReplayScreen() {
  const {
    selectedVideo,
    pickVideo,
    startReplayAssist,
    stopReplayAssist,
    sessionState,
    speechState,
    micState,
    lastTranscript,
    partialTranscript,
    lastHazard,
    ingestReplayFrame,
  } = useAssist();
  const player = useVideoPlayer(selectedVideo?.uri ?? null, (instance) => {
    instance.loop = false;
    instance.timeUpdateEventInterval = 0;
  });
  const lastSampleSecond = useRef(-1);
  const sampling = useRef(false);

  useEffect(() => {
    if (!selectedVideo || sessionState !== "connected") {
      lastSampleSecond.current = -1;
      return;
    }

    const timer = setInterval(async () => {
      if (!player.playing || sampling.current) {
        return;
      }

      const timeMs = Math.max(0, Math.round(player.currentTime * 1000));
      const secondBucket = Math.floor(timeMs / 1000);
      if (secondBucket === lastSampleSecond.current) {
        return;
      }

      lastSampleSecond.current = secondBucket;
      sampling.current = true;
      try {
        const thumbnail = await getThumbnailAsync(selectedVideo.uri, {
          time: secondBucket * 1000,
          quality: 0.5,
        });
        const base64 = await readAsStringAsync(thumbnail.uri, {
          encoding: EncodingType.Base64,
        });
        ingestReplayFrame({
          data: base64,
          capturedAt: Date.now() / 1000,
          frameId: secondBucket,
          width: selectedVideo.width ?? 0,
          height: selectedVideo.height ?? 0,
          sizeBytes: Math.round(base64.length * 0.75),
        });
      } finally {
        sampling.current = false;
      }
    }, 300);

    return () => clearInterval(timer);
  }, [ingestReplayFrame, player, selectedVideo, sessionState]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Replay Lab</Text>
        <Text style={styles.subtitle}>
          Pick a saved walking clip and run it through the same app-owned
          realtime guidance pipeline.
        </Text>

        <Pressable style={styles.primaryBtn} onPress={pickVideo}>
          <Text style={styles.primaryBtnText}>
            {selectedVideo ? "Pick Another Video" : "Pick Video"}
          </Text>
        </Pressable>

        {selectedVideo ? (
          <View style={styles.videoCard}>
            <VideoView
              player={player}
              style={styles.video}
              nativeControls
              contentFit="contain"
            />
            <Text style={styles.videoMeta}>
              {selectedVideo.fileName ?? "Selected video"}
            </Text>
            <Text style={styles.videoMeta}>
              {selectedVideo.durationMs
                ? `${Math.round(selectedVideo.durationMs / 1000)}s`
                : "Unknown duration"}
            </Text>
            <View style={styles.videoControls}>
              <Pressable style={styles.secondaryBtn} onPress={() => player.play()}>
                <Text style={styles.secondaryBtnText}>Play</Text>
              </Pressable>
              <Pressable style={styles.secondaryBtn} onPress={() => player.pause()}>
                <Text style={styles.secondaryBtnText}>Pause</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.placeholderCard}>
            <Text style={styles.placeholderText}>
              Choose a video from the library to start replay testing.
            </Text>
          </View>
        )}

        <View style={styles.row}>
          <Pressable
            style={[styles.primaryBtn, !selectedVideo && styles.disabledBtn]}
            disabled={!selectedVideo}
            onPress={startReplayAssist}
          >
            <Text style={styles.primaryBtnText}>Start Replay Assist</Text>
          </Pressable>
          <Pressable style={styles.stopBtn} onPress={stopReplayAssist}>
            <Text style={styles.stopBtnText}>Stop</Text>
          </Pressable>
        </View>

        <View style={styles.statusRow}>
          <Text style={styles.badge}>Session {sessionState}</Text>
          <Text style={styles.badge}>Mic {micState}</Text>
          <Text style={styles.badge}>Speech {speechState}</Text>
        </View>

        {lastHazard && (
          <View
            style={[
              styles.hazardCard,
              !lastHazard.isUrgent && styles.crossingCard,
            ]}
          >
            <Text style={styles.hazardTitle}>
              {lastHazard.isUrgent ? "Hazard" : "Crossing"}
            </Text>
            <Text style={styles.hazardText}>{lastHazard.text}</Text>
          </View>
        )}

        {(lastTranscript || partialTranscript) && (
          <View style={styles.transcriptCard}>
            <Text style={styles.transcriptLabel}>
              {lastTranscript ? "Latest Guidance" : "Live Draft"}
            </Text>
            <Text style={styles.transcriptText}>
              {lastTranscript ?? partialTranscript}
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
  },
  scroll: {
    padding: 20,
    paddingBottom: 32,
  },
  title: {
    color: "#fff",
    fontSize: 32,
    fontWeight: "800",
  },
  subtitle: {
    color: "#8da6b3",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
    marginBottom: 20,
  },
  primaryBtn: {
    backgroundColor: "#4FC3F7",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    marginBottom: 12,
    flex: 1,
  },
  primaryBtnText: {
    color: "#07222b",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
  disabledBtn: {
    opacity: 0.5,
  },
  stopBtn: {
    backgroundColor: "#7c2020",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    flex: 1,
  },
  stopBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
  videoCard: {
    backgroundColor: "#111",
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: "#1f2b31",
    marginBottom: 16,
  },
  video: {
    width: "100%",
    height: 240,
    backgroundColor: "#000",
    borderRadius: 12,
  },
  videoMeta: {
    color: "#8da6b3",
    fontSize: 12,
    marginTop: 8,
  },
  videoControls: {
    flexDirection: "row",
    gap: 12,
    marginTop: 12,
  },
  secondaryBtn: {
    flex: 1,
    backgroundColor: "#173746",
    borderRadius: 12,
    paddingVertical: 12,
  },
  secondaryBtnText: {
    color: "#d3eef8",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  placeholderCard: {
    backgroundColor: "#111",
    borderRadius: 18,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#1f2b31",
  },
  placeholderText: {
    color: "#708590",
    fontSize: 14,
    lineHeight: 20,
  },
  row: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  badge: {
    backgroundColor: "#132229",
    color: "#93c9da",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: "700",
  },
  hazardCard: {
    backgroundColor: "#521c1c",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  crossingCard: {
    backgroundColor: "#4f3510",
  },
  hazardTitle: {
    color: "#ffd7d7",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  hazardText: {
    color: "#fff",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
  },
  transcriptCard: {
    backgroundColor: "#111",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1f2b31",
  },
  transcriptLabel: {
    color: "#93c9da",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },
  transcriptText: {
    color: "#fff",
    fontSize: 15,
    lineHeight: 22,
  },
});
