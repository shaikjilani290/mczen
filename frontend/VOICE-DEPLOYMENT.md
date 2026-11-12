# Voice frontend proxy

The browser uses same-origin `/api` requests and `/api/voice/stream` WebSocket
upgrades. Do not configure a browser-facing backend URL or put bearer credentials
in a WebSocket URL. The authenticated `POST /api/voice/ticket` response is a
short-lived, single-use, origin-bound credential submitted only in the initial
`voice.session.start` message.

Vite development proxies `/api` to `http://127.0.0.1:3000` with WebSocket
upgrades enabled. Start the NestJS backend on that address before using voice.

Microphone capture uses 100 ms frames. During backpressure the client batches
up to 400 ms for VAD and waits for enough acknowledged byte credits to send
the next batch, rather than continually sending undersized requests. The
500 ms in-flight limit and two-second capture buffer remain enforced; audio
is never silently discarded to recover from congestion. A sustained service
outage or blocked browser thread can still exhaust that bounded buffer and
requires restarting voice. Rebuild the widget/SDK and reload existing pages
after updating capture code; an already-created AudioWorklet keeps its old code.
The `capture_buffer_overflow` diagnostic records backend pause status, in-flight
bytes, pending audio, tab visibility and AudioContext state without recording
microphone contents. If the browser stalls under CPU/memory pressure, keep the
voice tab active and free local resources; larger network batches cannot repair
audio already lost during a blocked capture consumer.

For production, terminate TLS at the public reverse proxy and route `/api/`
to the private NestJS listener. Preserve the browser origin and WebSocket
upgrade headers. Example Nginx configuration:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name mczen.example;

    location / {
        root /srv/mczen/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 75s;
    }
}
```

Configure the backend CORS/origin allowlist to include only the deployed
frontend origin. Keep the NestJS listener and STT/VAD/TTS sidecars private.
Voice tickets and live session state are process-local; use one backend
instance or configure connection affinity so ticket issuance, WebSocket
upgrade, and the lifetime of each voice session reach the same instance.
This project change does not deploy or alter VPS proxy configuration.
