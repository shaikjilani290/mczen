from collections import OrderedDict
from threading import Lock
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

import numpy as np
from pydantic import ValidationError

from server import Silero, TtsInput, VadInput, pcm16
from download_models import download


class FakeModel:
    def __init__(self):
        self.inputs = []

    def run(self, _outputs, inputs):
        self.inputs.append(inputs)
        return [np.array([[0.9]], dtype=np.float32), inputs["state"] + 1]


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.vad = Silero.__new__(Silero)
        self.vad.model = FakeModel()
        self.vad.streams = OrderedDict()
        self.vad.lock = Lock()

    def test_reframes_twenty_ms_without_padding_or_losing_samples(self):
        stream = str(uuid4())
        frame = np.ones(320, dtype=np.float32)
        first = self.vad.predict(stream, frame)
        self.assertEqual(first["probability"], 0)
        self.assertEqual(len(self.vad.model.inputs), 0)
        self.assertTrue(self.vad.predict(stream, frame)["speech"])
        self.assertEqual(self.vad.streams[stream]["pending"].size, 128)
        self.assertEqual(self.vad.model.inputs[0]["input"].shape, (1, 576))
        for _ in range(6):
            self.vad.predict(stream, frame)
        self.assertEqual(len(self.vad.model.inputs), 5)
        self.assertEqual(self.vad.streams[stream]["pending"].size, 0)

    def test_streams_do_not_share_context_or_recurrent_state(self):
        one, two = str(uuid4()), str(uuid4())
        for _ in range(4):
            self.vad.predict(one, np.ones(320, dtype=np.float32))
        self.vad.predict(two, np.zeros(320, dtype=np.float32))
        self.vad.predict(two, np.zeros(320, dtype=np.float32))
        inputs = self.vad.model.inputs[-1]
        self.assertFalse(inputs["state"].any())
        self.assertFalse(inputs["input"].any())
        self.assertEqual(self.vad.streams[one]["hidden"][0, 0, 0], 2)

    def test_expired_stream_state_is_removed(self):
        old, fresh = str(uuid4()), str(uuid4())
        self.vad.predict(old, np.zeros(320, dtype=np.float32))
        self.vad.streams[old]["seen"] -= 121
        self.vad.predict(fresh, np.zeros(320, dtype=np.float32))
        self.assertNotIn(old, self.vad.streams)

    def test_saturates_pcm_instead_of_wrapping(self):
        raw = pcm16(np.array([-2, -1, 0, 1, 2], dtype=np.float32))
        self.assertEqual(np.frombuffer(raw, dtype="<i2").tolist(), [-32768, -32768, 0, 32767, 32767])

    def test_rejects_non_session_stream_keys_and_invalid_audio_format(self):
        with self.assertRaises(ValidationError):
            VadInput(audio="", encoding="pcm_s16le", sampleRate=16000, channels=1, streamId="../other")
        with self.assertRaises(ValidationError):
            VadInput(audio="", encoding="wav", sampleRate=16000, channels=1, streamId=uuid4())

    def test_rejects_unsupported_speech_output_and_nonfinite_rate(self):
        request = dict(text="Hello", language="en", voice="en_US-amy-medium",
                       rate=1, encoding="pcm_s16le", sampleRate=16000, stream=True)
        with self.assertRaises(ValidationError):
            TtsInput(**{**request, "language": "te"})
        with self.assertRaises(ValidationError):
            TtsInput(**{**request, "rate": float("nan")})


class DownloadTests(unittest.TestCase):
    def response(self, headers, body):
        response = unittest.mock.MagicMock()
        response.__enter__.return_value = response
        response.headers = headers
        response.history = []
        response.iter_content.return_value = [body]
        return response

    def test_incomplete_file_is_not_promoted_to_ready(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "model.onnx"
            with patch("download_models.requests.get", return_value=self.response({"content-length": "100"}, b"bad")):
                with self.assertRaisesRegex(RuntimeError, "Incomplete download"):
                    download("https://example.invalid/model", target)
            self.assertFalse(target.exists())

    def test_decoded_response_is_not_compared_to_compressed_length(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "MODEL_CARD"
            response = self.response({"content-length": "5", "content-encoding": "gzip"}, b"decoded license")
            with patch("download_models.requests.get", return_value=response):
                download("https://example.invalid/license", target)
            self.assertEqual(target.read_bytes(), b"decoded license")

    def test_existing_download_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "model.onnx"
            target.write_bytes(b"existing")
            with patch("download_models.requests.get") as fetch:
                download("https://example.invalid/model", target)
            fetch.assert_not_called()
            self.assertEqual(target.read_bytes(), b"existing")


if __name__ == "__main__":
    unittest.main()
