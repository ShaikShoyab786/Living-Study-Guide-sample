---
name: PDF.js Node text extraction
description: PDF.js Node extraction, optional rendering dependencies, and bundled worker resolution
---

PDF.js may log warnings when optional canvas or DOM geometry polyfills are unavailable in Node, while `getTextContent()` still extracts text successfully.

**Why:** The PDF feature's Node smoke check emitted these warnings but returned the expected page text.

**How to apply:** For text-only PDF processing, do not add native canvas dependencies solely to silence rendering warnings. Add them only if the app must render PDF pages.

When an API server is bundled with esbuild, keep `pdfjs-dist/*` external. PDF.js dynamically imports its worker relative to the package module; bundling only the main module can make the worker resolve beside the server bundle, where it is missing.

**Why:** Source-module extraction passed while the bundled API failed with a missing `pdf.worker.mjs`; externalizing the package made the same multipage PDF pass through the built server.

**How to apply:** For Node services that bundle PDF.js, test a representative PDF through the built server and externalize the package in the bundler configuration.
