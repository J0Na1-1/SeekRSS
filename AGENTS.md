# SeekRSS contributor notes

SeekRSS is a single-administrator Bun + Hono + SQLite service derived from NodeSeeker-docker (MIT). Retain upstream LICENSE and CSS/theme provenance.

## Commands

- Runtime: Bun 1.4.4. Install with `bun install --frozen-lockfile`.
- Tests: `bun test tests/` (strict vertical RED → GREEN → refactor).
- Types: `bun run typecheck`.
- Build: `bun run build`; start: `bun start`; dev: `bun run dev`.
- Security audit: `bun audit --production`.
- Docker: `docker-compose config --quiet` and `docker-compose up -d --build`.

## Boundaries

- `src/server.ts` wires `src/seekrss/` only. Legacy upstream auth, multi-user tables and routes have been removed, not exposed alongside the new API.
- `Store` is durable SQLite persistence; `AppService` validates ALL external writes. Web and Telegram must use the same service.
- One admin login; Telegram numeric user-ID allowlist and private-chat-only administration. No registration or tenant model.
- Four rule types: ordinary keyword/block have one term; combo/blockcombo are AND groups. Separate include rules OR; blocks win; no include rules means no push.
- Network is public HTTP(S) only, all DNS addresses checked and pinned, redirects revalidated, bounded decoded body. Cumulative DNS/transfer/body time is bounded separately from cancellable publisher-budget waiting; never reset the network allowance per hop.
- One source request in flight; all scheduled/manual/test requests share per-host durable budgets. Never rotate IPs or bust caches to evade limits.
- Ingest + outbox transaction; baseline first successful fetch unless explicit backfill. Pause archives without new push jobs; resume sends future entries.
- Publisher text is untrusted: DOM textContent, HTML escaping, safe URLs, bounded Telegram formatting.
- No token/password/setup key/session/database/backup in Git or logs. Bot Token is set only through protected Web settings, encrypted at rest.
- Default Docker listens on loopback, non-root, read-only root filesystem, no extra capabilities. Persist DB and matching encryption key.

## Delivery verification

Exercise API CRUD/auth/CSRF, shared Web/Bot state, local mock publisher schedule and rate limits, Telegram transport payloads, browser mobile/desktop forms, actual Docker startup and health. Never call a mock API send a real Telegram delivery, or a healthcheck a completed Telegram acceptance. Maintain the explicit external-validation gap in docs/VALIDATION.md. Do not run a high-frequency stress test against a real forum.
