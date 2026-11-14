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

## Website integrations SDK

### Verified cart and checkout navigation

Pass the existing merchant-owned `cartAdapter` to `McZEN.init()`. Its `execute`
method must support `get_cart` as well as mutations and return the actual cart
snapshot. McZEN reads the cart before additions/removals, performs the mutation,
then independently reads it again. The backend checks product identity, stock,
prices, totals and the expected quantity change before returning success.
Navigation no longer happens inside the adapter's `openCart` acknowledgement.

Configure trusted destinations on the **backend**, using
`MCZEN_MERCHANT_NAVIGATION` (JSON keyed by integration UUID):

```dotenv
MCZEN_MERCHANT_NAVIGATION={"01974a11-3270-7da8-a3fc-c6a06fe90df0":{"cartUrl":"https://merchant.example/cart","checkoutUrl":"https://merchant.example/checkout"}}
```

Use the actual integration UUID and merchant-supported routes. Omit `checkoutUrl`
for cart-only merchants. Unconfigured integrations retain the existing `/cart`
route. Every configured destination must belong to the integration's exact origin;
production requires HTTPS. Restart the backend after changing this setting.
Browser-supplied destinations are not accepted as configuration.

Successful adds carry `cartOperation` and `navigationAction`; verified cart reads
open the cart. Removal/quantity updates never trigger navigation. The same fields
are sent in text responses and `voice.assistant.response`. English, Hindi and
Telugu confirmations use the selected/detected language, without asking the LLM
to claim transaction success.

The SDK checks the destination against the current merchant origin and deduplicates
operation IDs. It attempts a new tab without interrupting speech, and always
provides an **Open Checkout** / **Open Cart** fallback link in both chat and voice
views because popup blockers and `noopener` return values are browser-dependent.
Cookies/cart storage remain on the merchant origin; no session token is put in a URL.
Opening a cart or checkout never submits an order or payment.

The standalone React assistant uses the same navigation handler. It fails closed
unless `VITE_MERCHANT_ORIGIN` is explicitly configured at build time. That setting
does not create a merchant customer session: dashboard conversations without a
verified merchant binding still cannot operate a customer's cart.

### Voice choices and local voice-library status

The widget lists only backend-reported voices for the selected language. It stores
the nonsecret selected voice ID per assistant/language and passes it through the
existing voice ticket/session protocol. Changing voice or language stops the
current session; unavailable saved voices are reset with a visible default notice.
No ingestion key or voice-provider credential belongs in browser/Vite variables.

Admin **Voice settings** includes private consented recording upload, processing,
preview and activation controls. The local file-backed voice library is
**development-only** and rejects production use. Cloning is not provided by Piper:
the optional private OpenVoice V2 provider, its dependencies/weights, reviewed
base-voice rights and a consented reference recording must be provisioned first.
No cloned voice is advertised until its real profile is ready, previewed, active,
tenant-owned and its provider is healthy. See the latest implementation report for
verified scope, startup commands and outstanding production/human-voice checks.

The local synchronous Faster Whisper provider advertises
`partialTranscription: false`; final transcription remains enabled. Cancelling
HTTP previews cannot cancel that CPU inference, so previews are not queued
alongside the final utterance. Wait for Listening, not only the WebSocket server
acknowledgement, before speaking. Real VAD onset stops already-buffered old
playback; reconnect uses the fresh AudioContext's clock.

`mczen:voice-metrics` emits session/turn-correlated capture/queue, RTT, VAD, STT,
agent and TTS timings plus first/completed playback. These are diagnostic
software boundaries, not physical-speaker or human-accuracy measurements.

Final transcripts remain unchanged when recognition is uncertain. Local Whisper
decoder quality flags can cause an explicit repeat request without invoking
shopping tools. A clarification is not proof that the original phrase was
recognized. Actual microphone accuracy and audible playback need a human tester.

