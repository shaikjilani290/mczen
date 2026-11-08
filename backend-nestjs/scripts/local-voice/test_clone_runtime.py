"""Contract tests with a mocked converter, not evidence that OpenVoice models are installed."""
import base64
from threading import BoundedSemaphore
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException
import numpy as np
from pydantic import ValidationError

from clone_server import Conversion, decode_embedding, verify_speech
from engine_capacity import permit


class CloneContractTests(unittest.TestCase):
    def test_embedding_is_fixed_size_finite_float32_not_pickle(self):
        samples = np.ones(256, dtype="<f4")
        encoded = base64.b64encode(samples.tobytes()).decode("ascii")
        result = decode_embedding(encoded)
        self.assertEqual(result.shape, (1, 256, 1))
        self.assertTrue(np.all(result == 1))
        for invalid in ["not-base64", base64.b64encode(b"pickle").decode("ascii"),
                        base64.b64encode(np.full(256, np.nan, dtype="<f4").tobytes()).decode("ascii")]:
            with self.assertRaises((HTTPException, ValueError)):
                decode_embedding(invalid)

    def test_english_only_and_no_caller_selected_paths_or_provider_urls(self):
        valid = dict(text="Hello", embedding=base64.b64encode(np.ones(256, dtype="<f4").tobytes()).decode("ascii"), language="en")
        self.assertEqual(Conversion(**valid).language, "en")
        for invalid in [dict(valid, language="te"), dict(valid, path="C:\\private"),
                        dict(valid, text="x" * 501), dict(valid, embedding="short")]:
            with self.assertRaises(ValidationError):
                Conversion(**invalid)

    def test_capacity_is_bounded_and_released_after_failure(self):
        slots = BoundedSemaphore(1)
        with permit(slots):
            with self.assertRaises(HTTPException) as busy:
                with permit(slots):
                    self.fail("Concurrent conversion should not be admitted")
            self.assertEqual(busy.exception.status_code, 503)
        with self.assertRaises(RuntimeError):
            with permit(slots):
                raise RuntimeError("model failed")
        with permit(slots):
            pass

    def test_reference_quality_checks_real_vad_contract_with_bounded_nonoverlapping_batches(self):
        calls = []

        def respond(_url, json, timeout, allow_redirects):
            self.assertFalse(allow_redirects)
            raw = base64.b64decode(json["audio"])
            self.assertLessEqual(len(raw), 14080)
            self.assertEqual(len(raw) % 640, 0)
            calls.append(json)
            return Mock(status_code=200, raise_for_status=lambda: None,
                        json=lambda: {"frames": [{"speech": True}] * (len(raw) // 640)})

        with patch("clone_server.requests.post", side_effect=respond):
            verify_speech(np.full(32000, 1000, dtype="<i2"))
        self.assertEqual(sum(len(base64.b64decode(call["audio"])) for call in calls), 64000)
        self.assertEqual(len({call["streamId"] for call in calls}), 1)

    def test_reference_without_speech_is_rejected(self):
        def respond(_url, json, timeout, allow_redirects):
            frames = len(base64.b64decode(json["audio"])) // 640
            return Mock(status_code=200, raise_for_status=lambda: None, json=lambda: {"frames": [{"speech": False}] * frames})
        with patch("clone_server.requests.post", side_effect=respond):
            with self.assertRaises(HTTPException) as silent:
                verify_speech(np.zeros(32000, dtype="<i2"))
            self.assertEqual(silent.exception.status_code, 422)


if __name__ == "__main__":
    unittest.main()
