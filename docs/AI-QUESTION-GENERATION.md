# AI Question Generation

Audit basis: current Replit workspace source as checked on 2026-11-01. The model/provider description below reflects code configuration, not a guarantee about provider-side data retention.

## Provider and model

The API imports an OpenAI-compatible client from the Replit AI integration package. The client reads `AI_INTEGRATIONS_OPENAI_API_KEY` and `AI_INTEGRATIONS_OPENAI_BASE_URL` from the server environment. Study generation currently specifies model `gpt-5.6-luna`. The browser does not call the AI provider directly.

## Standard generation

1. A user saves a note with `POST /api/notes`.
2. The UI requests `POST /api/notes/:noteId/extract`.
3. The API loads the note only if it belongs to the current user or guest identity.
4. `extractCards` sends the complete note text as the user message. The system prompt requests a JSON object with `cards`, each containing `sourceExcerpt`, `concept`, `question`, and `answer`. It asks for source-grounded, varied questions and explicitly forbids invented facts.
5. The server JSON-parses the response and checks field types. It retains nonblank cards only when the excerpt is an exact contiguous substring of the note, then filters approximate duplicate questions using normalized text and Jaccard-style word overlap.
6. Retained cards are inserted as `pending` and returned to the Review Hub.

There is no application-level cap on source-text characters, AI input tokens, card count, or returned field lengths in the inspected generation code. The ordinary JSON parser imposes its default request-body limit on JSON note creation; the PDF route can extract text independently of that parser limit.

## PDF generation

The normal frontend uploads a PDF to `POST /api/notes/pdf-text`, then follows the same save-note and extract workflow as pasted text. The separate `POST /api/notes/pdf-study-pack` endpoint extracts the PDF and generates cards in one server request and database transaction. Both paths use `pdfjs-dist`; extraction is limited to 15 MiB and 250 pages. Image-only scans do not receive OCR.

Extracted PDF text is stored in `study_notes.raw_text` and passed to the AI integration on generation. Uploaded file bytes are held in memory and zeroed after processing; this does not erase the extracted text saved in the database.

## Source grounding and duplicate prevention

Source matching is exact substring inclusion (`rawText.includes(sourceExcerpt)`). Empty text fields are rejected. Duplicate filtering compares normalized question text and concept, with similarity thresholds. These are quality safeguards, not a cryptographic or semantic proof that an answer is correct. The AI can still produce a wrong, incomplete, or misleading answer based on a matching excerpt, so cards remain pending until a person reviews them.

Notes are untrusted input to the model. The system prompt requests grounded output, and server-side source matching limits unsupported citations, but prompt text itself is not isolated from model interpretation. Treat output validation and human review as essential.

## Additional-question generation

`POST /api/notes/:noteId/cards/more` loads the owner's note and all generated cards for that note, then sends the complete source plus covered concept/question/excerpt records to the model. It requires a boolean `moreAvailable` in the JSON response, applies the same source-excerpt and duplicate filters, and returns whether more questions remain. Unlike the standard generation path, AI errors are logged and returned as HTTP 503; no demo fallback is used.

## Fallback and review

Standard extraction catches AI/request/parse/grounding errors and creates deterministic sentence-based demo cards instead. The API response includes `mode: "demo"` or `"ai"`; the UI records and displays that mode. The fallback is functional scaffolding, not equivalent to AI-quality question generation.

The review route supports `approve`, `edit_approve`, and `discard`. Approving or editing creates/updates one library-card snapshot for the generated card and sets its status to `approved`; discarding marks it `rejected`. Library queries return only approved cards and enforce ownership through the source note. A note deletion cascades to its generated and library cards.

## Security and reliability recommendations

- Define maximum note and extracted-PDF character counts and reject over-limit input before persistence or AI submission.
- Set provider request timeouts and explicit per-call token/output limits; cap number and length of cards and fields after parsing.
- Keep per-owner limits, but use a shared limiter and add a global budget/abuse ceiling for multi-instance deployments.
- Preserve the existing mode indicator and human review. Track sanitized AI failure categories and latency without logging note contents, prompts containing user notes, or credentials.
- Add tests for malformed JSON, empty/inexact excerpts, duplicate cards, excessive input/output, provider timeout, and demo fallback. Verify that a failed generation cannot leave partial or incorrectly owned records.