Register a website in **Admin → Website Integrations**, select an active assistant, and save the generated ingestion key in the website's server-side secret manager. The ingestion key is shown once and must never be shipped to a browser.

For browser chat and page tracking, install the public SDK:

```html
<script src="https://YOUR-MCZEN-DOMAIN/mczen-sdk.js"></script>
<script>
  McZEN.init({
    integrationKey: "mzp_...",
    assistantId: "ASSISTANT_UUID"
  });
</script>
```

The public site key is restricted to the exact registered origin. The SDK creates an origin-bound short-lived session and tracks page changes; it does not contain the server ingestion credential. `McZEN.init()` can be called again after client-side navigation configuration changes; the returned object also provides `trackPage()` for routers that use `history.pushState`.

Use the ingestion key only in an authorized server-side environment. Send `Authorization: Bearer <INGESTION_KEY>` with JSON requests to:

- `POST /api/website-ingestion/pages` — an array of page records.
- `POST /api/website-ingestion/products` — an array of structured product records.
- `POST /api/website-ingestion/batch` — `{ "pages": [], "products": [] }`.

The API upserts records by canonical page URL and external product ID. Page text is indexed into the existing McZEN knowledge base. Products remain structured catalog data and are queried by the website-specific assistant tools. Each request is limited to 50 pages or 100 products.

**Start sync** crawls the registered public origin, honors `robots.txt` disallow rules and same-origin links, reads sitemap locations, and indexes extracted page text. Private, loopback, link-local, and non-global IP addresses are rejected on every request and redirect. Private or authenticated pages must be supplied by an authorized server-side ingestion client instead.

### Voice connection and recovery diagnostics

The browser uses HTTP POST for signed sessions, product context and one-use
voice tickets, then `ws(s)://API/api/voice/stream` with subprotocol
`mczen-voice.v1` for PCM input, transcripts, responses and audio output (not SSE).
Tickets are sent in the first WebSocket message, never in a URL. Keep proxy
WebSocket upgrade support, sticky routing and idle timeouts longer than the
25-second server ping interval. GPU tunnel ports must stay loopback-only.

Public session endpoints, including `/api/website-integrations/product-context`,
use widget CORS; the service still validates the signed session and exact
registered merchant Origin. Do not add merchant origins to the dashboard
allowlist to work around an omitted public route. A product-context failure
before `/voice-ticket` is now labelled as a context synchronization error.

Transient socket disconnects obtain a fresh one-use ticket and redeem the
existing resume token. If the server rejects only the old resume metadata with
`SESSION_MISMATCH`, the client starts a new voice session using the authenticated
widget conversation. The backend releases only a disconnected session matching
the same tenant, visitor, assistant and conversation before claiming its slot.
Active sockets and different conversations/visitors cannot be taken over.
Authentication/Origin rejection stops retries; it never triggers identity
fallback. Expired widget authentication is surfaced explicitly. Audio and
in-flight work are not replayed after recovery.

Use `mczen:voice-connection` stage diagnostics and inspect the first failed
HTTP request before assuming STT, LLM or TTS failed. For manual verification,
reload the product page, start voice, wait for Listening, and say
"How do I use this product?" Confirm the exact final transcript, an assistant
reply, and completed audible playback. Generated-audio checks must first wait
for acknowledged capture packets; injecting speech before the capture path is
ready can lose initial words. Neither successful builds nor generated speech
establish human recognition or physical-speaker acceptance.

### Product detail context on JavaScript-rendered pages

The website SDK reads the current public product container, including hidden
`role="tabpanel"` content, specifications, product details/FAQs/reviews, and
expanded or collapsed `details` elements. It never clicks tabs or cart buttons,
reads forms, or sends the entire document. On SPA pages, mutations refresh the
captured sections; context is also synchronized before text turns and voice
tickets. Lazy content is included when the site renders it.

For pages whose inactive tabs are fetched only on activation, provide an async
`productContext` loader in `McZEN.init` that reads the merchant's existing public
product-detail API and returns all sections, without simulating user clicks:

