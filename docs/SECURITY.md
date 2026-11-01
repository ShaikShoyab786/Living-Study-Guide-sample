# Security Review and Improvement Plan

Audit basis: current Replit workspace source on 2026-11-01. Source of truth was the checked-out workspace, not a ZIP or a separately inspected GitHub copy.

## Scope and limits

- Git branch `main` was clean before this documentation change at `013a176`, matching `origin/main`. No application changes were uncommitted in this checkout. The latest auth and guest-session implementation visible here is committed in that revision.
- Reviewed API routing, auth and owner middleware, PDF handling, AI generation, database schema, frontend auth entry points, workspace environment-variable references, package lockfile, and `.gitignore`.
- Ran the dependency audit, SAST, and HoundDog scans. The dependency audit reported 0 critical, 7 high, 8 moderate, and 2 low findings. SAST returned 0 findings; HoundDog returned 0 findings.
- No live database contents, Replit secret values, Clerk provider settings, or production deployment settings were accessed. No migration, UI/code fix, commit, or push was performed. No exploit payloads were run.
- Scanner output is a dependency/advisory signal, not proof that each affected code path is reachable in this deployment. Reachability notes below are based on this source review.

## Implemented controls verified in source

- Clerk middleware validates signed-in identity server-side. Study endpoints derive ownership from that identity or a signed guest cookie, not from a client-supplied owner field.
- `requireStudyOwner` is applied to the study router. Reads, writes, review operations, and library searches scope through the owner's note rows.
- Guest IDs are database-generated UUIDs in signed, HTTP-only cookies. Cookies are `SameSite=Lax`, `Secure` in production, and have a 60-day max-age.
- Guest transfer requires an explicit confirmation and runs in a transaction with a lock on the guest row. Notes are moved only from that guest identity.
- User input and path/query parameters are validated with generated Zod schemas and UUID checks. Database access uses Drizzle query builders and parameterized expressions; no raw user-built SQL was found.
- PDF upload uses in-memory Multer storage, limits to one 15 MiB file and one form field, checks the filename extension and a PDF signature, and uses `pdfjs-dist`. Extraction is capped at 250 pages, and the upload buffer is zeroed in `finally` blocks.
- AI output is parsed as JSON; cards with empty required fields, non-exact source excerpts, or approximate duplicate questions are filtered. Users must review generated cards before they enter the verified library.
- Pino redacts authorization, cookie, and set-cookie headers. Request log serialization omits query strings.
- PostgreSQL foreign keys cascade from notes to generated cards and from generated cards to library cards. A unique index prevents multiple library rows for one generated card.

## Confirmed vulnerabilities and missing controls

### High priority

1. **Reachable high-severity body-parser advisory (confirmed exposure).** The lockfile resolves `body-parser` 2.3.0; the dependency audit reports GHSA-27r3-jxmh-p828, fixed in 2.4.0. The API runs `express.json()` before routing and does not disable compressed request bodies. This puts the affected parser on the unauthenticated request path, including before the study-owner guard. The advisory describes a process-availability failure for certain malformed compressed bodies. No proof-of-concept was run.
2. **CORS reflects arbitrary origins with credentials (confirmed configuration; CSRF impact depends on browser/site context).** `cors({ credentials: true, origin: true })` reflects the incoming origin. No allow-list or origin check is present. There is no CSRF token or explicit Origin/Referer validation for cookie-authenticated mutations. `SameSite=Lax` helps against cross-site requests, but is not a substitute for a narrow origin policy, especially for same-site sibling origins. Affected writes include guest onboarding/transfer and study note/card operations.
3. **No maximum note-text or extracted-text size at the application schema (confirmed missing validation).** `CreateNoteBody.rawText` has a minimum length but no maximum. PDF input has file and page limits, but no cap on extracted characters or AI input tokens. The JSON parser's default body limit is the only observed bound for JSON note input; the PDF route can produce text outside that JSON-parser limit. This creates avoidable memory, latency, and AI-cost exposure.

### Dependency scanner advisories

The dependency scan found these high-severity lockfile advisories. Except for the body-parser route described above, reachability was not confirmed here:

- `undici` 7.29.1: four high-severity advisories concerning TLS option handling, redirect/cache behavior, TLS renegotiation, and excessive content encodings. Reported fix: 7.30.1. The affected caching/interceptor/TLS configurations were not found directly in application source; determine whether the installed SDK/runtime path exercises them before assigning application impact.
- `zod` 3.25.76 and 4.6.5: the same reported high-severity uncontrolled validation-resource-consumption advisory appears against both lockfile versions. Reported fixed version: 4.6.6. The app uses Zod, but the scanner finding alone does not establish an attacker-controlled unbounded array reaching the affected validator. Trace each call path and update within compatible dependency constraints.

The scan also reported 8 moderate findings: `fast-uri` 3.1.8 (2), `postcss-selector-parser` 6.0.10 (1), `qs` 6.16.0 (1), and `undici` 7.29.1 (4). It reported 2 low `fast-uri` 3.1.8 findings. All were reported in `pnpm-lock.yaml`; fixes were available per scanner metadata. SAST and HoundDog did not report findings.

### Other missing controls and risks

