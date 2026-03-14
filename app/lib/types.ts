export interface VisionFrame {
  data: string;
  frameId: number;
  capturedAt: number;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface PiFrame extends VisionFrame {
  type: "frame";
  timestamp: number;
}

export interface PiStatus {
  camera: boolean;
  streaming: boolean;
  state: string;
  fps: number;
}

export type PiEvent =
  | PiFrame
  | {
      type: "status";
      camera: boolean;
      streaming: boolean;
      state: string;
      fps: number;
    }
  | {
      type: "debug";
      event: string;
      payload: Record<string, unknown>;
      timestamp: number;
    };

export type AppCommand =
  | { type: "command"; action: "start_stream" }
  | { type: "command"; action: "stop_stream" }
  | { type: "command"; action: "set_stream_config"; fps: number };

export type SourceMode = "phone_live" | "video_replay";
export type SessionState = "idle" | "connecting" | "connected" | "error";
export type SpeechState = "idle" | "speaking" | "error";
export type MicState = "idle" | "requesting" | "ready" | "listening" | "denied" | "error";

export interface HazardState {
  category: "hazard" | "crossing";
  text: string;
  isUrgent: boolean;
  capturedAt: number;
}

export interface DebugEvent {
  id: number;
  event: string;
  payload: Record<string, unknown>;
  timestamp: number;
  source: "pi" | "app";
}

export interface PickedVideoAsset {
  uri: string;
  fileName: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
}
