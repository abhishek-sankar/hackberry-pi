import React, { useRef, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { IMUClient, IMUFrame } from '../../lib/IMUClient';
import { useWalkingDetector, WalkingState } from '../../lib/useWalkingDetector';

type Status = 'disconnected' | 'connecting' | 'connected' | 'streaming' | 'error';

const STATUS_COLOR: Record<Status, string> = {
  disconnected: '#888',
  connecting:   '#f0a500',
  connected:    '#4caf50',
  streaming:    '#2196f3',
  error:        '#f44336',
};

export default function IMUScreen() {
  const client = useRef(new IMUClient());
  const { detect, reset } = useWalkingDetector();
  const [ip, setIp] = useState('10.0.0.174');
  const [status, setStatus] = useState<Status>('disconnected');
  const [frame, setFrame] = useState<IMUFrame | null>(null);
  const [sampleCount, setSampleCount] = useState(0);
  const [walkingState, setWalkingState] = useState<WalkingState>('unknown');

  async function handleConnect() {
    setStatus('connecting');
    const ok = await client.current.connect(ip, 8765);
    setStatus(ok ? 'connected' : 'error');
    if (!ok) client.current = new IMUClient();
  }

  function handleStart() {
    client.current.onFrame((f) => {
      setFrame(f);
      setSampleCount(n => n + 1);
      setWalkingState(detect(f));
    });
    client.current.start();
    setStatus('streaming');
  }

  function handleStop() {
    client.current.stop();
    client.current.clearCallbacks();
    reset();
    setWalkingState('unknown');
    setStatus('connected');
  }

  function handleDisconnect() {
    client.current.disconnect();
    client.current.clearCallbacks();
    client.current = new IMUClient();
    reset();
    setFrame(null);
    setSampleCount(0);
    setWalkingState('unknown');
    setStatus('disconnected');
  }

  const isDisconnected = status === 'disconnected' || status === 'error';
  const isConnected    = status === 'connected';
  const isStreaming    = status === 'streaming';

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <Text style={s.title}>IMU Client</Text>
        <View style={[s.dot, { backgroundColor: STATUS_COLOR[status] }]} />
        <Text style={[s.statusText, { color: STATUS_COLOR[status] }]}>{status}</Text>
      </View>

      <View style={s.row}>
        <TextInput
          style={s.input}
          value={ip}
          onChangeText={setIp}
          placeholder="IP address"
          placeholderTextColor="#555"
          autoCapitalize="none"
          keyboardType="decimal-pad"
          editable={isDisconnected}
        />
        <Text style={s.portLabel}>:8765</Text>
      </View>

      <View style={s.controls}>
        <Btn label="Connect"    onPress={handleConnect}    disabled={!isDisconnected} />
        <Btn label="Start"      onPress={handleStart}      disabled={!isConnected}    />
        <Btn label="Stop"       onPress={handleStop}       disabled={!isStreaming}     />
        <Btn label="Disconnect" onPress={handleDisconnect} disabled={isDisconnected}   />
      </View>

      {isStreaming && (
        <Text style={s.counter}>Samples: {sampleCount}</Text>
      )}

      {isStreaming && (
        <WalkingBanner state={walkingState} />
      )}

      <ScrollView style={s.frameBox} contentContainerStyle={s.frameContent}>
        {frame ? (
          <>
            <Section title="Accelerometer (m/s²)" rows={[
              ['X', (frame.ax * 9.81 / 16384).toFixed(4)],
              ['Y', (frame.ay * 9.81 / 16384).toFixed(4)],
              ['Z', (frame.az * 9.81 / 16384).toFixed(4)],
            ]} />
            <Section title="Gyroscope (rad/s)" rows={[
              ['X', (frame.gx / 16.0 * Math.PI / 180).toFixed(4)],
              ['Y', (frame.gy / 16.0 * Math.PI / 180).toFixed(4)],
              ['Z', (frame.gz / 16.0 * Math.PI / 180).toFixed(4)],
            ]} />
            <Section title="Rotation (°)" rows={[
              ['Roll',  frame.r.toFixed(2)],
              ['Pitch', frame.p.toFixed(2)],
              ['Yaw',   frame.y.toFixed(2)],
            ]} />
            <Section title="Magnetometer (raw)" rows={[
              ['X', frame.mx.toFixed(0)],
              ['Y', frame.my.toFixed(0)],
              ['Z', frame.mz.toFixed(0)],
            ]} />
          </>
        ) : (
          <Text style={s.empty}>
            {isConnected ? 'Press Start to stream data.' : 'No data yet.'}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function WalkingBanner({ state }: { state: WalkingState }) {
  const config = {
    walking: { emoji: '🚶', label: 'Walking',  bg: '#1a3a1a', border: '#4caf50', text: '#4caf50' },
    still:   { emoji: '🧍', label: 'Still',    bg: '#1a1a3a', border: '#2196f3', text: '#2196f3' },
    unknown: { emoji: '⏳', label: 'Warming up…', bg: '#2a2a2a', border: '#888', text: '#888' },
  }[state];

  return (
    <View style={[s.banner, { backgroundColor: config.bg, borderColor: config.border }]}>
      <Text style={s.bannerEmoji}>{config.emoji}</Text>
      <Text style={[s.bannerLabel, { color: config.text }]}>{config.label}</Text>
    </View>
  );
}

function Btn({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  return (
    <TouchableOpacity style={[s.btn, disabled && s.btnDisabled]} onPress={onPress} disabled={disabled}>
      <Text style={[s.btnText, disabled && s.btnTextDisabled]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Section({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {rows.map(([label, value]) => (
        <View key={label} style={s.dataRow}>
          <Text style={s.dataLabel}>{label}</Text>
          <Text style={s.dataValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  root:            { flex: 1, backgroundColor: '#111', padding: 16 },
  header:          { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 8 },
  title:           { fontSize: 20, fontWeight: '700', color: '#fff', flex: 1 },
  dot:             { width: 10, height: 10, borderRadius: 5 },
  statusText:      { fontSize: 13, fontWeight: '600' },
  row:             { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 6 },
  input:           { flex: 1, backgroundColor: '#222', color: '#fff', borderRadius: 8,
                     paddingHorizontal: 12, paddingVertical: 8, fontSize: 15 },
  portLabel:       { color: '#888', fontSize: 14 },
  controls:        { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  btn:             { backgroundColor: '#2196f3', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  btnDisabled:     { backgroundColor: '#333' },
  btnText:         { color: '#fff', fontWeight: '600', fontSize: 13 },
  btnTextDisabled: { color: '#555' },
  banner:          { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12,
                     borderRadius: 10, borderWidth: 1, marginBottom: 10 },
  bannerEmoji:     { fontSize: 24 },
  bannerLabel:     { fontSize: 18, fontWeight: '700' },
  counter:         { color: '#2196f3', fontSize: 13, marginBottom: 8 },
  frameBox:        { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 10 },
  frameContent:    { padding: 12, gap: 12 },
  empty:           { color: '#555', textAlign: 'center', marginTop: 40 },
  section:         { gap: 4 },
  sectionTitle:    { color: '#888', fontSize: 11, fontWeight: '600',
                     textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  dataRow:         { flexDirection: 'row', justifyContent: 'space-between' },
  dataLabel:       { color: '#aaa', fontSize: 14 },
  dataValue:       { color: '#fff', fontSize: 14, fontFamily: 'monospace' },
});