- **PDF extraction is not rate limited.** The two AI-generation routes are limited per owner to 10 requests/hour for guests and 40/hour for signed-in users. The limiter is in-process memory, so limits reset on restart and are not shared across replicas. `/notes/pdf-text` is not behind that limiter. Upload size/page caps help but do not bound concurrent PDF parsing or parser time.
- **Guest expiry is not enforced by the server.** The guest cookie expires in the browser after 60 days, but the database stores no expiry and middleware only checks that the row is active/not transferred. There is no cleanup job or retention policy.
- **`.env` files are not excluded by the repository `.gitignore`.** No `.env` or `.env.example` file was found in the workspace or Git index during the audit. The repo ignores `.local` and build files but has no `.env*` rule. Replit Secrets are referenced by environment-variable name in code; actual secret values were not accessed.
- **No checked-in test suite or migration history was found.** No automated test files or SQL migration files were found in the inspected application/library source. The DB package exposes Drizzle `push` scripts. This audit did not run a migration or inspect live schema drift.
- **No explicit API security headers or centralized JSON error middleware were found in the Express app.** Express 5 provides its default error handling; deployment-edge headers were not checked. Add consistent production error handling and security headers as hardening.
- **Owner and foreign-key columns lack explicit query indexes in the Drizzle schema.** Current table indexes are the primary keys, a partial unique Google-provider index, and a unique library-card index. Owner-scoped queries and joins may slow as data grows.
- **Guest and account data retention is undefined in code.** Notes contain full raw source text and are sent to the configured AI integration for generation. Provider-side data retention is not established by repository code.

## Prioritized security implementation plan

| Priority | Finding / affected code | Recommended fix | Migration / feature impact | Required verification |
| --- | --- | --- | --- | --- |
| P0 | `body-parser` 2.3.0 behind `express.json()`; unauthenticated parser path | Upgrade the compatible Express/body-parser dependency chain to a fixed release (scanner says 2.4.0), or explicitly disable request inflation if compressed bodies are not required. Do not bypass package controls. | Usually no database migration; verify Express compatibility and request behavior. | Dependency audit; regression tests for normal JSON and compressed requests; confirm API process remains healthy on parser errors. |
| P1 | Reflected credentialed CORS and no CSRF/Origin validation (`app.ts`, cookie-authenticated POST/PATCH/DELETE routes) | Allow only the actual app origins; reject unexpected origins on state-changing cookie-authenticated requests and add a CSRF strategy appropriate for Clerk and guest cookies. | No DB migration. May affect custom domains and development previews; preserve an explicit development-origin workflow. | Cross-origin browser tests for allowed and rejected origins; confirm guest and Clerk flows still work. |
| P1 | Unbounded note/PDF text and AI input (`CreateNoteBody`, PDF endpoints, generation functions) | Set documented maximum text characters, PDF extracted characters, per-request AI token budget, and output field/card limits; reject before storing or calling AI. Add per-owner and global spend/abuse controls. | No schema migration unless limits are stored/configurable. Large existing notes may need a clear error rather than automatic truncation. | Boundary tests for JSON, PDF, AI input, and generated response size; verify no partial note/card writes. |
| P1 | Unrate-limited PDF extraction and in-memory owner rate limits (`study.ts`) | Rate-limit both PDF endpoints and use a shared limiter store or platform edge controls; bound parse concurrency/time and monitor rejected requests. | No database migration; shared rate-limit storage may require infrastructure/configuration. | Multiple-instance/restart tests, guest/user quota tests, oversized and expensive PDF tests. |
| P1 | Guest records have no server-side expiry/cleanup (`study_guest_sessions`) | Add an explicit expiry or inactivity policy enforced in owner middleware, plus scheduled cleanup and a retention policy. Keep the cookie and server TTL consistent. | Requires a schema migration and data-retention decision; existing guest rows need a backfill/grace policy to avoid unexpectedly losing access. | Cookie expiration, stale-cookie rejection, cleanup safety, and transfer tests. |
| P1 | `.env` ignore gap (`.gitignore`) | Ignore `.env` and local variants while explicitly allowing `.env.example`; keep examples placeholder-only. Review Git history before any secret cleanup if a secret is ever committed. | No runtime migration. Avoid deleting or rewriting existing user files without review. | `git check-ignore` tests and secret scanning; ensure `.env.example` remains trackable. |
| P1 | Dependency scan: undici/Zod high findings; moderate/low findings | Trace dependency paths and affected options; upgrade direct parents or compatible packages to scanner-fixed versions, then re-run audit. Keep scope limited to packages actually pulled into the shipped service. | No database migration. Zod major-version changes may require codegen/schema compatibility checks. | Dependency audit, build/typecheck, focused tests for callers and lockfile changes. |
| P2 | No app-level account-deletion lifecycle | Define deletion/retention requirements and synchronize Clerk deletion with local user/note cleanup through a verified webhook or managed workflow. | May require webhook state/identity or deletion-audit schema and migrations. Existing guest/unassigned rows need separate treatment. | Idempotent deletion tests, signature verification, cascade/retention tests. |
| P2 | No explicit query indexes on ownership/FK columns | Add measured indexes for owner-user, guest-session, note/card joins, and creation ordering where query plans justify them. | Requires a database migration; assess write overhead and existing table size. | Explain/query-plan checks on realistic data and migration rollback/restore plan. |
| P2 | Missing centralized JSON error handling and explicit security headers | Add a final sanitized JSON error handler, production security headers, and request correlation without logging note text or secrets. Confirm platform-added headers before duplicating them. | No database migration. Ensure Clerk proxy response headers remain intact. | Error contract tests, header checks, log-redaction tests, and production-preview verification. |

## Recommended order

1. Address the reachable body-parser advisory and verify request parsing.
2. Restrict CORS and add a cookie-compatible CSRF/Origin policy.
3. Bound JSON/PDF text, parser concurrency, AI tokens, and multi-instance rate limits.
4. Decide and implement guest expiry, retention, and account-deletion behavior.
5. Triage and update the remaining scanner findings, then add security-focused route and migration tests.
6. Add measured indexes and centralized error/header hardening.

No fixes or migrations were applied during this audit.
