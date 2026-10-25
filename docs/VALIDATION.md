# SeekRSS validation record

## Status

Development source snapshot, not a fully accepted production release. Real Telegram credentials have not been configured or exercised as part of this validation. No claim of real Telegram delivery, phone-notification latency, or permission for sustained one-second forum access is made.

## Latest source verification

The latest local checks before the initial public source push returned:

- **104 tests passed, 0 failed, across 35 files** (`bun test tests/`).
- Typecheck and production build passed. The build produces both the HTTP server and the operator-only password-reset CLI.
- `bun audit --production` reported no vulnerabilities in 13 production packages. This is a point-in-time dependency check, not a guarantee of security.
- The default Docker Compose configuration rendered successfully.
- Desktop and 390px mobile Web integration passed against an isolated real Hono API and SQLite fixture, with no external publisher or Telegram requests. CRUD, independent keywords and combined exclusions, pause/reload persistence, theme/drawer, logout and untrusted publisher-text handling were exercised.
- An additional isolated desktop/mobile browser check passed for password confirmation, removing the reset token from the address bar before API requests, setting a new password, logging in with that password, rejecting replay, and absence of page errors.

## Core and security coverage

- Unique administrator bootstrap, nonempty initialization key, Argon2id password hashing, persistent hashed sessions, expiry/logout, HttpOnly/SameSite cookies, CSRF and exact Origin checks, 64 KiB body bounds and a bounded login-attempt budget.
- Shared Web/Bot application service, authenticated CRUD, optimistic version checks, encrypted Telegram Token storage and redacted reads.
- First successful RSS baseline, atomic ingestion/outbox, durable deduplication, include/block precedence, pause behavior and URL-change baseline invalidation.
- Missing or empty RSS/Atom identifiers and links use stable fallbacks; namespace-stripped `encoded` content and valid empty feeds are handled.
- Bot mutations and update acknowledgements commit atomically. Multi-rule failures roll back; failed wizard prompts do not advance replayed input twice.
- Redirects consume the actual destination's persistent host budget and cooldown. Chains retain intermediate-host ownership, including repeated visits, while independent hosts remain schedulable.
- Publisher-budget waiting is bounded/cancellable and separate from cumulative DNS/transfer/body timeout. A real 16-second host-spacing test passes. Timeout/stop releases host leases even while DNS is unresolved; late results cannot start transport, ingest content or release a newer request's lock.
- Bot replies, explicit Telegram tests and outbox sends share a token-keyed persistent send gate and `retry_after` cooldown.

A focused independent review of DNS/cancellation ownership previously passed 16 tests plus 10 injected probes with no findings in that limited scope. It is not a full-product security audit.

## Password recovery source

The recovery feature is implemented in source and has been built in a Docker image, but **it has not been deployed to the public service and no real reset link has been issued** at this publication checkpoint. The operator requested the source push before continuing deployment.

- Only a server-side operator CLI can issue a random, expiring, single-use link; no public issuance endpoint exists.
- The database stores only a token hash and a credential fingerprint. Issuing a replacement invalidates the preceding token.
- Password reset revalidates the token after asynchronous hashing and atomically changes the password, removes all sessions and consumes the link, without modifying feeds/rules/targets/Telegram settings.
- A first independent review identified an in-flight old-password-login race and anonymous reset-limit poisoning. Both were reproduced with failing tests and fixed: session issuance now atomically rechecks the credential snapshot; reset quota applies only after token validation and is keyed to the valid token.
- Regression tests cover expiration, replacement, persistence across reopen, one concurrent winner, mismatched/short passwords, cross-origin rejection, old-session revocation, invalid-request quota isolation and the old-password login race. Any additional review result is separate from these tested claims.

## Container, backup and public HTTPS checks

Earlier operator-approved container acceptance passed non-root startup, read-only rootfs, capability dropping, loopback backend binding, a healthy service, original-volume restart persistence, and authenticated configuration reads.

- SQLite `VACUUM INTO` backups reopened with integrity `ok`; DB/key files were private. The backup was restored into an isolated network-disabled volume, not over the original data. Saved-session reads and another restart preserved configuration.
- File-key and environment-key restore tests verify the matching encryption key is required; an external `SECRET_KEY` is not included in database backups and must be retained separately. Real-container Token decryption was not exercised because no Token was configured.
- Public access was separately enabled through a non-root Caddy HTTPS reverse proxy. Ordinary certificate-verifying clients and a browser opened the login page. The HTTP entry redirects to HTTPS; the backend remains loopback/private.
- Exact `PUBLIC_ORIGIN` plus Secure cookies supports the HTTPS-to-HTTP proxy without trusting arbitrary forwarded headers. A same-origin non-mutating preview succeeded; foreign Origin, invalid CSRF and unauthenticated settings were rejected.
- Persistent certificate storage and automatic renewal were configured; a future renewal has not yet been observed. Host addresses, private storage paths, session files and operator deployment configuration are intentionally excluded from this public source record.

## Publication boundary

Public history starts from a parentless current-source snapshot. Inherited development history is deliberately excluded because it may contain credentials. Runtime data, databases, backups, encryption/setup keys, sessions, real reset links and site-specific deployment configuration are not source artifacts.

Local checks do not establish that GitHub Actions has passed. Remote commit identity and CI results must be read from GitHub after the push.

## External acceptance still required

- A new dedicated Bot Token configured through protected Web settings, administrator ID and real destination permissions.
- Live webhook-conflict detection and command registration/read-back in the intended scope.
- A real Telegram test message with returned message ID and user receipt confirmation.
- Publisher permission for the actual sustained request frequency; no real forum has been stress-tested.
- RSS-visible-to-Telegram-accepted latency measured separately from phone-notification arrival. Three seconds remains a target, not a guaranteed SLA.

## Operational limitations

- Intermediate unpublished database drafts are not mutually upgrade-compatible. Use a new data volume for the first release; do not reuse upstream NodeSeeker data volumes.
- Host budgets key by hostname. Aliases/subdomains sharing a publisher quota need a combined conservative policy.
- A crash after Telegram accepts a message but before the message ID is committed can duplicate delivery; Bot API offers no caller-provided send idempotency key.
- Archive retention and long-term database-growth policies remain operational work.
- No full-article scraping, AI classification, multi-user registration, IP rotation or access-control bypass is implemented.
