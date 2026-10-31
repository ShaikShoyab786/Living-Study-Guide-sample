---
name: PDF.js Node text extraction
description: PDF.js optional rendering dependencies and Node text extraction behavior
---

PDF.js may log warnings when optional canvas or DOM geometry polyfills are unavailable in Node, while `getTextContent()` still extracts text successfully.

**Why:** The PDF feature's Node smoke check emitted these warnings but returned the expected page text.

**How to apply:** For text-only PDF processing, do not add native canvas dependencies solely to silence rendering warnings. Add them only if the app must render PDF pages.
