# Phase 6H voice runtime

The backend exposes `/api/voice/stream` with `mczen-voice.v1`. The browser first
requests a 30-second, one-use, origin-bound ticket from `POST /api/voice/ticket`
with its normal authenticated HTTP request. It submits that ticket in the first
`voice.session.start` message; tickets are never placed in a URL, query string,
or log. The gateway consumes the ticket and verifies tenant membership and
assistant access before accepting mono PCM16/16 kHz input. Production must proxy
the HTTP endpoint and WebSocket upgrade through the same trusted origin; see
`frontend/VOICE-DEPLOYMENT.md`.
The transport rate limit is 40 audio frames/s; send roughly 25 ms PCM chunks
(800 bytes) or fewer. The gateway repacks audio into 20 ms frames for VAD.

## Local provider sidecars

### Windows local-demo setup

Python 3.12 and internet access are required for initial installation. From
the repository root:

```powershell
& .\backend-nestjs\scripts\local-voice\setup.ps1
```

This creates an isolated Python environment and downloads multilingual
Whisper small, Silero ONNX, and the six configured Piper voices into
`backend-nestjs/.local-voice/` (Git-ignored). Model repository revisions are
pinned in the downloader; Piper model cards and the Silero license are kept
beside the downloads. Review those licenses before redistribution or use
beyond this local demo. Piper's Python runtime is GPL-licensed.
Installation can take several minutes and requires roughly 1-2 GB of disk
space for models, plus Python dependencies. No existing environment file is changed.

Run each service in its own PowerShell terminal:

```powershell
& .\backend-nestjs\scripts\local-voice\start.ps1 -Service stt
& .\backend-nestjs\scripts\local-voice\start.ps1 -Service vad
& .\backend-nestjs\scripts\local-voice\start.ps1 -Service tts
```

Use Ctrl+C in each terminal to stop it. Services bind only to `127.0.0.1`
on the default ports below, load models before reporting healthy, and never
download at runtime. Start the backend with the current source, then refresh
the frontend. No migration is needed for sidecar startup.
Whisper warms up before opening its health endpoint and uses deterministic
greedy decoding on six CPU threads to limit local-demo latency. Measure
recognition quality on your own microphone; this is not a quality benchmark.
The same commands are available as `Local voice: STT`, `Local voice: VAD`
and `Local voice: TTS` in VS Code's **Terminal > Run Task** menu.

Verify actual inference (generates speech in memory, detects it, then
transcribes it; does not record a microphone or save audio):

```powershell
& .\backend-nestjs\.local-voice\venv\Scripts\python.exe .\backend-nestjs\scripts\local-voice\smoke_test.py
& .\backend-nestjs\.local-voice\venv\Scripts\python.exe -m unittest discover -s .\backend-nestjs\scripts\local-voice -p test_runtime.py
```

These are local demo services, not an authenticated public deployment.
The backend must use the documented default STT engine ID and URLs for this
setup; existing custom URLs are not changed automatically.

Sidecars bind to loopback only. These environment variable names are optional;
the defaults are shown. Do not expose these HTTP services on a public interface.

| Purpose | URL | Contract |
| --- | --- | --- |
| STT | `VOICE_STT_URL=http://127.0.0.1:8001` | `GET /health`; `POST /transcribe` multipart fields `file` (raw PCM16), `encoding=pcm_s16le`, `sample_rate=16000`, `channels=1`, `partial`, `model`, optional `language`. Return JSON `{text, language: "en"|"hi"|"te", confidence?}`. |
| VAD | `VOICE_VAD_URL=http://127.0.0.1:8002` | `GET /health`; `POST /predict` JSON `{audio: base64, encoding: "pcm_s16le", sampleRate: 16000, channels: 1, streamId}` for exactly 20 ms / 640-byte frames. `streamId` is the server-created voice-session UUID. Return `{speech: boolean, probability: number}`. |
| TTS | `VOICE_TTS_URL=http://127.0.0.1:8003` | `GET /health`; `POST /synthesize` JSON `{text, language, voice, rate, encoding: "pcm_s16le", sampleRate: 16000, stream: true}`. The sidecar resamples Piper output server-side and streams raw PCM16 bytes with headers `x-audio-encoding: pcm_s16le`, `x-audio-sample-rate: 16000`. Request cancellation aborts the stream. |

