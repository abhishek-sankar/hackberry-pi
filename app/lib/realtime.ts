import {
  buildVisualPrompt,
  OPENAI_API_KEY,
  OPENAI_REALTIME_URL,
  REALTIME_SYSTEM_PROMPT,
} from "./config";
import type { SessionState, SourceMode } from "./types";

type FrameInput = {
  data: string;
  capturedAt: number;
  frameId: number;
  width: number;
  height: number;
  sizeBytes: number;
};

type ResponseMeta = {
  sourceMode: SourceMode;
  capturedAt: number | null;
  latencyMs: number | null;
};

type RealtimeCallbacks = {
  onSessionState: (state: SessionState) => void;
  onResponse: (text: string, meta: ResponseMeta) => void;
  onPartialText: (text: string) => void;
  onError: (message: string) => void;
  onDebug: (event: string, payload?: Record<string, unknown>) => void;
};

function extractTextFromResponseDone(event: Record<string, any>): string {
  const outputItems = event.response?.output;
  if (!Array.isArray(outputItems)) {
    return "";
  }

  const parts = outputItems.flatMap((item) => item?.content ?? []);
  return parts
    .map((part) => part?.text ?? part?.transcript ?? "")
    .filter(Boolean)
    .join("");
}

export class RealtimeSessionClient {
  private ws: WebSocket | null = null;
  private readonly callbacks: RealtimeCallbacks;
  private sourceMode: SourceMode = "pi_live";
  private responseInFlight = false;
  private pendingFrame: FrameInput | null = null;
  private partialText = "";
  private intentionallyClosed = false;
  private inFlightCapturedAt: number | null = null;
  private responseStartedAt = 0;

  constructor(callbacks: RealtimeCallbacks) {
    this.callbacks = callbacks;
  }

  get hasApiKey() {
    return OPENAI_API_KEY.length > 0;
  }

  connect(sourceMode: SourceMode) {
    if (!this.hasApiKey) {
      throw new Error("Missing EXPO_PUBLIC_OPENAI_API_KEY");
    }

    this.disconnect();
    this.sourceMode = sourceMode;
    this.intentionallyClosed = false;
    this.callbacks.onSessionState("connecting");

    const WebSocketWithHeaders = WebSocket as unknown as {
      new (
        url: string,
        protocols?: string | string[],
        options?: { headers?: Record<string, string> }
      ): WebSocket;
    };
    const socket = new WebSocketWithHeaders(OPENAI_REALTIME_URL, [], {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
    });
    this.ws = socket;

    socket.onopen = () => {
      this.callbacks.onSessionState("connected");
      this.callbacks.onDebug("realtime_socket_open", {
        model: OPENAI_REALTIME_URL,
      });
      this.send({
        type: "session.update",
        session: {
          type: "realtime",
          instructions: REALTIME_SYSTEM_PROMPT,
        },
      });
      this.flushPendingFrame();
    };

    socket.onmessage = (event) => {
      this.handleMessage(String(event.data));
    };

    socket.onerror = (event) => {
      this.callbacks.onError("Realtime socket error");
      this.callbacks.onDebug("realtime_socket_error", {
        event: JSON.stringify(event),
      });
      this.callbacks.onSessionState("error");
    };

    socket.onclose = (event) => {
      this.ws = null;
      this.responseInFlight = false;
      if (!this.intentionallyClosed) {
        this.callbacks.onError(
          `Realtime socket closed (code=${event.code}, reason=${event.reason || "none"})`
        );
        this.callbacks.onSessionState("error");
      } else {
        this.callbacks.onSessionState("idle");
      }
      this.callbacks.onDebug("realtime_socket_closed", {
        code: event.code,
        reason: event.reason || "",
        wasClean: event.wasClean,
      });
    };
  }

