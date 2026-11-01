# Authentication and Authorization

Audit basis: current Replit workspace source as checked on 2026-11-01. Clerk provider settings and production deployment behavior are not directly verifiable from repository files.

## Google sign-in

1. The frontend mounts Clerk's React provider and Clerk `SignIn`/`SignUp` components at `/sign-in` and `/sign-up`. The surrounding product UI directs users to Google; the server does not rely on that UI as its security boundary.
2. Clerk validates its own signed-in session through `clerkMiddleware` in the API. In production, the source includes an optional Clerk Frontend API proxy at `/api/__clerk`, enabled when `NODE_ENV=production` and `CLERK_SECRET_KEY` is present.
3. `GET /api/auth/session` reads the Clerk user ID. `syncClerkUser` retrieves the user from Clerk and requires an external account whose provider contains `google`, a primary email, and a verified email. It then upserts the local `study_users` row using the Clerk user ID as the primary key.
4. Study requests require a Clerk-authenticated user and a local user row containing a Google provider ID and email. The backend therefore checks more than frontend login state. The Clerk user ID—not a frontend-supplied owner ID—is used for ownership.

The repository verifies the linked Google provider at session synchronization time. The actual Google OAuth provider enablement, OAuth credentials, and environment-specific Clerk configuration are managed outside this code and were not verified. A provider being hidden or shown in the frontend is not proof of its global Clerk configuration.

## Guest identity

`POST /api/auth/guest` rejects a current Clerk session. It resumes the valid guest cookie already in the browser when one exists; otherwise it inserts a new `study_guest_sessions` row with a database-generated UUID. Each newly created guest row is a unique owner identity.

The `study_guest` cookie is HTTP-only, signed with `SESSION_SECRET`, `SameSite=Lax`, and `Secure` when `NODE_ENV=production`. Its browser max-age is 60 days. The server validates the signature, UUID shape, and corresponding database row, and refuses sessions already marked transferred. `last_active_at` is updated but is not used as an expiry check. There is no server-side guest-session expiry field or cleanup job in the inspected source.

The cookie lets the same browser resume its guest workspace after a refresh. It is not a portable account: clearing or losing the cookie can make guest notes inaccessible. The landing page communicates this limitation.

## Session validation, logout, and expiry

- Clerk owns Google-session issuance, validation, expiry, and revocation. The API consumes identity from Clerk middleware rather than creating a separate signed-in user token.
- Guest identity is a signed cookie identifier backed by a database row. Its effective browser lifetime is 60 days, but the server does not compare a stored expiration timestamp when authorizing the row.
- The frontend invokes Clerk's `signOut` method. No application-specific sign-out endpoint was found. The source does not explicitly clear the guest cookie on ordinary Clerk sign-out; successful guest transfer does clear it.
- A copied, valid guest cookie can act as a bearer credential until it expires or its guest row is transferred/deleted. HTTP-only and signing reduce exposure but do not protect a cookie already stolen from the browser.

## Guest-to-account transfer

`POST /api/auth/guest/transfer` requires `confirmed: true`, a Clerk user, a signed guest cookie, and successful Google-account validation. A database transaction locks the guest row, moves only notes owned by that guest (with no user owner) to the signed-in user, and records the transfer. Generated and library cards remain associated through their note relationships. The API returns a conflict if the guest was already transferred and clears the guest cookie only after commit.

## Backend authorization and data isolation

The study router applies `requireStudyOwner` before its route handlers. For users, it derives ownership from the Clerk identity and checks the local Google-linked user record. For guests, it validates the signed cookie and active guest row. The client cannot choose an owner ID in note-creation input.

Every study read or mutation is scoped directly to notes owned by the current identity or joins through those notes:

- Notes: list, create, delete, extraction source lookup.
- Generated cards: list, review, approve, reject, additional generation.
- Verified Library: search, guide list, guide detail, and summary.
- Card rows do not have a duplicate owner column; their note relationship is the authorization path.

`GET /api/healthz`, `GET /api/auth/session`, and `POST /api/auth/guest` are intentionally reachable without a study owner. Onboarding has its own user-or-guest owner resolution. The rest of the study routes are protected by the shared owner middleware.

## Confirmed limits and follow-up

1. **Guest expiry and retention:** browser cookie expiry is enforced by the client, but a database expiry is not enforced server-side and guest rows have no scheduled cleanup. Add an explicit server-side TTL and retention/cleanup policy; this requires a schema migration and a cleanup mechanism.
2. **Account lifecycle:** no Clerk deletion webhook or account-deletion endpoint was found. User-owned notes cascade if the local user row is deleted, but code in this repository does not synchronize Clerk account deletion to that row. Define the lifecycle and data-deletion behavior before adding an integration; schema/data changes may be needed.
3. **CSRF and origin policy:** addressed in the current code. Credentialed CORS allows same-origin requests and exact additional origins configured in `STUDY_TRUSTED_ORIGINS`; state-changing API requests require a matching Origin/Referer and `X-Study-CSRF: 1`. The shared browser API client supplies the header. See [Security](./SECURITY.md) for verification and remaining follow-up.
4. **Ownership constraint:** the database prevents a note from having both owner fields set, but allows both fields to be null. New API writes set one owner; null/null rows can exist (including legacy/unassigned rows) and are not returned by either owner-scoped query.
