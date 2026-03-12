import { View, Text, FlatList, StyleSheet, SafeAreaView } from "react-native";
import { usePi } from "../../contexts/PiContext";

export default function DebugScreen() {
  const { debugEvents, connected, latency, piStatus } = usePi();

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>Debug Console</Text>

      {/* Stats Row */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>
            {connected ? "Yes" : "No"}
          </Text>
          <Text style={styles.statLabel}>Connected</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>
            {latency !== null ? `${latency}ms` : "--"}
          </Text>
          <Text style={styles.statLabel}>Latency</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{debugEvents.length}</Text>
          <Text style={styles.statLabel}>Events</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>
            {piStatus?.state ?? "--"}
          </Text>
          <Text style={styles.statLabel}>State</Text>
        </View>
      </View>

      {/* Pi Subsystem Status */}
      {piStatus && (
        <View style={styles.subsystemRow}>
          <Text style={[styles.badge, piStatus.camera && styles.badgeOk]}>
            CAM {piStatus.camera ? "OK" : "OFF"}
          </Text>
          <Text style={[styles.badge, piStatus.openai && styles.badgeOk]}>
            AI {piStatus.openai ? "OK" : "OFF"}
          </Text>
          <Text style={[styles.badge, piStatus.audio && styles.badgeOk]}>
            AUD {piStatus.audio ? "OK" : "OFF"}
          </Text>
        </View>
      )}

      {/* Event Log */}
      <FlatList
        data={[...debugEvents].reverse()}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <View style={styles.eventRow}>
            <Text style={styles.eventTime}>
              {new Date(item.timestamp * 1000).toLocaleTimeString()}
            </Text>
            <Text style={styles.eventName}>{item.event}</Text>
            <Text style={styles.eventPayload} numberOfLines={1}>
              {JSON.stringify(item.payload)}
            </Text>
          </View>
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
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 12,
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
