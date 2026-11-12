# Phase 6H voice runtime

The backend exposes `/api/voice/stream` with `mczen-voice.v1`. The browser first
requests a 30-second, one-use, origin-bound ticket from `POST /api/voice/ticket`
with its normal authenticated HTTP request. It submits that ticket in the first
`voice.session.start` message; tickets are never placed in a URL, query string,
or log. The gateway consumes the ticket and verifies tenant membership and
assistant access before accepting mono PCM16/16 kHz input. Production must proxy
the HTTP endpoint and WebSocket upgrade through the same trusted origin; see
`frontend/VOICE-DEPLOYMENT.md`.
The transport rate limit is 40 audio packets/s. Current browser capture sends
100 ms / 3,200-byte PCM packets with acknowledged bounded backpressure. The
gateway batches complete 20 ms frames for VAD; it does not change the sample rate.

## Current local voice verification

These are synthetic-speech integration checks, not human microphone tests.
The existing `.env` was not changed and no credentials or remote host details
are recorded here.

- While the configured SSH forwards were available, authenticated GPU STT
  health reported `large-v3`, CUDA and `int8_float32`. A generated English
  Dhvaani WAV was transcribed through `/transcribe`; the transcript matched
  the generated phrase and the response matched the configured adapter
  contract. The 2.96-second clip reported 1.124 seconds of processing.
- Dhvaani health returned HTTP 200 and `/voices` listed `my_voice`. English,
  Hindi and Telugu synthesis requests returned WAV audio at 24 kHz. English
  generated audio completed Windows playback and matched its Whisper
  transcription. Hindi and Telugu generated clips produced only fragmentary
  Whisper transcripts, so their spoken-language accuracy is not verified.
- No GPU VAD forward was found. The local CPU Silero sidecar on port 8002
  passed real inference on generated speech (speech detected, probability
  0.888; five 20 ms frames; 6.9 ms native inference after warm-up).
- A separate local widget WebSocket test passed with CPU Piper, CPU
  Faster-Whisper `base.en`, local Silero and the deterministic knowledge
  engine. Text and voice returned identical catalogue answers and five
  sources; generated response audio completed Windows playback. The reported
  model was `website-knowledge-engine`, with Ollama fallback disabled. This
  verifies the local CPU path, not the remote GPU path.
- The full widget WebSocket round trip using GPU STT and Dhvaani remains
  unverified. The authorized forwards were re-established briefly; initial
  STT and Dhvaani health probes returned HTTP 200. While the local API and
  Silero VAD were brought up, ports 28000 and 28003 closed again before a new
  inference or widget voice session could run. The forwards could not be kept
  open for the test. The API's MySQL/audit/shared-state readiness and local
  VAD health both passed. No test conversation was created and no customer
  data was changed in this attempt.
- A local CPU Whisper-small attempt exceeded its 45-second client deadline;
  the cached English `base.en` model was then used for the successful local
  English test. No customer microphone audio was recorded.

The previously observed local forwards were `127.0.0.1:28000` to remote
loopback port 18000 (STT) and `127.0.0.1:28003` to remote loopback port 18003
(Dhvaani). These are temporary developer forwards, not production endpoints.
Keep them open through the full test before attempting the remote WebSocket
round trip; do not put SSH credentials or API keys in this document or
frontend configuration.

## Optional remote GPU STT

The existing adapter supports an explicitly configured remote Whisper endpoint
that conforms to its multipart and response contract; no second STT pipeline
is needed.

STT is still injected through the single `SPEECH_TO_TEXT` port. With no new
configuration, it delegates to the unchanged local Faster Whisper adapter,
including its existing URLs, timeouts, language handling and health checks.
The default production provider is **local**. No database or browser change is
needed. VAD, its 500 ms deadline, endpointing, TTS, AgentService and cart tools
are unaffected.

| Backend-only variable | Default | Meaning |
|---|---|---|
| `MCZEN_STT_PROVIDER` | `local` | `local` or explicit `remote` |
| `MCZEN_STT_URL` | none | Remote API base URL; `/transcribe` and `/health` are appended, preserving a base path |
| `MCZEN_STT_API_KEY` | none | Required remote bearer token; never put it in `VITE_*`, frontend config or URLs |
| `MCZEN_STT_TIMEOUT_MS` | `15000` | Remote request timeout, including response parsing; integer 1-120000 ms |
| `MCZEN_STT_FALLBACK_ENABLED` | `true` in remote mode | `false` disables local transcription/health fallback |

