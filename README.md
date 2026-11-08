# McZEN AI Agent Starter

## Current McZEN implementation

The active platform is [backend-nestjs](backend-nestjs/) with the React/widget SDK
in [frontend](frontend/). The separate merchant storefront owns its persistent
browser guest cart; the central platform coordinates authenticated cart tools.
Guest add/read/update/remove/open and controlled English voice shopping are
live-verified. Authenticated merchant accounts and checkout/payment remain
disconnected. See [the final implementation report](MCZEN-FINAL-IMPLEMENTATION-REPORT.md)
for current startup commands, browser evidence, tool enablement and limitations.
The latest voice phase suppresses non-cancellable local Whisper previews, adds
correlated stage timings and fixes buffered-audio interruption/reconnect
scheduling. Confirmed human conversation and listening acceptance remain pending;
VAD dispatch starvation is isolated and scheduling protection passed controlled
concurrent adapter tests, but a scheduling deadline recurred during human testing.
The latest run recorded 14 guided cases with 10 reference/listening confirmations;
recognition and human cart/interruption acceptance still failed. Stage profiling
isolates CPU encoder/decoder work as the main STT bottleneck. A faster base.en
candidate is explicit opt-in only: generated accuracy passed, human accuracy did
not, so small remains the default. These failures and the legacy HTTP database
fixture are not silently reported as passed.
The starter notes below describe the original Express demo, not the active
merchant integration.

Standalone starter to prepare the agent before receiving the existing McZEN React/Node.js source.

## Included
- Express API that calls local Ollama
- React/Vite voice assistant demo
- Browser speech recognition/synthesis where supported
- English, Telugu and Hindi selector
- Demo product-search adapter to replace with the real McZEN catalogue

## Requirements
Node.js 20+, npm, and Ollama installed separately.

## Run backend
```bash
cd backend
cp .env.example .env
npm install
# In another terminal ensure Ollama is running and run:
ollama pull qwen2.5:3b
npm run dev
```
Backend default: http://localhost:8080

## Run frontend
```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```
Vite prints the local URL, usually http://localhost:5173.

## Important
This is a development starter, not production-ready. Product search is a placeholder; connect it to the verified McZEN product API/database. Browser speech support and voice availability vary by browser/device. Add authentication, rate limits, robust validation, HTTPS, logging and monitoring before public deployment. No cart/order/payment action is implemented.