```javascript
productContext: async () => ({
  externalProductId: currentProductId,
  productUrl: location.origin + location.pathname,
  name: currentProductName,
  sections: [
    { title: "Ingredients", content: suppliedIngredients },
    { title: "Usage", content: suppliedUsage }
  ]
})
```

Return `null` outside a product page. Omit sections not supplied by the merchant;
do not fabricate empty-tab contents, reviews, medical claims or dosages.
The default DOM reader supports `/product/:id` and `/products/:slug` containers
marked `data-mczen-product`, `.product-page`, or Product microdata. Other
templates can use the loader or mark their product sections with
`data-product-section`.

`POST /api/website-integrations/product-context` requires the existing signed
merchant session and exact Origin. The backend resolves the product URL within
that tenant/assistant/integration; page slugs cannot select another product.
It accepts at most 24 sections, 12000 characters per section, and 48000
characters total. Context expires after one hour and stays scoped to the visitor.
It does **not** change the imported product table, price, stock or availability,
nor does it grant ingestion or cart permissions. The existing detail tool
returns the stored record plus `pageContext` with source-labelled sections to
the agent. Product explanations and ingredient/usage follow-ups no longer use
the price-only shortcut; price-only and cart commands retain their deterministic
paths. The LLM must treat sections as source data, not instructions.

Persistent catalogue ingestion is still required. Static **Start sync** does not
execute JavaScript and must not be treated as a substitute for rendered context
or the merchant's authorised server-side product API export.

### Merchant-owned guest cart adapter

The SDK supports `cartAdapter` in the same `McZEN.init` call. It must use the
merchant's actual cart mechanism, not an independent McZEN cart. In `mcgen-rea`,
the existing installation passes `executeCartAction` from `src/lib/cart.ts`,
the current product's real ProductKey, and router navigation:

```javascript
cartAdapter: {
  execute: executeCartAction,
  selectedProductId: () => currentProductKey,
  openCart: () => navigate("/cart")
}
```

The signed widget session uses central
`POST /api/website-integrations/cart/poll` and `/cart/result`. No ingestion key or
merchant server credential is needed in the browser. Enable `add_to_cart`,
`get_cart`, `update_cart_item`, `remove_cart_item`, and `open_cart` for the correct
tenant and assistant through existing tool configuration. Product search/details
remain scoped to that merchant integration.

Product-detail follow-ups such as "this product detail explanation" and
"I need full description" retrieve the selected product by its recorded ID,
including uploaded rendered sections, rather than searching those phrases as
product names. Explicitly named different products still use catalogue search.
Full voice explanations allow up to 250 words to cover the supplied sections;
ordinary voice replies retain their 80-word limit. This does not correct
misrecognized product names: an ambiguous name must not silently select a
different catalogue item.
Voice product-name diagnostics preserve the provider's `rawText` alongside the
whitespace-normalized `text` in `voice.transcript.final`. Server logs contain
only lengths, catalogue-name/ID matches, recognition quality when supplied and
PCM metadata, not full transcripts or recordings. Optional
`MCZEN_AUDIO_DIAGNOSTICS=metadata` enables the existing ingress/segmented-audio
measurements without changing audio or VAD.

Detail requests resolve exact, merchant-scoped catalogue names before inference
and retrieve the corresponding ID through the normal validated tool executor.
Case/Unicode/punctuation normalization permits `HALE O` to match `HALE.O`, but
does not map `Genedge`, `Janet` or `EDGE` to `ZENAGE`. Unknown names require a
repeat. A retrieved different ID or a model answer naming another catalogue
product is rejected, including streamed sentences before playback.

Remote STT receives a bounded `initial_prompt` containing complete catalogue
names only if its `/openapi.json` advertises that string multipart field.
Faster-whisper supports `initial_prompt`, but an API accepting only `file` cannot
use this feature merely because NestJS sends extra fields. The current Paperspace
endpoint is file-only; recognition improvements require its existing handler to
forward that supported parameter. Local STT fallback remains unchanged.
Selected-product explanations use a compact grounding/safety prompt and the
complete current detail result without repeating prior conversation messages.
Conversation persistence is unchanged; this prevents old explanations from
crowding out tab content and the answer in small GPU model context windows.

