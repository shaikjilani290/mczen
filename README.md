# McZEN AI Agent Starter

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