  disconnect() {
    this.intentionallyClosed = true;
    this.pendingFrame = null;
    this.partialText = "";
    this.responseInFlight = false;
    this.inFlightCapturedAt = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  setSourceMode(sourceMode: SourceMode) {
    this.sourceMode = sourceMode;
  }

  sendVisualFrame(frame: FrameInput) {
    this.pendingFrame = frame;
    this.flushPendingFrame();
  }

  cancelResponse() {
    this.send({ type: "response.cancel" });
    this.responseInFlight = false;
    this.partialText = "";
  }

  sendUserText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    if (this.responseInFlight) {
      this.cancelResponse();
    }

    this.send({
      type: "response.create",
      response: {
        conversation: "none",
        output_modalities: ["text"],
        input: [
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: trimmed,
              },
            ],
          },
        ],
      },
    });
  }

  private flushPendingFrame() {
    if (!this.pendingFrame || !this.ws || this.ws.readyState !== WebSocket.OPEN || this.responseInFlight) {
      return;
    }

    const frame = this.pendingFrame;
    this.pendingFrame = null;
    this.partialText = "";
    this.inFlightCapturedAt = frame.capturedAt;
    this.responseStartedAt = Date.now();
    this.responseInFlight = true;

    this.send({
      type: "response.create",
      response: {
        conversation: "none",
        output_modalities: ["text"],
        input: [
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: buildVisualPrompt(this.sourceMode),
              },
              {
                type: "input_image",
                image_url: `data:image/jpeg;base64,${frame.data}`,
                detail: "low",
              },
            ],
          },
        ],
        metadata: {
          source_mode: this.sourceMode,
          frame_id: String(frame.frameId),
        },
      },
    });
  }

  private handleMessage(rawMessage: string) {
    let event: Record<string, any>;
    try {
      event = JSON.parse(rawMessage);
    } catch {
      this.callbacks.onDebug("realtime_parse_error", { rawMessage });
      return;
    }

    const eventType = String(event.type ?? "");
    switch (eventType) {
      case "session.created":
      case "session.updated":
        this.callbacks.onDebug(eventType);
        break;
      case "response.output_text.delta":
      case "response.text.delta":
        this.partialText += String(event.delta ?? "");
        this.callbacks.onPartialText(this.partialText);
        break;
      case "response.output_text.done":
      case "response.text.done": {
        const text = String(event.text ?? "");
        if (text) {
          this.partialText = text;
          this.callbacks.onPartialText(this.partialText);
        }
        this.callbacks.onDebug("realtime_text_done", {
          type: eventType,
          text,
        });
        break;
      }
      case "response.done":
      case "response.completed": {
        const completedText = (this.partialText || extractTextFromResponseDone(event)).trim();
        const latencyMs =
          this.responseStartedAt > 0 ? Date.now() - this.responseStartedAt : null;
        this.callbacks.onDebug("realtime_response_done", {
          type: eventType,
          status: event.response?.status ?? null,
          statusDetails: JSON.stringify(event.response?.status_details ?? {}),
          outputCount: Array.isArray(event.response?.output)
            ? event.response.output.length
            : 0,
          completedText,
        });
        this.responseInFlight = false;
        this.partialText = "";
        if (completedText) {
          this.callbacks.onResponse(completedText, {
            sourceMode: this.sourceMode,
            capturedAt: this.inFlightCapturedAt,
            latencyMs,
          });
        } else {
          this.callbacks.onDebug("realtime_empty_response", {
            type: eventType,
            response: JSON.stringify(event.response ?? {}),
            statusDetails: JSON.stringify(event.response?.status_details ?? {}),
          });
        }
        this.inFlightCapturedAt = null;
        this.flushPendingFrame();
        break;
      }
      case "error":
        this.responseInFlight = false;
        this.partialText = "";
        this.callbacks.onError(
          String(
            event.error?.message ??
              event.message ??
              "Unknown realtime error"
          )
        );
        this.callbacks.onDebug("realtime_server_error", {
          type: event.error?.type ?? event.type,
          code: event.error?.code ?? null,
          message: event.error?.message ?? event.message ?? "Unknown realtime error",
          fullEvent: JSON.stringify(event),
        });
        this.flushPendingFrame();
        break;
      default:
        if (eventType.startsWith("response.") || eventType.startsWith("conversation.")) {
          this.callbacks.onDebug("realtime_event", { type: eventType });
        }
        break;
    }
  }

  private send(payload: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify(payload));
  }
}
