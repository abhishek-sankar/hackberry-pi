import asyncio
import signal
import sys
import time
from config import PHONE_WS_HOST, PHONE_WS_PORT, FRAME_INTERVAL_SEC
from camera import Camera
from audio_io import AudioIO
from openai_realtime import OpenAIRealtimeClient
from phone_server import PhoneServer


class HackberryPi:
    def __init__(self):
        self.camera = Camera()
        self.audio = AudioIO()
        self.phone = PhoneServer()
        self.openai_client = None
        self.running = False
        self.assist_active = False
        self.transcript_buffer = ""
        self.last_frame_time = 0

    def _on_audio_delta(self, b64_audio: str):
        """Called when OpenAI streams back audio. Play it immediately."""
        self.audio.play_audio_chunk(b64_audio)

    def _on_transcript(self, text: str):
        """Called when OpenAI streams back text. Parse for alerts."""
        self.transcript_buffer += text

        # Check for ALERT: prefix to trigger phone haptic
        if "ALERT:" in self.transcript_buffer:
            parts = self.transcript_buffer.split("ALERT:")
            for part in parts[1:]:
                alert_text = part.strip()
                if alert_text and len(alert_text) > 3:
                    asyncio.create_task(self.phone.send_alert(alert_text))
                    print(f"[ALERT] {alert_text}")

        # On newline (response.done signal), send full transcript to phone
        if text == "\n":
            full_text = self.transcript_buffer.strip()
            if full_text:
                asyncio.create_task(self.phone.send_transcript(full_text))
                print(f"[transcript] {full_text}")
            self.transcript_buffer = ""

    def _on_openai_error(self, error: str):
        """Called on OpenAI errors."""
        print(f"[OpenAI ERROR] {error}")
        asyncio.create_task(
            self.phone.send_debug("openai_error", {"error": error})
        )

    def _on_phone_command(self, action: str):
        """Called when the phone app sends a command."""
        print(f"[phone command] {action}")
        if action == "start":
            self.assist_active = True
        elif action == "stop":
            self.assist_active = False

    async def start(self):
        self.running = True
        print("=" * 50)
        print("  HackberryPi - Navigation Assistant")
        print("=" * 50)

        # Start camera
        try:
            self.camera.start()
            camera_ok = True
        except Exception as e:
            print(f"Camera failed: {e}")
            camera_ok = False

        # Start audio (playback only for MVP, no mic)
        try:
            self.audio.start(enable_mic=False)
            audio_ok = True
        except Exception as e:
            print(f"Audio failed: {e}")
            audio_ok = False

        # Start phone server
        await self.phone.start(PHONE_WS_HOST, PHONE_WS_PORT)
        self.phone.on_command = self._on_phone_command

        # Connect to OpenAI
        openai_ok = False
        try:
            self.openai_client = OpenAIRealtimeClient(
                on_audio_delta=self._on_audio_delta,
                on_transcript=self._on_transcript,
                on_error=self._on_openai_error,
            )
            await self.openai_client.connect()
            openai_ok = True
        except Exception as e:
            print(f"OpenAI connection failed: {e}")
            print(">>> Consider switching to fallback mode (openai_fallback.py)")

        # Send status to phone
        await self.phone.send_status(
            camera=camera_ok,
            openai=openai_ok,
            audio=audio_ok,
            state="ready",
        )

        print()
        print(f"Camera: {'OK' if camera_ok else 'FAIL'}")
        print(f"OpenAI: {'OK' if openai_ok else 'FAIL'}")
        print(f"Audio:  {'OK' if audio_ok else 'FAIL'}")
        print(f"Phone server: ws://0.0.0.0:{PHONE_WS_PORT}")
        print()

        if not openai_ok:
            print("OpenAI not connected. Waiting for manual restart...")
            while self.running:
                await asyncio.sleep(1)
            return

        # Auto-start assist mode for simplicity
        self.assist_active = True
        print("Assist mode ACTIVE. Streaming frames to OpenAI...")
        print()

        await self._main_loop()

    async def _main_loop(self):
        """Core loop: capture frame -> send to OpenAI -> repeat."""
        while self.running:
            if not self.assist_active:
                await asyncio.sleep(0.5)
                continue

            try:
                now = time.time()
                elapsed = now - self.last_frame_time

                if elapsed < FRAME_INTERVAL_SEC:
                    await asyncio.sleep(FRAME_INTERVAL_SEC - elapsed)

                # Capture frame
                frame_b64, frame_jpeg = self.camera.capture_frame_base64()
                self.last_frame_time = time.time()

                # Send frame to phone app for preview
                await self.phone.send_frame(frame_b64)

                # Send frame to OpenAI
                self.transcript_buffer = ""
                await self.openai_client.send_image(frame_b64)

                # Send timing debug info
                await self.phone.send_debug("frame_sent", {
                    "size_kb": round(len(frame_jpeg) / 1024, 1),
                    "interval_s": round(elapsed, 2),
                })

            except Exception as e:
                print(f"[main loop error] {e}")
                await self.phone.send_debug("error", {"msg": str(e)})
                await asyncio.sleep(1)

    async def stop(self):
        print("\nShutting down...")
        self.running = False
        self.camera.stop()
        self.audio.stop()
        if self.openai_client:
            await self.openai_client.close()


async def main():
    app = HackberryPi()

    loop = asyncio.get_event_loop()

    def shutdown():
        asyncio.create_task(app.stop())

    loop.add_signal_handler(signal.SIGINT, shutdown)
    loop.add_signal_handler(signal.SIGTERM, shutdown)

    try:
        await app.start()
    except KeyboardInterrupt:
        await app.stop()


if __name__ == "__main__":
    asyncio.run(main())
