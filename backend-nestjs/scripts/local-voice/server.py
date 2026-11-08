import argparse
import base64
import binascii
from collections import OrderedDict
import asyncio
from contextlib import asynccontextmanager
from itertools import chain
import json
import math
import os
import logging
import sys
from pathlib import Path
from threading import BoundedSemaphore, Lock
import time
from typing import Literal
from uuid import UUID

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
import numpy as np
from pydantic import BaseModel, ConfigDict, Field
from scipy.signal import resample_poly
from starlette.background import BackgroundTask
import uvicorn
import anyio

from download_models import VOICES
from engine_capacity import permit
from temporary_audio import TemporaryAudio


class VadInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    audio: str = Field(max_length=19200)
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


def pcm16(samples):
    return np.clip(np.rint(samples * 32768), -32768, 32767).astype("<i2").tobytes()

def valid_request_id(value):
    try:
        UUID(value)
        return True
    except ValueError:
        return False


def cpu_session_options(threads):
    import onnxruntime as ort

    options = ort.SessionOptions()
    options.intra_op_num_threads = threads
    options.inter_op_num_threads = 1
    options.add_session_config_entry("session.intra_op.allow_spinning", "0")
    options.add_session_config_entry("session.inter_op.allow_spinning", "0")
    return options


def configure_vad_scheduling(service):
    if service != "vad" or sys.platform != "win32":
        return
    import ctypes
    from ctypes import wintypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.SetPriorityClass.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.SetPriorityClass.restype = wintypes.BOOL
    # Above-normal, not realtime: short VAD work must preempt CPU-bound inference.
    if not kernel.SetPriorityClass(kernel.GetCurrentProcess(), 0x00008000):
        raise ctypes.WinError(ctypes.get_last_error())
    logging.getLogger("uvicorn.error").info("voice_vad_scheduling priority=above_normal platform=win32")


def load_piper_voice(path):
    import onnxruntime as ort
    from piper import PiperVoice
    from piper.config import PiperConfig

    with Path(f"{path}.json").open(encoding="utf-8") as file:
        config = PiperConfig.from_dict(json.load(file))
    return PiperVoice(
        config=config,
        session=ort.InferenceSession(
            str(path), sess_options=cpu_session_options(2),
            providers=["CPUExecutionProvider"],
        ),
    )


def recognition_quality(segments, audio=None):
    levels = {} if audio is None else {
        "audioRms": float(np.sqrt(np.mean(np.square(audio, dtype=np.float64)))) if audio.size else 0.0,
        "audioPeak": float(np.max(np.abs(audio))) if audio.size else 0.0,
        "clippedFraction": float(np.mean(np.abs(audio) >= 0.999)) if audio.size else 0.0,
    }
    duration = sum(max(0, segment.end - segment.start) for segment in segments)
    if not segments or duration <= 0:
        return {"reliable": False, "reason": "no_speech", **levels}
    log_probability = sum(segment.avg_logprob * max(0, segment.end - segment.start)
                          for segment in segments) / duration
    no_speech = sum(segment.no_speech_prob * max(0, segment.end - segment.start)
                   for segment in segments) / duration
    return {
        "reliable": log_probability >= -1.0 and no_speech <= 0.6,
        "reason": "low_log_probability" if log_probability < -1.0
                  else "likely_no_speech" if no_speech > 0.6 else "accepted",
        "avgLogProbability": log_probability,
        "noSpeechProbability": no_speech,
        **levels,
    }


class Silero:
    def __init__(self, path):
        import onnxruntime as ort

        self.model = ort.InferenceSession(
            str(path), sess_options=cpu_session_options(1), providers=["CPUExecutionProvider"]
        )
        self.streams = OrderedDict()
        self.lock = Lock()

    def predict(self, stream_id, audio):
        return self.predict_batch(stream_id, audio)[-1]

    def predict_batch(self, stream_id, audio, profile=None):
        now = time.monotonic()
        waiting_at = time.perf_counter()
        with self.lock:
            if profile is not None:
                profile["sileroLockWaitMs"] = (time.perf_counter() - waiting_at) * 1000
                profile["sileroInferenceMs"] = 0.0
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
            decisions = []
            # Keep each batch atomic; retain one decision per 20 ms input frame.
            for offset in range(0, audio.size, 320):
                state["pending"] = np.concatenate((state["pending"], audio[offset:offset + 320]))
                while state["pending"].size >= 512:
                    window = state["pending"][:512].reshape(1, -1)
                    state["pending"] = state["pending"][512:]
                    inputs = np.concatenate((state["context"], window), axis=1)
                    inference_at = time.perf_counter()
                    probability, hidden = self.model.run(None, {
                        "input": inputs, "state": state["hidden"], "sr": np.array(16000, dtype=np.int64),
                    })
                    if profile is not None:
                        profile["sileroInferenceMs"] += (time.perf_counter() - inference_at) * 1000
                    state["hidden"] = hidden
                    state["context"] = window[:, -64:]
                    state["probability"] = float(probability.item())
                probability = state["probability"]
                decisions.append({"speech": probability >= 0.5, "probability": probability})
            return decisions


