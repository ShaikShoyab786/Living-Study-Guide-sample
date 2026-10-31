import { desc, eq, ilike, or, sql } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import multer from "multer";
import {
  CreatePdfStudyPackResponse,
  CreateNoteBody,
  CreateNoteResponse,
  ExtractPdfTextResponse,
  ExtractStudyPackParams,
  ExtractStudyPackResponse,
  GetStudySummaryResponse,
  ListNoteCardsParams,
  ListNoteCardsResponse,
  ListNotesResponse,
  ReviewCardBody,
  ReviewCardParams,
  ReviewCardResponse,
  SearchLibraryQueryParams,
  SearchLibraryResponse,
} from "@workspace/api-zod";
import {
  db,
  generatedCardsTable,
  libraryCardsTable,
  notesTable,
} from "@workspace/db";
import { extractCards } from "../lib/study-extraction";
import { extractPdfText, PdfExtractionError } from "../lib/pdf-extraction";

const router: IRouter = Router();
const maxPdfUploadBytes = 15 * 1024 * 1024;
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxPdfUploadBytes, files: 1, fields: 1 },
}).single("file");
const parsePdfUpload: RequestHandler = (req, res, next) => {
  pdfUpload(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      const isTooLarge = error.code === "LIMIT_FILE_SIZE";
      res.status(isTooLarge ? 413 : 400).json({
        error: isTooLarge
          ? "PDFs must be 15 MB or smaller."
          : "Upload one PDF file at a time.",
      });
      return;
    }
    if (error) {
      res.status(400).json({ error: "The PDF upload could not be read." });
      return;
    }
    next();
  });
};
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.get("/notes", async (_req, res): Promise<void> => {
  const notes = await db
    .select()
    .from(notesTable)
    .orderBy(desc(notesTable.createdAt));
  res.json(ListNotesResponse.parse(notes));
});

router.post("/notes", async (req, res): Promise<void> => {
  const parsed = CreateNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [note] = await db.insert(notesTable).values(parsed.data).returning();
  res.status(201).json(CreateNoteResponse.parse(note));
});

router.post(
  "/notes/pdf-text",
  parsePdfUpload,
  async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "Choose a PDF file to upload." });
      return;
    }
    if (!req.file.originalname.toLowerCase().endsWith(".pdf")) {
      req.file.buffer.fill(0);
      res.status(400).json({ error: "Choose a file with a .pdf extension." });
      return;
    }

    try {
      const extraction = await extractPdfText(req.file.buffer);
      res.json(ExtractPdfTextResponse.parse(extraction));
    } catch (error) {
      if (error instanceof PdfExtractionError) {
        if (error.cause) {
          req.log.error({ err: error.cause }, "Failed to extract text from PDF");
        }
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      req.log.error({ err: error }, "Failed to extract text from PDF");
      res.status(500).json({ error: "The PDF text could not be extracted." });
    } finally {
      req.file.buffer.fill(0);
    }
  },
);

router.post(
  "/notes/pdf-study-pack",
  parsePdfUpload,
  async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "Choose a PDF file to upload." });
      return;
    }

    const title = CreateNoteBody.shape.title.safeParse(req.body.title);
    if (!title.success) {
      req.file.buffer.fill(0);
      res.status(400).json({ error: "Add a valid title for this note." });
      return;
    }
    if (!req.file.originalname.toLowerCase().endsWith(".pdf")) {
      req.file.buffer.fill(0);
      res.status(400).json({ error: "Choose a file with a .pdf extension." });
      return;
    }

    try {
      const { text } = await extractPdfText(req.file.buffer);
      const extraction = await extractCards(text);
      if (extraction.mode === "demo") {
        req.log.warn(
          { title: title.data },
          "Using transparent demo card extraction for uploaded PDF",
        );
      }

      const saved = await db.transaction(async (tx) => {
        const [note] = await tx
          .insert(notesTable)
          .values({ title: title.data.trim(), rawText: text })
          .returning();
        const cards =
          extraction.cards.length > 0
            ? await tx
                .insert(generatedCardsTable)
                .values(
                  extraction.cards.map((card) => ({
                    noteId: note.id,
                    sourceExcerpt: card.sourceExcerpt,
                    concept: card.concept,
                    question: card.question,
                    answer: card.answer,
                    status: "pending" as const,
                  })),
                )
                .returning()
            : [];
        return { note, cards };
      });

      res
        .status(201)
        .json(
          CreatePdfStudyPackResponse.parse({
            ...saved,
            mode: extraction.mode,
          }),
        );
    } catch (error) {
      if (error instanceof PdfExtractionError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      req.log.error({ err: error }, "Failed to create a study pack from PDF");
      res.status(500).json({ error: "The study pack could not be created." });
    } finally {
      req.file.buffer.fill(0);
    }
  },
);

