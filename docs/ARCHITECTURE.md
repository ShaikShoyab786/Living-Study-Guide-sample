# Study with Miky — Architecture

Audit basis: the current Replit workspace source as checked on 2026-11-01. This is a source-code review; no live database contents or production configuration were queried.

## System overview

```text
Browser
  React + Vite + Wouter + TanStack Query
       │ generated fetch client; same-origin /api requests with cookies
       ▼
Express 5 API (artifacts/api-server)
  Clerk middleware ── signed guest-cookie owner resolution
  OpenAPI/Zod validation ── Drizzle queries and mutations
       ├── PostgreSQL (lib/db)
       ├── Replit OpenAI-compatible AI integration
       └── pdfjs-dist text extraction
```

The frontend is a single-page React application. `lib/api-spec/openapi.yaml` is the API contract; Orval-generated Zod schemas and React Query hooks live in the workspace libraries. The frontend uses those hooks for same-origin `/api` calls. Study data is not stored in the browser as its source of truth.

The API is an Express 5 service. It mounts health, auth, and study routers under `/api`. `requireStudyOwner` is applied to the entire study router. The API uses Drizzle ORM with PostgreSQL (`node-postgres`); the schema is defined in `lib/db/src/schema`.

## Authentication and request ownership

Clerk handles Google sign-in and validates signed-in sessions through `clerkMiddleware`. In production, `/api/__clerk` can proxy Clerk Frontend API requests using the server-side Clerk secret. Google provider availability and OAuth settings are configured outside this repository and were not verified in this audit.

Guest sessions are separate database identities. The server creates a guest-session UUID and issues it in an HTTP-only, signed cookie. Study routes resolve either the verified Clerk user ID or the active guest-session row into a `StudyOwner`. That owner is applied to note queries; generated and library cards inherit access through joins to their source note.

When a signed-in user confirms a guest-data transfer, the API locks the guest row and moves that guest session's unowned notes to the Clerk user inside a database transaction. Cards remain attached to their notes. The guest cookie is cleared after a successful transfer.

See [Authentication and Authorization](./AUTHENTICATION-AND-AUTHORIZATION.md) for the complete flow and limitations.

## Note and PDF workflow

For `.txt`, `.md`, and `.markdown`, the browser reads the selected text file and places its text in the note editor. For PDFs, the browser posts the file to `POST /api/notes/pdf-text`; the server accepts one file up to 15 MiB in memory, checks for a PDF signature, and extracts selectable text with `pdfjs-dist`. PDF extraction is capped at 250 pages. Scanned/image-only PDFs return an error because OCR is not implemented.

In the normal UI flow, the user reviews the extracted/pasted text, creates a note with `POST /api/notes`, and starts generation with `POST /api/notes/:noteId/extract`. The API also exposes `POST /api/notes/pdf-study-pack`, which extracts a PDF, generates cards, and stores the note and cards together in a transaction; the current frontend's normal flow does not call this combined endpoint.

## AI generation and review

The API sends note text to the OpenAI-compatible Replit AI integration with model identifier `gpt-5.6-luna`. The model is asked for JSON cards containing a source excerpt, concept, question, and answer. The server parses the response, rejects cards whose excerpt is not an exact substring of the source, filters blank fields, and removes approximate duplicate questions.

Each accepted generated card starts as `pending`. In Review Hub, a user can approve, edit and approve, or discard it. Approving stores a copy in the verified-library table and changes the generated card status to `approved`; discarding marks it `rejected`. The UI presents generation mode (`ai` or `demo`). Standard extraction falls back to sentence-based demo cards if the AI call or response validation fails. Additional-question generation returns a service error if its AI path fails.

See [AI Question Generation](./AI-QUESTION-GENERATION.md) for prompts, validation, fallback, and grounding details.

## API surface

| Route | Purpose | Access |
| --- | --- | --- |
| `GET /api/healthz` | Liveness response | Public |
| `GET /api/auth/session` | Resolve anonymous, guest, or signed-in state | Public; returns current state |
| `POST /api/auth/guest` | Create or resume a guest identity | Public; rate limited |
| `PATCH /api/auth/onboarding` | Save tour progress | Requires current user or guest identity |
| `POST /api/auth/guest/transfer` | Move confirmed guest notes into a Google-linked account | Requires both identities |
| `GET/POST /api/notes`, `DELETE /api/notes/:noteId` | List, create, and delete notes | Requires study owner |
| `POST /api/notes/pdf-text` | Extract selectable PDF text | Requires study owner |
| `POST /api/notes/pdf-study-pack` | Extract PDF and create note/cards | Requires study owner; AI rate limited |
| `GET /api/notes/:noteId/cards` | List generated cards | Requires study owner |
| `POST /api/notes/:noteId/extract` | Generate cards | Requires study owner; AI rate limited |
| `POST /api/notes/:noteId/cards/more` | Generate additional cards | Requires study owner; AI rate limited |
| `PATCH /api/cards/:cardId/review` | Approve, edit/approve, or reject | Requires study owner |
| `GET /api/library`, `/api/library/guides*` | Search/list approved cards and guides | Requires study owner |
| `GET /api/study/summary` | Counts for current owner | Requires study owner |

## Operational notes

- `DATABASE_URL`, `SESSION_SECRET`, Clerk keys, and the Replit AI integration variables are read from the server environment; the frontend reads `VITE_CLERK_PUBLISHABLE_KEY` and optionally `VITE_CLERK_PROXY_URL`.
- The API requires `PORT`. The workspace uses pnpm and starts the API through the `artifacts/api-server` workflow.
- The database package exposes a Drizzle `push` command. No checked-in SQL migration files were found. No migration was run for this audit.
- The package scan and source scans are summarized in [Security](./SECURITY.md).
