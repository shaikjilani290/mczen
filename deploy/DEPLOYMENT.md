# McZEN AI — Deployment Guide (Phase 6K)

Status: **prepared, not executed.** Nothing here has been run against a VPS.
Migrations 8–12 are unapplied in production. Do not follow these steps without explicit approval.

## 1. Layout

| Item | Location |
|---|---|
| React app + `widget.js` | `/var/www/mczen/releases/<id>/` (from `frontend/dist`), symlink `/var/www/mczen/current` |
| NestJS backend | `127.0.0.1:3000` (systemd/pm2, single instance) |
| MySQL 8.4 | local or private network only |
| Redis 6.2+ | private network; `rediss://` if not loopback |
| Nginx config | `deploy/nginx/mczen.conf`; install `deploy/nginx/mczen-api-proxy.conf` and `deploy/nginx/mczen-security-headers.conf` as `/etc/nginx/snippets/mczen-api-proxy.conf` and `/etc/nginx/snippets/mczen-security-headers.conf` (the include paths used by `mczen.conf`) |

## 2. Environment variables (names only; set via the service manager, never commit)

Required in production (startup fails closed if invalid; see `src/config/production-config.ts`):

- `NODE_ENV=production`
- `JWT_SECRET` (≥32 bytes, not a placeholder)
- `SECRET_MASTER_KEY` (64 hex or 32-byte base64); missing/invalid fails closed — secrets cannot be stored or read
- `SECRET_MASTER_KEY_VERSION` — **optional**, defaults to `1`. This matches the `tool_secrets.key_version` column default, so every record written while the variable is unset decrypts fine. Decryption requires this value to equal the stored record's `key_version` exactly; changing it without re-encrypting makes old tool secrets fail closed (503 "key version is unavailable") — it never silently changes decryption. Assistant provider API keys are unaffected: their envelope is self-versioned (`v1:` prefix) and ignores this variable. (optional; defaults to `1` and must be a positive integer if set. Keep it at the version your existing stored secrets were encrypted with. Only one key version is held at a time, so changing it makes secrets stored under the old version undecryptable until they are re-set; there is no multi-key rotation yet)
- `MCZEN_WIDGET_SESSION_SECRET` (≥32 chars, different from `JWT_SECRET`, shared by all instances)
- `DB_HOST`, `DB_PORT`, `DB_USERNAME` (or `DB_USER`), `DB_PASSWORD`, `DB_DATABASE` (or `DB_NAME`)
- `SHARED_STATE_DRIVER=redis`, `REDIS_URL`, optional `REDIS_KEY_PREFIX`
- `MCZEN_CORS_ORIGINS` (comma-separated exact origins)
- `MCZEN_TRUST_PROXY` — behind the local Nginx set it to `127.0.0.1` so per-IP rate limits see real visitor IPs (explicit IP addresses only; production startup fails on anything looser — see §5.2). Unset keeps forwarding headers fully untrusted.
- Voice sidecars: `VOICE_*_URL` (STT, TTS, VAD)

Must NOT be set in production: `MCZEN_ALLOW_DEV_HEADER=1`, `MCZEN_EXPOSE_DEV_AUTH_TOKENS=1`.
`MCZEN_ALLOW_PROCESS_LOCAL_STATE=true` is an explicit single-instance acknowledgement that allows the in-memory driver; use only if you accept no shared state.

## 3. HTTPS

