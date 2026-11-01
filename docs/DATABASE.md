# Database

Audit basis: Drizzle schema source in the current workspace, checked on 2026-11-01. No live database was queried and no migration was run.

## Database and ORM

The application uses PostgreSQL through `pg`/`node-postgres` and Drizzle ORM. `DATABASE_URL` is required at startup and by the Drizzle configuration. Schema definitions are in `lib/db/src/schema/auth.ts` and `lib/db/src/schema/study.ts`.

The package exposes `drizzle-kit push` and `push-force` scripts. No checked-in SQL migrations or migration journal were found in the workspace. Schema source documents the intended structure but does not establish whether a deployed database is fully synchronized.

## Tables

### `study_users`

| Column | Purpose |
| --- | --- |
| `clerk_user_id` | Primary key; trusted Clerk identity |
| `google_provider_id` | Google external-account ID; nullable |
| `email`, `name`, `profile_image_url` | User profile data synchronized from Clerk |
| `onboarding_status`, `onboarding_step`, `onboarding_version` | Persisted tour progress |
| `created_at`, `updated_at` | Timestamps |

`google_provider_id` has a unique partial index when non-null. The API synchronizes this record after validating a Google-linked Clerk account and verified primary email.

### `study_guest_sessions`

| Column | Purpose |
| --- | --- |
| `id` | Database-generated UUID primary key |
| onboarding fields | Persisted tour progress |
| `created_at`, `last_active_at` | Creation and last activity timestamps |
| `transferred_to_user_id` | Nullable FK to `study_users.clerk_user_id`, `ON DELETE SET NULL` |
| `transferred_at` | Transfer timestamp |

The source has no expiry column, TTL enforcement, cleanup marker, or explicit index beyond the primary key.

### `study_notes`

| Column | Purpose |
| --- | --- |
| `id` | Database-generated UUID primary key |
| `title`, `raw_text` | User-supplied note title and full source content |
| `owner_user_id` | Nullable FK to signed-in user, `ON DELETE CASCADE` |
| `guest_session_id` | Nullable FK to guest session, `ON DELETE CASCADE` |
| `created_at` | Creation timestamp |

The `study_notes_owner_exclusive` check prevents both owner columns from being non-null at once. It allows both to be null, which supports unassigned/legacy rows; owner-scoped API queries exclude those rows. New API-created notes set one owner field and null the other.

### `generated_study_cards`

| Column | Purpose |
| --- | --- |
| `id` | Database-generated UUID primary key |
| `note_id` | Required FK to note, `ON DELETE CASCADE` |
| `source_excerpt`, `concept`, `question`, `answer` | Generated/reviewed card content |
| `status` | PostgreSQL enum: `pending`, `approved`, `rejected`; defaults to `pending` |
| `created_at` | Creation timestamp |

Card ownership is inherited through the source note; cards have no independent user or guest owner column.

### `study_library_cards`

| Column | Purpose |
| --- | --- |
| `id` | Database-generated UUID primary key |
| `card_id` | Required FK to generated card, `ON DELETE CASCADE` |
| `concept`, `question`, `answer` | Approved snapshot; can differ from generated card after editing |
| `edited_by_user` | Whether the approved snapshot was edited |
| `created_at` | Creation timestamp |

`card_id` has a unique index, so a generated card has at most one library snapshot. Library ownership is also inherited through the generated card's note.

## Relationships and lifecycle

```text
study_users ──< study_notes >── study_guest_sessions
                    │
                    └──< generated_study_cards ──0..1── study_library_cards
```

- Deleting a note cascades to its generated cards and library snapshots.
- Deleting a local user row cascades to that user's notes; the corresponding Clerk-account deletion is not implemented in this repository.
- Deleting a guest-session row cascades to its guest notes.
- Guest transfer changes the note owner columns transactionally. Descendant cards remain attached through `note_id`.
- Approving a card creates or updates the unique library snapshot. Discarding only changes the generated card status.

## Indexes and data constraints

Explicit schema indexes are limited to primary keys, the partial unique Google-provider ID index, and the unique library `card_id` index. The inspected schema defines no explicit indexes for note owner columns, guest-session lookups on notes, note-to-card joins, or creation ordering. PostgreSQL primary keys are indexed automatically.

The owner check ensures mutually exclusive non-null ownership, not exactly-one ownership. A future constraint tightening would need to account for unassigned/legacy rows and should be planned as a migration rather than applied blindly.

## Schema-change and security considerations

- No migration was run during this audit. Review development and production schema state separately before applying any change.
- Guest expiration/retention requires a schema or policy change and a cleanup process. Backfill existing sessions with a grace policy.
- Adding query indexes requires a migration and should be based on production query plans and table sizes.
- Full note text, including extracted PDF text, is stored in `raw_text`; define retention and deletion behavior for guest and signed-in accounts.
- Generated and library records have no independent ownership columns; preserve the note join in every future card/library endpoint.
