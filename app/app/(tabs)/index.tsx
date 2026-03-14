import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { useAssist } from "../../contexts/AssistContext";
import { usePi } from "../../contexts/PiContext";

function StatusCard({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail?: string;
}) {
  return (
    <View style={[styles.card, ok ? styles.cardOk : styles.cardOff]}>
      <View style={[styles.dot, ok ? styles.dotGreen : styles.dotRed]} />
      <View style={styles.cardContent}>
        <Text style={styles.cardLabel}>{label}</Text>
        {detail && <Text style={styles.cardDetail}>{detail}</Text>}
      </View>
      <Text style={styles.cardStatus}>{ok ? "Ready" : "Offline"}</Text>
    </View>
  );
}

export default function SetupScreen() {
  const { piAddress, setPiAddress, connected, piStatus, connect } = usePi();
  const { hasApiKey, micState, sessionState } = useAssist();

  const handleStart = () => {
    router.push("/(tabs)/assist");
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>HackberryPi</Text>
        <Text style={styles.subtitle}>Realtime Navigation</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pi Address</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={piAddress}
              onChangeText={setPiAddress}
              placeholder="192.168.1.100"
              placeholderTextColor="#555"
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable
              style={[styles.connectBtn, connected && styles.connectBtnConnected]}
              onPress={connect}
            >
              <Text style={styles.connectBtnText}>
                {connected ? "Connected" : "Connect"}
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>System Status</Text>
          <StatusCard
            label="Pi Connection"
            ok={connected}
            detail={connected ? piAddress : "Not connected"}
          />
          <StatusCard
            label="Camera"
            ok={piStatus?.camera ?? false}
            detail="USB webcam on the Pi"
          />
          <StatusCard
            label="Pi Stream"
            ok={piStatus?.streaming ?? false}
            detail={piStatus ? `${piStatus.fps.toFixed(1)} fps target` : "Waiting for status"}
          />
          <StatusCard
            label="Realtime Key"
            ok={hasApiKey}
            detail={hasApiKey ? sessionState : "Set EXPO_PUBLIC_OPENAI_API_KEY"}
          />
          <StatusCard
            label="Voice Input"
            ok={micState === "ready" || micState === "listening"}
            detail={micState}
          />
        </View>

        <Pressable
          style={[styles.startBtn, !hasApiKey && styles.startBtnDisabled]}
          onPress={handleStart}
          disabled={!hasApiKey}
        >
          <Text style={styles.startBtnText}>Start Live Assist</Text>
        </Pressable>

        <Pressable
          style={styles.secondaryBtn}
          onPress={() => router.push("/(tabs)/replay" as never)}
        >
          <Text style={styles.secondaryBtnText}>Open Replay Lab</Text>
        </Pressable>
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
    padding: 24,
    paddingTop: 60,
  },
  title: {
    fontSize: 36,
    fontWeight: "800",
    color: "#fff",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    color: "#888",
    textAlign: "center",
    marginTop: 4,
    marginBottom: 32,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
  },
  inputRow: {
    flexDirection: "row",
    gap: 10,
  },
  input: {
    flex: 1,
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 16,
    fontSize: 18,
    color: "#fff",
    borderWidth: 1,
    borderColor: "#333",
  },
  connectBtn: {
    backgroundColor: "#4FC3F7",
    borderRadius: 12,
    paddingHorizontal: 20,
    justifyContent: "center",
  },
  connectBtnConnected: {
    backgroundColor: "#2E7D32",
  },
  connectBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
  },
  cardOk: {
    borderColor: "#2E7D3240",
  },
  cardOff: {
    borderColor: "#33333380",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  dotGreen: {
    backgroundColor: "#4CAF50",
  },
  dotRed: {
    backgroundColor: "#555",
  },
  cardContent: {
    flex: 1,
  },
  cardLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  cardDetail: {
    fontSize: 12,
    color: "#888",
    marginTop: 2,
  },
  cardStatus: {
    fontSize: 12,
    color: "#888",
    fontWeight: "500",
  },
  startBtn: {
    backgroundColor: "#4FC3F7",
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    marginTop: 16,
  },
  startBtnDisabled: {
    backgroundColor: "#333",
  },
  startBtnText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "800",
  },
  secondaryBtn: {
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: "#33515d",
    backgroundColor: "#10181c",
    marginTop: 12,
  },
  secondaryBtnText: {
    color: "#9fdcf5",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
});
