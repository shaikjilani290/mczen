"""Optional, isolated OpenVoice V2 provider. Never install into the working STT/VAD/Piper venv."""
import argparse
import base64
import binascii
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import BoundedSemaphore
import wave
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response
import numpy as np
from pydantic import BaseModel, ConfigDict, Field
import requests
import uvicorn

from engine_capacity import permit


class Conversion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=500)
    embedding: str = Field(min_length=1368, max_length=1368)
    language: str = Field(pattern="^en$")


def decode_embedding(value):
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error) as error:
        raise HTTPException(422, "Invalid speaker embedding.") from error
    embedding = np.frombuffer(raw, dtype="<f4")
    if embedding.size != 256 or not np.isfinite(embedding).all():
        raise HTTPException(422, "Invalid speaker embedding.")
    return embedding.copy().reshape(1, 256, 1)


def verify_speech(samples):
    stream = str(uuid4())
    speech_frames = 0
    for offset in range(0, samples.size, 7040):
        batch = samples[offset:offset + 7040]
        if batch.size % 320:
            batch = np.pad(batch, (0, 320 - batch.size % 320))
        try:
            response = requests.post("http://127.0.0.1:8002/predict", json={
                "streamId": stream, "audio": base64.b64encode(batch.astype("<i2").tobytes()).decode("ascii"),
                "encoding": "pcm_s16le", "sampleRate": 16000, "channels": 1,
            }, timeout=(2, 5), allow_redirects=False)
            response.raise_for_status()
            if response.status_code != 200:
                raise HTTPException(503, "Reference speech validation refused a redirect.")
            body = response.json()
            frames = body.get("frames") if isinstance(body, dict) else None
        except (requests.RequestException, ValueError) as error:
            raise HTTPException(503, "Reference speech validation is unavailable.") from error
        if not isinstance(frames, list) or len(frames) != batch.size // 320 or any(
                not isinstance(frame, dict) or type(frame.get("speech")) is not bool for frame in frames):
            raise HTTPException(502, "Reference speech validation returned an invalid response.")
        speech_frames += sum(frame["speech"] for frame in frames)
    if speech_frames < 50:
        raise HTTPException(422, "At least one second of clearly detected speech is required.")


def create_app(converter, torch, piper_url, base_voice):
    app = FastAPI(docs_url=None, redoc_url=None)
    slots = BoundedSemaphore(1)

    @app.get("/health")
    def health():
        return {"healthy": True, "service": "openvoice-v2", "languages": ["en"]}

    @app.post("/profiles")
    def profiles(file: UploadFile = File(...)):
        with permit(slots), TemporaryDirectory(prefix="mczen-voice-") as directory:
            data = file.file.read(4_000_001)
            if len(data) > 4_000_000:
                raise HTTPException(413, "Reference is too large.")
            reference = Path(directory) / "reference.wav"
            reference.write_bytes(data)
            try:
                with wave.open(str(reference)) as audio:
                    samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2")
                    if (audio.getnchannels() != 1 or audio.getframerate() != 16000
                            or audio.getsampwidth() != 2 or not 6 <= audio.getnframes() / 16000 <= 120
                            or samples.size == 0
                            or np.sqrt(np.mean((samples.astype(np.float32) / 32768) ** 2)) < 0.003):
                        raise HTTPException(422, "Use a clean, audible 6–120 second mono 16 kHz reference.")
            except (wave.Error, EOFError) as error:
                raise HTTPException(422, "Invalid reference WAV.") from error
            verify_speech(samples)
            with torch.inference_mode():
                embedding = converter.extract_se([str(reference)])
            values = embedding.detach().cpu().numpy().astype("<f4")
            if values.size != 256 or not np.isfinite(values).all():
                raise HTTPException(500, "Speaker extraction returned an invalid embedding.")
            return {"embedding": base64.b64encode(values.tobytes()).decode("ascii")}

    @app.post("/convert")
    def convert(request: Conversion):
        target = torch.from_numpy(decode_embedding(request.embedding)).to(converter.device)
        with permit(slots), TemporaryDirectory(prefix="mczen-voice-") as directory:
            source = Path(directory) / "source.wav"
            output = Path(directory) / "output.wav"
            try:
                with requests.post(piper_url + "/synthesize", json={
                    "text": request.text, "language": "en", "voice": base_voice,
                    "rate": 1.0, "encoding": "pcm_s16le", "sampleRate": 16000, "stream": True,
                }, timeout=(5, 60), stream=True, allow_redirects=False) as response:
                    response.raise_for_status()
                    if response.status_code != 200:
                        raise HTTPException(503, "Base speech refused a redirect.")
                    pcm = bytearray()
                    for chunk in response.iter_content(16384):
                        pcm.extend(chunk)
                        if len(pcm) > 1_920_000:
                            raise HTTPException(502, "Base speech exceeds the audio limit.")
            except requests.RequestException as error:
                raise HTTPException(503, "Piper base speech is unavailable.") from error
            if not pcm or len(pcm) % 2:
                raise HTTPException(502, "Base speech is invalid.")
            with wave.open(str(source), "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(16000)
                audio.writeframes(pcm)
            with torch.inference_mode():
                source_se = converter.extract_se([str(source)])
                converter.convert(audio_src_path=str(source), src_se=source_se, tgt_se=target,
                                  output_path=str(output), message="@McZEN")
            return Response(output.read_bytes(), media_type="audio/wav",
                            headers={"Cache-Control": "no-store"})

    return app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoints", type=Path, required=True)
    parser.add_argument("--port", type=int, default=8004)
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    parser.add_argument("--base-voice", required=True, help="Installed English Piper voice whose model/dataset rights have been reviewed.")
    args = parser.parse_args()
    import torch
    from openvoice.api import ToneColorConverter

    torch.set_num_threads(4)
    converter = ToneColorConverter(str(args.checkpoints / "converter" / "config.json"), device=args.device)
    converter.load_ckpt(str(args.checkpoints / "converter" / "checkpoint.pth"))
    uvicorn.run(create_app(converter, torch, "http://127.0.0.1:8003", args.base_voice), host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