Shopping intent routing distinguishes search, details, follow-ups, comparisons,
add/remove/update/view cart, checkout and ordinary conversation. Named products
must match one exact catalogue name before a detail or mutation request; an
unrelated full-text result cannot replace the requested product. Ingredient-only
questions quote recorded composition/ingredient sections directly. Comparisons
use the retrieved descriptions, prices, availability and stock; absent facts
remain unknown. These evidence-only paths do not need model inference.

Visitor-scoped SharedState retains bounded current/previous product IDs, current
name, last intent, successful cart action and pending product clarification for
one hour. Page selection is distinct from discussed selection: unchanged cart
polls cannot undo a named product request. "This" prefers the current page;
"it" uses the discussed selection; ordinal references use returned choices.
Search cards do not automatically replace the discussed product.

Voice final answers stream through the existing inference port using
OpenAI-compatible SSE or native Ollama NDJSON. Tool-bearing rounds remain
non-streaming so IDs, validation, permissions and results are settled before
speech. Completed final-answer sentences reach Piper and the existing PCM
WebSocket progressively, with streamed text displayed in the widget; the final
response retains the same metadata and product cards. Inference cancellation,
interruption, timeout and response/audio limits remain enforced. A truncated or
failed stream is an error, not a successful answer.

`LLM_PROVIDER`, `LLM_BASE_URL` and `LLM_MODEL` select the existing inference
service; CPU/GPU execution is chosen by that service's deployment, not by an
Ollama dependency in the voice pipeline. No GPU model or tunnel changes are
required. Diagnostics include `voice_agent_first_text` and `voice_first_audio`
(`endpointToFirstAudioMs`) to measure actual latency rather than infer it from
build success.

Cart delivery polling is demand-driven: no `/cart/poll` requests are sent simply
because the widget is open or idle. A text request first registers the adapter
and polls until its response finishes; active voice (including reconnect)
keeps delivery running. Voice stop, minimize, error and widget destruction stop
idle timers and abort any outstanding poll request. Text and voice share one
in-flight poll and one timer, with 750 ms between completed active polls.
An already-received cart operation finishes its read-back acknowledgement even
if voice stops, so stopping does not hide an uncertain mutation. A retried
acknowledgement reuses the existing operation result without repeating the write.

Misheard voice phrases such as "and to cut this product" request clarification
without changing the cart. A clear subsequent "Add this product to my cart" or
"Add to cart" uses the selected product and the existing verified merchant
operation. Ambiguous transcripts are not silently rewritten into purchases.

For `remove_cart_item`, optional whole `quantity` removes that many units;
omitting it removes the line. Apply relative removal atomically with the same
durable operation ID, not through an unprotected read followed by an absolute
quantity write. Replay must not subtract again.

`execute(action)` receives an idempotency `id`, `operation`, and, for mutations,
the actual imported `productId` with optional `variantId` and `quantity`.
It must validate the catalogue/availability, preserve other cart contents,
commit to the real cart, and return persisted read-back:

```javascript
{
  items: [{ productId, name, quantity, unitPrice, currency }],
  itemCount, total, currency, cartPath: "/cart"
}
```

Return catalogue values, never caller-supplied prices. Throw on failed
validation, storage or API operations. Persist operation IDs to prevent duplicate
additions across polling retries/reload. The SDK caches acknowledgements for
delivery retry and does not repeat a completed callback. After a mutation the SDK
independently calls `execute()` with `get_cart` and acknowledges that snapshot,
not the mutation callback's return value. For `open_cart`, `execute()` reads the
cart without navigating. Navigation waits for the backend-verified response;
the legacy `openCart()` callback is no longer used for this operation.

