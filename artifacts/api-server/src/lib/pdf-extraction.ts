import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const maxPdfPages = 250;

export class PdfExtractionError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 413 | 422,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PdfExtractionError";
  }
}

export async function extractPdfText(
  buffer: Buffer,
): Promise<{ text: string; pageCount: number }> {
  const header = buffer.subarray(0, Math.min(buffer.length, 1024));
  if (!header.includes(Buffer.from("%PDF-"))) {
    throw new PdfExtractionError("The uploaded file is not a valid PDF.", 400);
  }

  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    stopAtErrors: true,
    verbosity: 0,
  });

  try {
    const document = await loadingTask.promise;
    if (document.numPages > maxPdfPages) {
      throw new PdfExtractionError(
        `PDFs are limited to ${maxPdfPages} pages.`,
        413,
      );
    }

    const pageTexts: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) =>
          "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "",
        )
        .join("")
        .replace(/[ \t]+\n/g, "\n")
        .trim();
      pageTexts.push(pageText);
      page.cleanup();
    }

    const text = pageTexts.filter(Boolean).join("\n\n").trim();
    if (!text) {
      throw new PdfExtractionError(
        "No selectable text was found. OCR may be required for scanned PDFs.",
        422,
      );
    }
    return { text, pageCount: document.numPages };
  } catch (error) {
    if (error instanceof PdfExtractionError) throw error;
    if (error instanceof Error && error.name === "PasswordException") {
      throw new PdfExtractionError(
        "This PDF is password-protected. Remove its password and try again.",
        400,
        error,
      );
    }
    throw new PdfExtractionError(
      "This PDF could not be read. Check that it is not damaged or password-protected.",
      400,
      error,
    );
  } finally {
    await loadingTask.destroy();
  }
}
