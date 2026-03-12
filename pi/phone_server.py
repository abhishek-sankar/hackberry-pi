import json
import time
import asyncio
import websockets


class PhoneServer:
    def __init__(self):
        self.clients = set()
        self.server = None
        self.on_command = None  # callback(action: str) set by orchestrator

    async def start(self, host: str, port: int):
        self.server = await websockets.serve(
            self._handler,
            host,
            port,
            max_size=5 * 1024 * 1024,
        )
        print(f"Phone server listening on ws://{host}:{port}")

    async def _handler(self, websocket, path=None):
        self.clients.add(websocket)
        print(f"Phone app connected ({len(self.clients)} clients)")
        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    if data.get("type") == "command" and self.on_command:
                        self.on_command(data.get("action", ""))
                except json.JSONDecodeError:
                    pass
        except websockets.ConnectionClosed:
            pass
        finally:
            self.clients.discard(websocket)
            print(f"Phone app disconnected ({len(self.clients)} clients)")

    async def broadcast(self, event: dict):
        if not self.clients:
            return
        message = json.dumps(event)
        await asyncio.gather(
            *[client.send(message) for client in self.clients],
            return_exceptions=True,
        )

    async def send_frame(self, jpeg_b64: str):
        await self.broadcast({
            "type": "frame",
            "data": jpeg_b64,
            "timestamp": time.time(),
        })

    async def send_alert(self, text: str):
        await self.broadcast({
            "type": "alert",
            "text": text,
            "timestamp": time.time(),
        })

    async def send_transcript(self, text: str):
        await self.broadcast({
            "type": "transcript",
            "text": text,
            "timestamp": time.time(),
        })

    async def send_status(self, **kwargs):
        await self.broadcast({
            "type": "status",
            **kwargs,
        })

    async def send_debug(self, event_name: str, payload: dict):
        await self.broadcast({
            "type": "debug",
            "event": event_name,
            "payload": payload,
            "timestamp": time.time(),
        })
