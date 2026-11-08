# McZEN Website Integration — Final Implementation Report

## Executive status

**PARTIALLY COMPLETED.** Local terminal/network access is restored. The live
merchant integration, stored catalogue searches, exact product/price/link
pairing, website source references, and a controlled English browser voice turn
are verified. Human microphone accuracy, production voice cloning, Hindi/Telugu
conversations, authenticated customer shopping and checkout are NOT verified.
The merchant-owned browser guest cart, its text tools, persistence and controlled
English voice shopping flow ARE now verified (see the latest section).

The current MySQL database contains **13 applied migrations, zero pending/unknown,
16 active products, and 25 active pages with 34 indexed chunks**. The final live
verification passed 51 checks with no failures and one warning: the integration's
historical last-sync status is `failed`, with one recorded error. Existing imported
records remain readable and isolated; this run did not resync or overwrite them.
These are live DATABASE records imported from the merchant's recorded, read-only
storefront preview, not independently verified current commerce inventory.

The following section supersedes older incomplete/live-service statements below.
No migration or existing environment file was changed by the assistant during
this resumed work; the user's remote endpoint update is recorded below.

## Latest: real microphone product-name diagnosis and identity safeguards (8 November 2026)

**LOCAL SAFEGUARDS IMPLEMENTED. GPU PRODUCT-VOCABULARY RECOGNITION REMAINS
BLOCKED BY THE CURRENT FILE-ONLY API AND UNAVAILABLE SOURCE ACCESS.
NO SUCCESSFUL SIX-PHRASE MICROPHONE ACCEPTANCE IS CLAIMED.**

The user authorized a real-microphone test and then a minimal GPU STT prompt
extension. The existing forwarding identity was tested for source access without
altering its running tunnel. It did not permit a non-interactive `pwd` command
(exit 1), so no GPU source or service was changed.

### Observed failure point

In a dedicated Edge browser with a real microphone, no synthetic media, and no
saved audio recordings, the existing pipeline emitted these provider-derived
transcripts before any product lookup:

| Requested product phrase | Recorded transcript examples | Existing response |
|---|---|---|
| Explain ZENAGE | “Explain Janet.” / “Explain the energy.” / “Explain Gen Ed. Explain Gen Ed.” | Asked for clarification |
| Tell me about ZENAGE | “Tell me about Genedge. Tell me about Genedge.” | Asked for clarification |
| Tell me about LASS HEALTH | “Let's get it.” | Asked for clarification |
| Explain HALE.O | “ExplainedHell.org” | Asked for clarification |
| ZENAGE ingredients / WEIZAP / deliberate unclear-name case | No separately labelled event captured | Not verified |

The browser sent 1,417 binary frames. This proves actual microphone transport,
not acoustic quality. The original event exposed only the whitespace-normalized
transcript; it did not expose raw provider text separately. The normalization
function only changes whitespace and bounds length, not product spelling.
The exact reported ZENAGE-to-EDGE replacement was not reproduced: these captured
turns rejected unknown names instead of explaining another product.

The observed wrong tokens therefore reach product matching from STT; the test
does not establish whether microphone acoustics also contribute to decoding
errors. No VAD/preprocessing changes are justified by this evidence.

An independent, concrete matching bug was fixed: query extraction removed the
internal dot in HALE.O while the previous exact comparison retained it.

### Implemented safeguards

- Load active product names and IDs from the existing catalogue, scoped to the
  backend-established tenant, assistant and integration and products-read grant.
  The bounded query does not change database schema or imported product data.
- Exact normalized name/entity matching uses token boundaries and consistent
  Unicode/case/punctuation handling. HALE O can identify HALE.O. No phonetic
  aliases convert Genedge, Janet or EDGE into ZENAGE.
- Named detail requests resolve the catalogue identity before inference and use
  its exact ID through the existing permission-checked detail tool. Unknown or
  non-unique names require clarification; no first-result fallback.
- Validate that returned detail ID/name matches the selected identity. Reject
  final answers and streamed sentences naming another catalogue product. The
  reported EDGE substitution is explicitly rejected for pinned ZENAGE. A voice
  EDGE request conflicting with discussed ZENAGE asks to repeat.
- Preserve `rawText` separately from existing normalized `text` in the final
  transcript event. Safe server diagnostics record lengths, product-name/ID
  mentions, vocabulary count, available confidence/quality and PCM metadata;
  they do not log full utterances, credentials or save recordings.
- Inspect remote OpenAPI capability before sending a bounded, complete-name
  `initial_prompt`. Supported contracts receive the prompt; file-only or
  unavailable contracts log that hints are not sent and retain normal STT and
  local fallback behavior.

The actual loopback GPU OpenAPI document exposes only the multipart `file`
field. Faster-whisper upstream documents `initial_prompt`, but the existing
FastAPI handler must expose and forward it to the installed implementation.
Merely advertising a field is not proof of effective decoding bias; actual
microphone acceptance is still required after that GPU change.

### Validation and remaining acceptance

- Final agent routing/identity regression: **52 tests passed**.
- Final vocabulary/provider regression: **54 tests passed, two suites**.
- Earlier five-suite run passed 155 tests with two new HTTP-mock failures. Those
  failures were caused by reusing a consumed Response body; each mock request
  now creates a fresh Response, and both prompt-capability tests passed.
- Dedicated raw-transcript and streamed-substitution checks passed.
- Final TypeScript `npx tsc --noEmit` and backend `npm run build`: **passed**.

These test counts overlap; mocked tests do not prove microphone recognition.
The post-change microphone browser was opened, but the user reported “Could not
complete” and it captured no voice events. Therefore raw/normalized transcript,
matched ID and final-answer identity for all six spoken phrases remain unverified.
No noisy-audio accuracy claim is made.

Files changed:
- [product-identity.service.ts](backend-nestjs/src/website-integrations/product-identity.service.ts) (new)
- [product-identity.service.spec.ts](backend-nestjs/src/website-integrations/product-identity.service.spec.ts) (new)
- [website-integration.repository.ts](backend-nestjs/src/website-integrations/website-integration.repository.ts)
- [website-data.module.ts](backend-nestjs/src/website-integrations/website-data.module.ts)
- [agent.service.ts](backend-nestjs/src/agent/agent.service.ts)
- [merchant-cart.agent.spec.ts](backend-nestjs/src/agent/merchant-cart.agent.spec.ts)
- [shopping-intent.ts](backend-nestjs/src/agent/shopping-intent.ts)
- [shopping-intent.spec.ts](backend-nestjs/src/agent/shopping-intent.spec.ts)
- [voice.module.ts](backend-nestjs/src/voice/voice.module.ts)
- [voice-session.manager.ts](backend-nestjs/src/voice/voice-session.manager.ts)
- [voice-session.manager.spec.ts](backend-nestjs/src/voice/voice-session.manager.spec.ts)
- [stt.port.ts](backend-nestjs/src/voice/stt/stt.port.ts)
- [configured-stt.adapter.ts](backend-nestjs/src/voice/stt/configured-stt.adapter.ts)
- [configured-stt.adapter.spec.ts](backend-nestjs/src/voice/stt/configured-stt.adapter.spec.ts)
- [WIDGET-DEPLOYMENT.md](frontend/WIDGET-DEPLOYMENT.md), this report and rebuilt backend output.

Important-source backups and baseline recognition evidence remain in the session
files. No cart/checkout implementation, environment file, model, tunnel, Piper,
VAD deadline or database schema was changed for this task.

## Latest: shopping intent, real cart and progressive voice verification (8 November 2026)

**ALL SEVEN REQUESTED TEXT/CART SCENARIOS AND ONE GENERATED-AUDIO VOICE
FOLLOW-UP PASSED. HUMAN MICROPHONE ACCEPTANCE AND SIRI-LEVEL SPEED ARE NOT
CLAIMED.** This section supersedes older shopping/voice limitations where noted.

### Root causes and targeted fixes

- Cart polling repeatedly selected the page product, while catalogue responses
  selected their first result. Page product, discussed product and search choices
  now have separate visitor-scoped state with a one-hour TTL. Current/previous
  product, name, intent, successful cart action and pending clarification are
  retained; page navigation updates that state.
- Named detail questions and pronouns were not reliably routed. Explicit shopping
  intent routing now resolves exact catalogue names/IDs before detail/cart tools;
  ingredient follow-ups use the discussed product without another catalogue search.
  Unknown names require clarification instead of substituting unrelated products.
  Negated/ambiguous purchases never execute silently.
- Full history plus product evidence exceeded the GPU model's 4,096-token context;
  the model also returned generic ingredient responses despite complete sections.
  Grounded explanations use compact evidence prompts. Ingredient and comparison
  answers use retrieved evidence directly, avoiding unnecessary inference.
- Final inference answers were awaited in full before voice synthesis. The existing
  inference abstraction now streams completed sentences for tool-free final-answer
  rounds, through provider-specific OpenAI SSE/Ollama NDJSON parsing, to existing
  Piper PCM playback. Tool-bearing rounds retain validated, ordered execution and
  provider tool-call IDs. Abort signals reach inference and tool execution.
- During live verification the user's existing GPU SSH tunnel had stopped. The
  user restarted it; no endpoint, model, GPU service or tunnel exposure was changed.

Cart answers confirm the existing merchant SDK's real acknowledged operations,
not simulated mutations. Checkout remains merchant-owned; no checkout/payment
transaction is claimed. Existing authentication, tenant isolation, tool limits,
VAD thresholds/500 ms deadline, microphone processing and database remain intact.
No environment files or dependency manifests were changed.

### Actual live acceptance results

Verified in a new browser visitor context without changing a customer's cart:

| Requested scenario | Actual result | Request duration |
|---|---|---|
| Explain the ZENAGE product | Grounded description, ingredients, usage and safety; exact ZENAGE ID | 5,595 ms |
| What are its ingredients? | Captured composition, including recorded quantities; no new catalogue search | 268 ms |
| Add it to my cart | Acknowledged ZENAGE ID `A9B2C360-C61D-4265-889B-A0775314AC6D`, quantity 1 | 957 ms |
| Add WEIZAP also | WEIZAP quantity 1; ZENAGE retained at quantity 1; total INR 10,620 | 984 ms |
| Show my cart | Actual item names and quantities from merchant read-back | 983 ms |
| Remove ZENAGE | Correct item removed; WEIZAP retained, total INR 1,620 | 958 ms |
| Compare ZENAGE and LASS HEALTH | Retrieved prices, descriptions, availability and stock; no invented sections | 261 ms |
| Voice follow-up: “How do I use it?” | Exact remote transcript; ZENAGE details; Qwen answer; streamed text and completed Piper playback | See below |

The voice test used **generated speech, real remote GPU STT/Qwen, and real Piper**;
no physical microphone or mocked provider was used. Four text deltas preceded the
final answer. All **69 scheduled browser playback sources completed**, representing
27,399 ms of audio. Measured from the generated utterance's end:

- First text: **6.34 seconds**.
- First audio: **11.64 seconds**.
- STT: 1.60 seconds; agent: 4.67 seconds.
- TTS time to first audio after its first sentence: 5.30 seconds.

This proves the complete generated-audio voice lifecycle, not human microphone
accuracy or Siri/Alexa-level latency. Earlier intermittent local VAD scheduling
timeouts and the existing 60-second response-audio ceiling remain limitations.

### Compilation and focused verification

- TypeScript `npx tsc --noEmit`: passed after final changes.
- Backend `npm run build`: passed after final changes.
- Main focused shopping/provider/voice run: **211 tests passed, seven suites**.
- Subsequent agent/voice regression run: **182 tests passed, four suites**.
- Final context/clarification/parser verification: **58 tests passed, three suites**.
- Final streamed-error/decimal segmentation selection: **3 tests passed**.
- Frontend voice tests: **33 passed**.
- Frontend `build:widget`: passed, producing both widget and SDK bundles.

These runs overlap and must not be summed as unique tests. An attempted
`build:sdk` command has no script in this project; `build:widget` is the existing
successful build for both outputs.

### Files changed for this request

Backend source:
- [agent.service.ts](backend-nestjs/src/agent/agent.service.ts)
- [shopping-intent.ts](backend-nestjs/src/agent/shopping-intent.ts) (new)
- [streamed-answer.ts](backend-nestjs/src/agent/providers/streamed-answer.ts) (new)
- [merchant-cart.service.ts](backend-nestjs/src/website-integrations/merchant-cart.service.ts)
- [website-integration.tools.ts](backend-nestjs/src/website-integrations/website-integration.tools.ts)
- [agent-invocation.port.ts](backend-nestjs/src/voice/agent-invocation.port.ts)
- [agent-invocation.adapter.ts](backend-nestjs/src/voice/agent-invocation.adapter.ts)
- [voice-session.manager.ts](backend-nestjs/src/voice/voice-session.manager.ts)

Focused tests:
- [shopping-intent.spec.ts](backend-nestjs/src/agent/shopping-intent.spec.ts) (new)
- [merchant-cart.agent.spec.ts](backend-nestjs/src/agent/merchant-cart.agent.spec.ts)
- [streamed-answer.spec.ts](backend-nestjs/src/agent/providers/streamed-answer.spec.ts) (new)
- [merchant-cart.service.spec.ts](backend-nestjs/src/website-integrations/merchant-cart.service.spec.ts)
- [agent-invocation.adapter.spec.ts](backend-nestjs/src/voice/agent-invocation.adapter.spec.ts)
- [voice-session.manager.spec.ts](backend-nestjs/src/voice/voice-session.manager.spec.ts)

Frontend/documentation:
- [voice.js](frontend/src/widget/voice.js)
- [voice.test.js](frontend/src/widget/voice.test.js)
- [widget.js](frontend/src/widget/widget.js)
- [WIDGET-DEPLOYMENT.md](frontend/WIDGET-DEPLOYMENT.md)
- This report; rebuilt backend output and widget/SDK bundles.

Important-source backups were retained in the session files before edits. JSON
acceptance evidence is retained separately; temporary acceptance harnesses are
removed after verification. No merchant application source was edited.

Practical manual verification: hard-refresh the ZENAGE page, open the widget, run
the seven questions above, then start voice and ask “How do I use it?” Confirm
the real merchant cart read-back and audible playback, not just HTTP health.

## Latest: voice connection regression and recovery (8 November 2026)

**CONNECTION FIX AND A LIVE GENERATED GPU CONVERSATION VERIFIED.
HUMAN MICROPHONE ACCEPTANCE AND DEADLINE RELIABILITY ARE NOT CLAIMED.**

The exact first failing request on the reference product page was the browser
preflight for `POST /api/website-integrations/product-context`: HTTP 403.
The voice-ticket preflight returned 204. The new product-context route was
missing from `WEBSITE_PUBLIC_PATHS`, so it incorrectly used dashboard CORS.
The widget awaits this upload before its voice ticket; consequently no
WebSocket was opened and the widget showed a generic assistant-network error.
The same awaited upload can block reconnect after navigating to a product page.
Adding only that route to widget CORS fixes the regression; signed session,
tenant/assistant/visitor scoping and exact merchant-Origin checks are unchanged.

The actual transport is HTTP session/context/ticket requests followed by
`/api/voice/stream`, subprotocol `mczen-voice.v1`, binary 16 kHz mono PCM and
versioned JSON events; it is not SSE. Tickets are single-use and Origin-bound.
Gateway startup remains bounded to five seconds; client ticket/socket phases
remain bounded to 12 seconds. Server heartbeat pings remain 25 seconds and
VAD remains bounded to 500 ms. Current GPU endpoints use only local tunnel
ports 21434 (LLM) and 28000 (STT); no public GPU exposure was introduced.

Reconnect now respects stop/disposal and terminal authentication rejection.
`SESSION_MISMATCH` during an actual resume permits a fresh authenticated voice
start using the same widget conversation. The backend can close and release
only the matching disconnected tenant/visitor/assistant/conversation session,
not an active socket, to avoid its one-session slot blocking recovery.
Slot release is awaited and failed releases are logged. Captured audio and
in-flight cart/model actions are never blindly replayed.

### Actual runtime evidence

- Before fix: product-context preflight 403, browser `net::ERR_FAILED`,
  `ticket_requested -> ticket_failed`, no voice-ticket POST.
- After fix: preflight 204, product-context POST 200, voice-ticket POST 200,
  acknowledged WebSocket session and initialized audio.
- Controlled ordinary reconnect resumed the same session ID.
- A real loopback relay severed both socket connections and an intentionally
  invalid resume token produced `SESSION_MISMATCH`; a fresh authorized session
  then started with the **same conversation ID**. No session-limit rejection.
  The relay and test browser were closed afterwards.
- An initial browser-only proxy-close test did not actually disconnect the
  upstream backend socket. Its active-slot rejection was correct; the test
  was replaced with real socket termination rather than weakening that guard.
- A stale Nest watcher process predated the final emitted manager. The exact
  watcher and backend PIDs were verified and stopped; the current compiled
  backend was started once with `npm run start:prod`. It remains running
  with the existing environment configuration. This command runs compiled
  code, not watch mode. GPU tunnel, STT, VAD and Piper were not restarted.

### Live GPU conversation check

Reference: ZENAGE product page on `http://127.0.0.1:5173`.
Piper-generated "How do I use this product?" was sent through a synthetic
browser MediaStream, the existing capture/PCM/WebSocket/VAD path, remote STT,
AgentService, Qwen and Piper playback. No human/customer recording was used.
The final check waited for at least three acknowledged capture packets before
injecting the generated phrase.

- Exact final transcript: **How do I use this product?**
- Correlated turn: `0152ddb7-ad46-44c8-a5fd-ddc806112835`.
- Remote STT inference: **411 ms**; backend STT round trip: **999 ms**.
- Assistant model: **Qwen2.5-3B-Instruct**; agent/tools: **5006 ms**.
- Product-detail lookup used the selected ZENAGE record and captured sections.
- Piper output: **35724 ms**; all scheduled audio sources completed.
- Existing remote-adapter timing logs confirm actual remote inference;
  this was not counted as GPU success from a health response or configuration.

Earlier diagnostic attempts remain failures: speech injected immediately at
audio-ready lost initial words ("I use this product.") and took the deterministic
catalogue route rather than Qwen. Another live attempt encountered VAD deadlines.
The precisely correlated VAD request
`55faa611-647e-4f4f-877b-b4a77f4f3481` had **1113 ms dispatch delay**,
**1055 ms event-loop lag**, **0.041 ms queue wait**, and **6.09 ms actual
Silero inference**, with zero borrowed/waiting thread-pool workers. This is
local scheduling starvation, not GPU STT failure or slow Silero inference.
The deadline was not raised and those failures were not hidden. The final
successful generated turn does not establish absence of future VAD deadlines
or human speech accuracy, nor does it independently certify product-answer
factual correctness.

### Verification and files

- CORS/gateway: **16 tests passed**.
- Frontend transport/widget regressions: **58 tests passed** in one run.
- Session manager: **34 passed, one new recovery test failed** because the
  implementation initially compared the conversation on the agent context
  rather than voice context. That field was corrected; the four selected
  recovery/slot/isolation tests then passed. Other manager cases were not rerun.
- Final TypeScript check, backend build and widget/SDK builds passed.
- Changed backend: `src/auth/cors.config.ts`, `src/auth/http.config.spec.ts`,
  `src/voice/voice-session.manager.ts`, `src/voice/voice-session.manager.spec.ts`.
- Changed frontend: `src/voice/voiceClient.js`, `src/voice/voiceClient.test.js`,
  `src/widget/client.js`, `src/widget/client.test.js`, `WIDGET-DEPLOYMENT.md`.
- This existing report.

No environment file, schema, migration, merchant project, product extractor,
cart implementation, STT/TTS provider implementation or VAD threshold/deadline
was changed. Hard-reload existing browser pages to use the current SDK and
replace sessions lost during backend restart.

## Previous: rendered product details and follow-up context (8 November 2026)

**IMPLEMENTATION AND REFERENCE DOM EXTRACTION VERIFIED; LIVE DEPLOYMENT AND
HUMAN VOICE ACCEPTANCE NOT CLAIMED.**

The existing flow was SDK injection -> signed website session -> selected
product ID/cart polling -> AgentService -> scoped website tools -> configured
LLM. Neither the SDK nor page-view tracking sent product detail sections.
Static website crawling does not execute JavaScript. Additionally, the
contextual "tell me about the first product" shortcut returned only a price,
preventing full product evidence from reaching the model.

The SDK now captures bounded public product sections, including hidden ARIA
tab panels, terms and specifications. DOM mutations refresh dynamically rendered
content; text turns and voice-ticket requests synchronize context first.
An optional async `productContext` loader supports a merchant's existing public
detail API for tabs not mounted until activation. Capture never clicks tabs,
mutates the merchant/cart, reads forms or uploads microphone recordings.

The authenticated product-context endpoint revalidates the signed visitor
session and exact Origin, then resolves the page URL against the active
tenant/assistant/integration catalogue. Context is visitor-scoped in the
existing shared-state store and expires after one hour. It cannot overwrite
imported names, prices, availability or stock. Inputs are limited to 24
sections, 12000 characters per section and 48000 serialized characters.
Oversized/invalid context is explicitly rejected, not silently truncated.

The existing `get_product_details` tool now returns the full imported product
plus source-labelled `pageContext` sections. Contextual explanations and
ingredient/usage/benefit follow-ups reach the existing LLM instead of the
price-only shortcut. Named-product detail requests search the catalogue rather
than using a different selected product; the model may then call the existing
restricted detail tool. Cart and price-only paths remain deterministic.
Tool permissions, tenant scoping, auditing, limits and provider protocols remain
in force. Missing source information must remain unknown.

### Verified evidence

- Real rendered reference: ZENAGE at
  `http://127.0.0.1:5173/product/A9B2C360-C61D-4265-889B-A0775314AC6D`.
- Captured six sections: Overview, What's inside, How to use, Safety & storage,
  recorded product terms & conditions, and Product specifications.
- Three inactive tab panels were hidden; their text was still captured.
  Composition, dosage, storage, terms and specifications assertions passed,
  the selected tab was unchanged, and serialized context was 6094 characters.
- Backend TypeScript check passed. Initial focused six-suite regression:
  169 passed. Final rerun of the two changed safeguard suites: 24 passed,
  including named-product routing and bound URL/integration query parameters.
  Early added assertions assumed the wrong SQL parameter order and omitted
  the existing tool allowlist; corrected assertions check those actual
  security contracts rather than changing production behavior.
- Frontend regression: 52 passed. Final client suite after concurrency and
  lifecycle additions: 14 passed; the final lifecycle-guard check also passed.
- Final NestJS, widget and SDK production builds passed.

### Changed files for this task

- Frontend: `src/widget/product-context.js`, `src/widget/client.js`,
  `src/widget/widget.js`, `src/widget/sdk-entry.js`,
  `src/widget/client.test.js`, and `WIDGET-DEPLOYMENT.md`.
- Backend: `src/agent/agent.service.ts`,
  `src/agent/tools/tool-registry.service.ts`,
  `src/agent/merchant-cart.agent.spec.ts`,
  `src/widget/widget.service.ts`,
  `src/website-integrations/merchant-cart.service.ts`,
  `src/website-integrations/merchant-cart.service.spec.ts`,
  `src/website-integrations/website-integration.controllers.ts`,
  `src/website-integrations/website-integration.repository.ts`,
  `src/website-integrations/website-integration.repository.spec.ts`,
  `src/website-integrations/website-integration.tools.ts`,
  `src/website-integrations/website-integration.tools.spec.ts`.
- This existing report.

No environment file, migration, merchant project, STT/VAD settings, microphone
capture, TTS or cart implementation was modified for this task. Backend source
and production bundles are updated; the existing running backend was not
restarted, and the installed merchant page was not rewritten. Restart/reload
are required before exercising the new endpoint with the installed SDK.
No actual GPU answer or new human microphone interaction was claimed.
Other catalogue-only products still lack source details; truly unmounted tabs
require the site's public API loader or rendering before they can be captured.
Static ingestion alone cannot supply those missing JavaScript sections.

