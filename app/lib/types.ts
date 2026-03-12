// Messages FROM Pi to App
export type PiEvent =
  | { type: "frame"; data: string; timestamp: number }
  | { type: "alert"; text: string; timestamp: number }
  | { type: "transcript"; text: string; timestamp: number }
  | {
      type: "status";
      camera: boolean;
      openai: boolean;
      audio: boolean;
      state: string;
    }
  | { type: "debug"; event: string; payload: Record<string, unknown>; timestamp: number };

// Messages FROM App to Pi
export type AppCommand = { type: "command"; action: "start" | "stop" };

export interface PiStatus {
  camera: boolean;
  openai: boolean;
  audio: boolean;
  state: string;
}