def create_app(service: str, directory: Path, english_model: str = "small", recording_consent=False):
    if english_model not in ("small", "base.en"):
        raise ValueError("Unsupported English STT model.")
    runtime = {"eventLoopLagMs": 0.0, "maxEventLoopLagMs": 0.0}
    recordings = TemporaryAudio(consent=recording_consent)

    @asynccontextmanager
    async def lifespan(_app):
        async def monitor():
            while True:
                started = time.perf_counter()
                await asyncio.sleep(0.05)
                lag = max(0, (time.perf_counter() - started - 0.05) * 1000)
                runtime["eventLoopLagMs"] = lag
                runtime["maxEventLoopLagMs"] = max(runtime["maxEventLoopLagMs"], lag)
        task = asyncio.create_task(monitor())
        try:
            yield
        finally:
            recordings.close()
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
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
        started = time.perf_counter()
        request.state.received_at = started
        capacity = anyio.to_thread.current_default_thread_limiter().statistics()
        request.state.threadpool = {
            "borrowed": capacity.borrowed_tokens, "total": capacity.total_tokens,
            "waiting": capacity.tasks_waiting,
        }
        response = await call_next(request)
        elapsed = (time.perf_counter() - started) * 1000
        if service == "vad" and request.url.path == "/predict" and (response.status_code != 200 or elapsed >= 100):
            logging.getLogger("uvicorn.error").warning(
                json.dumps({
                    "event": "voice_vad_http_slow", "method": request.method,
                    "status": response.status_code, "durationMs": elapsed,
                    "requestId": request.headers.get("x-mczen-request-id")
                    if valid_request_id(request.headers.get("x-mczen-request-id", "")) else None,
                    "threadpool": request.state.threadpool,
                    "eventLoopLagMs": runtime["eventLoopLagMs"],
                })
            )
        return response

    if service == "stt":
        from stt_profile import ProfiledWhisperModel

        beam_size = int(os.environ.get("VOICE_STT_BEAM_SIZE", "5"))
        if beam_size < 1:
            raise ValueError("VOICE_STT_BEAM_SIZE must be a positive integer.")
        loading_at = time.perf_counter()
        whisper = ProfiledWhisperModel(
            str(directory / "whisper-small"),
            device="cpu", compute_type="int8", cpu_threads=6, num_workers=2,
            local_files_only=True,
        )
        runtime["modelLoadMs"] = (time.perf_counter() - loading_at) * 1000
        english_whisper = whisper
        if english_model != "small":
            loading_at = time.perf_counter()
            english_whisper = ProfiledWhisperModel(
                str(directory / f"whisper-{english_model}"), device="cpu",
                compute_type="int8", cpu_threads=4, num_workers=2, local_files_only=True,
            )
            runtime["englishModelLoadMs"] = (time.perf_counter() - loading_at) * 1000
        runtime["englishModel"] = english_model
        warming_at = time.perf_counter()
        warmup, _ = whisper.transcribe(
            np.zeros(16000, dtype=np.float32), language="en",
            beam_size=1, best_of=1, temperature=0,
            condition_on_previous_text=False,
        )
        for _ in warmup:
            pass
        if english_whisper is not whisper:
            warmup, _ = english_whisper.transcribe(
                np.zeros(16000, dtype=np.float32), language="en",
                beam_size=1, best_of=1, temperature=0, condition_on_previous_text=False,
            )
            list(warmup)
        runtime["warmupMs"] = (time.perf_counter() - warming_at) * 1000

        @app.post("/transcribe")
        def transcribe(
            request: Request,
            file: UploadFile = File(),
            encoding: str = Form(),
            sample_rate: int = Form(),
            channels: int = Form(),
            partial: bool = Form(),
            model: str = Form(),
            language: str | None = Form(default=None),
            initial_prompt: str | None = Form(default=None, max_length=200),
        ):
            dispatched_at = time.perf_counter()
            if (encoding != "pcm_s16le" or sample_rate != 16000 or channels != 1
                    or model != "faster-whisper-small-int8"
                    or language not in (None, "en", "hi", "te")):
                raise HTTPException(422, "Unsupported transcription format, model or language.")
            raw = file.file.read(640_001)
            if len(raw) < 640 or len(raw) > 640_000 or len(raw) % 2:
                raise HTTPException(422, "Expected 20 ms to 20 seconds of mono PCM16.")
            audio = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
            recordings.save(raw)
            started = time.perf_counter()
            selected = english_whisper if language == "en" else whisper
            selected_model = english_model if language == "en" else "small"
            with permit(slots):
                admitted_at = time.perf_counter()
                with selected.profiling() as stages:
                    segments, info = selected.transcribe(
                        audio, language=language, beam_size=beam_size, temperature=[0.0, 0.2, 0.4],
                        condition_on_previous_text=False, vad_filter=False,
                        initial_prompt=initial_prompt,
                    )
                    segments = list(segments)
                inferred_at = time.perf_counter()
            text = "".join(segment.text for segment in segments).strip()
            quality = recognition_quality(segments, audio)
            if info.language not in ("en", "hi", "te"):
                raise HTTPException(422, "Detected language is not supported.")
            finished_at = time.perf_counter()
            processing_ms = (finished_at - started) * 1000
            timings = {
                "dispatchMs": (dispatched_at - request.state.received_at) * 1000,
                "preprocessingMs": (started - dispatched_at) * 1000,
                "queueMs": (admitted_at - started) * 1000,
                "inferenceMs": (inferred_at - admitted_at) * 1000,
                **stages,
                "postprocessingMs": (finished_at - inferred_at) * 1000,
            }
            request_id = request.headers.get("x-mczen-request-id", "")
            try:
                request_id = str(UUID(request_id))
            except ValueError:
                request_id = None
            logging.getLogger("uvicorn.error").info(json.dumps({
                "event": "voice_stt_inference", "requestId": request_id,
                "audioMs": len(raw) / 32, "processingMs": processing_ms,
                "timings": timings,
                "partial": partial, "cpuThreads": 6 if selected_model == "small" else 4,
                "model": f"whisper-{selected_model}", "computeType": "int8",
            }))
            return {"text": text[:8000], "language": info.language, "languageProbability": info.language_probability,
                    "processingMs": processing_ms,
                    "recognitionQuality": quality, "timings": timings}

    elif service == "vad":
        silero = Silero(directory / "silero" / "silero_vad.onnx")

        @app.post("/predict")
        def predict(data: VadInput, request: Request):
            dispatched = time.perf_counter()
            try:
                raw = base64.b64decode(data.audio, validate=True)
            except binascii.Error as error:
                raise HTTPException(422, "Invalid base64 audio.") from error
            if not raw or len(raw) > 14080 or len(raw) % 640:
                raise HTTPException(422, "Expected 20 ms PCM16 frames, at most 440 ms per batch.")
            audio = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
            started = time.perf_counter()
            with permit(slots):
                admitted = time.perf_counter()
                native_timing = {}
                frames = silero.predict_batch(str(data.streamId), audio, profile=native_timing)
            finished = time.perf_counter()
            timing = {
                "dispatchMs": (dispatched - request.state.received_at) * 1000,
                "queueMs": (admitted - started) * 1000,
                "processingMs": (finished - admitted) * 1000,
                "eventLoopLagMs": runtime["eventLoopLagMs"],
                **native_timing,
            }
            if finished - request.state.received_at >= 0.1:
                logging.getLogger("uvicorn.error").warning(json.dumps({
                    "event": "voice_vad_slow", "sessionId": str(data.streamId),
                    "bytes": len(raw), "serviceState": "ready", "threadpool": request.state.threadpool,
                    "requestId": request.headers.get("x-mczen-request-id")
                    if valid_request_id(request.headers.get("x-mczen-request-id", "")) else None,
                    **timing,
                }))
            return {**frames[-1], "frames": frames, **timing}

    elif service == "tts":
        from piper import SynthesisConfig

        voices = {
            voice: load_piper_voice(directory / "piper" / f"{voice}.onnx")
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
        return {"healthy": True, "service": service, **runtime}

    return app


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--service", choices=("stt", "vad", "tts"), required=True)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--english-model", choices=("small", "base.en"), default="small")
    parser.add_argument("--temporary-recording-consent", action="store_true",
                        help="Developer explicit consent: local STT PCM only, expires in 30 minutes; forbidden in production.")
    args = parser.parse_args()
    configure_vad_scheduling(args.service)
    ports = {"stt": 8001, "vad": 8002, "tts": 8003}
    uvicorn.run(
        create_app(args.service, args.directory.resolve(), english_model=args.english_model,
                   recording_consent=args.temporary_recording_consent),
        host="127.0.0.1", port=ports[args.service], access_log=False,
        limit_concurrency=32,
    )
