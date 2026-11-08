import atexit
import logging
import os
from pathlib import Path
import tempfile
from threading import Lock, Timer
import time
from uuid import uuid4


class TemporaryAudio:
    """Local developer consent lease, never an HTTP/customer-controlled switch."""

    def __init__(self, consent=False, ttl_seconds=1800):
        if consent and os.environ.get("NODE_ENV") == "production":
            raise ValueError("Temporary voice recording is forbidden in production.")
        if not 0 < ttl_seconds <= 1800:
            raise ValueError("Recording lease must expire within 30 minutes.")
        self.lock = Lock()
        self.directory = Path(tempfile.mkdtemp(prefix="mczen-voice-consented-")) if consent else None
        self.expires = time.monotonic() + ttl_seconds
        self.remaining = 10 * 1024 * 1024
        self.files = []
        self.timer = None
        if consent:
            logging.getLogger("uvicorn.error").warning(
                "Explicit developer recording consent: local PCM at %s; expires in %s seconds; do not archive.",
                self.directory, ttl_seconds,
            )
            self.timer = Timer(ttl_seconds, self.close)
            self.timer.daemon = True
            self.timer.start()
            atexit.register(self.close)

    def save(self, raw):
        with self.lock:
            if self.directory is None or time.monotonic() >= self.expires:
                return
            if len(raw) > self.remaining:
                logging.getLogger("uvicorn.error").warning("Temporary diagnostic audio quota exhausted; recording skipped.")
                return
            destination = self.directory / f"{uuid4()}.pcm"
            destination.write_bytes(raw)
            self.files.append(destination)
            self.remaining -= len(raw)

    def close(self):
        with self.lock:
            if self.timer:
                self.timer.cancel()
            if self.directory is not None:
                # Only UUID files owned by this lease, never broad recursive cleanup.
                for file in self.files:
                    file.unlink(missing_ok=True)
                self.directory.rmdir()
                self.directory = None
                self.files.clear()
