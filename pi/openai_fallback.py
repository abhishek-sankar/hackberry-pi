"""
Fallback OpenAI client using GPT-4o Vision + TTS REST APIs.
Use this if the Realtime WebSocket API proves unreliable.

To switch: in main.py, replace OpenAIRealtimeClient with OpenAIFallbackClient.
The interface is similar but uses two REST calls instead of a WebSocket.
"""

import base64
import aiohttp
from config import OPENAI_API_KEY, SYSTEM_PROMPT


class OpenAIFallbackClient:
    def __init__(self, on_audio_delta, on_transcript, on_error):
        self.session = None
        self.on_audio_delta = on_audio_delta
        self.on_transcript = on_transcript
        self.on_error = on_error

    async def connect(self):
        """Initialize HTTP session (no WebSocket needed)."""
        self.session = aiohttp.ClientSession()
        print("Fallback mode: GPT-4o Vision + TTS ready")

    async def send_image(self, image_b64: str, prompt: str = "Describe what you see. Alert on any hazards."):
        """Analyze frame with GPT-4o Vision, then convert response to speech."""
        try:
            # Step 1: Vision API
            text = await self._analyze_frame(image_b64, prompt)
            if text:
                self.on_transcript(text)
                self.on_transcript("\n")

                # Step 2: TTS
                audio_bytes = await self._text_to_speech(text)
                if audio_bytes:
                    b64_audio = base64.b64encode(audio_bytes).decode("utf-8")
                    self.on_audio_delta(b64_audio)

        except Exception as e:
            self.on_error(f"Fallback error: {e}")

    async def _analyze_frame(self, image_b64: str, prompt: str) -> str | None:
        """Send image to GPT-4o Vision, get text description."""
        async with self.session.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            json={
                "model": "gpt-4o",
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{image_b64}",
                                    "detail": "low",
                                },
                            },
                            {"type": "text", "text": prompt},
                        ],
                    },
                ],
                "max_tokens": 150,
            },
        ) as resp:
            if resp.status != 200:
                error_text = await resp.text()
                self.on_error(f"Vision API error {resp.status}: {error_text}")
                return None
            data = await resp.json()
            return data["choices"][0]["message"]["content"]

    async def _text_to_speech(self, text: str) -> bytes | None:
        """Convert text to speech using OpenAI TTS API."""
        async with self.session.post(
            "https://api.openai.com/v1/audio/speech",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            json={
                "model": "tts-1",
                "input": text,
                "voice": "nova",
                "response_format": "pcm",
                "speed": 1.1,
            },
        ) as resp:
            if resp.status != 200:
                error_text = await resp.text()
                self.on_error(f"TTS API error {resp.status}: {error_text}")
                return None
            return await resp.read()

    async def close(self):
        if self.session:
            await self.session.close()
            print("Fallback client closed")
