import argparse
import hashlib
from pathlib import Path
import re
import requests


VOICES = (
    "en_US-amy-medium",
    "en_US-lessac-medium",
    "en_GB-alan-medium",
    "en_GB-alba-medium",
    "hi_IN-pratham-medium",
    "hi_IN-priyamvada-medium",
)
PIPER_REVISION = "e7229f7d33a10e145e109b886d661984201ac3c4"
WHISPER_REVISION = "536b0662742c02347bc0e980a01041f333bce120"
SILERO_REVISION = "066409f3d9db45a30d21dfcbf9147826ffdd7052"


def download(url: str, destination: Path):
    if destination.exists():
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".download")
    print(f"Downloading {destination.name}", flush=True)
    with requests.get(url, stream=True, timeout=(15, 60), headers={"Accept-Encoding": "identity"}) as response:
        response.raise_for_status()
        expected = response.headers.get("content-length")
        etags = [item.headers.get("x-linked-etag", "").strip('"') for item in response.history]
        checksum = next((value for value in etags if re.fullmatch(r"[a-f0-9]{64}", value)), None)
        digest = hashlib.sha256()
        total = 0
        progress = 0
        with temporary.open("wb") as output:
            for block in response.iter_content(1024 * 1024):
                output.write(block)
                digest.update(block)
                total += len(block)
                if total - progress >= 32 * 1024 * 1024:
                    print(f"  {destination.name}: {total // (1024 * 1024)} MiB", flush=True)
                    progress = total
        if expected is not None and not response.headers.get("content-encoding") and total != int(expected):
            raise RuntimeError(f"Incomplete download: {destination.name}")
        if checksum is not None and digest.hexdigest() != checksum:
            raise RuntimeError(f"Model checksum mismatch: {destination.name}")
    temporary.replace(destination)


def download_silero(directory: Path):
    directory.mkdir(parents=True, exist_ok=True)
    for source, target in (
        ("src/silero_vad/data/silero_vad.onnx", "silero_vad.onnx"),
        ("LICENSE", "LICENSE"),
    ):
        url = f"https://raw.githubusercontent.com/snakers4/silero-vad/{SILERO_REVISION}/{source}"
        download(url, directory / target)


def main(directory: Path):
    directory.mkdir(parents=True, exist_ok=True)
    download_silero(directory / "silero")
    voices = directory / "piper"
    voices.mkdir(exist_ok=True)
    for voice in VOICES:
        locale, name, quality = voice.split("-")
        prefix = f"{locale[:2]}/{locale}/{name}/{quality}"
        for source, destination in (
            (f"{voice}.onnx", f"{voice}.onnx"),
            (f"{voice}.onnx.json", f"{voice}.onnx.json"),
            ("MODEL_CARD", f"{voice}.MODEL_CARD"),
        ):
            url = f"https://huggingface.co/rhasspy/piper-voices/resolve/{PIPER_REVISION}/{prefix}/{source}?download=true"
            download(url, voices / destination)
    for filename in ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt", "README.md"):
        url = f"https://huggingface.co/Systran/faster-whisper-small/resolve/{WHISPER_REVISION}/{filename}?download=true"
        download(url, directory / "whisper-small" / filename)
    print("All local speech models are ready.", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, required=True)
    main(parser.parse_args().directory.resolve())
