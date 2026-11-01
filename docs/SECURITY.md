# Security Review and Improvement Plan

Audit basis: current Replit workspace source on 2026-11-01. Source of truth was the checked-out workspace, not a ZIP or a separately inspected GitHub copy.

## Scope and limits

- The three remediations below are present in the current working tree. No migration was run, and no pre-existing user data was changed. Temporary guest and note records created for smoke tests were removed afterward.
- Reviewed API routing, auth and owner middleware, PDF handling, AI generation, database schema, frontend auth entry points, workspace environment-variable references, package lockfile, and `.gitignore`.
- The earlier full-workspace audit reported 0 critical, 7 high, 8 moderate, and 2 low dependency findings; SAST and HoundDog each reported 0 findings. After remediation, `pnpm audit --prod` no longer reports body-parser, but still reports two high Zod findings and one moderate `qs` finding. SAST and HoundDog were not rerun.
- No production database, Replit secret values, Clerk provider settings, or production deployment settings were accessed. No exploit payloads were run.
- Scanner output is a dependency/advisory signal, not proof that each affected code path is reachable in this deployment. Reachability notes below are based on this source review.

## Implemented controls verified in source

- Clerk middleware validates signed-in identity server-side. Study endpoints derive ownership from that identity or a signed guest cookie, not from a client-supplied owner field.
- `requireStudyOwner` is applied to the study router. Reads, writes, review operations, and library searches scope through the owner's note rows.
- Guest IDs are database-generated UUIDs in signed, HTTP-only cookies. Cookies are `SameSite=Lax`, `Secure` in production, and have a 60-day max-age.
- Guest transfer requires an explicit confirmation and runs in a transaction with a lock on the guest row. Notes are moved only from that guest identity.
- User input and path/query parameters are validated with generated Zod schemas and UUID checks. Database access uses Drizzle query builders and parameterized expressions; no raw user-built SQL was found.
- JSON and URL-encoded request bodies have explicit 1 MiB and 64 KiB parser limits. Note text and extracted PDF text are capped at 100,000 characters; PDF upload remains limited to 15 MiB and 250 pages.
- PDF upload uses in-memory Multer storage, accepts one file and one form field, checks the filename extension and a PDF signature, and uses `pdfjs-dist`. The upload buffer is zeroed in `finally` blocks.
- AI output is parsed as JSON; cards with empty required fields, non-exact source excerpts, or approximate duplicate questions are filtered. Users must review generated cards before they enter the verified library.
- Credentialed CORS permits same-origin requests and origins explicitly listed in `STUDY_TRUSTED_ORIGINS`. API mutations require a matching Origin or Referer and the `X-Study-CSRF: 1` header; the generated browser client adds that header.
- Additional-card generation caps its serialized AI context at 120,000 characters and limits the existing-card context to 100 cards. Oversized legacy notes are rejected for generation rather than truncated or deleted.
- Pino redacts authorization, cookie, and set-cookie headers. Request log serialization omits query strings.
- PostgreSQL foreign keys cascade from notes to generated cards and from generated cards to library cards. A unique index prevents multiple library rows for one generated card.

## Three audited findings and remediation status

### High priority

1. **body-parser GHSA-27r3-jxmh-p828 — addressed in the lockfile.** The audited Express 5.3.0 release is still the latest Express 5 release and depends on `body-parser@^2.3.0`; its compatible range now resolves to patched `body-parser` 2.4.0 through a targeted workspace override. The parser remains bounded by explicit request-size limits.
2. **Reflected credentialed CORS and missing CSRF/Origin validation — addressed in the API.** CORS no longer reflects arbitrary origins. Mutations require the request origin to match the effective app origin (including the forwarded Replit host) or an exact configured `STUDY_TRUSTED_ORIGINS` entry, plus the required custom header. No extra origin is enabled by default.
3. **Unbounded note/PDF/AI input — addressed with application caps.** Notes and extracted PDF text are limited to 100,000 characters; JSON and URL-encoded bodies are limited to 1 MiB and 64 KiB. Additional-card generation rejects more than 100 existing cards or a serialized context over 120,000 characters. Older oversized notes remain intact and readable but receive a clear 413 response when generation is requested.

### Dependency scanner advisories

The post-remediation production audit still reports these out-of-scope dependency advisories:

- `zod` 3.25.76 and 4.6.5: the same reported high-severity uncontrolled validation-resource-consumption advisory appears against both lockfile versions. Reported fixed version: 4.6.6. The app uses Zod, but the scanner finding alone does not establish an attacker-controlled unbounded array reaching the affected validator. Trace each call path and update within compatible dependency constraints.
- `qs` 6.16.0: one moderate advisory, reported fixed in 6.16.1.

The earlier full-workspace scan also reported `undici`, `fast-uri`, and `postcss-selector-parser` advisories. Those full-workspace findings were not re-audited after this focused dependency change.

### Other missing controls and risks

