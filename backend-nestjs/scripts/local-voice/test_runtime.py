from collections import OrderedDict
from threading import Lock
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4
from threading import local, Thread
from contextlib import contextmanager
from io import BytesIO

import numpy as np
from pydantic import ValidationError

from server import Silero, TtsInput, VadInput, pcm16, recognition_quality, cpu_session_options, create_app
from download_models import download
from stt_profile import ProfiledWhisperModel, TimedFeatures
from temporary_audio import TemporaryAudio
import os
import time


class FakeModel:
    def __init__(self):
        self.inputs = []

    def run(self, _outputs, inputs):
        self.inputs.append(inputs)
        return [np.array([[0.9]], dtype=np.float32), inputs["state"] + 1]


class RuntimeTests(unittest.TestCase):
    def test_temporary_audio_needs_consent_and_expires_without_continued_capture(self):
        disabled = TemporaryAudio()
        disabled.save(b"not stored")
        self.assertIsNone(disabled.directory)
        with patch.dict(os.environ, {"NODE_ENV": "production"}):
            with self.assertRaises(ValueError):
                TemporaryAudio(consent=True)
        recorder = TemporaryAudio(consent=True, ttl_seconds=0.1)
        directory = recorder.directory
        try:
            recorder.save(b"\x00\x00" * 320)
            self.assertEqual(len(list(directory.iterdir())), 1)
            deadline = time.monotonic() + 2
            while directory.exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertFalse(directory.exists())
            recorder.save(b"expired")
            self.assertIsNone(recorder.directory)
        finally:
            recorder.close()

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

    def test_batch_keeps_nonoverlapping_windows_in_exact_sample_order(self):
        stream = str(uuid4())
        audio = np.arange(1600, dtype=np.float32)
        for offset in range(0, audio.size, 320):
            self.vad.predict(stream, audio[offset:offset + 320])
        windows = [entry["input"][0, 64:] for entry in self.vad.model.inputs]
        self.assertEqual(len(windows), 3)
        np.testing.assert_array_equal(np.concatenate(windows), audio[:1536])
        np.testing.assert_array_equal(self.vad.streams[stream]["pending"], audio[1536:])

    def test_batch_holds_one_model_lock_and_matches_individual_frame_decisions(self):
        class CountingLock:
            def __init__(self):
                self.entries = 0

            def __enter__(self):
                self.entries += 1

            def __exit__(self, *_args):
                pass

        self.vad.lock = CountingLock()
        stream = str(uuid4())
        audio = np.arange(1600, dtype=np.float32)
        profile = {}
        decisions = self.vad.predict_batch(stream, audio, profile=profile)
        self.assertGreaterEqual(profile["sileroLockWaitMs"], 0)
        self.assertGreater(profile["sileroInferenceMs"], 0)
        self.assertEqual(self.vad.lock.entries, 1)
        self.assertEqual(len(decisions), 5)
        self.assertEqual(decisions[0]["probability"], 0)
        self.assertTrue(all(result["speech"] for result in decisions[1:]))
        windows = [entry["input"][0, 64:] for entry in self.vad.model.inputs]
        np.testing.assert_array_equal(np.concatenate(windows), audio[:1536])

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

    def test_cpu_onnx_sessions_do_not_spin_or_create_unbounded_pools(self):
        options = cpu_session_options(2)
        self.assertEqual(options.intra_op_num_threads, 2)
        self.assertEqual(options.inter_op_num_threads, 1)
        self.assertEqual(options.get_session_config_entry("session.intra_op.allow_spinning"), "0")
        self.assertEqual(options.get_session_config_entry("session.inter_op.allow_spinning"), "0")

    def test_recognition_quality_is_not_a_fabricated_confidence_probability(self):
        segment = lambda logprob, silence: SimpleNamespace(start=0, end=2, avg_logprob=logprob, no_speech_prob=silence)
        self.assertTrue(recognition_quality([segment(-0.2, 0.01)])["reliable"])
        self.assertEqual(recognition_quality([segment(-1.1, 0.01)])["reason"], "low_log_probability")
        self.assertEqual(recognition_quality([segment(-0.2, 0.7)])["reason"], "likely_no_speech")
        self.assertEqual(recognition_quality([]), {"reliable": False, "reason": "no_speech"})

    def test_microphone_diagnostics_report_silence_and_clipping_without_retaining_audio(self):
        silent = recognition_quality([], np.zeros(320, dtype=np.float32))
        self.assertEqual(silent["audioRms"], 0)
        self.assertEqual(silent["clippedFraction"], 0)
        clipped = recognition_quality([], np.array([0, 1, -1, 0], dtype=np.float32))
        self.assertEqual(clipped["audioPeak"], 1)
        self.assertAlmostEqual(clipped["audioRms"], 2 ** -0.5)
        self.assertEqual(clipped["clippedFraction"], 0.5)

    def test_feature_profiling_preserves_samples_and_extractor_attributes(self):
        class Extractor:
            sampling_rate = 16000

            def __call__(self, audio, **kwargs):
                return audio

        model = ProfiledWhisperModel.__new__(ProfiledWhisperModel)
        model.profile = local()
        features = TimedFeatures(Extractor(), model.measure)
        audio = np.arange(640, dtype=np.float32)
        with model.profiling() as stages:
            self.assertIs(features(audio, chunk_length=None), audio)
        self.assertEqual(features.sampling_rate, 16000)
        self.assertGreaterEqual(stages["featureMs"], 0)
        self.assertEqual(stages["encoderMs"], 0)
        self.assertIsNone(model.profile.timings)

    def test_candidate_is_english_only_and_preserves_pcm_and_fallback(self):
        created = []

        class FakeWhisper:
            def __init__(self, path, **kwargs):
                self.path = path
                self.received = []
                created.append(self)

            @contextmanager
            def profiling(self):
                yield {"featureMs": 1.0, "encoderMs": 2.0, "decoderMs": 3.0}

            def transcribe(self, audio, **kwargs):
                self.received.append((audio.copy(), kwargs))
                segment = SimpleNamespace(text=" Open my cart.", start=0, end=1,
                                          avg_logprob=-0.2, no_speech_prob=0.01)
                return iter([segment]), SimpleNamespace(language=kwargs["language"] or "en", language_probability=0.95)

        with patch.dict(os.environ, {}, clear=True), patch("stt_profile.ProfiledWhisperModel", FakeWhisper):
            app = create_app("stt", Path("models"), english_model="base.en")
        endpoint = next(route.endpoint for route in app.routes if route.path == "/transcribe")
        original = np.arange(-320, 320, dtype="<i2")
        request = SimpleNamespace(state=SimpleNamespace(received_at=0), headers={})
        for language in ("en", "hi", "te", None):
            result = endpoint(request=request, file=SimpleNamespace(file=BytesIO(original.tobytes())),
                              encoding="pcm_s16le", sample_rate=16000, channels=1,
                              partial=False, model="faster-whisper-small-int8", language=language,
                              initial_prompt="Product names: ZENAGE, HALE.O.")
            self.assertEqual(result["text"], "Open my cart.")
            self.assertEqual(result["languageProbability"], 0.95)
            selected = created[1] if language == "en" else created[0]
            audio, options = selected.received[-1]
            np.testing.assert_array_equal(audio, original.astype(np.float32) / 32768)
            self.assertFalse(options.get("vad_filter", False))
            self.assertEqual(options["beam_size"], 5)
            self.assertEqual(options["temperature"], [0.0, 0.2, 0.4])
            self.assertFalse(options["condition_on_previous_text"])
            self.assertEqual(options["initial_prompt"], "Product names: ZENAGE, HALE.O.")
            self.assertEqual(result["timings"]["encoderMs"], 2)
            self.assertTrue(all(value >= 0 for value in result["timings"].values()))
        self.assertIn("whisper-small", created[0].path)
        self.assertIn("whisper-base.en", created[1].path)
        with patch.dict(os.environ, {"VOICE_STT_BEAM_SIZE": "3"}), patch("stt_profile.ProfiledWhisperModel", FakeWhisper):
            configured_app = create_app("stt", Path("models"))
        endpoint = next(route.endpoint for route in configured_app.routes if route.path == "/transcribe")
        endpoint(request=request, file=SimpleNamespace(file=BytesIO(original.tobytes())),
                 encoding="pcm_s16le", sample_rate=16000, channels=1,
                 partial=False, model="faster-whisper-small-int8", language="en", initial_prompt=None)
        self.assertEqual(created[-1].received[-1][1]["beam_size"], 3)
        self.assertIsNone(created[-1].received[-1][1]["initial_prompt"])
        schema = configured_app.openapi()["components"]["schemas"]
        transcribe_schema = next(value for key, value in schema.items() if key.startswith("Body_transcribe"))
        self.assertEqual(transcribe_schema["properties"]["initial_prompt"]["anyOf"][0]["maxLength"], 200)

    def test_stt_beam_size_rejects_invalid_configuration(self):
        for value in ("0", "-1", "invalid"):
            with self.subTest(value=value), patch.dict(os.environ, {"VOICE_STT_BEAM_SIZE": value}):
                with self.assertRaises(ValueError):
                    create_app("stt", Path("models"))

    def test_profile_wrapper_inherits_transcribe_without_discarding_options(self):
        from faster_whisper import WhisperModel

        self.assertIs(ProfiledWhisperModel.transcribe, WhisperModel.transcribe)

    def test_stt_profiling_is_request_local_and_cleans_up_on_failure(self):
        model = ProfiledWhisperModel.__new__(ProfiledWhisperModel)
        model.profile = local()
        thread_results = []

        def other_request():
            with model.profiling() as timings:
                timings["encoderMs"] = 42
                thread_results.append(timings)

        with model.profiling() as timings:
            thread = Thread(target=other_request)
            thread.start()
            thread.join()
            self.assertEqual(timings["encoderMs"], 0)
        self.assertEqual(thread_results[0]["encoderMs"], 42)
        with self.assertRaisesRegex(RuntimeError, "inference failed"):
            with model.profiling():
                with model.measure("encoderMs"):
                    raise RuntimeError("inference failed")
        self.assertIsNone(model.profile.timings)


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
