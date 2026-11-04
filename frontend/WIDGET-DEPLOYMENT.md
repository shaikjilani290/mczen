# McZEN Widget — Setup and Deployment

## Install snippet

```html
<script src="https://YOUR-MCZEN-DOMAIN/widget.js" data-public-key="wk_..." defer></script>
```

Optional: `data-api-base="https://api.example.com"` if the API is not on the script's origin.

## Setup

1. Sign in at `#/admin` as a tenant admin → **Widget**.
2. Add the exact website origins (e.g. `https://example.com`; HTTPS only, no wildcards/paths).
3. Customize branding, tick **Widget enabled**, save, and copy the snippet.

The widget stays unavailable until enabled and the page origin is allow-listed. The public key only identifies the tenant; it grants no admin access. Rotating the key invalidates old embeds.

## Build / hosting

`npm run build` produces `dist/widget.js` (IIFE, Shadow DOM, no dependencies) after the main app. The reverse proxy must serve `/widget.js` and proxy `/api` to the backend. `/api/widget/public/*` uses open CORS without credentials; the per-tenant origin allowlist is enforced by the service.

## Environment

- `MCZEN_WIDGET_SESSION_SECRET` (≥32 chars): signs widget session tokens. If unset, a random per-process key is used and sessions end on restart.

## Limitations

- Widget rate limits, voice tickets, voice concurrency slots and resume metadata live in SharedState (Redis in production, process memory otherwise). The widget `inFlight` guard, live WebSockets, audio buffers and VAD/STT/TTS pipelines remain process-local.
- **Active voice sessions are not horizontally scalable.** A reconnect/resume only works on the instance that owns the session; route `/api/voice/stream` with sticky routing (or run a single instance). Text chat has no such restriction once Redis is configured.
- Widget voice (microphone, `mczen-voice.v1`) is shown only when `config.voice.available` is true, i.e. STT, TTS and VAD sidecars are healthy. It has not been verified with a real microphone or live sidecars. Voice uses a single-use origin-bound ticket from `POST /api/widget/public/voice-ticket`; no token appears in the WebSocket URL.
- Telugu is text-only: the mic is hidden for any language not in `config.voice.speechLanguages`.
- The widget's `speechLanguages` reflect the configured Piper voices (English, Hindi); the host page must allow microphone use (`Permissions-Policy: microphone`) and be served over HTTPS.