Remote mode validates its configuration at startup rather than silently treating
a typo or missing key as local mode. Unused remote settings are ignored in local
mode. Use the deployment's secret manager or process environment; do not commit
credentials or edit existing environment files just to test this integration.
For example, after securely provisioning `MCZEN_STT_API_KEY` in the backend
process environment:

```powershell
$env:MCZEN_STT_PROVIDER = 'remote'
$env:MCZEN_STT_URL = 'https://your-authorized-stt-tunnel.example'
$env:MCZEN_STT_TIMEOUT_MS = '15000'
$env:MCZEN_STT_FALLBACK_ENABLED = 'true'
npm run build
if ($LASTEXITCODE -eq 0) { npm run start:prod }
```

Only configure an endpoint authorized to receive the participating users'
audio. Unlike local mode, remote mode transmits utterances outside this
machine; obtain appropriate consent and verify the remote service's retention
and access policies. No live external upload is performed by the unit tests.
HTTPS is required except for loopback HTTP contract tests. URL credentials,
queries and fragments are rejected; redirects are not followed.

The gateway's existing PCM16LE/16 kHz/mono buffer is wrapped in a standard WAV
header for Whisper file decoding. Sample bytes remain identical: no
resampling, normalization, filtering, trimming or new recording is introduced.
The request is multipart `file=audio.wav` with `Authorization: Bearer ...`.
An explicit `en`, `hi` or `te` hint is sent as `language`; `auto` omits it.
The remote implementation must accept this optional form hint to preserve
explicit-language decoding. Correlation is sent as `x-mczen-request-id`.
The multipart boundary is generated by native fetch, not hardcoded.

HTTP 200 plus `success: true`, a nonblank transcript up to 8000 characters,
supported language and finite nonnegative `audio_duration`/`processing_time`
are required. The exact transcript and returned language become internal
`text`/`language`, `isFinal` follows the request, and seconds of
`processing_time` become `processingMs`. `speed`, `device`, `model` and
provider-specific fields such as `compute_type` are
informational, not trusted confidence scores or fabricated per-stage timings.
The API supplies no decoder-quality score: this integration cannot manufacture
the local provider's recognition-quality metadata. Existing downstream
transcript normalization and intent/security checks remain unchanged.

Remote calls use bounded concurrency (2 active / 8 waiting). Timeouts,
unavailability, non-200 or invalid JSON/results produce sanitized failure logs
and, when enabled, call local STT once with the original buffer, language,
signal and correlation ID. Remote errors never log keys, endpoint URLs,
response bodies, exception messages or transcripts. Session cancellation does
not start fallback. Local fallback still needs a working local STT sidecar;
its normal final-inference deadline is 45 seconds, in addition to the remote
attempt. Both-provider failure (including an empty fallback transcript) raises
`VoiceProviderError`, which the existing WebSocket manager surfaces as
`STT_UNAVAILABLE` or `VOICE_PROVIDER_TIMEOUT`, never a successful empty result.

The confirmed remote health contract is authenticated `GET {base}/health`;
HTTP 200 indicates reachability, not verified GPU inference accuracy.
Probes time out after at most 1500 ms and do not upload synthetic/customer
audio. With fallback enabled, local health may keep voice available when remote
health fails. The existing permission-protected `GET /api/voice/capabilities`
includes `providers.stt.configuredProvider`, `localFallbackEnabled` and the
remote `timeoutMs`. `healthy` means the configured routing policy has a usable
provider, not necessarily that remote is healthy. The compatibility engine ID
remains `faster-whisper-small-int8` so persisted assistant settings need no
migration. No secret or remote endpoint is exposed by this status.

Temporary tunnels are ephemeral. Update the securely provisioned process URL
and restart the backend when it changes. The token must match the deployment
serving that URL. Non-200 transcription responses additionally emit
`voice_remote_stt_http_failed` with only `requestId`, `status` and `durationMs`.
HTTP 401 means inference authentication was rejected; a successful health probe
does not override it. Cloudflare HTTP 530 can indicate a tunnel/origin routing
failure and should be investigated at the remote deployment, not by changing
audio processing or disabling VAD.