The supplied implementation is a persistent **browser guest cart**, not an
authenticated/server-authoritative cart or checkout. Recorded products have no
verified variants; invented variants and historical pack estimates are rejected.
Normal controls, quantity, totals and header counts use the same state. Checkout
remains disabled. Guest read-back must not authorize payments, fulfilment,
orders or inventory reservations.

Use the exact registered origin (the verified installation uses
`http://127.0.0.1:5173`, not an interchangeable `localhost` origin). Keep `/cart`
out of knowledge ingestion/page tracking. Inspect the cart after a timeout
before creating a new request; a committed change may have lost its
acknowledgement. Destroy the returned SDK instance when genuinely unmounting it
so polling and microphone resources stop.

### Local merchant development (no crawler)

The existing ingestion routes also accept locally generated JSON from an
authenticated server-side adapter. Loopback website origins require **both**
`NODE_ENV=development` and `MCZEN_ALLOW_LOCAL_INGESTION=1` in the McZEN backend
process. They are rejected in production even if the flag is set, and are
disabled by default in other environments. No crawler bypass is enabled.

Start/restart the backend with process-only settings (do not edit `.env`):

```powershell
Set-Location 'C:\Users\jilan\Downloads\mczen\backend-nestjs'
$env:NODE_ENV = 'development'
$env:MCZEN_ALLOW_LOCAL_INGESTION = '1'
npm run start:dev
```

Register the merchant's exact browser origin, e.g. `http://localhost:5173`, in
**Website Integrations**, select its assistant, and securely save the one-time
private ingestion credential. `localhost` and `127.0.0.1` are different origins.
For local integrations the dashboard disables crawler sync and shows adapter
instructions, persisted page/product counts, and indexing counts.

In a separate server-side terminal:

```powershell
Set-Location 'C:\Users\jilan\Desktop\mcgen-rea'
$env:NODE_ENV = 'development'
$env:MCZEN_ALLOW_LOCAL_INGESTION = '1'
$env:MCZEN_SITE_URL = 'http://localhost:5173'
$env:MCZEN_API_BASE_URL = 'http://127.0.0.1:3000'
npm run mczen:sync:local:dry-run
# No key or running website/API is needed for the dry-run.
$env:MCZEN_INGESTION_KEY = [System.Net.NetworkCredential]::new('', (Read-Host 'Private ingestion key' -AsSecureString)).Password
npm run mczen:sync:local
Remove-Item Env:\MCZEN_INGESTION_KEY
```

The worker reads `public/data/storefront.json`, `src/content/home.ts`, and
`src/content/information.ts` from the merchant project and posts JSON to the
existing McZEN `/products` and `/pages` ingestion routes. It never requests a
crawl or needs the Vite website running for ingestion. Authentication, strict
same-origin field validation, tenant/assistant scoping, upserts, and knowledge
indexing are unchanged.

Only opted-in local ingestion preserves source page query strings/fragments
(category query pages and `/#faq`) as distinct page identities; public-site
canonicalization and SDK tracking privacy rules are unchanged. Do not include
sensitive values in these development page URLs.

CLI output shows provider-confirmed accepted page/product counts and newly
indexed pages. Failures report safe HTTP/transport errors and previously
confirmed counts, not raw server response bodies or credentials. A timeout can
occur after server writes; reconcile dashboard/verification counts before
rerunning. Repeat imports upsert the same keys; unchanged pages need not be
reindexed. Refresh the dashboard to see persisted counts. Direct ingestion does
not run a crawler job or change its last-crawl timestamp/status.

The private key must never be assigned to any `VITE_*` variable or browser code.
The existing public `mzp_` key and assistant ID remain the only browser settings.

## Build / hosting

`npm run build` produces `dist/widget.js` and `dist/mczen-sdk.js` (IIFE, Shadow DOM, no dependencies) after the main app. The reverse proxy must serve both files and proxy `/api` to the backend. Public widget and website-session routes use open CORS without credentials; McZEN independently enforces the exact registered origin on every request.

