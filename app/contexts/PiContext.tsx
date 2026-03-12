import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { AppCommand, PiEvent, PiStatus } from "../lib/types";

interface DebugEvent {
  id: number;
  event: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

interface PiContextValue {
  connected: boolean;
  piAddress: string;
  setPiAddress: (addr: string) => void;
  lastFrame: string | null;
  lastAlert: string | null;
  lastTranscript: string | null;
  piStatus: PiStatus | null;
  debugEvents: DebugEvent[];
  latency: number | null;
  sendCommand: (cmd: AppCommand) => void;
  clearAlert: () => void;
  connect: () => void;
  disconnect: () => void;
}

const PiContext = createContext<PiContextValue | null>(null);

let debugIdCounter = 0;

export function PiProvider({ children }: { children: React.ReactNode }) {
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [piAddress, setPiAddress] = useState("192.168.1.100");
  const [connected, setConnected] = useState(false);
  const [lastFrame, setLastFrame] = useState<string | null>(null);
  const [lastAlert, setLastAlert] = useState<string | null>(null);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [piStatus, setPiStatus] = useState<PiStatus | null>(null);
  const [debugEvents, setDebugEvents] = useState<DebugEvent[]>([]);
  const [latency, setLatency] = useState<number | null>(null);

  const clearAlert = useCallback(() => setLastAlert(null), []);

  const disconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }
    setConnected(false);
  }, []);

  const connectWs = useCallback(() => {
    disconnect();

    const socket = new WebSocket(`ws://${piAddress}:8765`);
    ws.current = socket;

    socket.onopen = () => {
      setConnected(true);
      console.log("Connected to Pi");
    };

    socket.onmessage = (event) => {
      const now = Date.now();
      try {
        const data: PiEvent = JSON.parse(event.data);

        if ("timestamp" in data && data.timestamp) {
          setLatency(Math.round(now - data.timestamp * 1000));
        }

        switch (data.type) {
          case "frame":
            setLastFrame(data.data);
            break;
          case "alert":
            setLastAlert(data.text);
            break;
          case "transcript":
            setLastTranscript(data.text);
            break;
          case "status":
            setPiStatus({
              camera: data.camera,
              openai: data.openai,
              audio: data.audio,
              state: data.state,
            });
            break;
          case "debug":
            setDebugEvents((prev) => [
              ...prev.slice(-199),
              {
                id: ++debugIdCounter,
                event: data.event,
                payload: data.payload,
                timestamp: data.timestamp,
              },
            ]);
            break;
        }
      } catch (e) {
        console.warn("Failed to parse Pi message:", e);
      }
    };

    socket.onclose = () => {
      setConnected(false);
      // Auto-reconnect after 3 seconds
      reconnectTimer.current = setTimeout(connectWs, 3000);
    };

    socket.onerror = () => {
      socket.close();
    };
  }, [piAddress, disconnect]);

  const sendCommand = useCallback(
    (cmd: AppCommand) => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify(cmd));
      }
    },
    []
  );

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
        piAddress,
        setPiAddress,
        lastFrame,
        lastAlert,
        lastTranscript,
        piStatus,
        debugEvents,
        latency,
        sendCommand,
        clearAlert,
        connect: connectWs,
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
