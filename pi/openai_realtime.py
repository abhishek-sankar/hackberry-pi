import json
import asyncio
import base64
import websockets
from config import OPENAI_API_KEY, OPENAI_WS_URL, SYSTEM_PROMPT


class OpenAIRealtimeClient:
    def __init__(self, on_audio_delta, on_transcript, on_error):
        self.ws = None
        self.on_audio_delta = on_audio_delta  # callback(b64_audio: str)
        self.on_transcript = on_transcript  # callback(text: str)
        self.on_error = on_error  # callback(error: str)
        self._receive_task = None

    async def connect(self):
        headers = {
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "OpenAI-Beta": "realtime=v1",
        }
        self.ws = await websockets.connect(
            OPENAI_WS_URL,
            additional_headers=headers,
            max_size=10 * 1024 * 1024,
        )
        print("Connected to OpenAI Realtime API")

        # Wait for session.created
        raw = await self.ws.recv()
        event = json.loads(raw)
        if event.get("type") == "session.created":
            print(f"Session created: {event['session'].get('id', 'unknown')}")
        else:
            print(f"Unexpected first event: {event.get('type')}")

        await self._send_session_update()
        self._receive_task = asyncio.create_task(self._receive_loop())

    async def _send_session_update(self):
        event = {
            "type": "session.update",
            "session": {
                "instructions": SYSTEM_PROMPT,
                "modalities": ["text", "audio"],
                "voice": "alloy",
                "input_audio_format": "pcm16",
                "output_audio_format": "pcm16",
                "turn_detection": None,
            },
        }
        await self.ws.send(json.dumps(event))
        print("Session configured")

    async def send_image(self, image_b64: str, prompt: str = "Describe what you see. Alert on any hazards."):
        """Send a camera frame and text prompt, then request a response."""
        # Create a conversation item with image + text
        item_event = {
            "type": "conversation.item.create",
            "item": {
                "type": "message",
                "role": "user",
                "content": [
                    {
                        "type": "input_image",
                        "image_url": f"data:image/jpeg;base64,{image_b64}",
                    },
                    {
                        "type": "input_text",
                        "text": prompt,
                    },
                ],
            },
        }
        await self.ws.send(json.dumps(item_event))

        # Request a response with both text and audio
        response_event = {
            "type": "response.create",
            "response": {
                "modalities": ["text", "audio"],
            },
        }
        await self.ws.send(json.dumps(response_event))

    async def send_audio_chunk(self, b64_audio: str):
        """Stream mic audio to the input buffer."""
        event = {
            "type": "input_audio_buffer.append",
            "audio": b64_audio,
        }
        await self.ws.send(json.dumps(event))

    async def commit_audio_and_respond(self):
        """Commit the audio buffer and request a response."""
        await self.ws.send(json.dumps({"type": "input_audio_buffer.commit"}))
        await self.ws.send(
            json.dumps({"type": "response.create", "response": {"modalities": ["text", "audio"]}})
        )

    async def _receive_loop(self):
        """Listen for server events and dispatch to callbacks."""
        try:
            async for raw_msg in self.ws:
                event = json.loads(raw_msg)
                event_type = event.get("type", "")

                if event_type == "response.audio.delta":
                    delta = event.get("delta", "")
                    if delta:
                        self.on_audio_delta(delta)

                elif event_type == "response.text.delta":
                    delta = event.get("delta", "")
                    if delta:
                        self.on_transcript(delta)

                elif event_type == "response.done":
                    # Signal end of response
                    self.on_transcript("\n")

                elif event_type == "error":
                    error_info = event.get("error", {})
                    self.on_error(
                        f"{error_info.get('type', 'unknown')}: {error_info.get('message', str(event))}"
                    )

                elif event_type == "session.updated":
                    print("Session settings updated successfully")

                elif event_type in (
                    "response.created",
                    "response.output_item.added",
                    "response.content_part.added",
                    "response.audio.done",
                    "response.text.done",
                    "response.content_part.done",
                    "response.output_item.done",
                    "conversation.item.created",
                ):
                    pass  # Expected lifecycle events, ignore

                else:
                    print(f"[realtime] unhandled event: {event_type}")

        except websockets.ConnectionClosed as e:
            self.on_error(f"Connection closed: {e}")
        except Exception as e:
            self.on_error(f"Receive loop error: {e}")

    async def close(self):
        if self._receive_task:
            self._receive_task.cancel()
        if self.ws:
            await self.ws.close()
            print("OpenAI connection closed")
