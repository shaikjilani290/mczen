# McZEN local development

This guide covers the existing local applications only. It does not configure production endpoints or use production credentials.

## Local services

| Component | Local address | Current verification |
|---|---|---|
| NestJS API | `http://127.0.0.1:3000` | Readiness endpoint returned `ready`; local MySQL-backed development mode |
| McZEN web frontend | `http://127.0.0.1:5174` | Vite project is configured for port 5174 and proxies `/api` to port 3000 |
| MySQL | `127.0.0.1:3308` | MySQL 8.4.13; database `mczen`; 13 migrations applied |
| Redis | Not required for the single-process local configuration | NestJS readiness uses the development in-memory shared-state provider |

The backend `.env` is machine-local and must not be committed. The backend startup script reads only its DB host and port, refuses a non-loopback DB host, and never prints credentials. It sets local JSON ingestion on, developer auth headers/tokens off, and Ollama fallback off.

## Start and check

In separate PowerShell windows:

```powershell
& 'C:\Users\jilan\Downloads\mczen\backend-nestjs\scripts\start-local.ps1'
& 'C:\Users\jilan\Downloads\mczen\scripts\start-website.ps1'
& 'C:\Users\jilan\Downloads\mczen\scripts\check-local.ps1'
```

The backend script requires an existing `backend-nestjs\.env` with loopback MySQL settings. If creating one for a new checkout, copy `.env.example` first and configure a local MySQL 8 account; do not replace an existing `.env`. The frontend starts on port 5174. Check the backend at `/api/health/ready`; the endpoint reports booleans and does not disclose connection details.

The Vite frontend in this repository is the assistant/dashboard project. The separate page previously seen on port 5173 is not a trusted source of current product, stock, price, or policy data.

## Website data and indexing

The current local database contains 16 active products, 25 active pages, and 34 knowledge chunks. Its website integration points at a loopback preview and its last sync failed; product records do not have upstream update timestamps. Treat prices and stock in that snapshot as historical, not live storefront facts, and do not treat preview policy text as official.

For explicitly provided local development content, use the authenticated JSON ingestion endpoint `/api/website-ingestion/batch` with the integration ingestion key in the expected header. Local JSON ingestion is enabled only with `NODE_ENV=development` and `MCZEN_ALLOW_LOCAL_INGESTION=1`. The crawler continues to reject loopback/private origins; do not relax SSRF protections to sync the preview site. Rebuild uses the existing index endpoint and does not change shopping records.

The no-LLM assistant remains the primary path. Product answers that depend on current prices or stock require a live commerce API/database source. This local snapshot is not a substitute for one. Ollama/Qwen is optional and disabled by the startup script.

## Voice services

The configured local Whisper STT and Dhvaani TTS sidecars were not listening during the latest local checks. The VAD adapter's local default is port 8002 and no service was listening there. Cached Whisper weights and English/Hindi Piper models exist, but there are no sidecar server entry points in this workspace; a Telugu Piper model was not found. The repository therefore cannot currently demonstrate real English, Hindi, or Telugu speech input/playback. Do not report voice as operational based on a health URL alone.

Start the actual configured Whisper, VAD, and Dhvaani services before testing voice; use the existing backend environment variables and keep them on loopback. `scripts/check-local.ps1` reports TCP availability only and does not claim model health or audio playback.

## Android

The existing Android app is in `C:\Users\jilan\Downloads\mczen-mobile-app`. Copy `local.properties.example` to `local.properties` only if no local file already exists. Never commit `local.properties` or share its widget key.

- Android emulator: `AI_BASE_URL=http://10.0.2.2:3000/`.
- Physical device: use the development computer's private LAN address, e.g. `http://192.168.x.x:3000/`; allow the backend port through the local firewall. `AI_ORIGIN` must still exactly match the origin registered for the local website integration.
- Debug builds permit cleartext only under the debug source set; application URL validation accepts emulator/loopback/private IPv4 hosts and rejects public HTTP hosts. Release networking remains HTTPS-only.
- Build and install: `.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug` then `.\gradlew.bat :app:installDebug`; launch the installed app on an available emulator/device.

The Android catalogue endpoint is now configurable and defaults to the emulator-local backend, not `api.mczen.in`. However, the current NestJS application does not implement the Android app's legacy `/api/v1/dashboard/getFirstPage`, `/category/get`, `/product/get`, and `/product/detail/get` commerce routes. The local DB snapshot also has no upstream freshness timestamp, so it must not be exposed as live price/stock. Consequently, catalogue, product details, login, and cart still need a genuine local commerce/auth API before end-to-end shopping can be claimed. No real cart or customer record should be changed during tests.

Debug variants intentionally blank the Shopify domain and token even if those values exist in `local.properties`; Shopify account/cart calls fail locally rather than reaching a production store. The app's current commerce API contract is not implemented by this NestJS backend.

To use a physical device, the computer and device must be on the same trusted private network; obtain the computer's LAN address locally rather than hardcoding it in source. For local images, set `MCZEN_IMAGE_BASE_URL` only when the local commerce API serves compatible image keys. Blank image configuration intentionally avoids the production CDN.

## Future production preparation (not deployed)

Production setup is intentionally out of scope. Before a future release, operators must supply the public website/API domains, VPS access, HTTPS/WSS and proxy configuration, production DB settings, reachable GPU-backed speech services, and a private Android release-signing keystore. Keep those values in deployment secrets or ignored local configuration, never in source control or this development setup.