## Environment

- `MCZEN_WIDGET_SESSION_SECRET` (≥32 chars): signs widget session tokens. If unset, a random per-process key is used and sessions end on restart.

## Local voice services

The backend does not launch speech engines automatically. With the existing
installed `.local-voice` runtime/models, run each command in its own PowerShell
terminal from `backend-nestjs`:

```powershell
.\scripts\local-voice\start.ps1 -Service stt
.\scripts\local-voice\start.ps1 -Service vad
.\scripts\local-voice\start.ps1 -Service tts
```

Default loopback health URLs are `http://127.0.0.1:8001/health` (STT),
`http://127.0.0.1:8002/health` (VAD), and `http://127.0.0.1:8003/health` (TTS).
The backend overrides are `VOICE_STT_URL`, `VOICE_VAD_URL`, `VOICE_TTS_URL`.
Piper synthesizes a complete sentence before emitting its first PCM chunk.
The adapter therefore divides long input into ordered pieces of at most
120 characters (smaller at speech rates below 1), preserving the answer while
keeping individual inference requests within the existing 12-second deadline.
Cancellation stops remaining pieces; real provider failures still surface as
playback errors rather than being reported as successful speech.
Wait for all three models to finish loading. To exercise real models:

```powershell
.\.local-voice\venv\Scripts\python.exe .\scripts\local-voice\smoke_test.py
```

This smoke test synthesizes English/Hindi speech and checks English recognition
and VAD; it is not a human-microphone conversation test. Also enable speech
and an installed voice for the desired language in the assigned assistant.
Installed Hindi voices do not override a disabled assistant language.

The public connect response's `config.voice.diagnostics` identifies unavailable
`stt`, `tts`, or `vad` dependencies, unavailable assistant settings, or no
supported speech language. It never includes provider URLs or exception details.
Health probes are cached for 15 seconds. After recovering a dependency, wait
for this cache and reload the merchant page to refresh initial capabilities.
Reloading starts a new in-memory widget session.

Allow microphone access in browser site permissions. HTTPS or loopback HTTP
and a microphone-permitting Permissions-Policy are required. The widget reports
these browser restrictions separately; microphone-denial errors are preserved
instead of being overwritten by WebSocket cleanup.

Connection and microphone startup have separate deadlines. The 12-second
connection deadline ends when `voice.session.started`/`resumed` arrives.
The widget then displays "Starting microphone — allow access if prompted…".
Microphone permission, AudioContext resume and worklet loading have a separate
60-second startup deadline, with a microphone-specific error if exceeded.
Late permission grants after timeout release their tracks rather than leaving
the microphone running. A real missing server acknowledgement still produces
the connection-timeout error; dependencies are not marked healthy by this change.

For startup failures, listen before clicking the microphone:

```javascript
window.addEventListener("mczen:voice-connection", ({ detail }) => console.info(detail));
```

The same diagnostics appear as `[McZEN:voice]` debug console entries.
They contain only a stage and elapsed milliseconds, never tickets, keys, URLs,
transcripts or credentials. Expected stages are `start_requested`,
`ticket_requested`, `ticket_received`, `websocket_connecting`, `websocket_open`,
`awaiting_session_ack`, `session_acknowledged`, `microphone_requested`,
`microphone_granted`, `audio_context_starting`, `worklet_loading`, `audio_ready`.
There is no separate `voice.ready` wire event: `voice.session.started` (or
`voice.session.resumed`) is the server acknowledgement, and `audio_ready`
indicates that browser capture is connected.

The ticket/connect HTTP phase now has an abortable 12-second deadline.
The existing WebSocket/acknowledgement deadline remains 12 seconds; its error
distinguishes a socket that never opened from a server that never acknowledged.
The gateway keeps its existing five-second startup deadline active through
authentication and asynchronous session creation, returning
`SESSION_START_TIMEOUT` instead of leaving an acknowledged TCP/WebSocket
connection waiting indefinitely. Cancelled starts release concurrency slots
and cannot attach a late-created session to a closed socket.

