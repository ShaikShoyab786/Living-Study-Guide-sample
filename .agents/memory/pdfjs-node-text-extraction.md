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

When testing extracted-text limits, PDF byte size or literal stream length does not guarantee the same amount of text is returned. Keep test text inside the page bounds and verify PDF.js's extracted character count before asserting an API limit; off-page glyphs can be omitted from extraction.

**Why:** A generated oversized fixture placed repeated text beyond the page bounds, so PDF.js returned only a short visible substring and the endpoint correctly accepted it.

**How to apply:** For cap-boundary fixtures, use multiple text runs positioned within the page or distribute content across pages, then confirm extraction length first.