## Previous: Paperspace STT integration verification (7 November 2026)

**IMPLEMENTATION REUSED; LIVE GPU-TO-AGENT ACCEPTANCE BLOCKED BY HTTP 401.**
Inspection confirmed the existing configured adapter, multipart upload, response
mapping, local fallback, capabilities and dependency injection already support
the Paperspace API. No duplicate provider or pipeline was added. The actual path
is browser PCM -> voice gateway -> session manager -> `SPEECH_TO_TEXT` ->
configured remote/local adapter -> final transcript -> existing
AgentInvocationAdapter -> AgentService. Session IDs, turn/request correlation,
language handling and WebSocket contracts are unchanged.

The backend is now running with explicit `remote`, 30000 ms remote timeout and
enabled local fallback. The production default remains `local`. Backend-only
bearer authentication and multipart field `file` were verified by tests and an
initial real inference request. Paperspace's extra `compute_type` is accepted
without changing the internal transcript contract or inventing confidence.

### Actual external and browser evidence

- **Initial real remote inference PASSED:** Piper-generated "Show me some
  products." returned that exact transcript, 361 ms reported remote processing
  and 1114.87 ms adapter round trip for 1277.13 ms input, without local fallback.
  Request: `73a752ac-ca03-4129-8e45-d87406fa4df4`. This proves one external
  inference, not a completed browser-to-GPU-to-agent journey.
- **Initial two browser turns PASSED VIA LOCAL FALLBACK:** product search and
  details reached real AgentService, cards and playback. Both remote attempts
  failed; local STT processing was 36.34 s and 29.06 s. These results are not GPU
  performance or remote acceptance.
- Subsequent generated padded-input POSTs and authenticated health probes
  returned **HTTP 530**; the health page identified **Cloudflare error 1016**
  (origin DNS resolution). The user updated the endpoint independently.
  Transient `EAI_AGAIN` on the new hostname was cross-checked with Windows DNS
  and HTTP; it subsequently resolved without any application/DNS-setting change.
- The updated endpoint's health returned **HTTP 200**, but actual generated
  transcription consistently returned **HTTP 401**. Restarts and fresh-process
  checks found no inherited STT overrides. After reported key edits, the saved
  backend environment checksum remained unchanged; the final generated POST
  still returned 401. The remote credential/deployment mismatch remains an
  operator blocker, not an audio-format or Whisper-model diagnosis.
- **Final current browser run PASSED VIA LOCAL FALLBACK, NOT GPU:** both remote
  requests logged 401 with the same IDs subsequently used by AgentService.
  Session: `01a1b5e3-45e1-735f-8dfc-43d666e3f1ed`.

| Generated phrase / turn ID | Exact final transcript | Actual outcome | Local STT processing / total STT | First playback from speech onset | Browser playback |
|---|---|---|---|---|---|
| Show me some products. / `83c61ba5-85a7-41c6-bab9-ba0ca5d7c9df` | Show me some products. | Remote 401; local fallback; real `search_products` succeeded and AgentService returned product cards | 7.75 s / 9.03 s | 13.77 s | 46/46 buffers ended, no stops |
| Tell me more about the first product. / `baa844fe-520c-4cd3-b796-06495dc7cea9` | Tell me more about the first product. | Remote 401; local fallback; AgentService returned LASS HEALTH details at 1035 INR | 7.12 s / 9.35 s | 13.51 s | 17/17 buffers ended, no stops |

The latest remote rejection took 1246.63 ms and 2211.52 ms respectively.
Automated playback-buffer completion is not a human listening confirmation.
Both cart snapshots stayed empty; no cart mutation was requested or claimed in
these two-turn checks. Only authorized generated speech was uploaded. Stopped
human testing was not resumed and no human/customer recording was retained.
P5000/Small INT8 hardware is user-reported, not independently benchmarked here.

### Surgical changes and validation

Current-task source/documentation edits:

- [Configured STT adapter](backend-nestjs/src/voice/stt/configured-stt.adapter.ts):
  added a sanitized non-200 log containing request ID, HTTP status and elapsed
  time, because the prior generic unavailable log concealed the live failure.
  Routing, authentication, fallback and timeout semantics were not changed.
- [Configured STT tests](backend-nestjs/src/voice/stt/configured-stt.adapter.spec.ts):
  Paperspace `compute_type: int8` fixture, safe status/timing assertions and 530
  fallback coverage, preserving existing success/auth/timeout/invalid tests.
- [Session manager tests](backend-nestjs/src/voice/voice-session.manager.spec.ts):
  binary-audio dispatch through the configured adapter, remote success,
  authentication-failure fallback, and both-provider failure. These cases mock
  HTTP and the agent port; the live browser checks above use real services.
- [Runtime guide](backend-nestjs/docs/PHASE-6H-VOICE-RUNTIME.md):
  Paperspace compatibility and honest health/inference/fallback diagnosis.
- This existing report. Build-generated backend output was regenerated;
  unrelated pre-existing worktree changes were preserved.

**135 tests passed across six suites:** configured STT, session manager,
voice-provider, widget-voice service, agent-invocation adapter and gateway.
Coverage includes bearer/multipart contracts, response mapping, languages,
request IDs, timeouts, invalid results, cancellation, local default/fallback,
both-provider errors, security and WebSocket dispatch. Backend production build
passed. Repository `npm run lint` (type-aware oxlint) exited 0 with existing
warnings. An attempted ESLint command was not applicable to this repository and
was replaced by its existing configured lint command.

**Final service state:** backend PID 8024 responds HTTP 200 and remains running.
Existing local Whisper/VAD/Piper and merchant listeners remain present; they
were not restarted. No environment file was edited by the assistant; the user's
endpoint edit was preserved and its checksum remained unchanged throughout
subsequent verification. No migrations, VAD thresholds/deadline (500 ms),
microphone capture, preprocessing, AgentService, cart tools or TTS were changed.