Backend stage logs use `widget_voice_ticket_stage`,
`widget_voice_capability_check`, `voice_connection_stage`,
`voice_session_start_stage`, and `voice_connection_timeout`. The last completed
stage distinguishes origin/session validation, assistant/conversation lookup,
health probes, shared-state slots, persistence and acknowledgement sending.

The current local merchant integration is registered for
`http://127.0.0.1:5173`, **not** `http://localhost:5173`. Live verification of
the latter returned 403 from `/connect`, as required by exact-origin security.
Use the registered origin; do not broaden production CORS or alias the two
origins. Both can use `/api/voice/stream` only with a ticket specifically issued
for their own registered origin. The public website routes have their own
origin-validation policy; adding a merchant to dashboard CORS is not a fix.

### Audio streaming diagnostics

Capture now uses an AudioWorklet on supported browsers, rather than doing
capture/resampling on the UI thread. The standalone SDK bundles its worklet as
a Blob module; the host CSP must permit Blob AudioWorklet modules. A load error
is explicit, not silently replaced by another capture implementation.
Browsers without AudioWorklet use the existing ScriptProcessor fallback.

The AudioContext requests 16 kHz, mono. The worklet preserves resampling phase
if the browser supplies a higher rate, converts to signed PCM16, and transfers
100 ms packets instead of repeatedly copying a growing Float32 backlog.
Two MessagePort packets may be outstanding; the worklet ring holds up to two
seconds. The main thread coalesces two delayed packets into 200 ms when needed
and schedules recovery against the last actual send (minimum 50 ms spacing),
not against a drifting polling timer.

The existing `mczen-voice.v1` 11-byte binary header is unchanged: direction,
epoch, sequence, byte length, then little-endian PCM16. Capture timestamps use
the AudioContext clock and local monotonic timing; acknowledgements correlate
packet sequences with server receive/processing timings without comparing
unsynchronized browser/server clocks.

The backend advertises `flowControl: "ack-v1"` on session start/resume. The
client permits only 16,000 unacknowledged PCM bytes (500 ms). `voice.audio.ack`
returns processed sequence, epoch, queue depth/duration, queue wait and VAD/
processing duration. `voice.audio.flow` pauses sends at a backend queue of
500 ms and acknowledgements resume them at 200 ms. Network congestion also
pauses sends. Queued audio stays ordered during these pauses.

Neither side silently evicts speech on overflow anymore. If the worklet ring
or backend's two-second hard limit is exhausted, voice stops with an explicit
error rather than submitting a segment with missing audio to STT. A genuine
within-epoch sequence gap likewise stops the session. Restart after resolving
CPU/network congestion. An epoch reset deliberately invalidates prior-turn
queued audio, as before.

VAD requests batch the packet's nonoverlapping 20 ms frames, returning one
decision per frame. The sidecar still reframes these into Silero's native
512-sample windows with its required 64-sample model context; new samples are
not repeatedly inferred in overlapping sliding windows. A 100 ms packet now
requires one HTTP round trip rather than five. Final STT runs asynchronously
and does not block the VAD ingress queue. Audio-end markers wait for queued
VAD, and the 20-second utterance limit matches the actual Whisper adapter.

Inspect timing metrics from the merchant browser console:

```javascript
window.addEventListener("mczen:voice-metrics", ({ detail }) => console.table(detail));
```

Snapshots are emitted approximately every five seconds and at final
transcription, without audio, credentials or transcript content. Fields include
capture mode/sample rates/channels, captured/sent durations, callback and
delivery time, capture queue/current maximum, chunk duration/bytes, sequence/
monotonic timestamp, WebSocket pending bytes/current maximum, ping/pong RTT,
unacknowledged packets, backend queue depth/duration, VAD and processing time,
STT time, and end-to-end transcription latency. `endToEndTranscriptionMs` uses
the detected first-speech sample's local capture clock through receipt of the
final transcript; `transcriptionLatencyMs` is the server's speech-onset-to-final
duration. STT timings are also logged under `voice_stt_timing`.

