import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { IMUClient, IMUFrame } from "../lib/IMUClient";
import { useWalkingDetector, WalkingState } from "../lib/useWalkingDetector";
import { AppCommand, DebugEvent, PiFrame, PiStatus } from "../lib/types";

interface PiContextValue {
  connected: boolean;
  connecting: boolean;
  piAddress: string;
  setPiAddress: (addr: string) => void;
  /** Walking state derived from IMU frames */
  walkingState: WalkingState;
  /** Camera frame from Pi — always null in IMU-only mode */
  lastFrame: PiFrame | null;
  /** Latest IMU sensor frame from the Pi */
  imuFrame: IMUFrame | null;
  piStatus: PiStatus | null;
  debugEvents: DebugEvent[];
  latency: number | null;
  sendCommand: (cmd: AppCommand) => void;
  connect: () => void;
  disconnect: () => void;
}

const PiContext = createContext<PiContextValue | null>(null);

export function PiProvider({ children }: { children: React.ReactNode }) {
  const clientRef = useRef<IMUClient>(new IMUClient());
  const { detect, reset: resetWalking } = useWalkingDetector();
  const detectRef = useRef(detect);
  const resetWalkingRef = useRef(resetWalking);
  useEffect(() => { detectRef.current = detect; }, [detect]);
  useEffect(() => { resetWalkingRef.current = resetWalking; }, [resetWalking]);

  const [piAddress, setPiAddress] = useState("10.0.0.174");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [imuFrame, setImuFrame] = useState<IMUFrame | null>(null);
  const [walkingState, setWalkingState] = useState<WalkingState>('unknown');
  const [latency, setLatency] = useState<number | null>(null);

  const disconnect = useCallback(() => {
    const client = clientRef.current;
    try { client.stop(); } catch {}
    try { client.disconnect(); } catch {}
    client.clearCallbacks();
    clientRef.current = new IMUClient();
    setConnected(false);
    setConnecting(false);
    setImuFrame(null);
    setLatency(null);
    resetWalkingRef.current();
    setWalkingState('unknown');
  }, []); // no external deps — resetWalking accessed via ref

  const lastFlushRef = useRef(0);
  const FLUSH_INTERVAL_MS = 33; // ~30fps

  const connect = useCallback(async () => {
    // Tear down any existing connection first
    const old = clientRef.current;
    try { old.stop(); } catch {}
    try { old.disconnect(); } catch {}
    old.clearCallbacks();

    const client = new IMUClient();
    clientRef.current = client;

    setConnecting(true);
    setConnected(false);

    const ok = await client.connect(piAddress, 8765);

    if (!ok) {
      setConnecting(false);
      clientRef.current = new IMUClient();
      return;
    }

    // Register frame callback — throttle React state updates to ~30fps
    // to prevent "Maximum update depth exceeded" at high IMU sample rates
    client.onFrame((frame) => {
      const now = Date.now();
      if (now - lastFlushRef.current < FLUSH_INTERVAL_MS) return;
      lastFlushRef.current = now;

      setImuFrame(frame);
      if (frame.ts) {
        setLatency(Math.round(now - frame.ts));
      }
      setWalkingState(detectRef.current(frame));
    });

    setConnecting(false);
    setConnected(true);
  }, [piAddress]);

  /**
   * Maps AppCommand actions to IMUClient streaming controls so that
   * AssistContext can call sendCommand without any changes.
   * - start_stream  → client.start()
   * - stop_stream   → client.stop()
   * - everything else → no-op
   */
  const sendCommand = useCallback((cmd: AppCommand) => {
    const client = clientRef.current;
    if (!client.connected) return;
    if (cmd.action === "start_stream") {
      try { client.start(); } catch {}
    } else if (cmd.action === "stop_stream") {
      try { client.stop(); } catch {}
    }
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return (
    <PiContext.Provider
      value={{
        connected,
        connecting,
        piAddress,
        setPiAddress,
        walkingState,
        lastFrame: null,   // IMU mode — no camera frames
        imuFrame,
        piStatus: null,    // IMU mode — no separate status messages
        debugEvents: [],
        latency,
        sendCommand,
        connect,
        disconnect,
      }}
    >
      {children}
    </PiContext.Provider>
  );
}

export function usePi() {
  const context = useContext(PiContext);
  if (!context) {
    throw new Error("usePi must be used within a PiProvider");
  }
  return context;
}