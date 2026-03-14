import { useMemo, useState } from "react";
import { FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { useAssist } from "../../contexts/AssistContext";
import { usePi } from "../../contexts/PiContext";

export default function DebugScreen() {
  const { debugEvents, connected, latency, piStatus } = usePi();
  const { appDebugEvents, micState, sessionState, speechState } = useAssist();
  const mergedEvents = useMemo(
    () => [...debugEvents, ...appDebugEvents].sort((a, b) => b.timestamp - a.timestamp),
    [appDebugEvents, debugEvents]
  );
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const selectedEvent =
    mergedEvents.find((item) => `${item.source}-${item.id}` === selectedEventId) ?? mergedEvents[0] ?? null;

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>Debug Console</Text>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{connected ? "Yes" : "No"}</Text>
          <Text style={styles.statLabel}>Connected</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{latency !== null ? `${latency}ms` : "--"}</Text>
          <Text style={styles.statLabel}>Latency</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{mergedEvents.length}</Text>
          <Text style={styles.statLabel}>Events</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{piStatus?.state ?? "--"}</Text>
          <Text style={styles.statLabel}>State</Text>
        </View>
      </View>

      <View style={styles.subsystemRow}>
        <Text style={[styles.badge, piStatus?.camera && styles.badgeOk]}>
          CAM {piStatus?.camera ? "OK" : "OFF"}
        </Text>
        <Text style={[styles.badge, piStatus?.streaming && styles.badgeOk]}>
          PI {piStatus?.streaming ? "LIVE" : "IDLE"}
        </Text>
        <Text style={[styles.badge, sessionState === "connected" && styles.badgeOk]}>
          AI {sessionState.toUpperCase()}
        </Text>
        <Text style={[styles.badge, micState === "listening" && styles.badgeOk]}>
          MIC {micState.toUpperCase()}
        </Text>
        <Text style={[styles.badge, speechState === "speaking" && styles.badgeOk]}>
          VOX {speechState.toUpperCase()}
        </Text>
      </View>

      <View style={styles.modeRow}>
        <Text style={styles.modeLabel}>Mode: live</Text>
      </View>

      {selectedEvent && (
        <View style={styles.detailCard}>
          <Text style={styles.detailTitle}>
            {selectedEvent.event} [{selectedEvent.source}]
          </Text>
          <Text style={styles.detailTime}>
            {new Date(selectedEvent.timestamp * 1000).toLocaleString()}
          </Text>
          <Text style={styles.detailPayload}>
            {JSON.stringify(selectedEvent.payload, null, 2)}
          </Text>
        </View>
      )}

      <FlatList
        data={mergedEvents}
        keyExtractor={(item) => `${item.source}-${item.id}`}
        renderItem={({ item }) => (
          <Pressable
            style={[
              styles.eventRow,
              `${item.source}-${item.id}` === selectedEventId && styles.eventRowSelected,
            ]}
            onPress={() => setSelectedEventId(`${item.source}-${item.id}`)}
          >
            <Text style={styles.eventTime}>
              {new Date(item.timestamp * 1000).toLocaleTimeString()}
            </Text>
            <Text style={styles.eventName}>{item.event}</Text>
            <Text style={styles.eventPayload} numberOfLines={2}>
              [{item.source}] {JSON.stringify(item.payload)}
            </Text>
          </Pressable>
        )}
        style={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              No events yet. Start a session to see debug output.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    paddingTop: 50,
  },
  header: {
    fontSize: 20,
    fontWeight: "800",
    color: "#fff",
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#1a1a1a",
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#222",
  },
  statValue: {
    fontSize: 16,
    fontWeight: "700",
    color: "#4FC3F7",
    fontVariant: ["tabular-nums"],
  },
  statLabel: {
    fontSize: 10,
    color: "#666",
    marginTop: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  subsystemRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 12,
  },
  modeRow: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  modeLabel: {
    color: "#84b2c2",
    fontSize: 12,
    fontWeight: "600",
  },
  detailCard: {
    backgroundColor: "#10161a",
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#21343e",
  },
  detailTitle: {
    color: "#d5f3ff",
    fontSize: 14,
    fontWeight: "700",
  },
  detailTime: {
    color: "#6d8d98",
    fontSize: 11,
    marginTop: 4,
    marginBottom: 8,
  },
  detailPayload: {
    color: "#d4dee2",
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "monospace",
  },
  badge: {
    backgroundColor: "#2a1a1a",
    color: "#F44336",
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: "hidden",
  },
  badgeOk: {
    backgroundColor: "#1a2a1a",
    color: "#4CAF50",
  },
  list: {
    flex: 1,
    paddingHorizontal: 12,
  },
  eventRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#111",
    borderRadius: 8,
    padding: 10,
    marginBottom: 4,
    gap: 8,
  },
  eventRowSelected: {
    borderWidth: 1,
    borderColor: "#4FC3F7",
  },
  eventTime: {
    fontSize: 10,
    color: "#555",
    fontVariant: ["tabular-nums"],
    width: 70,
  },
  eventName: {
    fontSize: 12,
    color: "#4FC3F7",
    fontWeight: "600",
    width: 90,
  },
  eventPayload: {
    flex: 1,
    fontSize: 11,
    color: "#666",
    fontFamily: "monospace",
  },
  emptyContainer: {
    padding: 40,
    alignItems: "center",
  },
  emptyText: {
    color: "#555",
    fontSize: 14,
    textAlign: "center",
  },
});