The local Whisper runtime remains CPU/int8 `whisper-small`, six CPU threads,
two workers, beam/best-of 1. Silero uses one ONNX thread. No GPU or new model
is required by this change. STT is utterance-based and can still take several
seconds on a shared CPU; healthy services do not imply sub-second transcription.

The backend still enforces 40 frames/second. Sequence continuity is validated
within each epoch; switching epochs deliberately discards stale frames and
starts a new sequence baseline. The client also discards unsent prior-epoch
audio. Fatal protocol/rate-limit rejections stop instead of automatically
reconnecting into the same failure.

`VOICE_AUDIO_PROCESSING_FAILED` indicates a failed live audio/VAD processing
operation, which may be transient even while health checks are passing. It does
not mean all three speech services have stopped. Backend logs include a safe
provider failure code. Actual failed startup health probes still fail closed.

VAD uses `POST /predict` on the `VOICE_VAD_URL` loopback origin (default
`http://127.0.0.1:8002`). JSON contains session UUID `streamId`, base64 `audio`,
`encoding: "pcm_s16le"`, `sampleRate: 16000`, `channels: 1`. Raw bytes must be
a positive multiple of 640, at most 14,080 / 440 ms. The response's `frames`
must contain one boolean `speech` / finite [0,1] `probability` decision per
20 ms input frame, in order.

The adapter admits two active requests and 16 queued. Its 500 ms total deadline
includes queueing and response JSON consumption, not just HTTP headers. The
sidecar admits two active batches and holds its shared model lock once per
batch. Requests beyond processing capacity are rejected explicitly, never
silently treated as silence. Do not retry timed-out batches automatically:
Silero state may already have advanced.

Look for `voice_vad_request_failed`: `phase` distinguishes validation, queue,
HTTP, response reading and response validation; `status` distinguishes 422
invalid input from 503 busy service. Timeout errors remain
`VOICE_PROVIDER_TIMEOUT`. Endpoint, method, byte count and duration are safe to
log; audio/base64 and raw provider response/error bodies are not. Successful
`voice_vad_request` diagnostics are sampled, with slow calls also included.
Python logs slow/error `/predict` durations without input bodies.

Test actual processing, without STT/TTS or database writes:

```powershell
cd C:\Users\jilan\Downloads\mczen\backend-nestjs
.\.local-voice\venv\Scripts\python.exe scripts\local-voice\smoke_test.py --vad-only
```

## Limitations

- Widget rate limits, voice tickets, voice concurrency slots and resume metadata live in SharedState (Redis in production, process memory otherwise). The widget `inFlight` guard, live WebSockets, audio buffers and VAD/STT/TTS pipelines remain process-local.
- **Active voice sessions are not horizontally scalable.** A reconnect/resume only works on the instance that owns the session; route `/api/voice/stream` with sticky routing (or run a single instance). Text chat has no such restriction once Redis is configured.
- Widget voice (microphone, `mczen-voice.v1`) is shown only when `config.voice.available` is true and the selected language/browser support speech. Real sidecars, an origin-bound widget ticket, synthetic speech through the existing agent, and generated TTS PCM playback have been tested. A complete human-microphone product conversation is not verified. Voice uses a single-use origin-bound ticket from `POST /api/website-integrations/voice-ticket` (website SDK) or `POST /api/widget/public/voice-ticket` (legacy widget); no token appears in the WebSocket URL.
- Telugu is text-only: the mic is hidden for any language not in `config.voice.speechLanguages`.
- The widget's `speechLanguages` are the intersection of assistant-enabled speech languages and Piper-supported languages (English, Hindi). Telugu has no configured Piper voice. The host page must allow microphone use and be served over HTTPS or loopback HTTP.