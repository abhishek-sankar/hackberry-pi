import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppCommand, DebugEvent, PiEvent, PiFrame, PiStatus } from "../lib/types";

interface PiContextValue {
  connected: boolean;
  piAddress: string;
  setPiAddress: (addr: string) => void;
  lastFrame: PiFrame | null;
  piStatus: PiStatus | null;
  debugEvents: DebugEvent[];
  latency: number | null;
  sendCommand: (cmd: AppCommand) => void;
  connect: () => void;
  disconnect: () => void;
}

const PiContext = createContext<PiContextValue | null>(null);

let debugIdCounter = 0;
const DEFAULT_PI_STATUS: PiStatus = {
  camera: true,
  streaming: true,
  state: "ready",
  fps: 1,
};

export function PiProvider({ children }: { children: React.ReactNode }) {
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnect = useRef(false);
  const [piAddress, setPiAddress] = useState("192.168.1.100");
  const [connected, setConnected] = useState(true);
  const [lastFrame, setLastFrame] = useState<PiFrame | null>(null);
  const [piStatus, setPiStatus] = useState<PiStatus | null>(DEFAULT_PI_STATUS);
  const [debugEvents, setDebugEvents] = useState<DebugEvent[]>([]);
  const [latency, setLatency] = useState<number | null>(null);

  const disconnect = useCallback(() => {
    shouldReconnect.current = false;
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }
    setConnected(true);
    setPiStatus(DEFAULT_PI_STATUS);
  }, []);

  const connectWs = useCallback(() => {
    shouldReconnect.current = true;

    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }

    const socket = new WebSocket(`ws://${piAddress}:8765`);
    ws.current = socket;

    socket.onopen = () => {
      setConnected(true);
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
            setLastFrame(data);
            break;
          case "status":
            setPiStatus({
              camera: data.camera,
              streaming: data.streaming,
              state: data.state,
              fps: data.fps,
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
                source: "pi",
              },
            ]);
            break;
        }
      } catch (error) {
        console.warn("Failed to parse Pi message:", error);
      }
    };

    socket.onclose = () => {
      ws.current = null;
      setConnected(true);
      setPiStatus((prev) => prev ?? DEFAULT_PI_STATUS);
      if (shouldReconnect.current) {
        reconnectTimer.current = setTimeout(connectWs, 3000);
      }
    };

    socket.onerror = () => {
      setConnected(true);
      setPiStatus((prev) => prev ?? DEFAULT_PI_STATUS);
      socket.close();
    };
  }, [piAddress]);

  const sendCommand = useCallback((cmd: AppCommand) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(cmd));
    }
  }, []);

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
        piStatus,
        debugEvents,
        latency,
        sendCommand,
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