- Obtain certificates (e.g. certbot) and set the `ssl_certificate*` paths in `mczen.conf`.
- Port 80 redirects everything to 443 (Let's Encrypt HTTP-01 challenges can be served from the same server block if needed).
- Microphone capture requires a secure context, so voice will not work over plain HTTP.

### HSTS (deliberately off by default)

The template does **not** send HSTS. The header is cached by browsers and cannot be reliably revoked, so enable it only after all of the following hold on the target host:

1. `https://<domain>` serves the dashboard, `/widget.js` and the API correctly, and the full §8 smoke test has passed over HTTPS;
2. nothing else on the domain — or its subdomains, since the header includes `includeSubDomains` — still needs plain HTTP;
3. you accept the browser-cached `max-age`.

To enable: uncomment the single `Strict-Transport-Security` line in `/etc/nginx/snippets/mczen-security-headers.conf`, run `nginx -t`, then reload. Every response (static files, API, WebSocket handshake) picks it up because all locations share that snippet. For a cautious rollout, first deploy with a short `max-age` (e.g. `3600`) and raise it to `31536000` after a problem-free week. Do not add `preload` unless you deliberately submit the domain to the HSTS preload list.

## 4. Nginx behavior (as configured in the template)

Compatibility: the template targets the stock Ubuntu 24.04 nginx **1.24.0** (`1.24.0-2ubuntu7.x`). HTTP/2 is enabled with `listen 443 ssl http2;`, which works on nginx >= 1.9.5 with `http_v2_module`; the newer standalone `http2 on;` directive requires >= 1.25.1 and is deliberately not used. On nginx >= 1.25.1 the listen parameter only logs a deprecation warning. Do not enable the `http2 on;` form unless the host is confirmed to run >= 1.25.1.

Static content:

- `/` serves the React build with SPA fallback and `Cache-Control: no-cache`, so a new release is picked up immediately.
- `/assets/` (hashed filenames): `Cache-Control: public, max-age=31536000, immutable`.
- `/widget.js`: `Cache-Control: public, max-age=300, must-revalidate` plus `Cross-Origin-Resource-Policy: cross-origin`, which is what allows customer sites to embed the script cross-origin. Do not remove it.

Security headers — `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: microphone=(self), camera=(), geolocation=()` and `X-Frame-Options: SAMEORIGIN` — come from `/etc/nginx/snippets/mczen-security-headers.conf`. That snippet is included at server level and **re-included in every location that declares any `add_header` of its own**, because nginx stops inheriting server-level headers for such locations. Result: the dashboard, `widget.js`, hashed assets, SPA HTML, API responses and the voice WebSocket handshake all carry the same set, with no duplicates. HSTS ships disabled — see §3.

API proxying (`/etc/nginx/snippets/mczen-api-proxy.conf`, included by `/api/`, `/api/auth/` and `= /api/health/ready`):

- `proxy_pass http://mczen_api` with `Host`, `Origin` (passed through untouched; the backend validates it), `X-Real-IP`, `X-Forwarded-For $remote_addr` (overwritten, never appended — clients cannot inject spoofed entries) and `X-Forwarded-Proto $scheme`.
- `Cache-Control: no-store` on API responses; `proxy_read_timeout 120s` for slow agent/Ollama replies.
- The voice WebSocket `= /api/voice/stream` is its own location with `Upgrade`/`Connection` handshake headers, 3600s read/send timeouts, `proxy_buffering off` and `access_log off`. It also includes the security-headers snippet.

Limits and sizes:

- Request body: 12m at nginx; the backend independently enforces a 10 MB per-file upload cap.
- Nginx rate limiting keys on the real remote address: 30 r/s (burst 60) for `/api/`, 5 r/s (burst 10) for `/api/auth/`, 50 concurrent connections per IP.
- `/api/health/ready` answers only loopback callers (`allow 127.0.0.1; allow ::1; deny all`); uncomment the placeholder line to admit a monitoring subnet.

Validate with `nginx -t` before every reload.

## 5. Known caveats

1. **Not horizontally scalable for live voice.** Shared state (tickets, rate limits, slots, resume metadata) is in Redis, but live sockets and audio buffers are per process. Run a single backend instance, or use sticky routing by client. Do not claim multi-instance voice support.
2. **Client IP behind the proxy (updated in Phase 6K).** The backend keeps forwarding headers untrusted by default. Set `MCZEN_TRUST_PROXY=127.0.0.1` (the local Nginx address) in production: Express then resolves `request.ip` from the forwarding headers of that proxy only, and because Nginx **overwrites** `X-Forwarded-For` with `$remote_addr`, per-IP limits (edge/IP, auth policies, widget sessions) key on genuine visitor IPs. The value is validated at startup in production — anything other than explicit IP addresses (`true`, hostnames, CIDRs, wildcards) fails the deploy. If the variable is unset, the previous behavior remains: every visitor arrives as `127.0.0.1`, so per-IP limits act as one global bucket. The localhost dev-token gate never consults forwarding headers in either mode.
3. Redis, real-MySQL migrations 8–12, real microphone and voice sidecars have not been verified in this repository's test runs.

## 6. Pre-deploy checklist (staging first)

1. Backend: `npm ci`, `npm run build`, focused tests pass.
2. Frontend: `npm ci`, `npm run build` (produces `dist/widget.js`).
3. Run `test/database/mysql-phase6k.spec.ts` against an isolated local MySQL 8.4 test instance (`RUN_DB_TESTS=1` plus `DB_*` set in your shell) and confirm it passes.
4. Run `src/shared-state/redis-shared-state.real.spec.ts` with `REDIS_TEST_URL` against a real Redis.
5. On the target host: install both snippets under `/etc/nginx/snippets/`, install `mczen.conf`, and confirm `nginx -t` passes.
6. Back up the production database and record the current migration ledger.

## 7. Migrations 8–12 (requires explicit approval)

1. Apply on a staging copy first; confirm the ledger shows 12 entries and `/api/health/ready` returns 200.
2. In production, take a backup, then apply via the project's existing migration command. Migrations 1–11 must remain unmodified.
3. Verify: `audit_events` exists (readiness checks this), widget settings load, knowledge search works.

## 8. Deploy

1. Install the Nginx files: `mczen.conf` as the site config, plus `mczen-api-proxy.conf` and `mczen-security-headers.conf` under `/etc/nginx/snippets/` (the exact paths the includes resolve). Confirm `nginx -t`.
2. Upload the build to `/var/www/mczen/releases/<id>/`.
3. Start the new backend build with the production environment, then check `curl -fsS http://127.0.0.1:3000/api/health/ready`.
4. Switch the symlink: `ln -sfn /var/www/mczen/releases/<id> /var/www/mczen/current`.
5. `nginx -t && systemctl reload nginx`.
6. Smoke test: load the app over HTTPS, `curl -I https://<domain>/widget.js`, open the widget from an allowlisted origin, send a text message, and (with sidecars) try voice. Only after this passes, consider enabling HSTS (§3).

## 9. Rollback

- **Frontend/widget:** repoint `current` to the previous release; reload Nginx.
- **Backend:** redeploy the previous build. Migration 12 only adds `audit_events`, so older code ignores it. Only revert the migration if required, and take a backup first.
- **Nginx:** restore the previous config file; `nginx -t`; reload.
- **Database:** restore from the pre-deploy backup only as a last resort.
- After rollback, confirm `/api/health/ready` and a text chat.
