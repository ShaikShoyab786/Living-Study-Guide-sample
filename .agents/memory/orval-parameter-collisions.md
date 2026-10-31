---
name: Orval parameter collisions
description: OpenAPI operation parameters can collide in this workspace's generated API Zod exports.
---

Before adding both path and query parameters to an operation, check the generated `api-zod` barrel and run codegen. Orval may emit the same `<OperationId>Params` name from separate generated modules. For note-scoped search with a moderate result set, filtering on the client avoids that collision.

**Why:** Adding a query parameter to a path-parameter guide route caused a duplicate generated `Params` export and failed the library typecheck.

**How to apply:** Prefer client-side filtering for a bounded note guide; if server-side search is needed, validate the generated names and adjust the contract before relying on the new operation.