**Remaining acceptance:** save the credential matching the currently configured
remote deployment (or fix that deployment's expected token), restart only the
backend if its environment changes, then repeat authorized generated browser
turns. Require a `voice_remote_stt_timing` event and AgentService success with
the same turn ID and no local fallback. Current application voice flow selects
remote first but obtains its final transcripts from local fallback; GPU
WebSocket-to-agent acceptance is explicitly **NOT VERIFIED**. Human microphone
accuracy, remote language-hint accuracy and remote retention controls remain
separate pending work.

## Previous: optional remote GPU STT integration (7 November 2026)

**IMPLEMENTED, not live Colab-accepted.** The existing `SPEECH_TO_TEXT` injection
now selects an adapter that defaults to the unchanged local Whisper provider.
Explicit `MCZEN_STT_PROVIDER=remote` uses the authorized remote API with
backend-only bearer authentication, exact PCM samples wrapped in WAV multipart
`file`, explicit language hints and the existing correlation ID. Remote
`transcript`/`language`/`processing_time` map to internal
`text`/`language`/`processingMs`; no transcript rewriting or invented confidence
was added. Local fallback is enabled by default in remote mode and can be
disabled with `MCZEN_STT_FALLBACK_ENABLED=false`, as confirmed by the user.

Remote timeout/network/non-200/invalid-result failures are logged without
endpoint, token, body or exception text and attempt local STT once when enabled.
Cancellation never starts fallback. Both-provider failure raises the existing
provider error instead of returning empty success. The existing permission-
protected capability endpoint reports configured provider and fallback policy,
without secrets. The user confirmed authenticated remote `GET /health`; it
checks reachability with at most 1500 ms and permits enabled local health fallback.
No existing environment file, database, VAD, preprocessing, browser capture,
TTS, AgentService or cart tool was modified for this integration.

**VERIFIED:** focused backend tests exercise successful response mapping,
authentication, actual loopback multipart HTTP using synthetic PCM, exact WAV
sample preservation, language/correlation, timeouts including body reads,
invalid responses, fallback, cancellation, both-provider failure and sanitized
capability output. Backend production build and type-aware lint passed.
The final focused run passed **121 tests across four suites**; lint exited 0
with existing warnings and no warnings in the new configured-STT files.
Configuration/startup instructions and important limits are in
[the runtime guide](backend-nestjs/docs/PHASE-6H-VOICE-RUNTIME.md#optional-remote-gpu-stt).

**PENDING:** no real Colab endpoint/key or customer audio was used in validation.
Live GPU timing, remote recognition accuracy, language-hint support and remote
data-retention controls are not proven by mocks or loopback transport tests.
Existing human acceptance and scheduling blockers below remain unresolved.
The running services were not restarted or remotely enabled by this change.

## Previous: physical audio diagnostics and stopped human investigation (6 November 2026)

**NOT FINALLY ACCEPTED. Human testing was stopped immediately at the tester's
request.** Eleven case verdicts were recorded, seven with reference/listening
confirmation; only four satisfied the deliberately strict transcript + required
tool + playback + human-verdict checks. This is not 20 verified human
interactions. Small remains the default; VAD still has its 500 ms deadline.
No existing environment file, migration, model default or transcript was changed.
The tester explicitly declined raw audio recording; none was enabled or saved.

### Changes and diagnostic limits

- **VERIFIED:** explicit loopback browser metadata opt-in and non-production
  backend process opt-in. Track settings, actual context/worklet rate,
  source/resampled RMS/peak/clipping/amplitude-silence statistics, final-STT PCM
  statistics, packet anomalies and VAD boundaries are available without samples.
  Final metadata is correlated by session/turn; VAD calls now have individual
  request UUIDs and service pool snapshots. Production backend ignores the flag.
- **VERIFIED:** worklet sample counts at 16/44.1/48 kHz, PCM sequence integrity,
  and exact retained preroll/speech/trailing samples into final STT are covered
  by tests. No resampler, endpoint, noise filter or speech boundary was changed.
- **IMPLEMENTED:** a separate, explicit developer CLI consent lease can retain
  local final-STT input for at most 30 minutes / 10 MiB, deleting owned files on
  expiry or graceful shutdown. Production rejects it. Synthetic-byte expiry and
  no-consent tests ran; it was NOT enabled for human testing. Forced termination
  can prevent in-process cleanup; see the runtime guide's operator caveat.
- **IMPLEMENTED after this run:** keep a browser's explicit metadata opt-in for
  that widget lifetime when cart navigation removes the URL query; reset packet
  diagnostic sequence tracking on epoch changes. Early cumulative "missing"
  metadata across epochs is not evidence of actual wire loss.
- **IMPLEMENTED in the development harness, not human-retested:** reacquired
  microphone streams now inherit the current Begin/mute state. Previously every
  new getUserMedia stream was forcibly muted, including one reacquired during
  a live test. Later silent/no-transcript cases are therefore contaminated by
  this harness defect, not proof that the application stopped capturing.

### Actual physical audio findings

The browser reported a **48,000 Hz, mono, 16-bit physical track**, with echo
cancellation, noise suppression and automatic gain control enabled.
Its **actual AudioContext/worklet input was 16,000 Hz**, as requested by the
existing client. Browser resampling therefore precedes the worklet; assuming
that this run exercised the worklet's 48-to-16 kHz resampler would be wrong.

Across **253 measured one-second windows**, context-input and worklet-resampled
RMS, peak and sample counts matched in every window. Maximum measured source
peak was **0.81947**, with **zero measured clipping**. Across the nine delivered
final transcripts, the backend's final-PCM RMS and Whisper's input RMS differed
by **zero**. Final STT inputs were **2.66-4.26 seconds**, retained 1 second of
preroll and 700 ms of trailing silence, and were not independently trimmed by
Whisper. This is evidence against worklet distortion, clipping or an extra
gateway-to-STT conversion in these observed turns; equal aggregate RMS is not
a cryptographic proof of waveform identity or intact phoneme boundaries.

**Root cause of the earlier cord/cut/car recognition is still PENDING.**
We cannot compare original hardware audio, browser processing, speech boundary
phonemes or Small/Base.en on identical human recordings without the declined
recordings. Browser processing could still affect pronunciation; amplitude
statistics do not measure intelligibility or signal-to-noise ratio. No original
hardware capture, alternate accent/noise benchmark or five-cart accuracy result
is claimed. No transcript "correction" or speculative decoder change was made.

### Actual human cases on restored Small

PASS below requires both the objective harness checks and the human's
reference/listening confirmation. Unchecked confirmations are not counted as
known spoken references. Case 9 also requested a second, spoken price question
during playback; it was not observed.

| # | Displayed reference | Exact final transcript | Observed outcome | Classification |
|---|---|---|---|---|
| 1 | Hello, can you hear me? | `Hello, can you hear me?` | No completed response/playback; confirmation unchecked | FAIL / unconfirmed |
| 2 | Show me available products. | `Show me available products` | Actual search, product cards, 45/45 playback buffers ended; confirmed | VERIFIED PASS |
| 3 | Tell me about this product. | `Tell me about this product` | Correct cached LASS HEALTH price/context; no new details tool; 17/17 buffers ended | Recognition/listening VERIFIED; strict tool check FAIL |
| 4 | What is its price? | `What is its price?` | Correct cached 1,035 INR answer; no new details tool; 17/17 buffers ended | Recognition/listening VERIFIED; strict tool check FAIL |
| 5 | Open my cart. | `Open my cart.` | Actual open-cart tool/navigation; empty cart; 22/22 buffers ended; confirmed | VERIFIED PASS |
| 6 | Add two units to my cart. | `Add two units to my cart.` | Real LASS HEALTH cart: 2 units / 2,070 INR; 27/27 buffers ended; confirmed | VERIFIED PASS |
| 7 | Show my cart. | `Oh my god` | No cart tool; generic response; spoken reference unconfirmed | FAIL / unconfirmed |
| 8 | Remove one item. | `remove one item` | Real cart decreased 2 to 1 / 1,035 INR; 28/28 buffers ended; confirmed | VERIFIED PASS |
| 9 | Products, then interrupt with price | `Show me available products.` only | Search succeeded, 46/46 buffers ended, zero buffers stopped; second transcript timed out | Human interruption NOT VERIFIED |
| 10 | What is the price of LASS HEALTH? | none | 659 acknowledgements, no speech onset; reacquisition/muting contamination possible | FAIL / unconfirmed |
| 11 | Open my cart. | none | Speech onset, then STT_UNAVAILABLE; no audio or new tool; unchecked | FAIL / unconfirmed |

Only one of the planned five repeated cart commands has an exact transcript and
verified open-cart tool. A second displayed attempt failed; the others were not
reached. Do not combine old Base.en attempts with this run to manufacture five
Small-model passes. Human testing will not resume without the tester choosing
to participate again.

### Precise deadline and cancellation evidence

The new run recorded request **df28bbc7-b505-4a94-82be-c74c3c263232**,
session **01a1b090-461f-7aa0-9ed7-841e894abe09**, at 16:48:01 local time:
6,400-byte VAD payload, client queue **0.0743 ms**, HTTP phase, no response,
`request_deadline`, elapsed **1,150 ms** despite the unchanged 500 ms timer.
The deadline callback itself was observed about 650 ms late. No matching
service slow-handler record exists for that UUID, so it is **not justified** to
assign that particular failure to Silero inference or AnyIO saturation.
The unresolved interval includes client dispatch, network/ASGI arrival and
response scheduling. New failure logs explicitly include deadline overshoot.

A separate slow service request **6385f2db-1776-4c6c-ad89-0e351e91ebac**
recorded dispatch **105.282 ms**, admission **0.0264 ms**, inference
**2.9531 ms**, event-loop lag **62.8431 ms** and entry pool snapshot
**0 borrowed / 40 total / 0 waiting**. This request is not the failed UUID.
Later request **4fa62849-0265-4525-8925-950e2f74a101** was cancelled by the
session after **23 ms**; that is normal session cancellation, not a 500 ms miss.
The older matched recurrence remains dispatch 816.39 ms / loop lag 795.91 ms /
inference 7.51 ms. VAD scheduling reliability is **precisely isolated in part,
not resolved or guaranteed** by successful stress tests.

Case 11's STT UUID **a109fd85-d015-4225-a3c4-7e593ec28681** independently
recorded **63,875 ms processing**: **32,240 ms encoder**, **31,507 ms decoder**,
queue **0.0294 ms**, on only **3,160 ms** of audio. The service completed native
work after the client had failed. This is a genuine CPU/native inference tail,
not 64 seconds of microphone buffering or a transcript intentionally hidden.
No timeout was raised to hide it.

### Latency: limited current human sample, not a speedup

Intel i7-1255U / 12 logical CPUs / approximately 16 GB RAM; local shared Windows
host; restored Small CPU int8, six threads, two workers, greedy decoding.
No builds or stress probes were run during these human observations.
Seven complete response/playback turns were eligible (including one whose
spoken reference was unconfirmed). These are not 20 accepted conversations.
Observed nearest-rank p95 with seven samples is simply the maximum and is not
a stable production percentile.

| Measure | Median | Observed p95 / max (n=7) |
|---|---:|---:|
| STT service processing | 8.991 s | 14.191 s |
| VAD onset to final transcript | 11.745 s | 16.180 s |
| VAD onset to first audio | 14.654 s | 23.079 s |
| VAD onset to complete playback | 24.028 s | 35.879 s |
| Agent response, including awaited tools | 0.371 s | 11.727 s |
| TTS generation | 3.487 s | 8.874 s |

The previous candidate's 3.08 s STT / 6.60 s first-audio medians and the
Small controlled-corpus 6.19 s inference median use different audio/models and
conditions; they do not prove a before/after improvement on this human run.
Model loading remains startup-only. Per-request feature/encoder/decoder
timings are preserved in evidence; no standalone tool-time percentile is
fabricated from aggregate agent time.

### Current regression status

Final regression results are recorded below after the diagnostic changes.
The first full backend run found a new test-fixture mistake: it sent 45 tiny
packets immediately, exceeding the real 40-packets/s safety limit. The corrected
test sends nine actual 100 ms packets and still compares every retained sample;
no production limit, assertion or endpoint was weakened.
The first parallel/traced desktop cart run exceeded its unchanged 30-second
test deadline near the final removal. Its unchanged assertions passed with
one worker and trace instrumentation off; mobile/cart-access cases also passed.
This initial failure remains part of the evidence.

| Surface | Current result | Previous report |
|---|---|---|
| Complete backend Jest | VERIFIED: 757 passed, 96 existing gated skips; 60 passed / 6 skipped suites | 754 passed / 96 skipped |
| Final targeted session/metadata tests | VERIFIED: 32 passed; subset, not additive | New metadata/endpoint sample test |
| Python runtime/privacy tests | VERIFIED: 18 passed | 17 passed |
| Frontend voice/widget | VERIFIED: 51 passed | 50 passed |
| Merchant Vitest | VERIFIED: 73 passed | 73 passed |
| Merchant adapter | VERIFIED: 15 passed | 15 passed |
| Merchant guest-cart browser | VERIFIED: 4 passed serially with tracing off; initial desktop timeout disclosed above | 4 passed |
| Backend, frontend/SDK and merchant builds | VERIFIED: all three production builds passed | All three passed |
| Backend type-aware lint | VERIFIED: exit 0, existing warnings; no autofix | Exit 0, warnings |
| Legacy HTTP e2e | BLOCKED historically: missing DataSource fixture; not rerun or weakened in this focused task | 19 setup failures before bodies |
| Real-provider generated shopping | FAILED current run: first two turns passed, third timed out after a VAD deadline; do not reuse old seven-turn success as current PASS | Seven turns previously passed |
| Real-provider authenticated WS resume | VERIFIED: both generated turns passed with same resumed session | Previously passed |
| Generated buffered / in-generation interruption | VERIFIED independently: both scenarios passed, new request processed and playback buffers stopped | Previously passed |

Final compiled-adapter VAD load probe: **1,200 calls, four sessions, 30 seconds,
zero errors**, concurrent real Piper generation and one Small transcription.
Median **38.81 ms**, observed p95 **96.10 ms**, maximum **269.69 ms**. This uses
digital silence, not human acceptance. It does not erase the actual human-run
deadline failure. The final process-only backend diagnostic opt-in was removed
after testing; raw recording was never enabled.

The subsequent actual-browser generated shopping run nevertheless reproduced
deadline request **480e06a5-886d-4c2e-b4c8-7496f7de67f0**, session
**01a1b0b5-848c-7e78-9540-9e7e96397336**, at 17:25:28:
client queue **0.0852 ms**, 6,400 bytes, HTTP/no response, elapsed **2,310 ms**,
reported deadline overshoot **1,809.79 ms**. Its third turn's STT was aborted;
the first two exact generated turns had completed playback. There is again
no matching slow-service UUID record, so attribution beyond the
client/network/ASGI/response scheduling interval remains unresolved.
Successful native profiling under the four-session probe separately measured
request **f9495513-534a-429d-806d-4cc90f8f0029**: dispatch **98.21 ms**,
lock wait **2.99 ms**, native ONNX calls **5.67 ms**, total processing
**9.02 ms**, pool snapshot **0/40 borrowed, zero waiting**. This request is
not the failed one. New logs now distinguish native inference from lock wait
and HTTP completion; they do not prove that the absent request reached Silero.
**The current real-provider regression is therefore NOT wholly green.**

A post-human, post-regression memory snapshot (not a human-run peak benchmark)
found backend/STT/VAD/TTS working sets approximately **23.2 / 4.9 / 12.5 / 3.3 MiB**
and lifetime CPU counters **70.7 / 266.2 / 91.8 / 705.8 seconds** respectively.
These small resident working sets on a shared Windows host do not represent
loaded model allocations or peak memory; paging/host pressure cannot be
quantified retrospectively from them. VAD was AboveNormal; the others Normal.
No CPU-utilization percentage or causal memory-pressure claim is fabricated.

Human-recording Small versus Base.en comparison is **BLOCKED by declined raw
recording consent**. Twenty real interactions, five repeated cart commands,
human spoken interruption and stable tail latency remain **PENDING**.
The detailed metadata-only case evidence and summary are saved in the session
workspace; old human results were not overwritten.

## Previous: STT profiling, model comparison and human acceptance (6 November 2026)

**NOT FINALLY ACCEPTED.** The current STT bottleneck is measured, not assumed.
Base.en is faster on controlled generated shopping audio, but it failed real
microphone accuracy. **Small remains the default.** The base.en runtime selection
is explicit experimental opt-in; its results must not be presented as a
default-production improvement. No raw microphone recording was permitted or
saved, and no existing environment or migration was changed.

### STT root cause and instrumentation

The previous reported 9.38 seconds was **speech onset to final transcript**,
not pure STT inference. The corresponding previous seven-turn STT processing
median was 7.59 seconds. This distinction matters when comparing measurements.

The existing local path is one final job per utterance: VAD endpoint detection,
in-memory PCM concatenation, adapter admission, multipart HTTP, NumPy conversion,
mel features, CTranslate2 encoder, greedy decoder, then text/quality extraction.
Partial previews remain disabled for this synchronous provider because aborting
HTTP cannot cancel native inference. Incomplete transcripts never authorize
shopping actions. The service admits two active requests and rejects excess
admission with 503; it does not hide an unbounded inference queue.

`stt_profile.py` adds request-local feature/encoder/decoder timers without
changing native calls. Service response/logs separately identify dispatch
(including multipart parsing), preprocessing, admission, total inference and
postprocessing. Backend validates these optional finite/nonnegative fields,
logs its own queue wait and forwards timings with the final transcript. Startup
load/warmup are separate health fields, not per-request model loading.
Encoder/decoder/feature times are subsets of inference, not extra totals.
Buffering diagnostics additionally identify retained preroll, trailing silence,
VAD-positive duration and endpoint reason without trimming or logging audio.

On the identical saved generated corpus, small/six-thread **median encoder
4,685.22 ms, decoder 1,510.77 ms and feature extraction 8.78 ms** isolate the
dominant cost to CPU model work. The installed Faster Whisper implementation
pads short encoder segments to its 3,000-frame / 30-second context. One-to-few
second shopping utterances therefore do not imply proportionally tiny encoder
work. This investigation did not crop model features or change speech boundaries
to obtain an artificial speedup.

### Identical-audio model and CPU evaluation

Intel i7-1255U, 12 logical CPUs, approximately 16 GB RAM, CPU int8, two workers,
beam 1, best_of 1, temperature 0, no previous-text conditioning and no second
VAD/noise-reduction pass. Configurations ran sequentially, with services idle and
no builds/test runners during measurement.

The saved corpus contains **20 generated speech samples plus silence**: the six
requested commands across Lessac, Alba and slower Amy, plus two deterministic
low-level noise variants. Every configuration used the exact same saved PCM,
one-second preroll and 700 ms trailing silence. This is NOT a human/accent or
microphone-distance accuracy benchmark. Exact token comparison ignores only
case/punctuation; actual transcripts are preserved.

| Model / CPU threads | Generated exact / 20 | Inference median / p95 | Approximate CPU cores used | Loaded working set / process peak |
|---|---:|---:|---:|---:|
| small / 6, existing | 20 | 6,192 / 7,486 ms | 3.04 | 478 / 771 MiB |
| small / 2 | 20 | 9,219 / 10,182 ms | 1.72 | 459 / 771 MiB |
| small / 4 | 20 | 6,686 / 7,072 ms | 2.73 | 469 / 771 MiB |
| base.en / 4, candidate | 20 | 2,481 / 2,991 ms | 2.32 | 281 / 394 MiB |
| tiny.en / 4, rejected | 19 | 1,223 / 1,417 ms | 2.45 | 237 / 297 MiB |

CPU-core equivalents are process CPU seconds divided by inference wall seconds;
they are not whole-host CPU percentages. Memory is a separate fresh-process
working-set/peak measurement, not a simultaneous-model allocation estimate.
Small/six threads loaded in 6.06 s and warmed in 7.07 s; base.en loaded in
1.44 s and warmed in 1.97 s in those benchmark processes. Thread reductions did
not improve small-model median latency. Small/six remains unchanged.

Tiny.en changed one "Add two units to my cart" sample to **"at two units to my
cart"** and is not offered as a runtime choice. Base.en hallucinated "you" on
digital silence; its quality record is retained, not counted as accurate speech.
The existing explicit low-quality rejection remains necessary and is not a
calibrated guarantee that other text is correct.

Base.en revision `3d3d5dee26484f91867d81cb899cfcf72b96be6c` and tiny.en evaluation
revision `0d3d19a32d3338f10357c0889762bd8d64bbdeba` were recorded. The supported
optional downloader pins base.en and keeps its model README. Startup never
downloads weights. Experimental base.en uses only explicit English requests;
small remains resident for auto-detection/Hindi/Telugu. The legacy wire engine
ID stays compatible; health/inference logs disclose the actual model.

### Actual human microphone results

The user explicitly permitted **metrics/transcripts only, not saved raw audio**.
The named headed Chrome run completed **14 guided cases**, with **10**
reference/listening confirmations. Physical input was the built-in Intel Smart
Sound microphone array: 48 kHz mono/16-bit device capture, browser echo
cancellation/noise suppression/AGC, existing 16 kHz mono PCM16LE transport.
Capture was muted between cases and enabled only by Begin; finals were matched
to VAD turn IDs to prevent the earlier cross-step attribution error.

Actual final-transcript RMS ranged approximately **0.026-0.074**, peaks
**0.260-0.697**, with **zero clipped samples** in this run. This rules out
digital clipping for those buffers; it does not establish a clean speech/noise
ratio or diagnose the speaker's pronunciation. The existing averaging resampler,
one-second VAD preroll and endpoint buffering were preserved. No aggressive
denoising, gain change, transcript rewrite or speech trimming was introduced.

| Case / displayed words | Exact final transcript(s) | Actual outcome |
|---|---|---|
| 1. Hello, can you hear me? | I'm not sure. | Low-quality repeat; no completed playback; FAIL |
| 2. Show me available products. | Show me available all right. | VAD recovery error; reference/listening unconfirmed; FAIL |
| 3. Tell me about this product. | Tell me about this product. | Asked which product; search had not selected one; audible clarification, not product-details acceptance |
| 4. What is its price? | What is its price? What is its price? | Asked which product; human marked FAIL |
| 5. Open my cart. | Open my cord. | No open tool; ungrounded LLM instructions; FAIL despite human PASS mark |
| 6. Add two units to my cart. | Add 2 units to my pocket. | Asked which product; no mutation; reference/listening unconfirmed; FAIL |
| 7. Show my cart. | Show my butt. | Refusal, no cart-read tool; FAIL |
| 8. Remove one item. | Remove one item. | Asked which product; no mutation of empty cart; not cart-removal acceptance |
| 9. Products, then interrupt with price | Show me available Pro X. / Show me available products. | Second request searched catalogue; no stopped playback sources; interruption NOT verified |
| 10. What is the price of LASS HEALTH? | What is the price of last hand? | Generic catalogue search, not exact named-product recognition; FAIL despite human PASS mark |
| 11. Open my cart. | Open my cart. | Actual `open_cart` tool, `/cart` navigation, empty merchant cart; verified |
| 12. Open my cart. | Open my cut. | No new open tool; echoed opened wording; FAIL despite human PASS mark |
| 13. Open my cart. | Open my car. | No response within completion wait; reference/listening unconfirmed; FAIL |
| 14. Open my cart. | No final transcript | Speech wait expired; reference/listening unconfirmed; FAIL |

These are displayed reference words, not invented recordings of what was said.
The stored checkbox/notes distinguish confirmed references from unconfirmed
attempts. Case 4's repeated text cannot be assigned conclusively to duplicate
STT versus repeated spoken words without the prohibited recording. Case 9 did
not produce the requested interruption phrase or stopped buffers. Only three of
the five displayed cart repetitions have reference/listening confirmation, and
only one has both exact "Open my cart" recognition and a real open tool.
Different distance/noise instructions were displayed, but blank condition notes
do not prove those physical conditions occurred.

The merchant cart remained **0 units / INR 0 throughout** the human run.
Successful human cart mutation and reliable human barge-in are NOT verified.
Several responses had complete native buffers and listening confirmation, but
that does not turn a wrong transcript or unverified action into a pass.
The prior unconfirmed wrong-window attempt is retained separately and is not
counted as a reference-confirmed human test.

The faster candidate was **not promoted** after these failures. A narrow
post-transcription merchant-voice guard now requests clarification for the
observed "Open my cord/cut/car" variants, just as for the prior heart/card
variants. It neither rewrites text nor invokes tools, and regression tests
require no LLM/tool call or "Opened" claim. That safety change is unit-verified,
not retroactively claimed as a successful human recognition fix.

### VAD reliability caveat from this human run

Despite the historical 8,400 passing stress calls, the current physical run
reproduced a real failure with **816.39 ms service dispatch, 795.91 ms loop lag,
7.51 ms inference and 0.03 ms admission**. The VAD listener remained AboveNormal;
its timeout remains 500 ms. This is the same precisely isolated shared-host
scheduling issue, not a newly invented PCM/schema error. **VAD reliability is
therefore reopened as a deployment/host-contention blocker**, not reported as
unconditionally resolved. No timeout or real-time priority was increased.

### Twenty completed candidate turns and latency comparison

**VERIFIED, generated input only:** a strict 20-turn real-provider browser run
completed with every supplied phrase recognized (case/punctuation ignored),
quality accepted, no clarification counted as a normal reply, and native
playback completion. It repeated product search/details/price/cart-read/open
questions in isolated guest context. No builds or unit-test runners ran during
the benchmark. A further seven-turn live cart regression and resume/two
interruption scenarios also passed under the explicit candidate.

| Metric | Earlier small baseline, 7 shopping turns | Experimental base.en, 20 turns | Candidate p95, nearest rank |
|---|---:|---:|---:|
| STT adapter processing | 7.59 s | **3.08 s** | **5.96 s** |
| Speech onset to final transcript | 9.38 s | **5.41 s** | **7.77 s** |
| Speech onset to first audio | 10.80 s | **6.60 s** | **9.44 s** |
| Speech onset to complete playback | 19.31 s | **14.84 s** | **24.54 s** |

These are different prompt distributions/sample counts, so the table is a
descriptive comparison, not a controlled end-to-end speedup percentage. The
matched offline same-audio model table above is the controlled comparison.
Candidate maximum STT processing was 8.15 s and maximum first playback 11.84 s;
p95 is not a guaranteed bound. **None of these candidate numbers describe the
restored default or establish human acceptance.**

Actual candidate service timings over those 20 turns:

| Stage | Median | p95 |
|---|---:|---:|
| HTTP dispatch / parsing | 5.43 ms | 7.12 ms |
| PCM preprocessing | 0.285 ms | 0.618 ms |
| Engine admission | 0.030 ms | 0.042 ms |
| Inference total | 3,069.72 ms | 5,946.65 ms |
| Feature extraction, subset | 6.56 ms | 30.75 ms |
| Encoder, subset | 2,186.43 ms | 2,825.02 ms |
| Decoding, subset | 774.68 ms | 3,331.93 ms |
| Postprocessing | 1.04 ms | 1.65 ms |

Median buffered utterance was 2,590 ms. Speech-onset-to-endpoint median was
1,599.72 ms, including spoken content and silence, **not solely queue delay**.
No evidence supports changing the existing endpoint silence or sacrificing
speech boundaries to fix the dominant model cost.

After restoring normal small startup, two final real-provider browser turns
passed with new buffering telemetry. Their exact buffered components were
940/1,000 ms retained preroll, 700 ms trailing silence, and 1,280/1,660 ms
VAD-positive speech, totaling 2,920/3,360 ms. This confirms retained boundary
context rather than proving human phoneme accuracy. Processing was still
8.89/7.97 s; **no unverified default latency improvement is claimed**.

The candidate-run resource snapshot had 0.979 GiB available physical RAM.
Working sets were backend 104.6 MiB, STT 149.1 MiB, VAD 20.5 MiB and TTS
341.1 MiB; STT had 48 threads and VAD remained AboveNormal. These are pageable
instantaneous working sets, not full resident-model requirements or peaks.
Both small and base.en were loaded in that experimental service, unlike the
fresh-process per-model memory table. No VPS measurements were available.

### Final current-phase regression and startup verification

| Actual command/check | Result |
|---|---|
| Complete backend `npm test -- --runInBand` | **754 passed; 96 skipped by existing gated suites; 59 passed / 6 skipped suites** |
| Focused voice/integration/merchant-agent/tool selection | **184 passed / 17 suites**; included in full count, not additive |
| Python runtime | **17 passed** |
| Frontend voice/widget | **50 passed** |
| Merchant cart/unit | **73 passed** |
| Merchant adapter | **15 passed** |
| Merchant desktop/mobile guest-cart Playwright | **4 passed** |
| Candidate real-provider performance | **20 completed strict generated turns** |
| Candidate actual shopping/resume/buffered and generating interruption | **4 scenarios passed** |
| Backend/frontend/merchant production builds | **All passed**; merchant includes strict TypeScript |
| Backend type-aware lint | **Exit 0; existing warnings remain** |
| Legacy HTTP e2e | **19 setup failures**, still missing repository `DataSource`; bodies not reached |
| Restored-default four-stream VAD/Piper/Whisper probe | **2,400 calls, zero errors**, median 21.57 / p95 32.69 / max 119.09 ms |
| Restored-default two browser turns | **Passed**, full native playback and actual buffering telemetry |

No skipped database fixture is counted as a passing integration test, and no
migration/shared-database substitution was used. The final passing VAD probe
does not erase the actual human-run dispatch failure.

Restoring default startup exposed a real Windows PowerShell helper defect:
`$ErrorActionPreference = 'Stop'` treated normal Uvicorn stderr
`INFO: Started server process ...` as fatal and terminated startup. The helper
now narrowly uses Continue for the native process, restores its original error
preference in `finally`, and explicitly rejects nonzero native exit codes.
The existing occupied-port guard still rejects duplicate listeners. Actual
startup through the corrected helper, health `englishModel: small`, subsequent
stress inference and browser audio were verified. No error output is suppressed
or converted to a fake healthy state.

### Remaining acceptance

- **VERIFIED:** CPU encoder/decoder bottleneck; additive per-request profiling;
  identical-input model/thread comparison; 20-turn candidate performance; current
  real guest cart, resume/interruption regressions; full unit/build results.
- **IMPLEMENTED, not promoted:** faster explicit English base.en candidate,
  retaining original small default/fallback. Human accuracy did not qualify it.
- **FAILED / PENDING:** reliable human shopping, five confirmed cart repetitions,
  real human cart mutation and barge-in, pronunciation/full listening acceptance.
  Ten confirmed guided references do not imply the ten required workflows passed.
- **BLOCKED:** recurring shared-host VAD scheduling deadlines; unresolved isolated
  legacy HTTP database fixture; human accuracy without authorized recordings
  cannot be compared against other models on the same captured waveform.

For another human attempt, use the normal small default, headphones and a quiet
room; confirm the selected laptop microphone. Run the provided named-window
harness, click Begin only in that window, speak exactly once, wait for the full
reply, and record actual words/conditions when they differ. Complete all ten
workflow references plus five confirmed cart repetitions. Inspect exact text,
matched turn/tool result, cart count/total and native/subjective playback before
marking pass. The future harness now requires matching reference text and the
expected verified tool, not just a human PASS click; this stronger classification
does not alter the preserved failed-run evidence. No raw microphone recording
should be enabled without new permission.

### Current implementation and reproduction

Changed runtime: `scripts/local-voice/stt_profile.py`, `server.py`,
`download_models.py`, `start.ps1`; STT port/adapter, session timing types/manager;
the merchant-voice ambiguity guard; corresponding Python/provider/session/agent
tests; runtime guide, root README and this report. Existing APIs, PCM protocol,
STT final authority, origin/auth checks, real merchant cart and idempotency
remain intact. No database or environment changes were made.

Normal production/demo startup remains:

```powershell
# From the McZEN repository root, separate terminals:
& .\backend-nestjs\scripts\local-voice\start.ps1 -Service stt
& .\backend-nestjs\scripts\local-voice\start.ps1 -Service vad
& .\backend-nestjs\scripts\local-voice\start.ps1 -Service tts
# Backend directory:
npm run build
npm run start:prod
```

Only for explicit candidate evaluation after stopping the STT listener:

```powershell
& .\backend-nestjs\.local-voice\venv\Scripts\python.exe .\backend-nestjs\scripts\local-voice\download_models.py --directory .\backend-nestjs\.local-voice\models --english-model base.en
& .\backend-nestjs\scripts\local-voice\start.ps1 -Service stt -EnglishModel base.en
```

The merchant origin remains `http://127.0.0.1:5173`, with
`npm run dev -- --host 127.0.0.1 --port 5173` in its existing project. Platform
Vite uses port 5174. Do not start duplicate listeners or substitute localhost for
the registered merchant origin.

## Previous: Final voice reliability and supervised acceptance (6 November 2026)

**PARTIALLY VERIFIED / HUMAN ACCEPTANCE FAILED AND INCOMPLETE.** This section records the follow-up investigation;
the previous phase remains below for comparison. No migration or existing
environment file was changed.

### Actual VAD failure isolated

The failing path is browser 100 ms / 3,200-byte PCM16LE mono 16 kHz packets,
existing WebSocket queue, `consumeAudio`, `SileroVadAdapter.detectBatch`, HTTP
POST `/predict`, FastAPI dispatch, bounded admission and serialized Silero ONNX
inference. The service still returns one decision per 20 ms / 640-byte frame,
up to 440 ms per batch. Schema/sample-rate mismatches were not the observed cause.

A real **compiled NestJS adapter** test reproduced two failures under concurrent
Whisper inference and repeated Piper generation. Client admission took only
0.079-0.119 ms. The existing 500 ms deadline was observed after 725/755 ms, with
no response headers. Correlated service records for the same two stream IDs
showed **860.43/862.10 ms dispatch delay**, **803.71 ms event-loop lag**, only
**5.68/14.64 ms model processing**, and about **0.03 ms admission delay**.
This precisely isolates that reproduction to scheduling/dispatch starvation,
not VAD inference, a saturated model queue, malformed PCM or missing service.
Subsecond OS scheduling under memory/CPU pressure remains relevant; an idle
health response does not test this deadline.

### Safe changes and rejected alternatives

- On Windows only, the existing VAD sidecar sets its own process to
  **AboveNormal**, not realtime, before loading the model. STT, TTS, NestJS and
  unrelated processes remain Normal. This reserves scheduling precedence for
  brief latency-critical VAD work; it neither disables VAD nor increases its
  500 ms deadline. A priority-setting failure is explicit, not silently ignored.
- The installed Piper loader created default ONNX pools for six voices; the
  original process had 78 threads. Existing voices now use the public Piper
  constructor with bounded two-thread ONNX sessions and disabled idle spinning.
  Silero uses one thread with idle spinning disabled. Voice models, synthesis
  settings, PCM encoding, sample rates and output duration are unchanged.
  Piper was observed with 31-34 threads after initialization.
- **Rejected:** lowering both STT/TTS to BelowNormal. VAD passed that probe, but
  STT timed out at its unchanged 45-second bound. Those priorities were restored
  to Normal; that experiment was not adopted as a successful pipeline fix.
- **Insufficient by itself:** bounded Piper pools alone. Actual Node adapter
  failures still reproduced before VAD scheduling precedence was applied.
- A separate urllib probe still showed occasional >500 ms total calls while
  server inference was fast; a staged `http.client` probe did not reproduce
  those outliers. Client-library timings are not interchangeable. The accepted
  stress measurements below use the **actual compiled NestJS adapter**, not a
  proxy Python request test.
- Session teardown, reset and interruption now cancel in-flight batched VAD
  requests. A late failure from an older epoch cannot reset a resumed session.
  In-flight native work is not claimed to be preemptively cancelled; no blind
  retry replays stateful audio.
- Adapter logs now include session/stream ID, phase, admission wait, duration,
  response state and cancellation/deadline reason. Service diagnostics separate
  dispatch, admission, processing and event-loop lag. No raw PCM or credentials
  are logged.

### Actual concurrent reliability measurements

Intel i7-1255U, 12 logical CPUs, approximately 16 GB RAM, no NVIDIA GPU; local
Whisper-small/int8/six threads and two workers, installed Piper models, same
Silero model and unchanged 500 ms deadline. Approximately 0.35-0.8 GiB available
physical memory was observed during portions of this investigation. Tests ran
without concurrent builds. Digital silence traversed real VAD while real Piper
generated repeatedly and Whisper performed one reference transcription per run.
This is scheduling/reliability evidence, not concurrent human accuracy evidence.

| Actual Node adapter probe | Completed VAD calls | Failures | Median / p95 / max successful call |
|---|---:|---:|---:|
| Bounded Piper, no VAD priority, 2 streams / 60 s | 1,198 | 2 deadline failures | 16.89 / 33.62 / 113.41 ms |
| VAD priority only, STT/TTS Normal, 2 streams / 60 s | 1,200 | 0 | 15.42 / 20.16 / 147.17 ms |
| Same scheduling, 4 streams / 120 s | 4,800 | 0 | 22.65 / 33.43 / 200.89 ms |
| Fresh backend/STT restart, same scheduling, 4 streams / 60 s | 2,400 | 0 | 22.95 / 33.49 / 131.33 ms |

Failed durations are not excluded from the failure column or presented as
successful maxima. The four-stream run also measured Node event-loop mean
15.22 ms, p95 21.76 ms and maximum 287.31 ms. **8,400 actual adapter calls**
passed across the three adopted-scheduling runs; this bounded observation does
not guarantee deadlines under arbitrary host overload or a disabled service.
The VAD process retained AboveNormal after a normal startup/restart.
A final controlled restart also verified the real stopped listener produces
`VOICE_ENGINE_UNAVAILABLE`, not success. After normal startup, the inspected new
process was AboveNormal and the compiled adapter accepted a 22-frame batch.
Actual malformed base64, 641-byte misaligned PCM and 8 kHz input each returned
HTTP 422; another valid batch then succeeded. No migration or fake VAD API
was involved.

### Short-command recognition and explicit clarification

The model was not blindly replaced. An offline same-model comparison used three
cached generated "Open my cart" samples (Lessac normal/0.8 rate, Amy normal)
with one second preroll and 700 ms trailing silence, plus digital silence.
Beam 1 and beam 5 both recognized all three spoken generated samples correctly:

| Generated sample | Beam 1 / beam 5 processing |
|---|---:|
| Lessac, normal | 8,047.77 / 9,137.03 ms |
| Lessac, 0.8 rate | 7,790.25 / 8,572.64 ms |
| Amy, normal | 7,148.10 / 8,165.53 ms |
| Digital silence | 8,970.64 / 9,734.88 ms |

Beam 5 hallucinated **"You"** on silence (no-speech probability 0.835), while
beam 1 returned empty text. **Beam 1 was retained**: the sample showed no
accuracy gain and higher latency. This does not explain away the earlier
browser "Open mic heart" failure or establish human accent/noise robustness.

Whisper now returns its duration-weighted segment log probability and no-speech
probability as `recognitionQuality`, **not fabricated calibrated confidence**.
A log probability below -1 or no-speech probability above 0.6 requests a repeat
without agent/cart execution. The original transcript remains visible and
unchanged. These are conservative rejection heuristics based on decoder
signals; they do not prove a confidently wrong word is correct.
Aggregate PCM RMS, peak and clipped-sample fraction are also returned and
validated, without retaining or logging raw human audio. Their plumbing was
verified against actual generated speech after the STT restart (RMS 0.156,
peak 0.99997, clipped fraction 0.0000498), not retrospectively measured for the
earlier human run. This instrumentation supports the next real-microphone
calibration; it is not evidence that the physical signal problem was fixed.

Only after transcription, the agent asks for clarification on the observed
ambiguous voice destinations such as "Open mic heart", rather than silently
rewriting them as "Open my cart" or executing navigation. A subsequent genuine
"Open my cart" transcript still uses the existing real merchant tool.

### Supervised physical microphone acceptance

The user agreed to participate. The first guided run timed out before the first
Begin confirmation and recorded **zero accepted cases**; no generated audio was
substituted. A retry recorded each displayed reference, actual transcript,
agent reply, native playback events, stage timings, actual cart read-back and
explicit human PASS/FAIL/listening confirmation in an isolated real Chrome guest
session. No raw human audio is retained. Browser-tool CDP access timed out, so
the supervised fallback uses installed Chrome through existing Playwright.

The first confirmed retry case **FAILED**. The human marked failure and confirmed
speaking/listening. Its displayed reference was "Hello, can you hear me?". The
case interval contained "Bye bye.", "I", "I'm gonna put the button on the top.
I'm gonna put it on the bottom.", and longer repetitive/unrelated transcripts.
All five were rejected by real decoder quality, and all replies were exactly
"I could not hear that clearly. Please repeat your request." No shopping tool
ran, and the actual isolated merchant cart remained empty.

**Attribution limitation:** capture continued between panel steps. An earlier
utterance could finish after Begin, and one computed onset-to-transcript interval
was negative. Consequently these interval transcripts are NOT presented as five
independently confirmed transcriptions of the displayed reference. Its computed
first-audio latency is not a valid single-request benchmark. The observed STT
inference durations were 13.03, 11.66, 15.74, 34.03 and 17.00 seconds, not five
separately confirmed human tests.

The device was the default Intel Smart Sound microphone array, reported as
48 kHz, mono, 16-bit, with browser echo cancellation, noise suppression and AGC
enabled. The user identified the laptop built-in microphone. These facts do not
isolate whether signal level, noise, acoustic feedback, device selection or
recognition robustness caused the failed attempt. No gain, model or rejection
threshold was blindly relaxed to force a pass.

The retry ended at `waiting_for_human_verdict_2` after its 300-second confirmation
deadline. **One confirmed case, zero passes; ten required successful human
interactions and repeated human "Open my cart" recognition remain PENDING.**
The first case also hit the 150-second automated response-completion wait.
The second case has no recorded human verdict and is not counted. The Chrome
context was closed and microphone tracks released. A subsequent harness fix
preserves unconfirmed case drafts if a future verdict wait expires; it cannot
recover missing evidence from this finished run.

### Current live shopping and playback regression

**VERIFIED, generated input only:** seven fresh turns traversed the actual browser
capture/transport, Silero, Whisper, agent/tools, Piper and native WebAudio.
Providers, transcripts, cart results and navigation were not mocked.

| Generated reference | Actual final transcript | Actual result |
|---|---|---|
| Show me some products. | Show me some products. | Catalogue cards including LASS HEALTH at INR 1,035 |
| Tell me more about the first product. | Tell me more about the first product. | Correct LASS HEALTH details and price |
| What is the price? | What is the price? | Selected product remains INR 1,035 |
| Add two to my cart. | Add 2 to my cart. | Merchant cart: 2 units, INR 2,070 |
| Show my cart. | Show my cart. | Read-back: 2 units, INR 2,070 |
| Remove one item. | Remove one item. | Atomic decrement: 1 unit, INR 1,035 |
| Open my cart. | Open my cart. | Actual `/cart` navigation; 1 unit, INR 1,035 |

All seven responses completed their scheduled native audio buffers without
stopped sources. This verifies playback scheduling/completion, NOT human
audibility, pronunciation or naturalness. The guest cart is still merchant-owned.
Authenticated customer sessions and checkout remain outside this acceptance.

Fresh actual-browser recovery tests also passed: authenticated WebSocket resume
with only 84.50 ms residual playback startup overhead; buffered-response barge-in
stopped 33 sources; barge-in during active generation stopped 8 sources and
produced one actual server interrupt. Both interruption tests processed the next
request in the same healthy session. These are generated-speech interruptions,
not the still-pending supervised human interruption case.

### Current pipeline latency and remaining headroom

Same i7-1255U/12 logical CPUs, CPU Whisper-small int8/beam 1/six threads, bounded
two-thread Piper voices, VAD AboveNormal and other services Normal. No production
builds or unit-test runners ran during these live measurements. Values below
come from the seven generated shopping turns, not failed human-case timing.
For seven heterogeneous turns, nearest-rank p95 equals the maximum and is
descriptive only; it is not a production capacity/SLO estimate.

| Measured stage | Samples | Median | p95 |
|---|---:|---:|---:|
| VAD adapter time in acknowledged packets | 1,485 | 11.02 ms | 13.61 ms |
| Backend audio-queue wait | 1,485 | 0.058 ms | 0.101 ms |
| Final STT | 7 | 7,589.42 ms | 9,145.50 ms |
| Agent including tools | 7 | 155.35 ms | 635.76 ms |
| Individual correlated tool execution | 7 | 118 ms | 555 ms |
| TTS request to first audio | 7 | 1,116.02 ms | 2,361.28 ms |
| Total TTS generation | 7 | 2,493.91 ms | 7,356.81 ms |
| TTS real-time factor | 7 | 0.302 | 0.402 |
| Injected speech onset to final transcript | 7 | 9,376.80 ms | 11,316.30 ms |
| Injected speech onset to first playback | 7 | 10,799.60 ms | 13,911.20 ms |
| Injected speech onset to complete playback | 7 | 19,311.50 ms | 32,226.40 ms |

Seven **last-per-turn capture snapshots**, not whole-stream percentiles, showed
0.20 ms callback time, effectively zero delivery/queue delay, and 2.40 ms median
WebSocket round trip (maximum 2.90 ms). Existing capture is AudioWorklet, with
100 ms / 3,200-byte PCM16LE mono 16 kHz wire packets.

**Residual tail explicitly retained:** one browser-run VAD call succeeded in
505.39 ms despite its configured 500 ms timer. Its service dispatch was
494.24 ms, event-loop lag 466.93 ms and inference 3.80 ms. Backend queue wait
maximum was 415.96 ms. JavaScript timers are not hard realtime under scheduling
delays. There were no surfaced VAD failures in these completed browser scenarios,
but this near-deadline tail means the priority mitigation does NOT establish
unconditional sub-500 ms performance. The cause remains precisely isolated to
dispatch/scheduling rather than Silero computation; production capacity or
separation from host contention still needs deployment measurement.

This phase's valid before/after comparison is the matched actual-adapter VAD
reproduction versus adopted scheduling above. The previous phase's two-turn
latency comparison is retained below; its different prompts/sample sizes are
not used to claim a new percentage STT improvement. STT remains the dominant
measured user-perceived bottleneck; beam 5 was slower without a demonstrated
quality gain and was correctly rejected.

During the controlled browser run, a resource snapshot showed 0.807 GiB
available of 15.711 GiB physical RAM. Listener process working sets were backend
126.9 MiB, STT 434.0 MiB, VAD 84.9 MiB and TTS 383.2 MiB; thread counts were
14/44/24/30 respectively. These are instantaneous working sets, not peak memory
or model allocation sizes. Earlier bounded-Piper measurement consumed 84.64 CPU
seconds over 61.43 wall seconds (~1.38 CPU cores), with 31 threads. No VPS was
available for measurement; none is claimed.

### Final current-phase regression results

| Check actually executed | Current result | Previous delivered phase |
|---|---|---|
| Backend voice, website integration, merchant-agent/tool suites | **177 passed / 17 suites** | 160 passed |
| Python local runtime | **14 passed** | 11 passed |
| Frontend voice/widget | **50 passed** | 50 passed |
| Merchant cart/unit | **73 passed** | 73 passed |
| Merchant server adapter | **15 passed** | 15 passed |
| Merchant desktop/mobile guest-cart Playwright | **4 passed** | 4 passed |
| Actual voice browser shopping/resume/two interruption modes | **4 scenarios passed** | Earlier shopping run failed |
| Actual VAD stop/restart and valid/invalid processing contracts | **passed** | Not claimed from mocks |
| Backend production build | **passed** | passed |
| Frontend production build | **passed** | passed |
| Merchant strict TypeScript + production build | **passed** | passed |
| Backend type-aware lint | **exit 0; warnings remain** | warnings remain |
| Legacy HTTP e2e | **19 setup failures; test bodies not reached** | same missing DataSource |

The legacy HTTP command was rerun separately and still cannot construct
`ConversationsRepository` because its fixture does not provide `DataSource`.
No shared database, credentials, migration or relaxed test assertion was used
to conceal this failure. All other results above are fresh executions, not a
relabeling of mocked tests as live database/cart acceptance.

Current-phase files: `backend-nestjs/scripts/local-voice/server.py` and
`test_runtime.py`; `src/voice/vad/silero-vad.adapter.ts`;
`src/voice/voice.types.ts`; `src/voice/voice-session.manager.ts`;
`src/voice/stt/stt.port.ts`; `src/voice/stt/faster-whisper.adapter.ts`;
`src/voice/voice-provider.spec.ts`; `src/voice/voice-session.manager.spec.ts`;
`src/agent/agent.service.ts`; `src/agent/merchant-cart.agent.spec.ts`;
the runtime deployment guide, root README, widget deployment guide and this
report. Agent/tool behavior outside the guarded merchant voice clarification,
existing security, real cart idempotency, environments and migrations are
preserved.

### Remaining acceptance and exact next manual check

- **VERIFIED:** VAD root cause isolated, bounded scheduling mitigation, actual
  concurrent/restarted adapter probes, real guest shopping, generated playback
  completion, generated barge-in and authenticated resume.
- **IMPLEMENTED:** truthful decoder-quality rejection, unchanged transcripts,
  ambiguity clarification, PCM level diagnostics and stale-VAD cancellation.
  Their presence does not establish human recognition or listening quality.
- **PENDING:** ten reference-confirmed real human interactions, repeated human
  "Open my cart" at normal/slow rates and microphone distances, human interruption,
  accent/background-noise evaluation and full listening acceptance.
- **BLOCKED:** human signal/recognition diagnosis needs another coordinated
  reference attempt with the new aggregate level diagnostics; legacy HTTP
  acceptance needs an isolated database-enabled test fixture. Hard realtime
  performance cannot be promised on this shared memory-constrained Windows host.

Use the existing startup commands below: start STT/VAD/TTS via
`backend-nestjs/scripts/local-voice/start.ps1 -Service stt|vad|tts` in separate
terminals; start the backend with `npm run start:prod` after `npm run build`,
the platform with `npm run dev -- --host 127.0.0.1 --port 5174` from `frontend`,
and the merchant with `npm run dev -- --host 127.0.0.1 --port 5173` from
`C:\Users\jilan\Desktop\mcgen-rea`. Use the registered
`http://127.0.0.1:5173` merchant origin. Do not start duplicate listeners; services on
3000/8001/8002/8003 were left healthy with the verified current code.

For the next human attempt, use headphones, select/check the laptop microphone,
wait for silence and readiness, then speak one displayed reference only after
Begin. Wait without speaking during the reply. Record the exact reference,
unchanged final transcript, its quality/PCM level fields, matched turn ID,
audibility and cart read-back before marking PASS/FAIL. Reject cross-step
utterance attribution rather than using negative or mismatched latency. Repeat
the ten requested phrases and then "Open my cart" slowly at ~40 cm and normally
at 10-20 cm. Mark failures and repetitions honestly; never treat generated
speech or repeat prompts as successful human acceptance.

## Human voice acceptance and latency optimisation (6 November 2026)

**PARTIALLY COMPLETE. Human conversation acceptance is still PENDING.** The
physical microphone is available, but no tester supplied and confirmed reference
utterances or a listening assessment. Generated-input browser results below are
not human acceptance. This section supersedes earlier voice status statements.
Existing environment files and migrations were preserved; no migration ran.

### Changes and root causes

1. **VERIFIED - avoid duplicate CPU inference.** The session manager previously
   submitted growing partial Whisper previews. Cancelling their HTTP requests
   cannot cancel the local service's synchronous native inference. Those jobs
   compete with final transcription. The existing Faster Whisper adapter now
   declares `supportsPartial: false`; the manager skips previews for that
   capability only and advertises `partialTranscription: false`. Other providers
   retain their existing preview behavior. The final model and decoding settings
   were not reduced to obtain a faster result.
2. **VERIFIED - buffered-response barge-in.** Generation can finish while browser
   playback still has seconds remaining. Real VAD speech onset now stops those
   buffered sources, even after normal server generation reset, without resetting
   or discarding the newly captured utterance.
3. **VERIFIED - reconnect playback clock.** Live recovery testing exposed about
   nine seconds of extra first-audio delay: the old AudioContext's playback
   timestamp was reused against a newly created context starting at zero. Capture
   initialization now resets scheduling to the new context's current time.
4. **VERIFIED in focused fault tests - bounded provider work.** STT deadlines now
   include reading the response body. Cancelled semaphore waiters do not later
   perform inference. Piper body reads have a 12-second **idle** deadline and
   respond to cancellation; this is not a longer total response timeout.
   Initial and mid-stream TTS failures report `TTS_UNAVAILABLE` with text fallback,
   not an inaccurate agent-service error.
5. **VERIFIED - contextual shopping.** "What is the price?" resolves the selected
   merchant product. "Remove one item" removes one unit atomically through the
   existing merchant cart and durable idempotency ledger. The existing
   `remove_cart_item` accepts optional whole `quantity`; omitting it preserves
   whole-line removal. This is not a new cart or endpoint.
6. **IMPLEMENTED; measured in live turns - correlated diagnostics.** A session ID
   and turn/request ID connect VAD onset, final STT, agent/tools and TTS. Browser
   metrics include first/completed playback, capture/transport and backend
   timings. The prior STT log incorrectly included the subsequent agent/TTS
   wait; its timer now measures STT only. Logs do not include raw PCM, credentials
   or tool arguments. Browser scheduled-playback timing is not a measurement
   taken at a physical speaker.

### Physical microphone observation

**VERIFIED:** headed installed Chrome, original `getUserMedia`, granted microphone
permission and secure loopback context; no synthetic stream in this run.
The Intel Smart Sound microphone array reported 48 kHz, mono, 16-bit samples,
echo cancellation/noise suppression/automatic gain and 10 ms device latency.
Existing AudioWorklet output remained 16 kHz, mono PCM16LE; 100 ms / 3,200-byte
packets with ordered protocol sequence/epoch handling were acknowledged.

During the 25-second unattended observation: 246 packet acknowledgements, five
pongs, one VAD onset and one final transcript, **"Paripet Madhu."** The final
segment contained 1,680 ms of audio; STT took 16,012.66 ms and measured
speech-to-transcript time was 17,541 ms. No answer playback completed inside the
observation window. Probe RMS 0.032305 and peak 1 are uncalibrated ambient signal
observations, not a noise, clipping, accuracy or listening-quality acceptance.
No raw physical-microphone recording was retained.

**PENDING / requires human tester:** the transcript has no confirmed spoken
reference. It proves an ambient physical-input transcription was observed, not
that a human sentence was understood correctly. Confirmed human shopping,
complete audible replies, human interruption and background-noise acceptance
remain incomplete.

### Controlled before/after latency

Same local i7-1255U (10 cores / 12 logical CPUs), approximately 16 GB RAM, no
NVIDIA GPU; cached `whisper-small`, CPU/int8, six threads, two workers, beam 1,
best-of 1, temperature 0. English Piper input traversed the actual browser
AudioWorklet, WebSocket, Silero, Whisper, agent/tools and Piper output. No STT,
agent, merchant cart or TTS response was mocked. Builds/tests were not running
during these two-turn measurements. These are small sequential observations,
not a statistical benchmark; restart, cache, thermal and memory variation matter.

| Generated reference | Before STT | After STT | First transcript before / after | First playback before / after | Complete playback before / after |
|---|---:|---:|---:|---:|---:|
| Show me some products. | 15,039.81 ms | 9,275.72 ms | 17,153.9 / 11,401.6 ms | 19,089.7 / 13,635.5 ms | 37,435.6 / 32,096.0 ms |
| Tell me more about the first product. | 21,868.10 ms | 7,942.43 ms | 24,966.3 / 10,622.3 ms | 26,588.3 / 13,241.3 ms | 33,368.0 / 19,975.9 ms |

Observed final STT reductions: 38.3% and 63.7%. CPU transcription remains the
dominant delay; this is not yet a low-latency human conversation experience.
First-transcript/playback/complete figures are relative to harness input
scheduling; service STT durations are independent monotonic stage timings.

| Additional stage, after run | Products turn | Details turn |
|---|---:|---:|
| AudioWorklet callback, last observed | 0.30 ms | 0.20 ms |
| Capture packet duration / bytes | 100 ms / 3,200 | 100 ms / 3,200 |
| Maximum observed capture queue | 4 ms | 4 ms |
| WebSocket RTT, last observed | 2.10 ms | 2.70 ms |
| Maximum WebSocket send buffer | 3,211 bytes | 3,211 bytes |
| Maximum backend queue wait | 0.202 ms | 0.285 ms |
| Maximum VAD request processing | 19.48 ms | 16.89 ms |
| Service-reported Whisper inference | 9,250 ms | 7,922 ms |
| Agent plus tools, backend boundary | 133.02 ms | 971.48 ms |
| TTS request to first generated audio | 2,020.09 ms | 1,005.49 ms |
| TTS generation / generated duration | 5,478.01 / 18,471 ms | 1,852.68 / 6,733 ms |
| TTS real-time factor | 0.297 | 0.275 |

Capture-to-VAD maximum in this run was 61 ms; the browser assembly packet is
100 ms. These are different boundaries, not conflicting sample rates. Individual
tool execution also logs `voice_tool_timing` with correlation IDs. Agent timing
includes its tools; it is not an isolated model-only benchmark. Verified shopping
intents resolve actual catalogue/cart data without an unnecessary Ollama call.

**VERIFIED - CPU experiment, six threads retained:** identical cached generated
PCM and unchanged decoder settings, warm-up then two phrases twice, sequential
processes: six threads 8,545.79 / 8,149.53 / 6,868.24 / 5,996.86 ms; two threads
10,278.62 / 10,188.95 / 10,644.54 / 10,375.56 ms. Both produced the expected
generated-input text. Two threads were slower and were not adopted. This does
not establish human-speech accuracy or justify silently changing model size.

**VERIFIED - resource sample:** 63.845 seconds spanning the controlled after run.
CPU percentages are process CPU-time deltas divided by elapsed time and all 12
logical processors; they are not peak utilization or per-core saturation.

| Process | CPU seconds / normalized mean | Working set before / after |
|---|---:|---:|
| NestJS | 4.734 / 0.62% | 84.9 / 119.5 MiB |
| Whisper | 40.266 / 5.26% | 477.5 / 479.3 MiB |
| Silero | 4.469 / 0.58% | 19.8 / 19.9 MiB |
| Piper | 74.938 / 9.78% | 36.4 / 300.5 MiB |

Working set is resident memory, not committed/model memory. Available physical
memory varied from about 0.8 to 2.2 GiB during this phase. This short sample
does not prove absence of leaks. No VPS measurements were made.

### Reliability evidence and remaining blockers

- **PENDING - intermittent VAD processing deadline:** an initial seven-turn
  run correctly changed the cart but its last answer was cut short. The actual
  `/predict` request timed out after 523 ms without response headers, crossing
  the existing 500 ms deadline. Recovery stopped nine queued playback buffers.
  Logs identify `VOICE_PROVIDER_TIMEOUT`, not an invalid audio schema or an
  authentication failure. Health alone does not prove timely processing.
  One subsequent seven-turn cart/playback run completed, but another final run
  failed again (920 ms elapsed before the same deadline was observed). Its
  service/host scheduling cause is **not established** and it is
  not declared fixed. The timeout was not inflated and stateful Silero inference
  was not blindly retried, which could process the same audio twice.
- **VERIFIED in automated provider/session tests:** malformed audio/responses,
  unavailable VAD, bounded queue/concurrency, slow STT, ordering/backpressure,
  STT header/body timeout, TTS idle timeout/cancellation and initial/mid-stream
  TTS failures. These are fault-injected tests, not live service-restart proof.
- **PENDING:** calibrated background noise, human listening/pronunciation/rhythm,
  hour-long sessions, concurrent customer load and real network outages.
  Shared VAD/TTS were not restarted merely to manufacture fault acceptance.
  Piper remains TTS, not natural voice cloning; Hindi/Telugu acceptance was not
  expanded. Authenticated merchant carts and checkout remain disconnected.
- **BLOCKED - legacy backend HTTP e2e fixture:** the existing 19-test suite fails
  in setup because `ConversationsRepository` requires a TypeORM `DataSource`
  while the fixture supplies no DB configuration. The 19 test bodies did not
  execute. No assertions were skipped or weakened, no database was substituted
  with mocks and no migrations were run against the shared application DB.
  Completing this suite requires an approved isolated current-schema fixture.

### Latest browser conversations and playback

**VERIFIED, controlled generated input - both interruption cases:** actual VAD
detected both utterances; no transcript or interrupt event was injected.
During Piper generation the server issued one interrupt and seven scheduled
buffers stopped; all 26 started sources eventually ended, including the complete
new answer. After generation had finished, VAD stopped 34 buffered old sources;
all 62 started sources eventually ended and the new price answer completed.
Both runs transcribed "Show me some products." and "What is the price?"
correctly, and returned LASS HEALTH at 1035 INR. These are native WebAudio
completion/stop observations, not proof of subjective sound quality.

**VERIFIED, controlled reconnect plus silence:** transparent Playwright
WebSocket forwarding closed the owned connection from the server side with
code 1001; real backend handshake/authentication/session-resume messages and
audio were forwarded unchanged. A new capture stream was created, followed by
10 seconds of silence and another successful question. This is not a real
internet outage test. After the clock fix, the second first transcript was at
11,078.7 ms, first playback at 12,738.8 ms and complete playback at 19,430.6 ms.
Playback-start excess over measured agent/TTS boundaries fell from about
9 seconds to **233.96 ms**, below the harness's 1,500 ms regression threshold.
Browser API attempts to initiate close code 1001 were rejected as invalid; a
client-sent 4000 intentionally did not reconnect. Those were harness limitations,
not reasons to loosen production reconnect/authentication rules.

**Latest seven-turn shopping run: FAILED overall, first six verified.**
The first six responses completed 153 output buffers with no explicit stops;
the merchant cart really changed from zero to two units / INR 2,070, then one
unit / INR 1,035. The final question was misrecognized and subsequently hit the
VAD deadline. No success/navigation confirmation was fabricated.

| Spoken generated reference | Actual final transcript | Actual result |
|---|---|---|
| Show me some products. | Show me some products. | Product cards; LASS HEALTH 1,035, WEIZAP 1,620, HALE.O 3,600 Indian rupees; recorded catalogue, not a sales ranking. |
| Tell me more about the first product. | Tell me more about the first product. | "LASS HEALTH is listed at 1035 INR. The product card opens its recorded details." |
| What is the price? | What is the price? | Same verified selected product/price. |
| Add two to my cart. | Add 2 to my cart. | "Added 2 units of LASS HEALTH to your merchant cart." Read-back: 2 units, 2070 INR. |
| Show my cart. | Show my cart. | "Your cart contains 2 units, total 2070 INR. Checkout and payment are not connected." |
| Remove one item. | Remove one item. | "Removed 1 unit of the selected product from your merchant cart." Read-back: 1 unit, 1035 INR. |
| Open my cart. | Open mic heart. | No completed agent answer or response audio; recoverable VAD error. Cart retained 1 unit / 1035 INR. |

Final-run STT ranged 6.93-16.52 seconds, including 16.52 seconds for removal;
the failed last transcription took 11.59 seconds. This variation and the
misrecognition are additional evidence that reliable English latency/accuracy
acceptance is **not complete**, despite the controlled before/after improvement.
The earlier completed run did open the real `/cart` and retained one unit, but
its first generated sentence was truncated to "me some products." The harness
now waits for actual audio acknowledgements before starting its reference input
and checks the complete normalized reference, not merely a plausible answer.
Original negative evidence is retained. A spurious negative playback duration
on the failed no-audio turn was corrected to null with an explicit annotation;
it represented the previous turn's end time, not measured playback.

### Regression results

| Validation actually executed | Result / classification |
|---|---|
| Backend voice, provider, gateway/auth/tickets, website integration, cart agent/service and tool executor | **VERIFIED: 160 passed in 17 suites**, final run with `--detectOpenHandles`; no open-handle diagnostic. Mocked/fault-injected tests are not live SQL or microphone acceptance. |
| Frontend voice/widget tests | **VERIFIED: 50 passed**, previously 48 at cart delivery. |
| Merchant unit tests | **VERIFIED: 73 passed**, previously 72; atomic relative removal/replay/reload covered. |
| Merchant adapter integration tests | **VERIFIED: 15 passed**, transport fault cases use mocks; no claim of live ingestion. |
| Merchant production browser cart tests | **VERIFIED: 4 passed**, desktop/mobile normal add, persisted edit/remove and guest-cart navigation. |
| Existing Python voice runtime tests | **VERIFIED: 11 passed.** |
| Backend / frontend+SDK / merchant production builds | **VERIFIED: all passed**; merchant includes strict TypeScript checking, frontend SDK copied to merchant fallback. |
| Existing backend type-aware lint | **VERIFIED: exit 0 with warnings**, not warning-free. No new lint tooling installed. |
| Legacy backend HTTP e2e | **BLOCKED: setup failure; 19 test bodies not executed**, missing DataSource as detailed above. |
| Human microphone shopping / subjective listening / human interruption | **PENDING**, not replaced by generated input. |

Final idle smoke: backend, STT, VAD, TTS, Ollama and merchant each returned
HTTP 200. Actual VAD `/predict` processed 100 ms of generated digital silence
in **10.7 ms**, returned five valid ordered non-speech decisions, and rejected
a 639-byte invalid frame with HTTP 422. This proves final idle reachability and
processing, not that the intermittent deadline problem is resolved.

The expanded 160-test backend selection is broader than the previous 41-test
cart selection; the totals are not directly comparable feature-growth counts.
An initial broad run also exceeded the real FFmpeg voice-library test's polling
window during concurrent build load. The isolated unchanged test passed, and
the final full selection passed without increasing that deadline. No tests
were skipped, assertions weakened or actual schema migrations performed.

Reproduction from the backend, frontend and merchant working directories:

```powershell
# backend-nestjs
npm test -- --runInBand --detectOpenHandles --testPathPatterns="src/voice/|src/website-integrations/|src/agent/merchant-cart.agent.spec.ts|src/agent/tools/tool-executor.service.spec.ts"
.\.local-voice\venv\Scripts\python.exe -m unittest discover -s scripts\local-voice -p test_runtime.py
npm run build
npm run lint
# Existing fixture currently fails setup; do not supply the shared DB to bypass it:
npm run test:e2e -- --runInBand

# frontend
npm test
npm run build

# merchant
npm test
npm run test:integration
npm run build
npm run test:e2e -- --grep "guest cart" --workers=1
```

### Changed files and reproduction

Backend:
[voice-session.manager.ts](backend-nestjs/src/voice/voice-session.manager.ts),
[voice.types.ts](backend-nestjs/src/voice/voice.types.ts),
[stt.port.ts](backend-nestjs/src/voice/stt/stt.port.ts),
[faster-whisper.adapter.ts](backend-nestjs/src/voice/stt/faster-whisper.adapter.ts),
[voice-provider.util.ts](backend-nestjs/src/voice/voice-provider.util.ts),
[piper.adapter.ts](backend-nestjs/src/voice/tts/piper.adapter.ts),
[server.py](backend-nestjs/scripts/local-voice/server.py),
[tool-executor.service.ts](backend-nestjs/src/agent/tools/tool-executor.service.ts),
[agent.service.ts](backend-nestjs/src/agent/agent.service.ts),
[merchant-cart.tools.ts](backend-nestjs/src/website-integrations/merchant-cart.tools.ts),
[merchant-cart.service.ts](backend-nestjs/src/website-integrations/merchant-cart.service.ts).
Related tests:
[voice-session.manager.spec.ts](backend-nestjs/src/voice/voice-session.manager.spec.ts),
[voice-provider.spec.ts](backend-nestjs/src/voice/voice-provider.spec.ts),
[merchant-cart.agent.spec.ts](backend-nestjs/src/agent/merchant-cart.agent.spec.ts),
[merchant-cart.service.spec.ts](backend-nestjs/src/website-integrations/merchant-cart.service.spec.ts),
[website-integrations.module.spec.ts](backend-nestjs/src/website-integrations/website-integrations.module.spec.ts).
The website module test now supplies isolated memory
shared-state to its dependency fixture and checks request-ID forwarding; its
real cart service is still resolved, and assertions are preserved/extended.

Browser:
[voiceClient.js](frontend/src/voice/voiceClient.js),
[voiceClient.test.js](frontend/src/voice/voiceClient.test.js),
rebuilt SDK/widget output, merchant
[cart.ts](../../Desktop/mcgen-rea/src/lib/cart.ts) and its tests, copied merchant
SDK and directly related documentation. Other dirty worktree changes were kept.

Use the existing separate-terminal startup commands in the following cart
section: backend 3000, Whisper 8001, Silero 8002, Piper 8003, Ollama 11434 and
merchant **http://127.0.0.1:5173**. Do not start duplicate listeners or edit
environment files. Existing local Python venv is required; global Python lacks
the sidecar dependencies.

**Manual human acceptance (PENDING):** in a separate test browser profile, choose
the intended physical input in Chrome/Windows, allow microphone access and wait
for **Listening** (a server acknowledgement alone is not capture readiness).
Speak "Hello, can you hear me?", then the seven shopping phrases below. Confirm
every transcript against what was actually said, listen to each entire answer,
check actual cart quantities/totals and reload persistence. Repeat "What is the
price?" while the long products reply is still audible, both early and late:
the old audio must stop, the complete new request must transcribe, its reply
must finish and another question must still work. Observe silence and realistic
background noise, then Stop/restart twice; verify Chrome's microphone indicator
clears and other visitors are unaffected. Record pass/fail and human listening
comments rather than inferring them from a transcript or audio-node event.

## Real merchant guest cart acceptance (6 November 2026)

**Guest cart implemented and live-verified; checkout is NOT implemented.** This
section supersedes the older statements that cart buttons are disconnected.
McZEN remains the central API/agent platform. The separate merchant React app
owns the customer's actual cart. No WooCommerce, cart REST API or authenticated
commerce service was found in that app, so no such endpoint was invented.

### Mechanism, tools and security

- The merchant's normal product buttons, header count, `/cart` page and SDK
  callback now use one persistent cart: `localStorage["mczen-storefront-cart:v1"]`.
  Browser storage is **guest storefront state**, not checkout authority or a
  server-authenticated customer account. Clearing storage loses the guest cart.
- Cart identities use the actual `ProductKey` UUID, not the numerical product ID.
  Prices, currency and stock are resolved from the merchant catalogue; the
  caller cannot supply a price. Whole quantities 1-99 and cumulative recorded
  stock are validated. Existing items are preserved. Web Locks serialize writes.
- The durable, bounded operation ledger prevents replayed additions, including
  after reload. Reusing an operation ID with different inputs is rejected.
  A fresh customer utterance creates a new operation; repeating the same HTTP
  request preserves its request ID and does not add again.
- Existing `search_products` and `get_product_details` are reused. Added
  `add_to_cart`, `get_cart`, `update_cart_item`, `remove_cart_item`, `open_cart`
  through the existing tool registry, validation, permissions, configuration and
  audit path. Add is incremental; update sets an absolute quantity. "Buy" adds
  to the guest cart, never completes a purchase.
- Added central `POST /api/website-integrations/cart/poll` and
  `POST /api/website-integrations/cart/result`. They use the existing signed
  widget visitor session and exact-origin authentication, **not the ingestion
  key**. The browser executes the merchant operation and returns persisted
  read-back. McZEN only stores short-lived pending-operation coordination.
- Tenant, assistant, integration and visitor scopes come from verified claims.
  Catalogue tools cannot override the merchant integration. Acknowledgements
  must match that visitor's pending action; counts, totals, currency and product
  ownership/prices are validated. Browser read-back remains untrusted for
  payment, fulfilment or authoritative inventory.
- Missing/offline adapters, expired pending operations, invalid credentials,
  catalogue/storage errors and unconfirmed changes never produce a success
  confirmation. On an ambiguous timeout, inspect the cart before starting a
  new addition; the merchant may have committed before acknowledgement failed.
- Five tools were enabled only for the existing merchant tenant/assistant using
  the existing tool-configuration repository. Other integrations need explicit
  enablement; adding a tool definition does not grant every tenant access.
  Existing administrator APIs are
  `PATCH /api/tools/:toolName/tenant-config` and
  `PUT /api/tools/:toolName/assistants/:assistantId`, with `enabled: true` and
  `tools:write`. The authenticated administrator must configure both scopes.

### Critical defects found and fixed during real acceptance

1. The two new cart routes initially fell through the dashboard CORS policy.
   Their preflights were rejected, making a running adapter appear offline.
   Only those exact paths were added to the existing credential-free public
   widget CORS list; exact-origin/session validation remains unchanged.
2. The widget could accept input before the adapter's initial heartbeat finished.
   Adapter registration is now awaited and Send remains disabled until ready.
3. The first complete voice test found that every spoken turn reused the
   session's original agent request ID. "Add one more" replayed the first
   addition instead of increasing quantity. Each agent invocation now uses
   its existing fresh `turnId` as request ID, preserving the same merchant
   visitor binding and within-turn idempotency.
4. A normal server `turn_reset` advanced the epoch and stopped queued browser
   TTS before it finished playing. Capture still advances to the new epoch,
   but already-scheduled output now finishes naturally on normal completion.
   Interruption, recovery, disconnect and explicit Stop still stop playback;
   newly arriving stale-epoch packets remain rejected.
5. Cart navigation previously happened after its success acknowledgement.
   Navigation now completes before success is reported; a missing/throwing
   merchant navigation callback returns failure and retries do not reopen it.

### Actual browser evidence (no mocked cart APIs)

Installed Google Chrome was exercised through the merchant's existing Playwright
package. Each live run used an isolated browser context, not the user's existing
cart. No imported catalogue records, migration or environment file was modified.

| Acceptance case | Actual result |
|---|---|
| Catalogue and first-product details | Actual LASS HEALTH ID, price INR 1,035 and product cards; "best" is explicitly catalogue suggestions, not a fabricated sales ranking. |
| Add one, then one more | Persisted quantity 1 then 2; totals INR 1,035 then INR 2,070. |
| Repeat the same HTTP ADD | Quantity remained 1; no duplicate addition. Repeated absolute UPDATE also remained unchanged. |
| Add multiple quantities/preserve another item | Added two WEIZAP while preserving two LASS HEALTH: four units, INR 5,310. |
| Read and update | Agent read actual count; update to three LASS HEALTH produced INR 3,105. |
| Remove through agent | Removed LASS HEALTH; two WEIZAP remained, INR 3,240. Cart-page removal also passed. |
| Open cart / normal product Add | Opened actual `/cart`; ordinary detail-page button changed the same cart. |
| Persistence / page controls | Reload retained three units; cart-page edit to two and removal were persisted. |
| Invalid quantity, identity, variant | Zero/fractional/over-limit quantities, unknown UUID and unverified variant rejected without mutation. |
| Actual recorded out-of-stock product | HALE.O has recorded stock zero; agent returned `success: false`, no addition, existing cart unchanged. No inventory record was edited. |
| Controlled real browser storage failure | Isolated context's cart `setItem` threw a quota error. Actual SDK operation returned `success: false`; no "Added" claim, persisted cart unchanged. Original Storage implementation restored. |
| Invalid cart credentials | Actual polling endpoint returned HTTP 401. |

Sanitized reproducible scripts, JSON and screenshots are in the session's
`files/` deliverables: `verify-merchant-cart.cjs`,
`merchant-cart-live-evidence.json`, `merchant-cart-live.png`,
`verify-cart-voice.cjs`, `merchant-cart-voice-evidence.json` and
`merchant-cart-voice.png`. The scripts require this installation's merchant
Playwright dependency and installed Chrome; they do not log bearer credentials.
The text screenshot is the actual three-unit/INR 3,105 cart page, not a mocked
display. The voice screenshot is the actual two-unit/INR 2,070 cart page.

### Complete controlled English voice shopping conversation

All six requested utterances passed through the real SDK ticket, WebSocket,
AudioWorklet, VAD, Faster Whisper, existing McZEN agent/tools, merchant callback,
Piper and browser Web Audio:

1. "Show me your best products." -> actual catalogue cards.
2. "Tell me about the first product." -> LASS HEALTH / INR 1,035.
3. "Add this product to my cart." -> actual quantity 1.
4. "Add one more." -> actual quantity 2, not an idempotent replay.
5. "How many items are in my cart?" -> two units / INR 2,070.
6. "Open my cart." -> actual merchant `/cart`.

Input was **clearly labelled Piper-generated English speech through a synthetic
MediaStream**, not a human microphone. No transcript, STT/VAD response, agent
answer or cart result was injected. All six final transcripts matched; no
voice-session error occurred. All **161 received TTS buffers were scheduled and
reached `ended`, with zero premature `stop` calls**, before the next question.
This verifies browser playback progression, not subjective human listening.
Final-run input-start-to-final-transcript times were **12.742-27.791 seconds**;
the preceding successful run measured 13.243-15.602 seconds. These include
speaking, endpoint detection and CPU STT, not pure STT time or a load benchmark.
CPU voice latency is still material; this is not low-latency human acceptance.

### Validation and changed files

- Final focused backend run: **41 tests passed across four suites**, including
  per-spoken-turn request IDs, merchant context, cart coordination and exact
  CORS paths. Backend build passed. Earlier broader cart-phase run: 169 passed;
  those are overlapping regression runs, not an additive test count.
- Frontend: **48 tests passed**, including full normal-completion playback,
  interruption, stale epochs, cart retries/errors and voice connection tests.
  Full frontend/widget/SDK production builds passed.
- Merchant: **72 unit tests passed across six files**; strict TypeScript and
  production build passed. Live Chrome text and six-turn voice scripts exited 0.
  Unit tests use catalogue fixtures/mocked providers and are not presented as
  live cart or MySQL acceptance.
- Existing merchant E2E assertions were updated for the intentional guest-cart
  behavior, retaining real image/safety checks and adding actual persistence,
  totals, edit/removal and disabled-checkout assertions. **Four focused
  desktop/mobile browser tests passed** against the production preview.
- Final read-only database checks confirmed **MySQL 8.4.13**, primary schema
  `mczen`, **13 applied migrations, zero pending/unknown**. No migration was run
  or reverted. `git diff --check` passed (existing line-ending warnings only).

Implementation files:

- Central bridge: [merchant-cart.service.ts](backend-nestjs/src/website-integrations/merchant-cart.service.ts),
  [merchant-cart.tools.ts](backend-nestjs/src/website-integrations/merchant-cart.tools.ts),
  [website-data.module.ts](backend-nestjs/src/website-integrations/website-data.module.ts),
  [website-integration.controllers.ts](backend-nestjs/src/website-integrations/website-integration.controllers.ts),
  [website-integration.tools.ts](backend-nestjs/src/website-integrations/website-integration.tools.ts).
- Agent/tool context: [agent.service.ts](backend-nestjs/src/agent/agent.service.ts),
  [agent.module.ts](backend-nestjs/src/agent/agent.module.ts),
  [tool-registry.service.ts](backend-nestjs/src/agent/tools/tool-registry.service.ts),
  [agent-execution-context.interface.ts](backend-nestjs/src/agent/context/agent-execution-context.interface.ts).
- Widget/auth/voice: [widget.service.ts](backend-nestjs/src/widget/widget.service.ts),
  [widget.dto.ts](backend-nestjs/src/widget/widget.dto.ts),
  [cors.config.ts](backend-nestjs/src/auth/cors.config.ts),
  [voice-auth.service.ts](backend-nestjs/src/voice/voice-auth.service.ts),
  [widget-voice.service.ts](backend-nestjs/src/voice/widget-voice.service.ts),
  [voice-session.manager.ts](backend-nestjs/src/voice/voice-session.manager.ts).
- SDK/client: [client.js](frontend/src/widget/client.js),
  [widget.js](frontend/src/widget/widget.js),
  [sdk-entry.js](frontend/src/widget/sdk-entry.js),
  [voiceClient.js](frontend/src/voice/voiceClient.js), plus their focused tests
  and rebuilt SDK output copied to merchant `public/mczen-sdk.js`;
  [WIDGET-DEPLOYMENT.md](frontend/WIDGET-DEPLOYMENT.md) documents the adapter contract.
- Merchant, under `C:\Users\jilan\Desktop\mcgen-rea`: `src/lib/cart.ts`,
  `src/lib/cart.test.ts`, `src/lib/mczen.ts`, `src/components/CartProvider.tsx`,
  `MczenIntegration.tsx`, `Header.tsx`, `ProductCard.tsx`, `PreviewProvider.tsx`,
  `src/pages/CartPage.tsx`, `ProductPage.tsx`, `src/app/App.tsx`,
  `tests/e2e/storefront.spec.ts` and `README.md`.
- New backend tests:
  [merchant-cart.service.spec.ts](backend-nestjs/src/website-integrations/merchant-cart.service.spec.ts),
  [merchant-cart.agent.spec.ts](backend-nestjs/src/agent/merchant-cart.agent.spec.ts);
  updated CORS and voice-session regression tests. Generated build files changed
  with their sources. Unrelated pre-existing worktree changes were preserved.

### Manual acceptance, startup and remaining blockers

Use the already registered origin **http://127.0.0.1:5173**. An independently
registered `localhost` origin is not implicitly interchangeable with it.
With the existing backend configuration, in separate PowerShell terminals:

```powershell
Set-Location C:\Users\jilan\Downloads\mczen\backend-nestjs
npm run build
$env:OLLAMA_MODEL = 'qwen2.5:1.5b'
npm run start:prod
```

```powershell
Set-Location C:\Users\jilan\Desktop\mcgen-rea
npm run dev
```

For voice only, run each existing sidecar in a separate terminal from
`C:\Users\jilan\Downloads\mczen\backend-nestjs`:

```powershell
.\.local-voice\venv\Scripts\python.exe scripts\local-voice\server.py --service stt --directory .local-voice\models
.\.local-voice\venv\Scripts\python.exe scripts\local-voice\server.py --service vad --directory .local-voice\models
.\.local-voice\venv\Scripts\python.exe scripts\local-voice\server.py --service tts --directory .local-voice\models
```

Existing services must be on backend 3000, STT 8001, VAD 8002, TTS 8003 and Ollama
11434. Do not start another instance over an already running service. Text cart
does not require STT/VAD/TTS. The chosen model override affects only that process;
no environment file was changed.

Open a separate test browser profile, add a normal product first, then run the
six-question flow using text and again using your actual microphone. Verify the
header count, `/cart` quantities/totals, reload persistence, edit/removal and
continued presence of the pre-existing product. Listen to every full response
before the next question. Finally try HALE.O and an invalid quantity; neither
should alter the cart. Do not delete your real browser shopping storage.

Remaining limitations:

- **No verified variant contract:** current catalogue has no genuine orderable
  variants. ZENAGE three/five-pack estimates are not variant IDs; removed from
  orderable controls. Positive variant acceptance remains blocked until real
  merchant variant data/API exists; invalid variants are explicitly rejected.
- **Guest only:** persistence works in the same browser/origin, including reload.
  Authenticated merchant customer sessions, cross-device cart and server
  inventory reservation are not integrated or claimed.
- **Checkout/payment/orders are not connected.** `/cart` checkout is disabled;
  the legacy `/checkout` route still opens the disconnected login preview.
- Human microphone shopping, subjective listening and realistic spoken
  interruption/background noise still require the earlier human checklist.
  CPU voice latency remains high. No new Hindi/Telugu or cloning claim is made.
- No dedicated live expired-session/network-timeout fault acceptance was run.
  Bounded transport/retry/offline and tenant/visitor isolation have regression
  coverage; a production/multi-instance/authoritative commerce release needs
  additional acceptance. Guest read-back is never a checkout security boundary.

## Previous: English client acceptance review (6 November 2026)

**Release decision: NOT fully client-accepted.** This was a bounded acceptance
review, not another implementation phase. No application source, migration,
environment file or existing merchant record was edited. Ordinary widget
conversations/session events were created through the existing authenticated APIs.
The earlier generated-input full-path test remains valid but is not substituted
for human microphone acceptance.

### 1. Physical microphone: actual capture verified; human conversation pending

The actual shared merchant browser at `http://127.0.0.1:5173` reported a secure
context, microphone permission `granted`, and the Intel Smart Sound microphone
array. Capture used the original browser `getUserMedia` implementation and real
device, with no synthetic stream, generated speech, or injected PCM.

Observed in a 21.683-second session:

- Server acknowledgement: **277 ms**; **203 input packet acknowledgements**.
- Physical input: 48 kHz, mono, 16-bit device settings, with echo cancellation,
  noise suppression and automatic gain control enabled. Existing AudioWorklet
  conversion and transport retained the backend's PCM16LE/16 kHz/mono contract.
- Aggregate signal RMS **0.01991**, peak **0.13049**; the input was nonzero.
  These are passive analyser observations, not a calibrated sound-level reading.
- No `voice.speech.started`, final transcript, assistant audio packet, or session
  error was observed. Silence nudges occurred approximately 11.3 and 21.3 seconds
  after starting. The microphone was stopped deliberately; socket close was 1000.
- No raw microphone recording was saved. Temporary browser observation hooks
  were restored, and the microphone button returned to `aria-pressed=false`.

Two additional real-device sessions started successfully (247 ms and about
81 ms after the second start click), delivered 60 acknowledged packets together,
and closed normally. The Stop-speaking control emitted an interruption request;
there was no assistant speech playing, so this is **control delivery/cleanup,
not spoken barge-in acceptance**.

**Interpretation:** real microphone permission, capture, transport, passive
room-input rejection and repeated session startup passed. No intelligible human
utterance was detected in the unattended capture. Therefore human STT accuracy,
an agent/TTS turn triggered by human speech, audible output, repeated spoken
questions, speech interruption and controlled background-noise tolerance remain
unverified. A person must perform the checklist below; autonomous browser control
cannot supply a human voice or certify subjective listening.

### 2. Five real English Piper responses

All samples used installed **Alba (`en_GB-alba-medium`)**, rate 1.0, through the
actual Piper HTTP service. Output was PCM16LE, 16 kHz mono, wrapped in WAV for
review. This is built-in Piper synthesis, **not voice cloning**.

First audio means HTTP request start to the first nonempty PCM response chunk;
total means complete response-body receipt. Neither includes STT, agent time,
network delivery to a remote customer, or the widget's complete time-to-speech.
These are five sequential observations, not a percentile/load benchmark.

| Sample | First audio | Total generation | Audio duration | Full-scale samples | Longest quiet run |
|---|---:|---:|---:|---:|---:|
| 1: Welcome/catalogue assistance | 1,156 ms | 4,037 ms | 7.454 s | 1 | 240 ms |
| 2: LASS HEALTH / WEIZAP budget | 2,008 ms | 4,053 ms | 11.169 s | 2 | 200 ms |
| 3: HALE.O details | 1,294 ms | 2,613 ms | 9.358 s | 2 | 260 ms |
| 4: AURA pack/individual comparison | 929 ms | 3,589 ms | 11.564 s | 0 | 240 ms |
| 5: Honest cart/payment limitation | 1,022 ms | 2,444 ms | 9.474 s | 1 | 280 ms |

Real-time factors were 0.258-0.542. All five played to the browser media `ended`
event, unmuted at volume 1, with no media errors. This verifies media playback
progression, **not that a person heard the device output**. There were only 0-2
full-scale samples in each recording, not evidence of sustained clipping.
Quiet runs use 20 ms RMS windows below 0.001 full scale; this is a mechanical
pause check, not a judgement of rhythm or naturalness. Pronunciation of brand
names, rupee amounts, pauses and subjective clipping still requires listening.
No speculative gain/resampling changes were made to hide isolated peak samples.

The exact generated texts were:

1. "Welcome! I can help you explore the catalogue, check stored prices, and open
   product details. What are you shopping for today?"
2. "LASS HEALTH is listed at 1,035 Indian rupees. WEIZAP is listed at 1,620 rupees.
   Both are below your budget of 2,000 rupees."
3. "HALE.O is listed at 3,600 Indian rupees. You can open its product card to
   review the recorded ingredients and product information."
4. "AURA COFFEE PACK OF 6 costs 9,000 rupees. AURA STRESS FREE COFFEE costs 1,620
   rupees. These are stored catalogue prices, not a live checkout quote."
5. "This merchant preview cannot add items to a cart or take payments. Nothing
   has been purchased or saved. I can still help you find a product and open
   its details."

Review files, measurement JSON and the reproducible measurement script are in
the delivery session's `files\piper-acceptance` directory and accompanying
`measure_piper_acceptance.py`. The delivery ZIP contains the five WAVs and
measurements, not microphone audio or credentials. Open WAVs locally with a media
player; the temporary loopback HTTP server used for browser testing was stopped.

### 3. OpenVoice: exact provisioning gap and profile procedure

Inspection confirmed **Python 3.12.10**, no installed `torch` or `openvoice` in
the working speech environment, no V2 converter configuration/checkpoint under
the configured local models directory, and no listener on port 8004. The host
has approximately 16 GB RAM, Intel Iris Xe graphics and no NVIDIA CUDA device.
Only about **0.5 GB RAM was free** during this review. A local CPU deployment is
not proven impossible, but installing/loading another model alongside these
services is not a credible acceptance environment at this memory pressure.
No provider, reference recording or clone was fabricated.

Deployment requirements, in order:

1. Use a separate interpreter/environment, preferably a separate Linux host or
   VM with capacity isolated from STT/Ollama. Official instructions use Python
   3.9. Do not install into the working STT/VAD/Piper Python 3.12 environment.
   Upstream pins include NumPy 1.22.0, librosa 0.9.1, faster-whisper 0.9.0,
   wavmark 0.0.3, whisper-timestamped 1.14.2 and other dependencies from
   `setup.py`. Install an appropriate matched PyTorch/torchaudio pair, install
   the official OpenVoice package, then the adapter dependencies FastAPI,
   Uvicorn, Pydantic 2, python-multipart and requests. Resolve, `pip check`, test
   imports and lock this environment before deployment. An exact working
   dependency lock has **not** been established here; these are provisioning
   steps, not a certified install command.
2. Obtain the official V2 converter files, keeping this directory layout:
   `<weights-root>\converter\config.json` and
   `<weights-root>\converter\checkpoint.pth`.
   The upstream guide's S3 `checkpoints_v2_0417.zip` link returned **404** in this
   review. Verified alternative official URLs both returned HTTP 200:
   - https://huggingface.co/myshell-ai/OpenVoiceV2/resolve/main/converter/config.json
   - https://huggingface.co/myshell-ai/OpenVoiceV2/resolve/main/converter/checkpoint.pth
   The official repository lists an 838-byte config and 131,320,490-byte
   checkpoint. Pin the reviewed model revision/checksums when provisioning;
   no weights were downloaded during this review.
3. Provision the additional watermark model/cache. OpenVoice's converter enables
   `wavmark.load_model()` by default; WavMark loads the Hugging Face repository
   `M4869/WavMark`, including
   `step59000_snr39.99_pesq4.35_BERP_none0.30_mean1.81_std1.81.model.pkl`.
   Allow approved first-start model-host access or prepopulate a private cache.
   Do not assume the converter checkpoint alone makes an offline installation
   complete. Review/retain the dependency/model notices too.
4. FFmpeg and FFprobe must be on the NestJS process PATH (both were found here).
   The clone provider must reach **Piper on its own loopback port 8003** and
   **Silero on its own loopback port 8002**. The current adapter hardcodes those
   loopback dependencies: on a separate host, co-locate them or establish
   private local tunnels before starting the provider. Merely forwarding 8004
   is insufficient. No public model endpoint or browser ingestion key is needed.
5. Start with the isolated interpreter, from `backend-nestjs`:

   ```powershell
   <isolated-python.exe> scripts\local-voice\clone_server.py --checkpoints <weights-root> --device cpu --base-voice <reviewed-installed-English-Piper-id>
   Invoke-RestMethod http://127.0.0.1:8004/health
   # Backend terminal only, before starting NestJS:
   $env:VOICE_CLONE_URL = 'http://127.0.0.1:8004'
   ```

   CPU is supported by the adapter; CUDA is optional and requires a compatible
   NVIDIA GPU/PyTorch build. Upstream does not state a guaranteed minimum RAM or
   VRAM in the inspected usage guide. Size and load-test all co-resident engines;
   do not present invented GPU/RAM minima or this host's timings as a cloning
   benchmark. Keep 8004 private/loopback. This provider is not independently
   authenticated for public exposure.
6. In a **development** backend, sign in as the correct tenant administrator
   with `assistants:write`. Open Voice settings, choose an English profile name,
   attest explicit recording ownership/permission, and upload WAV/MP3/M4A/MP4
   up to 20 MB. Use 30-60 seconds of clean single-speaker English; accepted
   duration is 6-120 seconds. Do not use another person's voice without consent.
7. Process the profile. Existing NestJS preparation runs FFprobe/FFmpeg to
   normalized mono 16 kHz WAV, then calls the provider's `POST /profiles`.
   Silero must detect at least one second of speech. OpenVoice extracts a
   256-float embedding; NestJS stores it privately and reports `ready`, or
   persists a visible failure. Poll/refresh the existing profile list.
8. Request and **listen to** a preview. `POST /convert` obtains actual Piper base
   speech, extracts its source embedding, performs tone-color conversion and
   returns WAV. Preview must exist before activation. Activate, refresh the
   merchant voice choices, select the profile, then complete a human voice turn.
   Verify deactivation removes availability and another tenant cannot use it.
   Never interpret mocked embedding/preview tests as evidence for these steps.

The inspected official OpenVoice code licence and V2 model card specify MIT /
commercial use. Preserve notices and separately review base-voice/dataset rights,
watermark dependencies and reference-recording consent. Alba's model card cites
CC BY 4.0 data **and says it was fine-tuned from Lessac**; that is not blanket
rights clearance for every model in the chain.

**Production cloning remains intentionally disabled.** Database-backed lifecycle,
shared durable jobs and private multi-instance storage have not been implemented.
Do not bypass that restriction or treat local manifest storage as production-ready.

Sources checked:
[official usage](https://github.com/myshell-ai/OpenVoice/blob/main/docs/USAGE.md),
[dependency pins](https://github.com/myshell-ai/OpenVoice/blob/main/setup.py),
[converter implementation](https://github.com/myshell-ai/OpenVoice/blob/main/openvoice/api.py),
[code licence](https://github.com/myshell-ai/OpenVoice/blob/main/LICENSE),
[V2 model card](https://huggingface.co/myshell-ai/OpenVoiceV2),
[WavMark loader](https://github.com/wavmark/wavmark/blob/main/src/wavmark/__init__.py),
[Alba model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_GB/alba/medium/MODEL_CARD).

### 4. Actual merchant shopping acceptance

- The real widget answered "Find products under INR 2,000." twice consistently.
  Five cards: LASS HEALTH 1,035; WEIZAP 1,620; AURA STRESS FREE COFFEE 1,620;
  REYONIQUE 1,800; DETOXIFIER 900 (INR). All five images loaded.
- "Give me details of AURA COFFEE PACK OF 6." returned the correct stored
  9,000 INR card/link. This is a stored-record lookup, not a complete product
  review. The real LASS HEALTH product page heading was verified again.
- Clicking the real product page's Add to cart showed "Shopping isn't connected
  yet" and explicitly stated that nothing was sent, purchased or saved.
  No non-GET/HEAD/OPTIONS network request occurred during that product/cart/
  checkout test. `/cart` redirected to `/`; `/checkout` redirected to `/login`.
- Asking the assistant to add LASS HEALTH and open the cart correctly declined
  because no cart tool exists, but included a literal `[URL]` placeholder and
  suggested using the merchant website. This is a **known response-quality
  limitation**, not a working link or cart operation; this merchant preview
  itself cannot add items. No mutation or shopping completion is claimed.

Missing contracts are a genuine authenticated cart identity/session, add/update/
remove-item operations, authoritative totals/stock, cart-read/open destination,
and checkout/payment integration. The merchant transport currently allows only
five public catalogue reads. These APIs were not invented or enabled.

### 5. Exact human acceptance checklist

Use the existing startup commands in the following implementation section.
Confirm `/api/health` on 3000 and `/health` on 8001/8002/8003 return HTTP 200.
Use **http://127.0.0.1:5173**, the registered origin, not an unregistered localhost
alias. Choose **English / Alba**, use headphones, and check Windows Settings >
System > Sound > Input selects the intended microphone and its level moves.

| Step | Action | Required observation / evidence to record |
|---|---|---|
| Permission | Click Start voice, allow the microphone; separately block it once in site permissions, retry, then restore Allow. | Listening with Allow; useful denied-permission error with Block; no stuck connection or active microphone after Stop. |
| First human turn | Say "What products are available?" naturally, then pause. | Actual final transcript, real catalogue cards, audible complete response; record end-of-speech, transcript, first-audio and completion times. |
| Details and budget | Say "Find products under INR two thousand", then "Give me details of AURA COFFEE PACK OF 6." | Correct intent, budget cards and pack price; record the actual transcript and any recognition error. Spoken-number budget handling is not certified by the digit-based text test. |
| Repetition | Ask the same question five times with a pause after each answer. | No stale answer/audio, duplicate turn, growing latency, frame-drop warning or stuck microphone; record all five timings. |
| Spoken interruption | During an audible answer say "Stop. Show me WEIZAP instead." | Old speech cancels promptly, the new utterance is not lost and no stale audio resumes; record interruption time. |
| Stop control | During an audible answer press Stop; stop voice, then start voice again twice. | Playback stops, prior microphone tracks end and each new session becomes ready without a session-limit error. |
| Silence | Stay silent for 20 seconds, then ask a question. | No invented transcript/product answer during silence; a nudge is acceptable; next real question works. |
| Background noise | Repeat one question in normal room noise, then with low-level conversation/TV nearby. | Record transcript/intent accuracy and errors; noise alone must not trigger shopping actions. This controlled test was not performed automatically. |
| Listening | Play each supplied WAV locally and listen to one full live answer. | Review LASS HEALTH, WEIZAP, HALE.O, AURA names, rupee amounts, rhythm, pauses, distortion, initial/final syllables and volume. Mark each pass/fail; media `ended` alone is not listening acceptance. |
| Shopping | Search, open a card, click Add to cart and open `/cart`. | Read operations work; disconnected shopping is explicit. Do not sign off cart/checkout without real authenticated staging contracts. |

If a human turn fails, retain sanitized event names/status/durations and transcript
(with the speaker's permission); do not attach tokens, API keys or raw microphone
recordings. No Hindi/Telugu implementation or acceptance work was undertaken.
The configured greeting still mentions these languages; that is not proof of
their end-to-end availability. English is the acceptance target.

### 6. Regression results and remaining blockers

- Backend voice-session lifecycle: **23 tests passed**, covering pending/slow
  transcription, bounded queues, batching, overflow, epoch ordering and stale
  TTS cancellation. Frontend voice client: **23 tests passed**, including
  permission denial, startup timeouts, cleanup, congestion and interruption.
- Optional clone contracts: **5 tests passed** with mocked dependencies; no
  real OpenVoice inference was performed.
- These mocked regressions supplement, not replace, the physical-input and
  real-engine evidence above. Previous builds remain the latest build evidence;
  no application code changed in this acceptance-only pass.
- Critical acceptance blockers: a completed human speech/listening checklist,
  acceptable end-to-end CPU latency, a provisioned/consented live cloning test
  plus production persistence if cloning is required, and genuine merchant
  cart/checkout APIs if shopping mutation is required.
- Known limitations: the historical ingestion-sync warning, model-generated
  unsupported-cart placeholder response, unverified subjective voice quality,
  and unverified Hindi/Telugu. Existing migration/environment files remain intact.

## Earlier: resumed merchant and voice implementation

### Access and safety

- PowerShell local execution, backend port 3000, STT 8001, VAD 8002, Piper 8003,
  Ollama 11434, npm registry, PyPI, and the OpenVoice model host were reachable.
  Backend and frontend baseline tests/builds also ran successfully.
- MySQL verification used the existing `mczen_user` account against `mczen`:
  migration 0013, all four integration tables, indexes, foreign keys, ownership,
  duplicate checks, product prices and budget filters passed.
- No migration was run or changed, `synchronize` stayed disabled, and no existing
  application records were dropped, truncated or replaced. Browser/`--ask`
  verification creates ordinary new widget conversation/runtime records.
- Backend restarts used inspected, owned processes. An old session helper pointed
  at a removed disposable schema; that startup failed explicitly. Starting with
  the application's existing environment correctly selected `mczen`; no schema
  was created or reset to work around that failure.

### Root causes and implemented corrections

1. The mandatory general `knowledge_search` could return before merchant tools
   were offered. Widget retrieval now uses the existing merchant tools through
   the same permission/configuration/audit executor. Legacy non-widget retrieval
   and urgent-symptom handling remain in place.
2. `search_products({})` was rejected, preventing truthful catalogue browsing.
   Empty filters now mean bounded browsing of the verified tenant/assistant's
   imported catalogue, not a fabricated bestseller ranking.
3. Product search filtered with FULLTEXT but sorted only by update time.
   Common words in a natural-language details/comparison question displaced the
   explicitly named product before LIMIT. Named-product matches and FULLTEXT
   relevance now precede recency, using bound SQL parameters.
4. Website excerpts used newline both inside source text and as the chunk
   delimiter. Only the title survived `SUBSTRING_INDEX`. Newlines inside each
   candidate chunk are flattened before chunk selection; live excerpts now
   include 826–882 characters of actual page body rather than just titles.
5. Small-model answers incorrectly reassociated real product names, prices and
   links, and repeated tool calls could time out. Deterministic merchant reads
   now render actual successful tool records directly: `model: verified-catalogue`
   for catalogue/current-stored-price comparisons and `verified-website` for
   clearly labelled stored website excerpts. These are NOT mocked answers or
   timeout-success fallbacks. Other conversation/tool workflows still use the
   existing Ollama loop. Broader recommendation reasoning is not proven by these
   deterministic read tests.
6. Sentence splitting cut decimal prices and names such as `HALE.O`.
   TTS segments now preserve these, split at sentence whitespace, and stay at or
   below 500 characters for both providers.

### Actual assistant/API evidence

The final verifier checks card IDs, prices and links against database records,
requires nonempty budget results when matching rows exist, and requires both
actual products in comparison cards. It also checks invalid keys, wrong origins,
and invalid sessions. A failed historical sync is now a warning, not a PASS.

| Question | Observed record-grounded result |
|---|---|
| What products are available? | LASS HEALTH INR 1,035; WEIZAP INR 1,620; HALE.O INR 3,600; five database-backed cards. |
| Find products under INR 2,000. | Five cards, none over budget; the database contains eight matching products. |
| Give me details of AURA COFFEE PACK OF 6. | Correct product card and stored effective price INR 9,000. This is a stored-record/price lookup, not a detailed generative product review. |
| Compare AURA COFFEE PACK OF 6 and AURA STRESS FREE COFFEE. | Both correct cards: INR 9,000 and INR 1,620 respectively; this verifies a stored-price comparison, not invented feature or health comparisons. |
| What is the return policy? | Labelled excerpts and real connected website sources, not invented operational return terms. The merchant preview explicitly says purchases/returns are disconnected. |

Registered origin `http://127.0.0.1:5173` passed; a wrong origin and bad public key
returned 403, and an invalid message session returned 401. The localhost alias is
not silently treated as the registered 127.0.0.1 origin.

### Controlled English browser voice evidence

Actual merchant browser, actual WebSocket/ticket, AudioWorklet, bounded transport,
Silero, Faster Whisper, AgentService, audited `search_products`, MySQL, Piper and
browser audio scheduling were exercised. **Input was explicitly Piper-generated
English speech injected through a browser MediaStream, NOT human speech or a
physical-microphone acceptance test.** No STT, VAD, product records or TTS response
was mocked in this browser test.

| Measured stage | Relative to test start |
|---|---|
| Server session acknowledgement | 389 ms |
| Generated capture source scheduled | 587 ms, with a further 500 ms source-start delay |
| Final real STT transcript | 30,188 ms: "What products are available?" |
| Agent/tool response | 30,373 ms; actual `search_products` audit and five product cards |
| First response playback buffer scheduled | 33,302 ms; AudioContext running |
| Server audio end / turn end | 41,378 / 41,388 ms |

43 response PCM packets were scheduled as 43 browser playback buffers.
1,153 input acknowledgements were observed before stopping the test; no session
error was observed. The selected built-in voice was Alba. Product names, images,
effective prices and links were visible in the actual widget; a browser-tool
screenshot in the implementation conversation captures the result. This proves
browser scheduling, not subjective sound quality or that a human heard it.
The synthetic microphone override was restored and its generated merchant audio
fixture was deleted.

This is **not low-latency acceptance**. The host had roughly 0.9 GB free RAM out
of 16 GB during investigation. One overloaded real STT smoke request exceeded
60 seconds. After releasing the loaded 3B model (not deleting its files) and using
the already-installed 1.5B model for open-ended local queries, the isolated
English smoke completed STT in 12.39 seconds and real STT/VAD/all six installed
Piper voices passed. Browser timing above includes concurrent local validation
load. The backend's model override is process-only; no `.env` was edited.

### Voice library: implemented development workflow, not live cloning

- Existing admin Voice settings now includes a named, consent-attested private
  upload workflow for WAV/MP3/M4A/MP4 (20 MB maximum), status display, processing,
  private preview, activation/deactivation and deletion.
- Tenant identity and creator come from verified authentication. Routes require
  `assistants:write`; anonymous access was tested live and returned 401.
  Cross-tenant IDs, scope injection, missing consent, unapproved language and
  invalid media are covered by regression tests.
- Originals, normalized mono 16 kHz WAV, fixed-size float speaker embedding,
  preview and metadata are private, never public media URLs. FFprobe verifies
  audio/duration (6–120 seconds); FFmpeg normalizes/extracts audio. The optional
  provider also checks audible energy and real Silero speech activity.
- Processing is bounded/asynchronous; interrupted jobs become failed, not ready.
  An unconfigured/unavailable provider never produces a fake ready profile.
  Preview generation is required before activation; active/processing profiles
  cannot be deleted. Inactive/deleted profiles cannot start another utterance.
- The optional `clone_server.py` invokes real OpenVoice V2 extraction/conversion,
  with existing Piper as base speech. It accepts raw fixed-size float embeddings,
  not executable pickle uploads, and binds only to loopback. The existing
  WebSocket protocol and PCM playback are reused.
- **This library is development-only and fails closed in production.** Metadata
  is in a private local manifest following the existing local document-storage
  pattern, not a new SQL table. No migration was added. Production database-backed
  profile lifecycle/shared jobs/storage design remains outstanding; do not run
  this local manifest workflow across replicas. On Windows protect its storage
  directory with account ACLs as well as avoiding public/static roots.
- OpenVoice code license and official V2 model card specify MIT and commercial
  use. This does not automatically clear every Piper base voice/dataset. For
  example, Lessac's model card links to research-license terms. The provider
  deliberately requires an explicit rights-reviewed `--base-voice`.
- **Blocked live:** OpenVoice/PyTorch are not installed in the existing Python
  3.12 voice environment; official OpenVoice pins older NumPy/dependencies and
  documents a Python 3.9 environment. No incompatible install was forced into the
  working sidecars. No consented human reference recording was supplied.
  Provider contract tests and mocked embedding/preview responses do NOT prove
  cloned speech generation or similarity.

### Customer voice selection

The existing widget now displays backend-reported voice names for the selected
language, persists only the nonsecret voice preference per assistant/language,
and sends `voiceId` through the existing ticket/WebSocket start path. Changing
language/voice stops the previous session. A removed/unavailable saved selection
is explicitly reset to the assistant default. The backend validates active clone
ownership/language and provider health and rechecks on synthesis. Disabled clone
providers are not advertised. Built-in Amy/Lessac/Alan/Alba choices were visible
in the real browser; no active cloned voice is claimed.
The final browser reload test restored `en_GB-alba-medium` successfully. It first
exposed an initialization bug that cleared preferences before capabilities
arrived; preference validation now waits for an available backend configuration.
The live budget-card test also opened the first product link in a separate tab
and verified the actual `LASS HEALTH` product heading, rather than treating an
SPA HTTP 200 response as proof that the link worked.

English controlled full-path verification is described above. Hindi's two Piper
voices passed direct synthesis only; the merchant assistant currently enables
English speech, and Hindi recognition/conversation is NOT certified. Telugu has
no installed Piper voice; no Telugu speech or cloning is claimed.

### Scope limits and startup/manual verification

`mcgen-rea` remains a read-only storefront: `/cart` redirects to home, checkout
redirects to login, and purchase buttons explain that no cart mutation occurred.
No real cart/checkout API exists in this merchant implementation. None was
invented, bypassed, or reported as successful.

Run each existing sidecar in its own terminal, from `backend-nestjs`:

```powershell
.\.local-voice\venv\Scripts\python.exe scripts\local-voice\server.py --service stt --directory .local-voice\models
.\.local-voice\venv\Scripts\python.exe scripts\local-voice\server.py --service vad --directory .local-voice\models
.\.local-voice\venv\Scripts\python.exe scripts\local-voice\server.py --service tts --directory .local-voice\models
```

Use the existing Ollama service on 11434; start `ollama serve` only if it is not
already running. Backend and verification:

```powershell
npm run build
$env:OLLAMA_MODEL = 'qwen2.5:1.5b' # optional CPU development override, not a file edit
npm run start:prod
# Separate terminal, same backend directory:
npm run verify:live-integration -- --origin http://127.0.0.1:5173 --api --ask
.\.local-voice\venv\Scripts\python.exe scripts\local-voice\smoke_test.py
```

Use the existing merchant Vite application at `http://127.0.0.1:5173` and platform
Vite application at port 5174. From their respective application directories:
`npm run dev -- --host 127.0.0.1 --port 5173` (merchant) and
`npm run dev -- --host 127.0.0.1 --port 5174` (platform).

For a future isolated OpenVoice installation with its official dependencies and
official V2 converter weights, the startup entry point is:

```powershell
# Use the isolated OpenVoice interpreter, NOT the working local-voice venv.
python scripts\local-voice\clone_server.py --checkpoints <OpenVoiceV2-weights-root> --device cpu --base-voice <rights-reviewed-installed-English-Piper-voice>
# Set only in the backend process environment before restart, never VITE_*:
$env:VOICE_CLONE_URL = 'http://127.0.0.1:8004'
```

These cloning commands are a deployment procedure, NOT evidence of a working
cloning installation here. Prefer an appropriately resourced separate host;
keep the provider private/loopback, using a private tunnel if needed.

Morning acceptance: ask catalogue/budget/details/comparison questions; inspect
prices/links; select a built-in voice; allow the real microphone; speak English;
confirm the transcript, tool-backed cards and audible reply; then test Stop and
language/voice changes. For cloning, first provision the isolated provider and a
consented recording, then upload, process, refresh, listen to preview, activate,
and verify tenant isolation and deactivation. Do not mark human/cloning acceptance
complete on the strength of the automated fixture tests.

### Validation and changed surfaces

- Focused backend agent, voice session/gateway/provider, widget voice, profile,
  website tools and repository suites passed; backend production build and lint
  passed (existing lint warnings remain). The grouped eight-suite run passed
  157 tests; the final six-profile-test run additionally covered the new
  production restriction and orderly job shutdown/atomic metadata persistence.
- Frontend: 42 tests passed; app, widget and SDK production builds passed.
- Python: 16 runtime/contract tests passed; real sidecar smoke passed after the
  documented overloaded first attempt.
- Profile lifecycle tests use real FFmpeg and mock only the cloning provider.
  They verify byte-preserving PCM conversion, cancellation, private persistence,
  activation rules and production restrictions; they do not prove a real clone.

Changed backend surfaces: `src/agent/agent.service*`,
`src/website-integrations/website-integration.tools*` and
`website-integration.repository*`, `scripts/verify-live-integration.ts`,
`src/voice/voice-library.*`, `voice.module.ts`, `widget-voice.service*`,
`voice-session.manager*`, and optional/shared Python voice runtime files.
Changed frontend surfaces: admin API/Voice settings, widget voice selection/client
tests and styling, SDK build output, and this report/deployment documentation.

Remaining release blockers: consented live cloning and production persistence,
physical-microphone/human listening acceptance, lower-latency CPU operation,
Hindi/Telugu full conversations, and a real merchant cart/checkout contract.
The historical ingestion sync warning also remains explicit.

## Earlier: healthy VAD service, failing real audio processing

### Confirmed failure and reproduced cause

The retained backend log captured the reported browser failure at 03:31:40:
`voice_audio_pipeline_failed` with **`VOICE_PROVIDER_TIMEOUT`**. This was an
audio-processing deadline, not a TCP connection, ticket, origin or `/health`
failure. The adapter's deadline was 500 ms. Actual valid PCM processing
requests succeeded outside contention; endpoint/schema mismatch was ruled out.

The VAD adapter previously had no global admission limit. The Python endpoint
allowed concurrent request threads to compete for one shared ONNX model lock,
reacquiring it for every 20 ms frame in each batch. Under concurrent valid
440 ms batches, **15 of 16 requests timed out at approximately 509–515 ms**;
one completed in 477.9 ms. Health can remain successful because it performs
neither inference nor acquisition of that model lock.

This reproduces the observed timeout class and identifies an unbounded
contention mechanism. The original failure log did not record host CPU load
or concurrent request count, so those exact conditions for that historical
request cannot be reconstructed.

### Exact wire contract and packet trace

The processing endpoint is **POST `http://127.0.0.1:8002/predict`**, or the
loopback origin configured by `VOICE_VAD_URL`, with `Content-Type:
application/json`. A normal 100 ms WebSocket packet carries 3,200 PCM bytes;
the manager batches its five nonoverlapping 640-byte / 20 ms frames.

```json
{
  "streamId": "<voice-session UUID>",
  "audio": "<base64 raw PCM bytes, never logged>",
  "encoding": "pcm_s16le",
  "sampleRate": 16000,
  "channels": 1
}
```

PCM is signed 16-bit little-endian, 16 kHz, mono—not WAV, float32 or stereo.
Batches must be a positive multiple of 640 bytes, up to 14,080 bytes / 440 ms
(22 frames). The previous textual 450 ms maximum was misleading because it
was not 20 ms aligned. Response:

```json
{
  "speech": false,
  "probability": 0.01,
  "frames": [{"speech": false, "probability": 0.01}],
  "processingMs": 1.2
}
```

`frames` has exactly one ordered decision per 20 ms frame; probabilities must
be finite numbers in [0,1] and speech values booleans. Top-level decision fields
mirror the final frame for compatibility. Silero internally consumes 512 new
samples plus its 64-sample model context; leftover input is retained per UUID.

Actual path: gateway `handleBinary` validates binary framing/epoch/sequence →
bounded session audio queue → `drainAudio` → `consumeAudio` →
`SileroVadAdapter.detectBatch` → JSON/base64 POST → FastAPI validation →
bounded admission → atomic Silero batch → ordered response validation →
per-frame speech segmentation → `voice.audio.ack`.

### Implemented fixes

- NestJS now permits at most **two active VAD requests and 16 queued**, with
  cancellation and the **same 500 ms total budget**, including queue wait and
  response-body reading/validation. Existing session queue/backpressure remains.
- Python bounds active VAD processing with its existing two-slot semaphore and
  holds the model lock **once per complete batch**. It preserves all 20 ms
  decisions and exact sample order, rather than interleaving individual frame
  acquisitions across request threads. Excess sidecar work fails explicitly
  with HTTP 503; no unlimited queue or dummy success is introduced.
- Found and fixed a coupled timeout bug: the shared fetch helper originally
  removed its abort bridge/timer once headers arrived. Its new optional response
  reader keeps the deadline active through VAD JSON parsing. Existing STT/TTS
  callers retain their previous API and streaming behavior.
- Validate stream UUID, PCM metadata/size and response shape. HTTP 422 is an
  invalid-request error, 503/unreachable a service-unavailable error, elapsed
  deadlines timeout errors and malformed replies validation errors.
- Never retry a timed-out stateful batch: the model might already have consumed
  it. Existing failed-turn error/reset behavior remains explicit.
- Sanitized adapter logs include fixed loopback endpoint/path, POST method,
  phase, HTTP status when available, duration, byte/frame counts and error code.
  Successful validation is sampled every five seconds (also for slow calls);
  failures are always logged. Sidecar slow/error logs contain only method,
  `/predict`, status and duration. No PCM/base64, credentials or response body
  is printed.

### Actual verification

| Test | Result |
|---|---|
| Before fix: 16 concurrent valid 14,080-byte direct requests | 15 timeouts, one HTTP 200 |
| After fix: final NestJS adapter, 16 concurrent 3,200-byte batches, real ONNX service | 16/16 passed, 152–357 ms including queue wait |
| After fix: final adapter, 16 concurrent 14,080-byte batches, real ONNX service | 16/16 passed, 47–402 ms including queue wait |
| Persistent real endpoint smoke test | HTTP 200 and exact decision counts for 640/3,200/6,400/14,080 bytes |
| Real invalid PCM smoke test | HTTP 422 for zero, 639 and 14,400 bytes |
| Merchant browser, actual microphone API → worklet → WS → adapter → real VAD | 469 acknowledgements, no session errors over 57.34 seconds |
| Browser VAD processing | Mean 21.43 ms, p95 44.59 ms, max 138.80 ms |
| Browser backend queue maximum in ACKs | 100 ms |

The real endpoint smoke test's first Python urllib request took 2.125 seconds
including client connection setup on this host; subsequent valid requests took
46/47/110 ms. It is not presented as a sub-500 ms cold-start guarantee. Direct
Node/adapter tests above use the real 500 ms deadline. Sustained CPU starvation
or unavailable engines can still fail explicitly; health is not proof of
processing capacity.

Focused automated verification: **40 backend tests passed**, including success,
invalid input, HTTP 422/503, unreachable service, malformed JSON/probabilities,
missing decisions, bounded concurrency, header timeout and response-body timeout.
**11 Python tests passed**, including single-lock batching and exact native
window order/state isolation. Backend production build and lint passed.
This task did not claim a new full STT/agent/TTS product conversation.

### Files changed and commands

- [VAD adapter](backend-nestjs/src/voice/vad/silero-vad.adapter.ts)
- [Provider HTTP/deadline helper](backend-nestjs/src/voice/voice-provider.util.ts)
- [Provider regressions](backend-nestjs/src/voice/voice-provider.spec.ts)
- [Existing sidecar](backend-nestjs/scripts/local-voice/server.py)
- [Runtime regressions](backend-nestjs/scripts/local-voice/test_runtime.py)
- [Live smoke test](backend-nestjs/scripts/local-voice/smoke_test.py)
- [Deployment guidance](frontend/WIDGET-DEPLOYMENT.md) and this report

```powershell
cd C:\Users\jilan\Downloads\mczen\backend-nestjs
# Regression and actual processing tests:
npm test -- --runInBand --runTestsByPath src/voice/voice-provider.spec.ts src/voice/voice-session.manager.spec.ts
.\.local-voice\venv\Scripts\python.exe -m unittest discover -s scripts\local-voice -p test_runtime.py
.\.local-voice\venv\Scripts\python.exe scripts\local-voice\smoke_test.py --vad-only

# If stopped: VAD in its own terminal; backend in another after build:
.\.local-voice\venv\Scripts\python.exe scripts\local-voice\server.py --service vad --directory .local-voice\models
npm run build
npm run start:prod
```

Only the owned VAD/backend processes were restarted; STT/TTS/Ollama, migrations,
environment files, authentication/origin security and WebSocket framing remain
unchanged.

## Full voice connection lifecycle and bounded startup

The repeated report was investigated again against the running merchant page,
backend, models and actual WebSocket—not inferred from health probes alone.
All five services (backend, STT, VAD, TTS, Ollama) responded successfully.

### Findings and exact timeout location

The generic message was generated by the 12-second timer inside
`VoiceClient.openSocket`, while it waited for the matching server
`voice.session.started` / `voice.session.resumed` acknowledgement. There is no
separate `voice.ready` event in the protocol.

The particular user-reported failed attempt was not retained in browser logs,
and the shared merchant browser connected successfully before these new
changes. Therefore **its precise triggering dependency cannot honestly be
identified retrospectively**. The previously fixed permission-timer bug is
not assumed to explain this new report.

Two additional reproducible lifecycle defects were found and corrected:

1. The HTTP voice-ticket request (including an initial widget connect when
   needed) had no startup deadline or cancellation signal.
2. The gateway marked the session started and cleared its five-second timer
   immediately after authenticating the ticket, **before** asynchronous
   settings/health/slots/conversation/persistence initialization. If creation
   stalled, a WebSocket could be open indefinitely with no acknowledgement;
   only the browser's generic timer eventually failed. A late creation could
   also attach a session after the browser had already closed.

The gateway now keeps that same five-second budget through creation, sends a
safe stage-specific timeout error and aborts initialization. The manager checks
cancellation after awaited operations, releases slots and closes only a newly
created late session—not existing merchant data. The client now distinguishes
ticket timeout, WebSocket upgrade timeout, missing acknowledgement,
authentication rejection and microphone startup. Existing 12-second
WebSocket and 60-second microphone budgets were not increased.

### Actual lifecycle and security checks

The actual order is click → ticket HTTP request → widget token/exact origin/
tenant/assistant validation → conversation resolution → live/cached capabilities
→ origin-bound single-use ticket → `ws://localhost:3000/api/voice/stream`
using `mczen-voice.v1` → `voice.session.start` containing the ticket →
server authentication/creation → `voice.session.started` →
microphone permission → AudioContext/AudioWorklet → local `audio_ready` →
ordered binary audio. Permission is deliberately not requested before the
authenticated server session is accepted.

Frontend/backend event names, version and payload fields match. Tickets expire
after 30 seconds, are atomically consumed once, stay out of URLs/logs and bind
the exact browser Origin plus tenant/assistant/conversation. No namespace or
Socket.IO endpoint is used. The merchant connects directly to port 3000;
the platform Vite proxy also supports `/api` WebSockets. Production origin/
authentication policies, audio backpressure, STT/VAD/TTS and agent tools remain
unchanged.

**Live origin test:** `http://localhost:5173` returned HTTP 403 at `/connect`
and hid the mic; `http://127.0.0.1:5173` is the actual registered merchant origin
and connected successfully. They are intentionally not aliases. No allowlist
or protected integration record was modified to make the test pass.

### Live browser results with the deployed fixes

| Stage since microphone click | Measured time |
|---|---:|
| Ticket received | 46 ms |
| WebSocket open | 60 ms |
| Server session acknowledged | 123 ms |
| Microphone permission granted | 428 ms |
| AudioContext startup | 748 ms |
| AudioWorklet ready / Listening | 766 ms |
| Audio packets sent during approximately five-second check | 41 |
| Widget errors | 0 |

**Real browser connection verified:** yes, through the actual merchant widget,
real microphone API, origin-bound ticket, running NestJS gateway and AudioWorklet.
This is a connection/streaming test, not a new factual product-conversation or
human-speech accuracy claim. Capture was stopped and the page restored to the
registered origin after testing.

Credential-safe browser diagnostics now emit `mczen:voice-connection` and
`[McZEN:voice]` debug entries with stage/elapsed time only. Backend logs trace
ticket requests, capabilities, upgrade/origin validation, ticket authentication,
settings, health, slots, conversation authorization, persistence and actual
acknowledgement sending. Audio and token bodies are never logged.

### Validation and changed files

- **77 backend tests passed** across gateway, session manager, widget voice,
  ticket service and widget service suites.
- **41 frontend tests passed**, covering stalled ticket creation, cancellation,
  socket-not-open, missing acknowledgement, auth failure, delayed microphone
  permission, successful startup and forwarding HTTP abort signals.
- Backend build/lint and frontend/widget/SDK production builds passed.
- Server regressions cover a stalled creation deadline, late persistence
  cancellation/slot cleanup, both loopback origins with correctly bound
  tickets, mismatched origins, token expiry and existing tenant isolation.

Changed runtime sources:
[voice client](frontend/src/voice/voiceClient.js),
[widget API client](frontend/src/widget/client.js),
[widget diagnostics](frontend/src/widget/voice.js),
[gateway](backend-nestjs/src/voice/voice.gateway.ts),
[session manager](backend-nestjs/src/voice/voice-session.manager.ts),
[widget voice capabilities](backend-nestjs/src/voice/widget-voice.service.ts),
[widget ticket flow](backend-nestjs/src/widget/widget.service.ts).
Regression coverage:
[client tests](frontend/src/voice/voiceClient.test.js),
[widget voice tests](frontend/src/widget/voice.test.js),
[gateway tests](backend-nestjs/src/voice/voice.gateway.spec.ts),
[manager tests](backend-nestjs/src/voice/voice-session.manager.spec.ts),
[ticket tests](backend-nestjs/src/voice/voice-ticket.service.spec.ts).
Updated [deployment guidance](frontend/WIDGET-DEPLOYMENT.md).

### Startup commands

Use separate terminals for the long-running commands; do not start a second
copy if a port is already healthy. Existing environment/model configuration is
used without editing `.env` files.

```powershell
# Backend
cd C:\Users\jilan\Downloads\mczen\backend-nestjs
npm run build
npm run start:prod

# Three separate speech-service terminals, from backend-nestjs:
.\.local-voice\venv\Scripts\python.exe scripts\local-voice\server.py --service stt --directory .local-voice\models
.\.local-voice\venv\Scripts\python.exe scripts\local-voice\server.py --service vad --directory .local-voice\models
.\.local-voice\venv\Scripts\python.exe scripts\local-voice\server.py --service tts --directory .local-voice\models

# Ollama, only if not running
ollama serve

# Platform frontend
cd C:\Users\jilan\Downloads\mczen\frontend
npm run dev

# Merchant frontend (separate terminal); open http://127.0.0.1:5173/
cd C:\Users\jilan\Desktop\mcgen-rea
npm run dev
```

## Earlier follow-up: connection timeout during microphone startup

The reported timeout was investigated with all speech sidecars healthy and the
backend responding HTTP 200. A fresh actual merchant-browser connection opened
in 8.5 ms and received `voice.session.started` after approximately 52 ms; the
original failed attempt was not retained in browser diagnostics, so its exact
cause cannot be retrospectively established.

A concrete client lifecycle bug was found and fixed: the 12-second connection
timer remained active until microphone permission, AudioContext resume and
AudioWorklet initialization finished, even after the backend had acknowledged
the session. A slow permission prompt could therefore produce a false
"Voice connection timed out" error and close a healthy socket.

The server acknowledgement now ends that timer. A separate bounded 60-second
microphone-startup deadline reports a microphone/device-specific error, and the
widget displays an explicit permission/startup status. Genuine missing server
acknowledgements still fail after 12 seconds. Late microphone grants following
timeout are cleaned up.

**Verified live:** deliberately delayed browser microphone acquisition by
13 seconds. At 12.21 seconds the widget correctly displayed "Starting microphone
— allow access if prompted…"; after permission completed it displayed
"Listening…" and sent 22 audio packets without errors. A normal fresh startup
also displayed "Listening…" and sent audio. The test stopped microphone capture
and restored browser APIs afterward.

**Validation:** 36 frontend tests passed, including delayed permission, genuine
connection timeout, microphone-startup timeout and late-track cleanup; frontend,
widget and SDK production builds passed. No backend restart or service-health
bypass was needed. Changed
[voice client](frontend/src/voice/voiceClient.js),
[client tests](frontend/src/voice/voiceClient.test.js),
[widget status](frontend/src/widget/widget.js) and
[deployment guidance](frontend/WIDGET-DEPLOYMENT.md).

## Microphone backlog fix and live stress verification

This section supersedes the older paced/drop-buffer behavior described below.
No migrations, environment files, model selection, credentials or protected
application records were changed for this fix.

### Exact backlog and root cause

The old warning originated in the browser's `pendingSamples` Float32 buffer:
only 8,000 samples / 500 ms of unsent microphone audio were retained.
Main-thread capture/resampling plus timer drift could make the producer
outpace the paced sender after a stall. Older samples were discarded.
Separately, the backend previously discarded old queued PCM at 64,000 bytes /
two seconds. Neither behavior guaranteed a complete utterance for STT.

Serial VAD HTTP overhead was an additional CPU/latency cost: the backend sent
each 20 ms frame individually (50 requests/second/stream). A baseline measured
10.394 ms mean, 14.643 ms p95, 151.743 ms maximum per request. Slow final STT
was not the audio-drain queue's blocking operation; it runs separately.

### Implemented changes

- AudioWorklet captures on the audio thread, with persistent resampling phase,
  PCM16 conversion, a fixed two-second ring and two bounded MessagePort credits.
- Capture is 16 kHz, mono, signed little-endian PCM16. Normal packets contain
  100 ms / 3,200 payload bytes; delayed packets coalesce to 200 ms / 6,400
  bytes, in original sample order. The existing binary header remains unchanged.
- Deadline-driven sends recover from delays without a polling-timer throughput
  ceiling, at most one packet per 50 ms. Backend 40-frame/sec enforcement stays
  unchanged. `ack-v1` limits unacknowledged PCM to 500 ms; explicit backend
  pause/resume and WebSocket buffered-byte checks retain ordered unsent audio.
- Overflow, global ingress overload or a genuine within-epoch sequence gap stops the affected session
  explicitly, rather than silently dropping speech and submitting incomplete STT.
- VAD batches nonoverlapping 20 ms frames through the existing endpoint and
  preserves every ordered decision. Audio-end waits for queued VAD; the
  utterance limit now matches the STT adapter's actual 20-second limit.
- Browser `mczen:voice-metrics`, per-packet acknowledgements, authenticated
  ping/pong, speech-onset correlation and safe server STT timing logs expose
  capture, buffering, network, VAD, STT and end-to-end latency.
- Existing origin-bound tickets, assistant/tenant identity, agent, product tools
  and Piper audio remain in use. No parallel voice implementation was created.

### Actual measurements and verification

**COMPLETE AND VERIFIED: bounded ordered transport, backpressure, VAD batching,
and controlled English input through the real browser/backend voice pipeline.**

The final adaptive worklet build ran on the actual merchant browser for
**115.65 seconds**, including a deliberate **1.2-second UI-thread stall**,
real Whisper inference, existing agent processing and generated response audio:

| Measurement | Actual result |
|---|---|
| Input source | Controlled Piper speech injected as a browser MediaStream; not a human microphone accuracy test |
| Transport | 1,149 packets, all 1,149 acknowledged; 100/200 ms packets; no session errors |
| Audio format | AudioContext and wire both 16,000 Hz, mono PCM16 |
| Recognized speech | "Hello, what products are available?" |
| VAD packet processing | Mean 10.79 ms; p95 14.00 ms; maximum 32.30 ms |
| Backend queue wait | Mean 0.077 ms; p95 0.138 ms; maximum 0.538 ms |
| Sampled backend queue peak | 0 ms after packet processing |
| Capture backlog peak | 940 ms during deliberate stall; recovered without overflow |
| Capture-to-VAD peak | 1,144.1 ms during stall; latest normal sample 14 ms |
| Latest WebSocket RTT | 1.7 ms |
| Browser WebSocket pending-byte peak | 3,211 bytes |
| Complete STT input | 4,120 ms including pre-roll and endpoint silence |
| Final STT duration | 12,276.13 ms |
| Capture onset to received final transcript | 15,559.3 ms |
| Generated response PCM received | 159,384 bytes through the existing voice socket |

Earlier one-credit worklet prototypes were rejected: one recovered from a UI
stall but still overflowed under subsequent agent CPU load. The final two-credit
adaptive packet implementation above survived that combined load. This is not
just a larger warning threshold.

The same updated VAD benchmark measured 20 ms individual requests at 8.495 ms
mean / 10.560 ms p95, versus 100 ms batches at 11.384 ms mean / 13.260 ms p95.
For equal audio duration this reduces serial VAD/HTTP work by about **3.7x**
and HTTP request count by **5x**. Native Silero model context is retained;
new audio samples are not processed repeatedly in overlapping windows.

**Remaining limitations:** CPU Whisper-small/int8 remains relatively slow
(9.15 seconds in an earlier run, 12.28 seconds in this loaded run). Existing
six-thread/two-worker Whisper configuration was inspected, not arbitrarily
retuned or replaced. Streaming remains responsive during final STT, but this
is not a sub-second transcription claim. Physical-microphone speech accuracy,
factual merchant-product voice answers and Hindi/Telugu end-to-end voice remain
unverified. Telugu has no configured Piper model; installed Hindi voices do not
enable assistant speech when its Hindi voice setting is disabled.

### Changed source and verification commands

- [Capture worklet](frontend/src/voice/capture-worklet.js),
  [voice client](frontend/src/voice/voiceClient.js),
  [client tests](frontend/src/voice/voiceClient.test.js),
  [widget diagnostics](frontend/src/widget/voice.js).
- [Voice manager](backend-nestjs/src/voice/voice-session.manager.ts),
  [voice types](backend-nestjs/src/voice/voice.types.ts),
  [VAD port](backend-nestjs/src/voice/vad/vad.port.ts),
  [Silero adapter](backend-nestjs/src/voice/vad/silero-vad.adapter.ts),
  [manager tests](backend-nestjs/src/voice/voice-session.manager.spec.ts),
  [provider tests](backend-nestjs/src/voice/voice-provider.spec.ts).
- [Local speech server](backend-nestjs/scripts/local-voice/server.py),
  [Python tests](backend-nestjs/scripts/local-voice/test_runtime.py),
  [deployment and metrics guidance](frontend/WIDGET-DEPLOYMENT.md).

Focused validation: **43 backend tests**, **33 frontend tests**, **10 Python
tests** passed. Backend build/lint and frontend application/widget/SDK production
builds passed. Existing unrelated lint, bundle-size and Jest open-handle
warnings are not treated as voice success evidence. Added tests cover slow STT
without blocking ingress, slow VAD flow control, queue overflow, WebSocket
congestion, exact sample/sequence ordering, resampling, bounded worklet credits
and adaptive recovery.

```powershell
cd C:\Users\jilan\Downloads\mczen\backend-nestjs
npm test -- --runInBand --runTestsByPath src/voice/voice-session.manager.spec.ts src/voice/voice-provider.spec.ts src/voice/voice.gateway.spec.ts src/voice/widget-voice.service.spec.ts
npm run build
npm run lint
.\.local-voice\venv\Scripts\python.exe -m unittest discover -s scripts\local-voice -p test_runtime.py

cd C:\Users\jilan\Downloads\mczen\frontend
npm test
npm run build
```

Services required: existing backend on 3000, Whisper on 8001, Silero on 8002,
Piper on 8003 and existing Ollama on 11434. Start local sidecars in separate
terminals using the installed environment (replace `vad` with `stt` or `tts`):

```powershell
cd C:\Users\jilan\Downloads\mczen\backend-nestjs
.\.local-voice\venv\Scripts\python.exe scripts\local-voice\server.py --service vad --directory .local-voice\models
# In a separate terminal, after npm run build:
npm run start:prod
```

All three sidecars and the final backend were confirmed healthy during live
verification. Synthetic browser overrides are restored and the temporary
speech fixture is removed after testing.

## Earlier widget voice investigation and real verification

### Follow-up: audio frame rate and sequence errors

All three sidecars were healthy during the follow-up investigation. The errors
therefore were not evidence that all three services had stopped.

Fixed the existing streaming path without changing authentication or raising
the server's 40-frames/second limit:

- The old microphone callback sent all buffered frames in a tight loop.
  Delayed callbacks/backpressure recovery could burst frames. The existing
  `VoiceClient` now sends at most one packet each 50 ms, up to 100 ms PCM per
  packet, with a bounded 500 ms backlog and throttled, explicit overload warning.
- Prior-epoch audio intentionally dropped by the server previously appeared as
  a sequence gap when the next epoch arrived. The manager now starts a new
  sequence baseline on interruption, turn reset and disconnect/recovery.
  Duplicate/gap checks remain enforced within each epoch, and the client drops
  unsent prior-epoch samples.
- Fatal rate/protocol rejection no longer initiates automatic reconnect loops.
  Capture send timers are cancelled on stop/disconnect; stale socket callbacks
  and late microphone permission results cannot restart old capture.
- A failed live audio/VAD operation now reports `VOICE_AUDIO_PROCESSING_FAILED`
  and logs a safe provider code instead of reusing the startup "all engines
  unavailable" message. Actual failed health checks still reject voice startup.

Regression validation: 29 frontend tests passed; three focused backend voice
suites / 28 tests passed; backend build and type-aware lint passed (warnings
remain), and frontend/widget/SDK production builds passed. Tests explicitly
exercise callback bursts, bounded packets/backlog, socket backpressure, stale
epoch audio, stop cleanup, terminal rate-limit rejection, genuine within-epoch
gaps, resume epochs, transient VAD errors, and the unchanged server frame limit.

Live merchant-browser verification after rebuilding the SDK and restarting the
backend ran for **60.06 seconds**, sending **692 packets** with a maximum
**16 packets in any rolling second** and maximum **3,200 PCM bytes/packet**.
It included an explicit interrupt/epoch transition and a deliberately blocked
main thread for 1.2 seconds. There were **zero WebSocket session errors**, no
rate-limit rejection, no false sequence-gap warning and no reconnect. One
expected bounded-backlog warning reported audio dropped during the deliberate
stall. All three sidecar health checks still passed afterward. The microphone
session was stopped after the check.

This validates transport stability under that test; it is not a new factual
product-answer or human-speech accuracy claim. The rebuilt backend and existing
sidecars remain running. Refresh the merchant page to load the updated SDK.

### Root cause and changes

The backend's STT, VAD and TTS endpoints on loopback ports 8001, 8002 and 8003
were not listening. The Python environment and downloaded models already
existed; no installation was needed. `WidgetVoiceService.availability` correctly
returned false but collapsed all failed probes into one boolean. The widget
therefore displayed only "Voice is not available right now."

The assigned assistant already has speech enabled with Faster Whisper and
Piper, and English voice `en_US-amy-medium`. Hindi and Telugu are enabled for
text but their persisted `voice_enabled` flags are zero. No assistant settings,
existing records, migrations or environment files were edited.

Changes:

- `widget-voice.service.ts`: retain individual failed STT/TTS/VAD probes in
  the existing cached/coalesced health check; expose safe diagnostic codes and
  log unavailable dependencies/settings without returning internal errors.
- `widget/voice.js`: explain failed dependencies, disabled/misconfigured
  assistants, missing speech languages, insecure contexts and microphone
  Permissions-Policy restrictions while preserving text chat.
- `voice/voiceClient.js`: settle a microphone startup failure before closing
  the socket, so cleanup cannot replace it with a generic connection error.
- Related backend/frontend regression tests and widget deployment documentation.
- Rebuilt backend, frontend, widget and SDK output.

The connection and playback implementations were already present: website
voice tickets bind the same tenant, assistant, conversation and widget session;
the WebSocket consumes this origin-bound ticket; the session manager invokes
the existing agent with public catalogue permissions and voice modality.
PCM output is played through the existing Web Audio queue. No duplicate API,
agent, or playback subsystem was added.

### Actual results and limitations

| Check | Result |
|---|---|
| Real sidecar health | All three existing sidecars started and returned healthy. |
| Real model smoke test | Four English and two Hindi Piper voices produced PCM. Silero detected speech and kept independent silence streams isolated. Whisper recognized "Hello, welcome to the local voice assistant." in 31.81 seconds, below its 45-second final timeout. |
| Live merchant connect | HTTP 200; `available: true`, speech languages `["en"]`, text-only languages `["hi","te"]`, no failed dependencies. |
| Real voice ticket/WebSocket | Origin-bound website widget ticket accepted; session initialized against the existing MySQL-backed assistant. |
| Controlled synthetic speech turn | Sent real Piper-generated "What products are available?" as paced 16 kHz PCM over the actual WebSocket; real VAD and Whisper returned "what products are available." |
| Existing agent response | Model `qwen2.5:3b` answered "There was an issue retrieving the available products. Please try again later." It reported zero tool calls and sources. **Product-tool execution/factual product answers are NOT verified by this turn**, despite the 16/25 persisted records. |
| Real response TTS | 153,810 PCM bytes, 4,806 ms, completed voice turn. |
| Browser playback | Captured real response PCM passed through the current `VoiceClient.queuePlayback`: running AudioContext, 49 queued frames, approximately 4.83 seconds; all sources completed. This proves playback scheduling/completion, not human audibility. Temporary PCM file removed. |
| Merchant microphone attempt | Secure context, microphone policy and APIs present; initially permission denied, later granted. Session and transcription were observed, but the uncontrolled input produced "AM and C.", rate-limit/reconnect and STT errors. **A complete human-microphone conversation is NOT verified.** |
| Hindi | Both installed Hindi voices synthesized successfully. Assistant Hindi speech is disabled; Hindi STT/conversation was not tested. |
| Telugu | Assistant speech disabled and no configured Piper voice; text-only. |

These live API tests created new widget/voice conversations and events through
normal application APIs. They did not overwrite merchant records or change
schemas. The standalone DB checks were read-only.

### Commands and verification

From `backend-nestjs`, in separate terminals:

```powershell
.\scripts\local-voice\start.ps1 -Service stt
.\scripts\local-voice\start.ps1 -Service vad
.\scripts\local-voice\start.ps1 -Service tts
npm run start:prod
```

For rebuilding/restarting later, run `npm run build` before `npm run start:prod`.
Do not run a second backend or sidecar on an already occupied port.
The three sidecars and backend were left running for the local demo after
the bounded test instances were replaced with detached instances.
The detached PowerShell wrapper launches exited unsuccessfully; direct launches
of the same installed Python `server.py` runtime succeeded. Final health checks
confirmed all three sidecars healthy and backend HTTP 200. Final merchant
browser reload confirmed HTTP 200 connect, English voice available, microphone
button visible and the unavailable note cleared.

Commands executed for validation:

```powershell
# backend-nestjs
.\.local-voice\venv\Scripts\python.exe .\scripts\local-voice\smoke_test.py
npm test -- --runInBand --runTestsByPath src/voice/widget-voice.service.spec.ts src/voice/voice-session.manager.spec.ts src/voice/voice.gateway.spec.ts src/widget/widget.spec.ts
npm run build
npm run lint
# frontend
npm test
npm run build
```

- Backend: 4 focused suites / 55 tests passed; build passed; lint exited zero
  with warnings. Jest printed its existing open-handles warning.
- Frontend: 27 tests passed, including denial/cleanup ordering and capability
  diagnostics; frontend, widget and SDK production builds passed. Vite retains
  a large-chunk warning.
- Additional inline Node verification queried assistant settings and merchant
  counts read-only and exercised the live ticket/PCM turn described above.
- Real browser checks used the actual merchant origin and actual backend,
  without mocked connect/voice responses.

Remaining blockers: repeat a controlled, spoken human English conversation and
resolve observed live microphone rate/STT failures; obtain actual product-tool
execution and factual answers; configure Hindi speech if desired. Neither a
fully working voice/product demo nor Hindi/Telugu voice is claimed.

## Feature status

| Feature | Status | Evidence / blocker |
|---|---|---|
| Tenant-scoped website integration APIs, key lifecycle, page/product/batch ingestion, crawler, and status/sync implementation | IMPLEMENTED BUT NOT VERIFIED | Existing controllers, service, repository, DTOs, and migration are present. Focused integration unit tests pass; no live API requests were made. |
| Website integration migration 0013 | COMPLETE AND VERIFIED | `npm run verify:live-integration` (runtime account `mczen_user`, MySQL 8.4.13, database `mczen`): `WebsiteIntegrations1740000000013` recorded; 13 applied, 0 pending, 0 unknown. This task did not run the migration. |
| MySQL integration tables and indexes | COMPLETE AND VERIFIED | Same run: `website_integrations`, `website_pages`, `website_products`, `website_page_views` exist with all expected named indexes (including the product FULLTEXT index) and foreign keys. |
| API key creation, rotation, revocation, unauthorized access, and tenant isolation against real MySQL | IMPLEMENTED BUT NOT VERIFIED | No live API/database tests were run. Existing unit tests do not establish database isolation or persistence. |
| Merchant product/page/content import | IMPLEMENTED BUT NOT VERIFIED | The merchant adapter reads its existing storefront source (16 products) and website content source (25 pages), plus a server-only sync worker and dry-run mode. Dry-run emitted 16 products and 25 pages with zero requests; no live records have been imported. |
| Development-only local JSON ingestion | IMPLEMENTED BUT NOT VERIFIED LIVE | Explicit development/flag gates, existing private-key ingestion routes, local CLI commands and dashboard guidance implemented. Source-to-DTO check validates 16 products and 25 distinct pages. Service tests use mocked repositories and adapter tests use mocked transport; no live apply was performed. |
| Website/product assistant tools | IMPLEMENTED BUT NOT VERIFIED | Six website/product tools are registered. Unit tests cover tenant/assistant scope, product query validation, and currency-qualified budget filtering (for example `maxPrice: 2000, currency: INR`). A repository test checks that the SQL binds tenant, assistant, currency, and effective-price filters. No real records or live agent conversation were used. |
| SDK initialization and public-key/session/page-view flow | IMPLEMENTED BUT NOT VERIFIED LIVE | A local production-preview browser check verified invalid-key rejection, widget rendering, intercepted session/chat requests, and SPA page-view request construction. Calls were intercepted; real McZEN origin validation, sessions, and chat remain unverified. |
| Product cards in the text and voice widget | IMPLEMENTED; UI VERIFIED WITH FIXTURE | Product tool results are forwarded through text and voice responses. The public widget message response previously dropped `products`; `WidgetService.ask` now returns them (unit-tested). A local production-preview browser check with an explicitly mocked API response rendered a product name, image, sale price/currency, product link, answer text, and source. No merchant/database result was used. |
| English voice conversation with actual STT/VAD/TTS services | PARTIALLY VERIFIED LIVE; HUMAN CONVERSATION BLOCKED | Latest investigation above verifies a synthetic speech turn through real services/agent and browser response playback. Uncontrolled microphone testing had rate/STT failures, and the product question produced no product-tool calls. Hindi TTS synthesized successfully but assistant Hindi speech is disabled; Telugu is text-only. |
| `mcgen-rea` connection | IMPLEMENTED BUT NOT VERIFIED | The merchant project has an optional SDK loader and server-only sync adapter using McZEN's page/product routes. Its dry-run made zero network requests. Actual key/domain/session/chat/ingestion behavior remains unverified. |

## Database verification and required authorization

The inspected TypeORM CLI configuration is
[`backend-nestjs/src/database/data-source.ts`](./backend-nestjs/src/database/data-source.ts).
It loads `DB_HOST`, `DB_PORT`, and `DB_DATABASE`, uses the separate
`DB_MIGRATION_USERNAME` / `DB_MIGRATION_PASSWORD` pair for migrations, disables
automatic migrations and schema synchronization, and uses the explicit
[`ALL_MIGRATIONS` registry](./backend-nestjs/src/database/migrations/index.ts).

Required environment variables:

- Runtime: `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_PASSWORD`, and
  `DB_USERNAME` or `DB_USER`.
- Migration CLI: `DB_MIGRATION_USERNAME`, `DB_MIGRATION_PASSWORD`, plus the
  same host, port, and database settings.
- Optional: `DB_CONNECT_TIMEOUT_MS`, `DB_CONNECTION_LIMIT`.

Earlier read-only checks found 12 migrations applied and
`WebsiteIntegrations1740000000013` pending, with both accounts limited to
`USAGE ON *.*`. **As of 2026-11-05 the live verifier confirms 0013 is applied**
(13 applied, 0 pending, 0 unknown) and the runtime account can read the schema.
This task did not run the migration or change grants. The 0013 migration creates
`website_integrations`, `website_pages`, `website_products`, and
`website_page_views`, including tenant-aware foreign keys and named unique,
lookup, and full-text indexes.

The DBA grant request below is retained for reference only:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE
  ON `mczen`.*
  TO 'mczen_user'@'%';

GRANT SELECT, INSERT, CREATE, INDEX, REFERENCES
  ON `mczen`.*
  TO 'mczen_migrator'@'%';
```

After authorization, the project migration command is:

```powershell
Set-Location 'C:\Users\jilan\Downloads\mczen\backend-nestjs'
npm run migration:run
```

The package does **not** define an `npm run migration` script. After running
the configured command, verify with:

```powershell
npm run migration:show
npm run migration:check
```

Do not treat the migration as complete until 0013 is applied, the ledger has no
pending or unknown migrations, and the required tables, constraints, and
indexes are verified against `information_schema`.

## Live integration verification script

[`backend-nestjs/scripts/verify-live-integration.ts`](./backend-nestjs/scripts/verify-live-integration.ts)
checks the migration, merchant ingestion, product search, and assistant answers
without modifying or deleting existing records. It uses the runtime DB account
and never prints passwords, public/ingestion keys, or session tokens.

```powershell
Set-Location 'C:\Users\jilan\Downloads\mczen\backend-nestjs'
# 1. Database + search only (read-only)
npm run verify:live-integration -- --origin http://localhost:5173
# 2. Add public API checks (no database writes; backend must be running)
npm run verify:live-integration -- --origin http://localhost:5173 --api
# 3. Add assistant questions and save the transcript
npm run verify:live-integration -- --origin http://localhost:5173 --ask --report live-verification.json
```

| Phase | Checks | Writes |
|---|---|---|
| db (always) | Ledger has 0013 with 0 pending/unknown; 4 tables, named indexes, FKs; integration active; tenant/assistant active and owned; active product/page counts vs `--expect-products 16` / `--expect-pages 25`; no foreign-tenant rows; integration counters match; no duplicate products/URLs; every active page indexed into knowledge chunks; price/currency completeness | None. Runs in `START TRANSACTION READ ONLY` (rolled back) behind a SELECT-only guard |
| search (always) | Production `WebsiteIntegrationRepository.searchProducts`/`searchPages` SQL: full catalog listing, name search, `<= --max-price 2000 --currency INR` budget search vs direct DB count, random tenant/assistant return nothing, policy page search | None (same read-only session) |
| api (`--api`) | Invalid `mzp_` key → 403, wrong Origin → 403, registered Origin → session, invalid session token → 401 | None (sessions are signed tokens) |
| ask (`--ask`) | Five questions (catalog, under ₹2,000, product details, comparison, return policy) through `/api/website-integrations/message`; product cards must match DB price/sale price/URL; every ₹/Rs/INR amount in the answer must be a real catalog price | Creates **new** widget conversation/message rows only, exactly as a visitor would; nothing existing is updated or deleted |

Use `--integration-id <uuid>` when an origin is registered under more than one
tenant. Exit codes: 0 all pass, 1 a check failed, 2 configuration/connection
error.

First live run (2026-11-05, `--origin http://localhost:5173`): 16 checks passed
(connection, ledger, all tables/indexes/FKs); 1 failed — no website integration
is registered yet, so merchant, search, API, and assistant checks could not run.

## Test evidence

### Development-only local JSON ingestion (2026-11-05)

The existing merchant worker now provides `mczen:sync:local:dry-run` and
`mczen:sync:local`. Both the worker and McZEN backend require explicit
`NODE_ENV=development` and `MCZEN_ALLOW_LOCAL_INGESTION=1` for loopback merchant
origins. Production rejects local ingestion even with the flag set.
No new endpoints, authentication exceptions, crawler allowances, or schema
changes were added. Local crawler sync is rejected before changing job state;
the dashboard instead shows CLI instructions and existing persisted counts.

The worker still uses the separate private ingestion key and existing page/
product endpoints. It validates provider accepted/indexed counts rather than
treating any 2xx JSON as success, and reports confirmed counts and safe errors
without exposing credentials or response bodies. Local URL canonicalization
retains category query pages and the FAQ fragment so the 25 exported records
have 25 distinct page identities. Public canonicalization and SDK tracking
remain unchanged. See the [local setup commands](./frontend/WIDGET-DEPLOYMENT.md#local-merchant-development-no-crawler).

Verified:

- Backend website integration suites: **6 suites, 28 tests** (mock repositories,
  actual service logic): authentication, explicit environment gate, batch/page/
  product ingestion, indexing/deduplication, cross-tenant scope, and local crawler
  rejection. Crawler tests also reject private/link-local/metadata addresses.
- Merchant adapter: **10 tests** (mock transport), including local dry-run/apply,
  production rejection, invalid credentials/responses, and safe partial counts.
- Actual local dry-run: **16 products, 25 pages, zero network requests**.
- Actual merchant source -> built McZEN DTO contract check: **16 products and
  25 distinct validated local page URLs**, no database or network writes.
- Backend build, frontend 25 tests and dashboard/widget/SDK builds, and merchant
  TypeScript/production build passed. Frontend retains its existing chunk-size warning.

No live `--apply`, new key generation, database record write, or browser-to-live
assistant verification was performed for this change.

### Startup dependency fix (2026-11-05)

`WebsiteIntegrationsModule` imported `WidgetModule`, but `WidgetModule` did
not export `WidgetService`. Nest therefore could not construct
`WebsiteIntegrationPublicController` or `WebsiteIngestionController`.
`WidgetModule` now exports its existing service (no duplicate provider).

The module-wiring regression test compiles the real integration/widget module
boundary with external dependencies mocked and exercises both controllers'
delegation to the shared widget service. The regression and existing widget
tests pass: **2 suites, 31 tests**. Backend `npm run build` also passes.
This is module/unit validation, not live API or database verification.

### Product tool registration fix (2026-11-05)

The demo catalog and website integration both registered `get_product_details`,
causing a startup conflict when the website repository was injected. The
registry now registers that name once with context-specific dispatch: UUID
tenants require `externalProductId` and use the tenant/assistant-scoped website
repository; legacy demo tenants retain `productId` and their isolated demo
catalog. Missing or mixed identifiers are rejected. A missing imported product
never falls back to demo data, and duplicate registration remains an error.

Registry, executor, and website tool tests pass: **3 suites, 42 tests**,
including initialization with the website repository, scoped merchant lookup,
legacy demo behavior, cross-tenant demo rejection, and invalid identifiers.

Executed in this task:

```text
backend-nestjs: focused integration, agent, and voice suites
  6 suites passed; 111 tests passed.

backend-nestjs: npm test -- --runInBand src/voice/voice-session.manager.spec.ts
  1 suite passed; 13 tests passed, including voice response product metadata.
  Jest printed its existing open-handles warning after success.

frontend: npm test
  25 tests passed.

backend-nestjs: npm run build
  passed after adding currency-qualified effective-price filtering and product-card response data.

backend-nestjs: npx oxlint --type-aware src/website-integrations
  passed.

mcgen-rea: npm run test:integration
  7 mocked adapter/API tests passed.

mcgen-rea: npm test -- src/lib/mczen.test.ts
  5 SDK tests passed.

mcgen-rea: npm run build
  TypeScript check and Vite production build passed.

mcgen-rea dry-run sync
  16 products and 25 pages; zero network requests.

mcgen-rea browser-bundle ingestion-secret boundary scan
  passed.

Local production-preview browser check (API calls intercepted with test-only fixtures)
  Widget displayed a product image, ₹1,800.00 sale price, product link,
  assistant text, and source. Invalid public integration key was rejected.
  SPA navigation constructed a page-view request with the changed URL.
  No live McZEN endpoint was contacted; the screenshot was browser output only,
  not saved as a deliverable.
```

Previously recorded before this task:

- Backend build passed.
- Full backend test run: 53 suites passed, 6 skipped; 648 tests passed,
  96 skipped.
- Frontend production, widget, and SDK builds passed.

Those build/unit-test results and the fixture-based browser check do not prove
live database, merchant, agent, or voice behavior. No tests were skipped or
weakened in this task.

## Merchant integration and demo

The merchant project is separate:
`C:\Users\jilan\Desktop\mcgen-rea`. Its adapter reads the existing
`public/data/storefront.json` and `src/content/home.ts` /
`src/content/information.ts` sources; it does not add a second website.
The SDK installation pattern is:

```html
<script src="https://<MCZEN_ORIGIN>/mczen-sdk.js"></script>
<script>
  window.McZEN.init({
    integrationKey: "mzp_<PUBLIC_SITE_KEY>",
    assistantId: "<ASSISTANT_UUID>"
  });
</script>
```

Only the public site key belongs in browser code. The `mzi_...` ingestion
credential must remain in the merchant server's secret environment and be used
only for server-side requests to `/api/website-ingestion/pages`,
`/products`, or `/batch`. Do not put it in React code or a `VITE_*` variable.

No live integration can be demonstrated until the migration is authorized and
applied, the McZEN backend is running with database access, a tenant admin
registers the actual merchant origin and assistant, and the resulting public
key/assistant ID and server-side ingestion credential are configured in their
respective environments.

Start the existing McZEN backend and frontend in separate terminals:

```powershell
Set-Location 'C:\Users\jilan\Downloads\mczen\backend-nestjs'
npm run start:dev
```

```powershell
Set-Location 'C:\Users\jilan\Downloads\mczen\frontend'
npm run dev
```

The merchant worker has a dry-run command; it must not be run with `--apply`
until the API contract is configured and the database migration succeeds:

```powershell
Set-Location 'C:\Users\jilan\Desktop\mcgen-rea'
npm run dev
npm run mczen:sync -- --dry-run
```

The dry-run verification emitted 16 products and 25 pages without network
requests. `--apply` was not run. The worker sends page arrays to
`POST /api/website-ingestion/pages`, product arrays to
`POST /api/website-ingestion/products`. It uses bearer authentication sourced
only from the server-side `MCZEN_INGESTION_KEY` environment variable.

Configure these names in the appropriate process environments only; do not
put the ingestion key in any `VITE_*` setting or browser bundle:

- Server: `MCZEN_API_BASE_URL`, `MCZEN_INGESTION_KEY`, `MCZEN_SITE_URL`.
- Browser (public values only): `VITE_MCZEN_INTEGRATION_KEY`,
  `VITE_MCZEN_ASSISTANT_ID`.

The merchant `.gitignore` excludes `dist/`; the agent could not determine
whether that directory is already tracked because the merchant folder is not a
Git repository.

## Exact blockers / next actions

1. Migration 0013 is applied and verified (no action needed).
2. Start the McZEN backend and register `mcgen-rea` (origin `http://localhost:5173`
   for local dev) with its assistant in the admin Website Integrations screen.
3. Configure and start the existing McZEN backend and frontend, register
   `mcgen-rea`, and configure its public key/assistant ID plus server-side
   ingestion credential.
4. Import actual merchant products and public content, then run
   `npm run verify:live-integration -- --origin <origin> --ask` to verify
   counts, tenant association, product/content search, and factual assistant
   answers with real records.
5. Run a shared-browser end-to-end test against live McZEN for the widget,
   domain validation, session creation, chat, product presentation, and page
   tracking. Product-card rendering is verified only with a test fixture.
6. Verify English voice through live microphone → STT → agent/tools → TTS audio
   playback only when the configured local voice services are available.

No database migration, database write, or live API request was performed.
Browser API traffic in the local fixture check was intercepted; no live
browser-to-McZEN end-to-end request was made.