To verify remote use end to end, correlate `voice_remote_stt_timing` with the
same turn's final transcript and AgentService request. A successful browser
turn accompanied by `voice_remote_stt_failed` and local Whisper timing proves
fallback, not GPU inference. Use explicitly authorized generated audio for
transport checks; it does not establish human microphone accuracy.
Live language-hint accuracy, human recognition and remote data-retention
controls require their own acceptance evidence. See the current local voice
verification above for the tests performed against the discovered GPU
services and the remaining tunnel and multilingual-quality limitations.

## Local provider sidecars

### Opt-in local audio-path investigation

No recording is enabled by metadata diagnostics. For a development backend,
set process-only variables before starting it (do not edit existing environment
files):

```powershell
$env:NODE_ENV = 'development'
$env:MCZEN_AUDIO_DIAGNOSTICS = 'metadata'
npm run start:prod
```

Production `NODE_ENV=production` ignores the diagnostic flag. On a loopback
storefront only, append `?mczenAudioDiagnostics=metadata` to explicitly enable
browser metadata. It is not enabled on remote customer origins. Rebuild the
frontend SDK before testing modified capture code. Browser
`mczen:voice-connection` events with stages `audio_format` and `audio_levels`
contain no samples or device identifiers: physical track settings, the actual
AudioContext/worklet rate, and one-second source/resampled RMS, peak, clipping
and below-0.01-amplitude sample percentages. This silence measure is an amplitude
statistic, **not** a speech classifier or signal-to-noise estimate.

The browser can report a 48 kHz physical track and a 16 kHz AudioContext: browser
resampling precedes the worklet in that case. Worklet source metrics describe
the context input, not unprocessed hardware samples. Resampled metrics are
before PCM16 quantization. No original hardware recording is implied.
The existing ScriptProcessor fallback reports its format but does not produce
these worklet level windows.

Backend `voice_audio_diagnostics` logs and final transcript `audioDiagnostics`
contain cumulative accepted ingress PCM levels, packet anomaly counts, and
the exact concatenated final-STT PCM duration/levels. Sequence counters include
arrivals rejected by the existing duplicate/reorder/gap checks; audio levels
include only accepted payloads. Epochs are checked first. VAD onset/endpoint
use server monotonic timestamps, not browser wall clocks; transcript buffering
identifies preroll, VAD-positive speech and retained trailing silence. The close
summary includes detected packet anomalies even when a gap ends the session
before transcription. Packet gaps still fail closed; this flag does not conceal
loss, resample, trim, retry or change the 500 ms VAD deadline.

Each VAD HTTP call now carries a generated UUID `x-mczen-request-id`.
Client failures and slow service requests share it. The service records
AnyIO borrowed/total/waiting worker-token counts at middleware entry along with
dispatch, admission, processing and event-loop delay. Middleware entry is
**after** network/ASGI dispatch: these fields cannot measure prior OS starvation.
Nor does a pool snapshot prove the cause of a delay that happened later.
`sileroLockWaitMs` separately measures waiting for the recurrent-state lock;
`sileroInferenceMs` sums only native ONNX `run` calls. Both are subsets of the
broader processing duration. Slow HTTP completion logs also carry the UUID;
client failures report deadline overshoot rather than implying timers run
exactly on time. Native inference can continue after an HTTP cancellation.
The metadata URL opt-in survives in-memory widget cart navigation but is not
stored in cookies, localStorage or sessionStorage.

For a separately authorized developer only, the loopback STT executable also
supports `--temporary-recording-consent`. This is a startup CLI consent lease,
not a WebSocket/HTTP/customer flag; `NODE_ENV=production` rejects it.
Do **not** supply it without fresh consent from every participating speaker.
It saves only final STT input as PCM16/16 kHz mono in a newly created OS-temporary
directory, never original hardware audio, logs, database or uploads. The lease
expires after 30 minutes from startup, stops recording, and removes only its own
files; total quota is 10 MiB. Graceful shutdown also cleans up. An OS crash or
forced process kill can prevent in-process cleanup: the authorized operator must
remove the exact logged directory before sharing or archiving anything.
Raw recording is **off** for the current investigation: the human tester
explicitly selected metadata/transcripts only. Identical-recording human model
comparisons remain blocked by that choice, not replaced with generated speech.

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
The PowerShell helper permits native stderr while Uvicorn runs: INFO startup
messages are not startup failures. Nonzero process exit codes still throw,
and an existing port listener is never stopped or silently replaced.
Whisper warms up before opening its health endpoint and uses deterministic
greedy decoding on six CPU threads to limit local-demo latency. Measure
recognition quality on your own microphone; this is not a quality benchmark.
The default remains multilingual small/int8, six threads, two workers, beam 1.
An **experimental English-only base.en candidate** can be evaluated explicitly:

