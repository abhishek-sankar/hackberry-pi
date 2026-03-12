import pyaudio
import base64
import threading
import queue
from config import AUDIO_RATE_INPUT, AUDIO_RATE_OUTPUT, AUDIO_CHANNELS, AUDIO_CHUNK


class AudioIO:
    def __init__(self):
        self.pa = pyaudio.PyAudio()
        self.input_stream = None
        self.output_stream = None
        self._playback_queue = queue.Queue()
        self._playback_thread = None
        self._running = False

    def start(self, enable_mic=False):
        """Start audio streams. Mic is optional for MVP."""
        # Output stream (to Bluetooth earbuds)
        self.output_stream = self.pa.open(
            format=pyaudio.paInt16,
            channels=AUDIO_CHANNELS,
            rate=AUDIO_RATE_OUTPUT,
            output=True,
            frames_per_buffer=AUDIO_CHUNK,
        )

        # Mic input (optional)
        if enable_mic:
            try:
                self.input_stream = self.pa.open(
                    format=pyaudio.paInt16,
                    channels=AUDIO_CHANNELS,
                    rate=AUDIO_RATE_INPUT,
                    input=True,
                    frames_per_buffer=AUDIO_CHUNK,
                )
                print("Microphone started")
            except Exception as e:
                print(f"Mic not available: {e}")
                self.input_stream = None

        # Start playback thread for non-blocking audio output
        self._running = True
        self._playback_thread = threading.Thread(target=self._playback_worker, daemon=True)
        self._playback_thread.start()
        print(f"Audio output started (rate={AUDIO_RATE_OUTPUT})")

    def _playback_worker(self):
        """Background thread that plays audio chunks from the queue."""
        while self._running:
            try:
                audio_bytes = self._playback_queue.get(timeout=0.1)
                self.output_stream.write(audio_bytes)
            except queue.Empty:
                continue
            except Exception as e:
                print(f"Playback error: {e}")

    def play_audio_chunk(self, b64_audio: str):
        """Decode base64 PCM16 audio and queue for playback."""
        audio_bytes = base64.b64decode(b64_audio)
        self._playback_queue.put(audio_bytes)

    def read_mic_chunk(self) -> str | None:
        """Read a chunk from mic, return as base64 PCM16. Returns None if mic unavailable."""
        if not self.input_stream:
            return None
        data = self.input_stream.read(AUDIO_CHUNK, exception_on_overflow=False)
        return base64.b64encode(data).decode("utf-8")

    def stop(self):
        self._running = False
        if self._playback_thread:
            self._playback_thread.join(timeout=2)
        if self.input_stream:
            self.input_stream.stop_stream()
            self.input_stream.close()
        if self.output_stream:
            self.output_stream.stop_stream()
            self.output_stream.close()
        self.pa.terminate()
        print("Audio stopped")
