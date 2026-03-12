# HackberryPi

A wearable navigation assistant for visually impaired users. A Raspberry Pi with a camera sees the world, OpenAI understands it, and the user hears spoken guidance through Bluetooth earbuds. A companion phone app shows what the camera sees and vibrates on hazard alerts.

Built for a hackathon. Runs on a Pi 4 with 1GB RAM.

---

## How it works

```
USB Webcam → Pi 4 → OpenAI Realtime API → Spoken audio → BT Earbuds
                ↓
          Phone App (WiFi)
          - Live camera feed
          - Alert banner
          - Haptic feedback
```

Every 2 seconds, the Pi captures a frame, sends it to OpenAI's Realtime API, and plays the audio response through connected earbuds. The phone app receives the same frames and alerts over a local WebSocket connection.

Hazards are announced immediately: *"ALERT: obstacle on the ground ahead."* The phone vibrates on any alert.

---

## Hardware

- Raspberry Pi 4 B (1GB RAM or more)
- USB webcam
- Bluetooth earbuds (paired to the Pi)
- A phone to run the companion app

---

## Setup

### Pi

**1. Clone and install dependencies**
```bash
cd pi
pip install -r requirements.txt
```

**2. Configure your OpenAI key**
```bash
cp .env.example .env
# Edit .env and set OPENAI_API_KEY=sk-...
```

**3. Pair Bluetooth earbuds**
```bash
bluetoothctl
> power on
> scan on
# Wait for your earbuds to appear, then:
> pair <MAC>
> connect <MAC>
> trust <MAC>
> exit
```

**4. Run**
```bash
python main.py
```

The Pi will connect to OpenAI and start the phone WebSocket server on port 8765. Once running, it auto-starts streaming — you'll see `Assist mode ACTIVE` in the console.

**Note your Pi's IP address** — you'll need it for the phone app:
```bash
hostname -I
```

---

### Phone App

**1. Install dependencies**
```bash
cd app
npm install
```

**2. Start**
```bash
npm start
```

Scan the QR code with [Expo Go](https://expo.dev/go) on your phone.

**3. Connect to Pi**

On the Setup screen, enter the Pi's IP address and tap **Connect**, then tap **Start Live Assist**.

---

## Screens

| Screen | What it shows |
|--------|--------------|
| **Setup** | Pi connection status, camera/OpenAI/audio health, start button |
| **Assist** | Live camera feed, alert banner (red), AI transcript, latency, stop button |
| **Debug** | Raw event log, per-subsystem status, latency stats |

---

## Fallback mode

If the Realtime API WebSocket is unreliable, there's a fallback using GPT-4o Vision + OpenAI TTS (two REST calls instead of a WebSocket).

In `pi/main.py`, swap the import:

```python
# Replace this:
from openai_realtime import OpenAIRealtimeClient

# With this:
from openai_fallback import OpenAIFallbackClient as OpenAIRealtimeClient
```

The fallback has the same interface. Latency will be higher (2–4s vs sub-second) but it's more reliable.

---

## Configuration

All settings are in `pi/config.py`:

| Setting | Default | Description |
|---------|---------|-------------|
| `FRAME_INTERVAL_SEC` | `2.0` | How often to capture + send a frame |
| `JPEG_QUALITY` | `50` | JPEG compression (lower = faster, smaller) |
| `CAPTURE_WIDTH/HEIGHT` | `640x480` | Camera resolution |
| `PHONE_WS_PORT` | `8765` | Port the phone app connects to |
| `SYSTEM_PROMPT` | see file | Instructions for the AI assistant |

---

## Architecture

```
pi/
  main.py              # Orchestrator — runs the capture loop, wires everything together
  config.py            # Settings and system prompt
  camera.py            # USB webcam → base64 JPEG
  openai_realtime.py   # OpenAI Realtime API WebSocket client
  audio_io.py          # PyAudio playback to Bluetooth earbuds
  phone_server.py      # WebSocket server for the phone app
  openai_fallback.py   # Fallback: GPT-4o Vision + TTS REST calls

app/
  contexts/PiContext.tsx          # Shared WebSocket state (frames, alerts, status)
  app/(tabs)/index.tsx            # Setup screen
  app/(tabs)/assist.tsx           # Live Assist screen
  app/(tabs)/debug.tsx            # Debug screen
  lib/types.ts                    # Pi ↔ App message types
```

**Pi → App messages (JSON over WebSocket):**

```json
{ "type": "frame",      "data": "<base64 JPEG>",        "timestamp": 1234567.89 }
{ "type": "alert",      "text": "obstacle ahead",       "timestamp": 1234567.89 }
{ "type": "transcript", "text": "I see a clear path...", "timestamp": 1234567.89 }
{ "type": "status",     "camera": true, "openai": true, "audio": true, "state": "ready" }
{ "type": "debug",      "event": "frame_sent",          "payload": { "size_kb": 28.3 }, "timestamp": 1234567.89 }
```

**App → Pi messages:**
```json
{ "type": "command", "action": "start" }
{ "type": "command", "action": "stop" }
```
