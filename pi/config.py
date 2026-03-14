import os
from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL = "gpt-4o-realtime-preview"
OPENAI_WS_URL = f"wss://api.openai.com/v1/realtime?model={OPENAI_MODEL}"

# Camera
CAMERA_INDEX = 0
CAPTURE_WIDTH = 640
CAPTURE_HEIGHT = 480
JPEG_QUALITY = 50
FRAME_INTERVAL_SEC = 1.0

# Audio
AUDIO_RATE_INPUT = 16000
AUDIO_RATE_OUTPUT = 24000
AUDIO_CHANNELS = 1
AUDIO_CHUNK = 1024

# Phone WebSocket server
PHONE_WS_HOST = "0.0.0.0"
PHONE_WS_PORT = 8765

# System prompt
SYSTEM_PROMPT = """You are a real-time navigation and scene assistant for a visually impaired person. You receive camera images from a wearable device.

Your job:
1. Describe the scene briefly and naturally (1-2 sentences max).
2. Call out hazards immediately: stairs, curbs, obstacles, vehicles, people approaching.
3. Read any text you see: signs, labels, menus, prices.
4. Give directional guidance: "clear path ahead", "obstacle on your left".
5. Be concise. Speak like a helpful companion, not a robot.
6. If nothing has changed since the last frame, say only "No changes."

Priority order: SAFETY HAZARDS > navigation guidance > text reading > scene description.
Start every hazard alert with the word "ALERT:" so the system can trigger haptic feedback on the user's phone."""