router.get("/notes/:noteId/cards", async (req, res): Promise<void> => {
  const params = ListNoteCardsParams.safeParse(req.params);
  if (!params.success || !uuidPattern.test(params.data?.noteId ?? "")) {
    res.status(400).json({ error: "Invalid note ID" });
    return;
  }
  const cards = await db
    .select()
    .from(generatedCardsTable)
    .where(eq(generatedCardsTable.noteId, params.data.noteId))
    .orderBy(desc(generatedCardsTable.createdAt));
  res.json(ListNoteCardsResponse.parse(cards));
});

router.post("/notes/:noteId/extract", async (req, res): Promise<void> => {
  const params = ExtractStudyPackParams.safeParse(req.params);
  if (!params.success || !uuidPattern.test(params.data?.noteId ?? "")) {
    res.status(400).json({ error: "Invalid note ID" });
    return;
  }
  const [note] = await db
    .select()
    .from(notesTable)
    .where(eq(notesTable.id, params.data.noteId))
    .limit(1);
  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  const result = await extractCards(note.rawText);
  if (result.mode === "demo") {
    req.log.warn({ noteId: note.id }, "Using transparent demo card extraction");
  }
  const cards =
    result.cards.length > 0
      ? await db
          .insert(generatedCardsTable)
          .values(
            result.cards.map((card) => ({
              noteId: note.id,
              sourceExcerpt: card.sourceExcerpt,
              concept: card.concept,
              question: card.question,
              answer: card.answer,
              status: "pending" as const,
            })),
          )
          .returning()
      : [];

  res.json(ExtractStudyPackResponse.parse({ cards, mode: result.mode }));
});

router.patch("/cards/:cardId/review", async (req, res): Promise<void> => {
  const params = ReviewCardParams.safeParse(req.params);
  const parsed = ReviewCardBody.safeParse(req.body);
  if (
    !params.success ||
    !uuidPattern.test(params.data?.cardId ?? "") ||
    !parsed.success
  ) {
    res.status(400).json({
      error: !parsed.success ? parsed.error.message : "Invalid card ID",
    });
    return;
  }
  const [current] = await db
    .select()
    .from(generatedCardsTable)
    .where(eq(generatedCardsTable.id, params.data.cardId))
    .limit(1);
  if (!current) {
    res.status(404).json({ error: "Card not found" });
    return;
  }

  if (parsed.data.action === "discard") {
    const [updated] = await db
      .update(generatedCardsTable)
      .set({ status: "rejected" })
      .where(eq(generatedCardsTable.id, current.id))
      .returning();
    res.json(ReviewCardResponse.parse(updated));
    return;
  }

  const edited = parsed.data.action === "edit_approve";
  if (
    edited &&
    (!parsed.data.concept?.trim() ||
      !parsed.data.question?.trim() ||
      !parsed.data.answer?.trim())
  ) {
    res.status(400).json({
      error: "Concept, question, and answer are required when editing a card",
    });
    return;
  }

  const finalCard = {
    concept: edited ? parsed.data.concept!.trim() : current.concept,
    question: edited ? parsed.data.question!.trim() : current.question,
    answer: edited ? parsed.data.answer!.trim() : current.answer,
  };
  const updated = await db.transaction(async (tx) => {
    const [card] = await tx
      .update(generatedCardsTable)
      .set({ ...finalCard, status: "approved" })
      .where(eq(generatedCardsTable.id, current.id))
      .returning();
    await tx
      .insert(libraryCardsTable)
      .values({
        cardId: current.id,
        ...finalCard,
        editedByUser: edited,
      })
      .onConflictDoUpdate({
        target: libraryCardsTable.cardId,
        set: { ...finalCard, editedByUser: edited },
      });
    return card;
  });

  res.json(ReviewCardResponse.parse(updated));
});

router.get("/library", async (req, res): Promise<void> => {
  const parsed = SearchLibraryQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const query = parsed.data.query?.trim();
  const cards = await db
    .select()
    .from(libraryCardsTable)
    .where(
      query
        ? or(
            ilike(libraryCardsTable.concept, `%${query}%`),
            ilike(libraryCardsTable.question, `%${query}%`),
            ilike(libraryCardsTable.answer, `%${query}%`),
          )
        : undefined,
    )
    .orderBy(desc(libraryCardsTable.createdAt));
  res.json(SearchLibraryResponse.parse(cards));
});

router.get("/study/summary", async (_req, res): Promise<void> => {
  const [noteCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notesTable);
  const [pendingCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(generatedCardsTable)
    .where(eq(generatedCardsTable.status, "pending"));
  const [approvedCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(libraryCardsTable);
  res.json(
    GetStudySummaryResponse.parse({
      notes: noteCount.count,
      pending: pendingCount.count,
      approved: approvedCount.count,
    }),
  );
});

export default router;