```powershell
& .\backend-nestjs\.local-voice\venv\Scripts\python.exe .\backend-nestjs\scripts\local-voice\download_models.py --directory .\backend-nestjs\.local-voice\models --english-model base.en
& .\backend-nestjs\scripts\local-voice\start.ps1 -Service stt -EnglishModel base.en
```

Stop the existing STT listener yourself before starting another. The optional
download is revision-pinned and uses the existing downloader; startup never
downloads models. This candidate uses four CPU threads only for explicit `en`
requests. Auto-detection and Hindi/Telugu still use the unchanged small model.
Both models are resident in this evaluation mode, so allow additional memory.
The existing wire engine identifier remains the compatibility profile
`faster-whisper-small-int8`; health `englishModel` and inference logs disclose
the actual English model. Do not infer the selected model from that legacy ID.
Return to the normal command without `-EnglishModel base.en` to use small for
all languages. Generated shopping samples showed faster base.en inference,
but the supervised human run had recognition failures. It has **not** been
promoted to the default or accepted for production accuracy.

STT logs and final transcript events now expose validated stage timings:
HTTP dispatch (including multipart parsing), PCM conversion, fail-fast engine
admission, inference, mel features, native encoder, decoding and postprocessing.
Encoder/decoder/feature measurements are request-local and are subsets of total
inference time, not additional durations to sum with it. Health separately
reports startup model load and warmup. No raw microphone samples are logged.
On Windows the VAD process gives only itself AboveNormal scheduling precedence
(never realtime) so brief speech detection can preempt CPU-bound inference.
STT/TTS stay Normal. Piper uses two-thread ONNX sessions and disables idle
spinning; Silero uses one thread without spinning. No timeout or decoding
accuracy setting is increased/reduced by this scheduling policy. Model cold
start can take minutes on a memory-constrained machine; wait for health rather
than starting duplicate listeners.
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
| STT | `VOICE_STT_URL=http://127.0.0.1:8001` | `GET /health`; `POST /transcribe` multipart fields `file` (raw PCM16), `encoding=pcm_s16le`, `sample_rate=16000`, `channels=1`, `partial`, `model`, optional `language`. Returns `{text, language: "en"|"hi"|"te", processingMs, timings, recognitionQuality}`. Quality includes decoder log/no-speech probabilities and aggregate RMS/peak/clipped fraction, not calibrated confidence or saved audio. |
| VAD | `VOICE_VAD_URL=http://127.0.0.1:8002` | `GET /health`; `POST /predict` JSON `{audio: base64, encoding: "pcm_s16le", sampleRate: 16000, channels: 1, streamId}` for complete 20 ms / 640-byte frames, up to 440 ms per batch. `streamId` is the server-created voice-session UUID. Returns `{speech, probability, frames, processingMs, queueMs, dispatchMs, eventLoopLagMs}`, with one ordered decision per frame. |
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
Providers that support partial recognition use the most recent three seconds of audio with one in-flight
request per session and a 12-second provider deadline suitable for local CPU
inference. They are rolling-window previews, not a complete transcript.
Final transcription still receives the full utterance and cancels the preview.
The synchronous local Whisper provider advertises `supportsPartial: false`:
an HTTP abort cannot cancel its native CPU inference, so previews are not
scheduled for it. Low-quality final recognition requests repetition without
calling agent/cart tools, while preserving the original transcript. Weighted
segment log probability below -1 or no-speech probability above 0.6 is a
rejection heuristic, not a proof of correctness for other transcripts.
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
  provider and avoids per-request API charges. The local adapter disables
  non-cancellable rolling-window previews. Telugu
  recognition quality and latency must be measured with the deployed model.
- **VAD: Silero local sidecar.** Keeps audio local and supplies a speech
  probability gate. Scheduling/dispatch deadline failures and actual concurrent
  measurements are documented in the latest final implementation report.
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