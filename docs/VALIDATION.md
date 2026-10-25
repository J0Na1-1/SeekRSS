# SeekRSS validation record

## Status

Development source, not a fully externally accepted production release. Administrator authentication is managed by trusted local configuration, with **no Web setup or password-recovery page, API or operator reset-link CLI**. The local-configuration authentication version was previously published and separately deployed. The current five-part message-format changes remain local and unpublished; this checkpoint does not update either running instance.

No real Telegram credentials, production database or production session was used in this validation. No claim of real Telegram delivery, phone-notification latency, or permission for sustained one-second forum access is made.

## Latest local verification

**Known issue accepted for release by the operator.** The checks below passed, but independent review identified a remaining summary-limit defect: secondary HTML-budget truncation can append an ellipsis to an already complete 300-code-point brief when the ellipsis changes keyword highlighting, producing 301 visible code points within a 4,091-character HTML message. This was independently reproduced locally with valid rule names and remains unfixed by explicit operator decision. The format review did not pass; acceptance of this one-code-point deviation is not a claim of independent approval. The operator authorized publication and the IPv6 instance update; this document records local verification, not proof of remote CI or deployment.

- **155 tests passed, 0 failed, across 39 files**, with 2,756 assertions (`bun --no-env-file test tests/`). Coverage includes the five-part formatter, fixed UTC+8 dates, escaped metadata, message-length boundaries, ASCII/emoji summary limits (including the truncation ellipsis), the standard/300-character defaults in actual fixture outbox payloads, and the existing authentication, session, data-preservation and clean-build regressions.
- **Two browser integration tests passed** against isolated fixture data. Desktop and 390px mobile form submissions exercised the real authenticated settings API for standard/300 and compact/0, including time, link-preview, author-disabled and revision fields. The test reads the persisted settings back after each submission and reloads the form.
- Typecheck and production server build passed. Production dependency audit found no vulnerabilities in 13 checked packages; this is a point-in-time dependency check, not a security guarantee.
- The Docker Compose template rendered successfully. The checked-in `-pwd=xxx` value is intentionally invalid and must be replaced in a private local copy.
- A real source server read an isolated, mode-0600 `.env`, accepted the exact configured password including literal `$` and `=`, returned an HttpOnly session, and rejected access to `.env`, removed recovery assets and setup API. Missing or malformed credentials exited before creating a database.
- An isolated Docker image and Compose project ran as the non-root `bun` user with a read-only root filesystem. Exact `-pwd=` values containing dollar signs, equals and spaces successfully authenticated. A restart with unchanged configuration preserved the session; recreation with a new password rejected the old password and session, accepted the new password and preserved rules. The database contained an Argon2id hash and no legacy reset-token table. Passwords were absent from captured application logs. The container became healthy and was removed with its fixture volume after validation.
- Desktop and 390px mobile browser integration passed against an isolated real Hono API and SQLite fixture: CRUD, independent keywords and combined exclusions, pause/reload persistence, theme/drawer, logout, untrusted publisher-text handling and absence of page errors. No external publisher or Telegram requests were used.

## Local administrator configuration

- Docker: plaintext password in a private local Compose command argument `-pwd=...`.
- Source: plaintext password in local `.env` `ADMIN_PASSWORD`; optional `ADMIN_USERNAME`.
- Passwords retain their exact value (12–128 characters); a command argument takes precedence over the environment. Missing, ambiguous or invalid configuration fails closed without printing the input.
- New databases default to username `admin`. Existing names are preserved unless an explicit new name is configured.
- Startup synchronizes the Argon2id hash before binding the listener or starting workers. Changed credentials and session revocation commit atomically without changing application configuration. Unchanged credentials do not rotate the hash or revoke sessions.
- Legacy reset-token tables are removed even when credentials are unchanged. No new setup key or recovery link is generated.
- An in-flight login atomically rechecks the credential snapshot after asynchronous verification and cannot issue an old-password session after a configuration change.
- `.env` and `docker-compose.local.yml` are excluded from Git and the Docker build context. Host/Docker access, process arguments, Compose rendering and operator backups can expose the intentional local plaintext; this design does not conceal passwords from the server operator.

## Core and security coverage

