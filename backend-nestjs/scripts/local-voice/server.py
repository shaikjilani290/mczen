import argparse
import base64
import binascii
from collections import OrderedDict
from contextlib import contextmanager
from itertools import chain
import math
from pathlib import Path
from threading import BoundedSemaphore, Lock
import time
from typing import Literal
from uuid import UUID

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
import numpy as np
from pydantic import BaseModel, ConfigDict, Field
from scipy.signal import resample_poly
from starlette.background import BackgroundTask
import uvicorn

from download_models import VOICES


class VadInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    audio: str = Field(max_length=856)
    encoding: Literal["pcm_s16le"]
    sampleRate: Literal[16000]
    channels: Literal[1]
    streamId: UUID


class TtsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=2000)
    language: Literal["en", "hi"]
    voice: str
    rate: float = Field(ge=0.5, le=2, allow_inf_nan=False)
    encoding: Literal["pcm_s16le"]
    sampleRate: Literal[16000]
    stream: Literal[True]


@contextmanager
def permit(slots):
    if not slots.acquire(blocking=False):
        raise HTTPException(503, "Voice engine is busy.")
    try:
        yield
    finally:
        slots.release()


def pcm16(samples):
    return np.clip(np.rint(samples * 32768), -32768, 32767).astype("<i2").tobytes()


class Silero:
    def __init__(self, path):
        import onnxruntime as ort

        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        self.model = ort.InferenceSession(
            str(path), sess_options=options, providers=["CPUExecutionProvider"]
        )
        self.streams = OrderedDict()
        self.lock = Lock()

    def predict(self, stream_id, audio):
        now = time.monotonic()
        with self.lock:
            for key, value in list(self.streams.items()):
                if now - value["seen"] > 120:
                    del self.streams[key]
            state = self.streams.get(stream_id)
            if state is None:
                if len(self.streams) >= 128:
                    raise HTTPException(503, "VAD stream capacity reached.")
                state = {
                    "hidden": np.zeros((2, 1, 128), dtype=np.float32),
                    "context": np.zeros((1, 64), dtype=np.float32),
                    "pending": np.empty(0, dtype=np.float32),
                    "probability": 0.0,
                    "seen": now,
                }
                self.streams[stream_id] = state
            state["seen"] = now
            state["pending"] = np.concatenate((state["pending"], audio))
            # Silero consumes 32 ms windows; Nest sends 20 ms frames.
            while state["pending"].size >= 512:
                window = state["pending"][:512].reshape(1, -1)
                state["pending"] = state["pending"][512:]
                inputs = np.concatenate((state["context"], window), axis=1)
                probability, hidden = self.model.run(None, {
                    "input": inputs, "state": state["hidden"], "sr": np.array(16000, dtype=np.int64),
                })
                state["hidden"] = hidden
                state["context"] = window[:, -64:]
                state["probability"] = float(probability.item())
            probability = state["probability"]
            return {"speech": probability >= 0.5, "probability": probability}


def create_app(service: str, directory: Path):
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    slots = BoundedSemaphore(2)

    @app.middleware("http")
    async def limit_request_body(request, call_next):
        if request.method == "POST":
            length = request.headers.get("content-length")
            if length is None:
                return JSONResponse({"detail": "Content-Length is required."}, status_code=411)
            if not length.isdecimal():
                return JSONResponse({"detail": "Invalid Content-Length."}, status_code=400)
            if int(length) > 1_048_576:
                return JSONResponse({"detail": "Voice request is too large."}, status_code=413)
        return await call_next(request)

    if service == "stt":
        from faster_whisper import WhisperModel

        whisper = WhisperModel(
            str(directory / "whisper-small"),
            device="cpu", compute_type="int8", cpu_threads=6, num_workers=2,
            local_files_only=True,
        )
        warmup, _ = whisper.transcribe(
            np.zeros(16000, dtype=np.float32), language="en",
            beam_size=1, best_of=1, temperature=0,
            condition_on_previous_text=False,
        )
        for _ in warmup:
            pass

        @app.post("/transcribe")
        def transcribe(
            file: UploadFile = File(),
            encoding: str = Form(),
            sample_rate: int = Form(),
            channels: int = Form(),
            partial: bool = Form(),
            model: str = Form(),
            language: str | None = Form(default=None),
        ):
            if (encoding != "pcm_s16le" or sample_rate != 16000 or channels != 1
                    or model != "faster-whisper-small-int8"
                    or language not in (None, "en", "hi", "te")):
                raise HTTPException(422, "Unsupported transcription format, model or language.")
            raw = file.file.read(640_001)
            if len(raw) < 640 or len(raw) > 640_000 or len(raw) % 2:
                raise HTTPException(422, "Expected 20 ms to 20 seconds of mono PCM16.")
            audio = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
            with permit(slots):
                segments, info = whisper.transcribe(
                    audio, language=language, beam_size=1, best_of=1, temperature=0,
                    condition_on_previous_text=False, vad_filter=False,
                )
                text = "".join(segment.text for segment in segments).strip()
            if info.language not in ("en", "hi", "te"):
                raise HTTPException(422, "Detected language is not supported.")
            return {"text": text[:8000], "language": info.language}

    elif service == "vad":
        silero = Silero(directory / "silero" / "silero_vad.onnx")

        @app.post("/predict")
        def predict(data: VadInput):
            try:
                raw = base64.b64decode(data.audio, validate=True)
            except binascii.Error as error:
                raise HTTPException(422, "Invalid base64 audio.") from error
            if len(raw) != 640:
                raise HTTPException(422, "Expected exactly 20 ms of PCM16 audio.")
            audio = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
            return silero.predict(str(data.streamId), audio)

    elif service == "tts":
        from piper import PiperVoice, SynthesisConfig

        voices = {
            voice: PiperVoice.load(str(directory / "piper" / f"{voice}.onnx"))
            for voice in VOICES
        }
        locks = {voice: Lock() for voice in voices}

        def synthesize_audio(data):
            with permit(slots), locks[data.voice]:
                config = SynthesisConfig(length_scale=1 / data.rate)
                for chunk in voices[data.voice].synthesize(data.text, syn_config=config):
                    audio = np.frombuffer(chunk.audio_int16_bytes, dtype="<i2").astype(np.float32) / 32768
                    divisor = math.gcd(chunk.sample_rate, 16000)
                    audio = resample_poly(audio, 16000 // divisor, chunk.sample_rate // divisor)
                    yield pcm16(audio)

        @app.post("/synthesize")
        def synthesize(data: TtsInput):
            if data.voice not in voices or not data.voice.startswith(data.language + "_"):
                raise HTTPException(422, "Unsupported voice for this language.")
            audio = synthesize_audio(data)
            try:
                first = next(audio)
            except StopIteration as error:
                raise HTTPException(422, "Text did not produce speech.") from error
            return StreamingResponse(
                chain((first,), audio),
                media_type="application/x-mczen-pcm",
                headers={"x-audio-encoding": "pcm_s16le", "x-audio-sample-rate": "16000"},
                background=BackgroundTask(audio.close),
            )
    else:
        raise ValueError(f"Unknown voice service: {service}")

    @app.get("/health")
    def health():
        return {"healthy": True, "service": service}

    return app


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--service", choices=("stt", "vad", "tts"), required=True)
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    ports = {"stt": 8001, "vad": 8002, "tts": 8003}
    uvicorn.run(
        create_app(args.service, args.directory.resolve()),
        host="127.0.0.1", port=ports[args.service], access_log=False,
        limit_concurrency=32,
    )
