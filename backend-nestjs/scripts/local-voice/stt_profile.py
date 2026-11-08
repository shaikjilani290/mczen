from contextlib import contextmanager
from threading import local
from time import perf_counter

from faster_whisper import WhisperModel


class TimedFeatures:
    def __init__(self, extractor, measure):
        self.extractor = extractor
        self.measure = measure

    def __getattr__(self, name):
        return getattr(self.extractor, name)

    def __call__(self, *args, **kwargs):
        with self.measure("featureMs"):
            return self.extractor(*args, **kwargs)


class ProfiledWhisperModel(WhisperModel):
    """Request-local timings; native encoder/decoder calls remain unchanged."""

    def __init__(self, *args, **kwargs):
        self.profile = local()
        super().__init__(*args, **kwargs)
        self.feature_extractor = TimedFeatures(self.feature_extractor, self.measure)

    @contextmanager
    def measure(self, key):
        started = perf_counter()
        try:
            yield
        finally:
            timings = getattr(self.profile, "timings", None)
            if timings is not None:
                timings[key] = timings.get(key, 0.0) + (perf_counter() - started) * 1000

    @contextmanager
    def profiling(self):
        previous = getattr(self.profile, "timings", None)
        timings = {"featureMs": 0.0, "encoderMs": 0.0, "decoderMs": 0.0}
        self.profile.timings = timings
        try:
            yield timings
        finally:
            self.profile.timings = previous

    def encode(self, *args, **kwargs):
        with self.measure("encoderMs"):
            return super().encode(*args, **kwargs)

    def generate_with_fallback(self, *args, **kwargs):
        with self.measure("decoderMs"):
            return super().generate_with_fallback(*args, **kwargs)