- Persistent hashed sessions, expiry/logout, HttpOnly/SameSite cookies, CSRF and exact Origin checks, 64 KiB body bounds and a bounded login-attempt budget.
- Shared Web/Bot service, authenticated CRUD, optimistic version checks, encrypted Telegram Token storage and redacted reads.
- First successful RSS baseline, atomic ingestion/outbox, durable deduplication, include/block precedence, pause behavior and URL-change baseline invalidation.
- Missing or empty RSS/Atom identifiers and links use stable fallbacks; namespace-stripped `encoded` content and valid empty feeds are handled.
- Bot mutations and update acknowledgements commit atomically. Multi-rule failures roll back; failed wizard prompts do not advance replayed input twice.
- Redirects consume the destination's persistent host budget and cooldown. Chains retain intermediate-host ownership, including repeated visits, while independent hosts remain schedulable.
- Publisher-budget waiting is bounded/cancellable and separate from cumulative DNS/transfer/body timeout. A real 16-second host-spacing test passes. Timeout/stop releases leases even while DNS is unresolved; late results cannot start transport, ingest content or release a newer request's lock.
- Bot replies, explicit Telegram tests and outbox sends share a token-keyed persistent send gate and `retry_after` cooldown.

A focused independent review of the local-password authentication diff passed with no blocking security or logic findings. The reviewer ran 16 focused tests across 12 files (129 assertions), typecheck, ignore/Compose checks and isolated probes for rollback, application-table preservation, reopen persistence and fail-closed startup. Its non-blocking feedback identified outdated Bot guidance; that guidance now distinguishes protected Web Bot Token settings from local Compose / `.env` passwords, with a regression. The isolated rollback and all-application-table preservation probes were also retained as automated regression tests. This is a scoped review, not a full-product audit.

A focused independent review of DNS/cancellation ownership previously passed 16 tests plus 10 injected probes with no findings in that limited scope. It is not a full-product security audit and does not cover the current authentication changes.

## Earlier container, backup and public HTTPS checks

These are earlier checkpoints, not deployment of the current source changes:

- Operator-approved container acceptance passed non-root startup, read-only rootfs, dropped capabilities, loopback backend binding, health, original-volume restart persistence and authenticated configuration reads.
- SQLite `VACUUM INTO` backups reopened with integrity `ok`; private DB/key files were restored into a separate network-disabled volume, not over the original data. Saved-session reads and another restart preserved configuration.
- File-key and environment-key tests require the matching Token encryption key. External `SECRET_KEY` values are not included in database backups and must be retained separately. Real-container Token decryption was not exercised because no Token was configured.
- Public HTTPS access was separately enabled through a non-root Caddy proxy. Certificate-verifying clients and a browser opened the login page; HTTP redirects to HTTPS and the backend remains loopback/private.
- Exact `PUBLIC_ORIGIN` and Secure cookies support the HTTPS-to-HTTP proxy without trusting arbitrary forwarded headers. Foreign Origin, invalid CSRF and unauthenticated settings requests were rejected.
- Persistent certificate storage and automatic renewal were configured; a future renewal has not yet been observed. Host addresses, private paths, sessions and operator deployment configuration are excluded from this record.

## Publication boundary

Public Git history starts from a parentless source snapshot; inherited development history is excluded because it may contain credentials. Runtime databases, backups, encryption keys, sessions and private operator configuration are not source artifacts. The local-configuration authentication version was published before this checkpoint; the current message-format changes have not been committed, pushed or deployed. Local checks do not establish remote CI success for a new commit.

## External acceptance still required

- A new dedicated Bot Token configured through protected Web settings, administrator ID and real destination permissions.
- Live webhook-conflict detection and command registration/read-back in the intended scope.
- A real Telegram test message with returned message ID and user receipt confirmation.
- Publisher permission for the actual sustained request frequency; no real forum has been stress-tested.
- RSS-visible-to-Telegram-accepted latency, separately from phone notification arrival. Three seconds remains a target, not a guaranteed SLA.

## Operational limitations

- Intermediate unpublished database drafts are not mutually upgrade-compatible; do not reuse upstream NodeSeeker data volumes.
- Host budgets key by hostname. Aliases/subdomains sharing a publisher quota require a combined conservative policy.
- A crash after Telegram accepts a message but before its ID is committed can duplicate delivery; Bot API provides no caller-supplied send idempotency key.
- Archive retention and long-term database-growth policies remain operational work.
- No full-article scraping, AI classification, multi-user registration, IP rotation or access-control bypass is implemented.