Unavailable sidecars fail session initialization with a safe service error.
The dashboard displays an explicit instruction to start STT, VAD and TTS
when startup reports `VOICE_ENGINE_UNAVAILABLE` or closes with code `4503`.
Successful ticket issuance and WebSocket upgrade do not establish engine
readiness; check the authenticated `/api/voice/capabilities` provider health.
STT concurrency is capped at two active requests with a bounded wait queue; TTS
streams hold one of two bounded engine permits until completion or cancellation.
Session audio is transient in memory; no raw audio is written to MySQL or logs.
Endpoint detection starts the transcription/response task without blocking
the microphone drain, so incoming silence and barge-in frames continue to
be processed while the assistant is working.
Live captions use the most recent three seconds of audio with one in-flight
request per session and a 12-second provider deadline suitable for local CPU
inference. They are rolling-window previews, not a complete transcript.
Final transcription still receives the full utterance and cancels the preview.
Final recognition has a separate 45-second deadline because measured CPU
requests on the demo machine sometimes exceed 30 seconds under load. This is
a bounded tolerance for CPU latency, not a real-time performance guarantee.
During final recognition the server sends `voice.assistant.thinking` with
`hint: "transcribing"`; dashboard and widget display a distinct transcription
status instead of continuing to say "Listening". Keep the tab visible and
the session running until the reply arrives. Stop session cancels the turn.
The included Silero service reframes 20 ms input into 32 ms inference windows
and keeps recurrent state separately for each session UUID. Pending audio and
state expire after 120 seconds without a frame, with at most 128 streams.
Do not run multiple VAD workers or share recurrent state across sessions.

## Provider decision and verification limits

- **STT: faster-whisper local sidecar.** Avoids sending audio to an external
  provider and avoids per-request API charges. The adapter exposes rolling
  window partial captions, not native incremental recognition. Telugu
  recognition quality and latency must be measured with the deployed model.
- **VAD: Silero local sidecar.** Keeps audio local and supplies a speech
  probability gate. No latency or CPU benchmark has been run in this repo.
- **TTS: Piper local sidecar.** Local synthesis avoids per-request API charges;
  configured English and Hindi voices include male and female choices. Piper
  has no configured Telugu voice here, so Telugu sessions return text without
  speech. Voice naturalness and real-time throughput require listening and
  hardware tests.

Provider adapter and orchestration unit tests use mocks. The optional local
smoke test above checks real model inference and provider contracts, but does
not prove microphone compatibility, multilingual recognition quality, speech quality,
real-time latency, reconnect behavior over a real network, or hardware capacity.

## Migration and checks

`VoiceRuntime1740000000010` is additive and registered after migration 9. It
has **not** been run by the application. Migrations 8 and 9 are still pending
on the VPS; do not apply migration 10 there until those prerequisites, the
backup, and production approval are confirmed. Migration execution remains
manual; `synchronize` is disabled.

For a local database explicitly approved for migration testing, inspect
`npm run migration:show`, verify migrations 8 and 9 are applied and migration
10 is pending, then run the reviewed migration command only after approval.
Verify the two voice tables, assistant voice-setting columns, composite
tenant-aware foreign keys, and `voice_session_events` enum before smoke tests.


## Scalability (Phase 6K)

Voice tickets, rate limits, concurrency slots and resume metadata use SharedState (Redis or memory). Live sockets, audio buffers, epochs and STT/VAD/TTS pipelines are per-process. A resume on a different instance than the one holding the session fails safely (`SESSION_MISMATCH`). **Active voice sessions are not horizontally scalable**; use a single instance or sticky routing for `/api/voice/stream`. If shared state is unavailable, new sessions fail closed (close code 4503).

Widget (anonymous) sessions: the ticket binds tenant, widget session, assistant, conversation and origin; the client cannot override assistant or conversation. Permissions are limited to `knowledge:read`, `products:read` and `inventory:read`.