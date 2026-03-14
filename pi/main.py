import asyncio
import signal
import time
from config import (
    CAPTURE_HEIGHT,
    CAPTURE_WIDTH,
    FRAME_INTERVAL_SEC,
    PHONE_WS_HOST,
    PHONE_WS_PORT,
)
from camera import Camera
from phone_server import PhoneServer


class HackberryPi:
    def __init__(self):
        self.camera = Camera()
        self.phone = PhoneServer()
        self.running = False
        self.stream_active = False
        self.camera_ok = False
        self.last_frame_time = 0.0
        self.frame_id = 0
        self.target_fps = 1.0 / FRAME_INTERVAL_SEC if FRAME_INTERVAL_SEC > 0 else 1.0

    async def _publish_status(self, state: str):
        await self.phone.send_status(
            camera=self.camera_ok,
            streaming=self.stream_active,
            state=state,
            fps=round(self.target_fps, 2),
        )

    def _on_phone_command(self, action: str, payload: dict):
        print(f"[phone command] {action}")
        if action == "start_stream":
            self.stream_active = True
            asyncio.create_task(self._publish_status("streaming"))
        elif action == "stop_stream":
            self.stream_active = False
            asyncio.create_task(self._publish_status("ready"))
        elif action == "set_stream_config":
            requested_fps = float(payload.get("fps", self.target_fps) or self.target_fps)
            self.target_fps = max(0.25, min(requested_fps, 2.0))
            asyncio.create_task(
                self.phone.send_debug(
                    "stream_config_updated",
                    {"fps": round(self.target_fps, 2)},
                )
            )
            asyncio.create_task(self._publish_status("ready"))

    async def start(self):
        self.running = True
        print("=" * 50)
        print("  HackberryPi - Camera Streamer")
        print("=" * 50)

        try:
            self.camera.start()
            self.camera_ok = True
        except Exception as exc:
            print(f"Camera failed: {exc}")
            self.camera_ok = False

        await self.phone.start(PHONE_WS_HOST, PHONE_WS_PORT)
        self.phone.on_command = self._on_phone_command
        await self._publish_status("ready")

        print()
        print(f"Camera: {'OK' if self.camera_ok else 'FAIL'}")
        print(f"Phone server: ws://0.0.0.0:{PHONE_WS_PORT}")
        print(f"Default stream FPS: {round(self.target_fps, 2)}")
        print()

        await self._main_loop()

    async def _main_loop(self):
        while self.running:
            if not self.stream_active or not self.camera_ok:
                await asyncio.sleep(0.25)
                continue

            try:
                now = time.time()
                elapsed = now - self.last_frame_time
                frame_interval_sec = 1.0 / self.target_fps

                if elapsed < frame_interval_sec:
                    await asyncio.sleep(frame_interval_sec - elapsed)

                frame_b64, frame_jpeg = self.camera.capture_frame_base64()
                captured_at = time.time()
                self.last_frame_time = captured_at
                self.frame_id += 1

                await self.phone.send_frame(
                    frame_b64,
                    frame_id=self.frame_id,
                    captured_at=captured_at,
                    width=CAPTURE_WIDTH,
                    height=CAPTURE_HEIGHT,
                    size_bytes=len(frame_jpeg),
                )

                await self.phone.send_debug(
                    "frame_sent",
                    {
                        "frame_id": self.frame_id,
                        "fps": round(self.target_fps, 2),
                        "size_kb": round(len(frame_jpeg) / 1024, 1),
                    },
                )
            except Exception as exc:
                print(f"[main loop error] {exc}")
                await self.phone.send_debug("error", {"msg": str(exc)})
                await asyncio.sleep(1)

    async def stop(self):
        print("\nShutting down...")
        self.running = False
        self.camera.stop()


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