- **PDF extraction is not rate limited.** The two AI-generation routes are limited per owner to 10 requests/hour for guests and 40/hour for signed-in users. The limiter is in-process memory, so limits reset on restart and are not shared across replicas. `/notes/pdf-text` is not behind that limiter. Upload size/page caps help but do not bound concurrent PDF parsing or parser time.
- **Guest expiry is not enforced by the server.** The guest cookie expires in the browser after 60 days, but the database stores no expiry and middleware only checks that the row is active/not transferred. There is no cleanup job or retention policy.
- **`.env` files are not excluded by the repository `.gitignore`.** No `.env` or `.env.example` file was found in the workspace or Git index during the audit. The repo ignores `.local` and build files but has no `.env*` rule. Replit Secrets are referenced by environment-variable name in code; actual secret values were not accessed.
- **Focused security tests now cover origin and CSRF behavior.** Broader authenticated route tests and SQL migration files were not found in the inspected application/library source. The DB package exposes Drizzle `push` scripts. No migration was run or live schema drift inspected.
- **General API error handling and security headers remain follow-up work.** The new request-body-size handler returns JSON for oversized parser requests, but there is not yet a general sanitized JSON error handler. Deployment-edge headers were not checked.
- **Owner and foreign-key columns lack explicit query indexes in the Drizzle schema.** Current table indexes are the primary keys, a partial unique Google-provider index, and a unique library-card index. Owner-scoped queries and joins may slow as data grows.
- **Guest and account data retention is undefined in code.** Notes contain full raw source text and are sent to the configured AI integration for generation. Provider-side data retention is not established by repository code.

## Prioritized security implementation plan

| Priority | Finding / affected code | Recommended fix | Migration / feature impact | Required verification |
| --- | --- | --- | --- | --- |
| Resolved | `body-parser` 2.3.0 behind `express.json()` | Workspace override resolves the compatible Express dependency to patched 2.4.0; JSON parsing is explicitly bounded. | No migration. | Confirm the lockfile resolves 2.4.0; verify normal JSON and oversized-body handling. |
| Resolved | Reflected credentialed CORS and missing CSRF/Origin validation | Exact same-origin checks, optional exact-origin allow-list, and a required request header on mutations. | No migration. Cross-origin frontends must be listed in `STUDY_TRUSTED_ORIGINS`. | Origin/CSRF tests and same-origin app smoke test. |
| Partially resolved | Unbounded note/PDF/AI input | Note and extracted-text caps, parser limits, and additional-generation context bounds are in place. Output card/field limits and global AI spend controls remain separate follow-up work. | No migration. Existing long notes are not altered. | Boundary tests for JSON, PDF, AI context, and no partial writes. |
| P1 | Unrate-limited PDF extraction and in-memory owner rate limits (`study.ts`) | Rate-limit both PDF endpoints and use a shared limiter store or platform edge controls; bound parse concurrency/time and monitor rejected requests. | No database migration; shared rate-limit storage may require infrastructure/configuration. | Multiple-instance/restart tests, guest/user quota tests, oversized and expensive PDF tests. |
| P1 | Guest records have no server-side expiry/cleanup (`study_guest_sessions`) | Add an explicit expiry or inactivity policy enforced in owner middleware, plus scheduled cleanup and a retention policy. Keep the cookie and server TTL consistent. | Requires a schema migration and data-retention decision; existing guest rows need a backfill/grace policy to avoid unexpectedly losing access. | Cookie expiration, stale-cookie rejection, cleanup safety, and transfer tests. |
| P1 | `.env` ignore gap (`.gitignore`) | Ignore `.env` and local variants while explicitly allowing `.env.example`; keep examples placeholder-only. Review Git history before any secret cleanup if a secret is ever committed. | No runtime migration. Avoid deleting or rewriting existing user files without review. | `git check-ignore` tests and secret scanning; ensure `.env.example` remains trackable. |
| P1 | Dependency scan: undici/Zod high findings; moderate/low findings | Trace dependency paths and affected options; upgrade direct parents or compatible packages to scanner-fixed versions, then re-run audit. Keep scope limited to packages actually pulled into the shipped service. | No database migration. Zod major-version changes may require codegen/schema compatibility checks. | Dependency audit, build/typecheck, focused tests for callers and lockfile changes. |
| P2 | No app-level account-deletion lifecycle | Define deletion/retention requirements and synchronize Clerk deletion with local user/note cleanup through a verified webhook or managed workflow. | May require webhook state/identity or deletion-audit schema and migrations. Existing guest/unassigned rows need separate treatment. | Idempotent deletion tests, signature verification, cascade/retention tests. |
| P2 | No explicit query indexes on ownership/FK columns | Add measured indexes for owner-user, guest-session, note/card joins, and creation ordering where query plans justify them. | Requires a database migration; assess write overhead and existing table size. | Explain/query-plan checks on realistic data and migration rollback/restore plan. |
| P2 | Missing centralized JSON error handling and explicit security headers | Add a final sanitized JSON error handler, production security headers, and request correlation without logging note text or secrets. Confirm platform-added headers before duplicating them. | No database migration. Ensure Clerk proxy response headers remain intact. | Error contract tests, header checks, log-redaction tests, and production-preview verification. |

## Recommended order

1. Re-run the dependency audit to confirm the body-parser finding is cleared; triage the remaining package advisories.
2. Exercise signed-in and guest browser flows with the new origin/CSRF checks.
3. Consider output card/field limits, PDF parse concurrency, provider timeouts, and shared/global AI abuse controls.
4. Decide and implement guest expiry, retention, and account-deletion behavior.
5. Add broader authenticated route tests and migration coverage.
6. Add measured indexes and general error/header hardening.

## Verification performed

- `pnpm run typecheck` passed; all 7 origin/CSRF tests passed.
- Same-origin preflight and health checks passed. Mutations without the marker and requests from an untrusted origin returned 403; oversized JSON returned 413.
- Guest session and note creation/list/delete worked. A short note generated 4 AI cards using the existing model. Valid PDF text extracted; a PDF yielding over 100,000 characters returned 413. The temporary guest and note records were removed.
- Signed-in Google login and positive guest-to-account transfer were not exercised because the preview browser has no authenticated Google session. A transfer request without a signed-in user returned 401.

No migrations were run. Changes are confined to code, dependency resolution, tests, and documentation.
