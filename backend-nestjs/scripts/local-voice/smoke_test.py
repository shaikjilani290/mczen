import base64
import json
import time
import urllib.error
import urllib.request
from uuid import uuid4

from download_models import VOICES


def request(port, path, body=None, content_type="application/json"):
    data = None if body is None else body if isinstance(body, bytes) else json.dumps(body).encode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", data=data,
        headers={"Content-Type": content_type} if data is not None else {},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read(), response.headers


def main():
    for port in (8001, 8002, 8003):
        body, _ = request(port, "/health")
        assert json.loads(body)["healthy"], f"Port {port} is not healthy."
    speech = None
    for voice in VOICES:
        text = "Hello. Welcome to the local voice assistant."
        if voice.startswith("hi_"):
            text = "\u0928\u092e\u0938\u094d\u0924\u0947"
        started = time.monotonic()
        body, headers = request(8003, "/synthesize", {
            "text": text, "language": voice[:2], "voice": voice, "rate": 1,
            "encoding": "pcm_s16le", "sampleRate": 16000, "stream": True,
        })
        assert headers["x-audio-encoding"] == "pcm_s16le"
        assert headers["x-audio-sample-rate"] == "16000"
        assert len(body) >= 3200 and len(body) % 2 == 0
        print(f"TTS {voice}: {len(body)} PCM bytes in {time.monotonic() - started:.2f}s", flush=True)
        if voice == "en_US-amy-medium":
            speech = body
    stream_id, silent_id = str(uuid4()), str(uuid4())
    probabilities = []
    started = time.monotonic()
    for offset in range(0, len(speech), 640):
        frame = speech[offset:offset + 640].ljust(640, b"\0")
        body, _ = request(8002, "/predict", {
            "audio": base64.b64encode(frame).decode(), "encoding": "pcm_s16le",
            "sampleRate": 16000, "channels": 1, "streamId": stream_id,
        })
        probabilities.append(json.loads(body)["probability"])
    assert max(probabilities) >= 0.5, "Silero did not detect synthesized speech."
    for _ in range(5):
        body, _ = request(8002, "/predict", {
            "audio": base64.b64encode(bytes(640)).decode(), "encoding": "pcm_s16le",
            "sampleRate": 16000, "channels": 1, "streamId": silent_id,
        })
        assert not json.loads(body)["speech"], "VAD state leaked into another stream."
    print(f"VAD detected speech; isolated silence passed in {time.monotonic() - started:.2f}s", flush=True)
    boundary = "MczenVoiceSmokeBoundary"
    parts = []
    for key, value in {
        "encoding": "pcm_s16le", "sample_rate": "16000", "channels": "1",
        "partial": "false", "model": "faster-whisper-small-int8", "language": "en",
    }.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="smoke.pcm"\r\n'
        'Content-Type: application/octet-stream\r\n\r\n'.encode()
        + speech + f"\r\n--{boundary}--\r\n".encode()
    )
    started = time.monotonic()
    body, _ = request(8001, "/transcribe", b"".join(parts), f"multipart/form-data; boundary={boundary}")
    result = json.loads(body)
    assert result["language"] == "en" and "hello" in result["text"].lower(), result
    elapsed = time.monotonic() - started
    assert elapsed < 45, f"STT exceeded the backend's 45-second final-transcription timeout: {elapsed:.2f}s"
    print(f"STT recognized generated English speech in {elapsed:.2f}s: {result['text']}", flush=True)
    print("Real local STT, VAD and all configured Piper voices passed.", flush=True)


if __name__ == "__main__":
    main()
