import { and, desc, eq, exists, ilike, or, sql } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import {
  CreatePdfStudyPackResponse,
  CreateNoteBody,
  CreateNoteResponse,
  ExtractPdfTextResponse,
  ExtractStudyPackParams,
  ExtractStudyPackResponse,
  FetchVerifiedGuideParams,
  FetchVerifiedGuideResponse,
  GenerateMoreCardsParams,
  GenerateMoreCardsResponse,
  GetStudySummaryResponse,
  ListVerifiedGuidesResponse,
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
import {
  buildAdditionalCardsContext,
  extractAdditionalCards,
  extractCards,
} from "../lib/study-extraction";
import { extractPdfText, PdfExtractionError } from "../lib/pdf-extraction";
import {
  MAX_AI_CONTEXT_CHARACTERS,
  MAX_EXISTING_CARDS_FOR_AI,
  MAX_STUDY_TEXT_CHARACTERS,
  STUDY_TEXT_TOO_LARGE_MESSAGE,
} from "../lib/study-limits";
import {
  getStudyOwner,
  requireStudyOwner,
  studyOwnerCondition,
  studyOwnerValues,
} from "../lib/study-owner";

const router: IRouter = Router();
const aiGenerationLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: (_req, res) => (getStudyOwner(res).kind === "guest" ? 10 : 40),
  keyGenerator: (_req, res) => {
    const owner = getStudyOwner(res);
    return owner.kind === "guest"
      ? `guest:${owner.guestSessionId}`
      : `user:${owner.userId}`;
  },
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "You’ve reached the study-generation limit for this hour. Try again later.",
  },
});
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

const generatedCardFields = {
  id: generatedCardsTable.id,
  noteId: generatedCardsTable.noteId,
  sourceExcerpt: generatedCardsTable.sourceExcerpt,
  concept: generatedCardsTable.concept,
  question: generatedCardsTable.question,
  answer: generatedCardsTable.answer,
  status: generatedCardsTable.status,
  createdAt: generatedCardsTable.createdAt,
};

router.use(requireStudyOwner);

router.get("/notes", async (_req, res): Promise<void> => {
  const owner = getStudyOwner(res);
  const notes = await db
    .select()
    .from(notesTable)
    .where(studyOwnerCondition(owner))
    .orderBy(desc(notesTable.createdAt));
  res.json(ListNotesResponse.parse(notes));
});

router.post("/notes", async (req, res): Promise<void> => {
  const owner = getStudyOwner(res);
  if (
    typeof req.body?.rawText === "string" &&
    req.body.rawText.length > MAX_STUDY_TEXT_CHARACTERS
  ) {
    res.status(413).json({ error: STUDY_TEXT_TOO_LARGE_MESSAGE });
    return;
  }
  const parsed = CreateNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [note] = await db
    .insert(notesTable)
    .values({ ...parsed.data, ...studyOwnerValues(owner) })
    .returning();
  res.status(201).json(CreateNoteResponse.parse(note));
});

router.delete("/notes/:noteId", async (req, res): Promise<void> => {
  const owner = getStudyOwner(res);
  const noteId = req.params.noteId;
  if (!uuidPattern.test(noteId)) {
    res.status(400).json({ error: "Invalid note ID" });
    return;
  }

  const [deleted] = await db
    .delete(notesTable)
    .where(and(eq(notesTable.id, noteId), studyOwnerCondition(owner)))
    .returning({ id: notesTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  // The database foreign keys cascade to generated cards and verified cards.
  res.status(204).end();
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
  aiGenerationLimit,
  parsePdfUpload,
  async (req, res): Promise<void> => {
    const owner = getStudyOwner(res);
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
          .values({
            title: title.data.trim(),
            rawText: text,
            ...studyOwnerValues(owner),
          })
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
  const owner = getStudyOwner(res);
  const params = ListNoteCardsParams.safeParse(req.params);
  if (!params.success || !uuidPattern.test(params.data?.noteId ?? "")) {
    res.status(400).json({ error: "Invalid note ID" });
    return;
  }
  const cards = await db
    .select(generatedCardFields)
    .from(generatedCardsTable)
    .innerJoin(notesTable, eq(generatedCardsTable.noteId, notesTable.id))
    .where(
      and(
        eq(generatedCardsTable.noteId, params.data.noteId),
        studyOwnerCondition(owner),
      ),
    )
    .orderBy(desc(generatedCardsTable.createdAt));
  res.json(ListNoteCardsResponse.parse(cards));
});

router.post(
  "/notes/:noteId/extract",
  aiGenerationLimit,
  async (req, res): Promise<void> => {
    const owner = getStudyOwner(res);
    const params = ExtractStudyPackParams.safeParse(req.params);
    if (!params.success || !uuidPattern.test(params.data?.noteId ?? "")) {
      res.status(400).json({ error: "Invalid note ID" });
      return;
    }
    const [note] = await db
      .select()
      .from(notesTable)
      .where(
        and(
          eq(notesTable.id, params.data.noteId),
          studyOwnerCondition(owner),
        ),
      )
      .limit(1);
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    if (note.rawText.length > MAX_STUDY_TEXT_CHARACTERS) {
      res.status(413).json({ error: STUDY_TEXT_TOO_LARGE_MESSAGE });
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
  },
);

router.post(
  "/notes/:noteId/cards/more",
  aiGenerationLimit,
  async (req, res): Promise<void> => {
    const owner = getStudyOwner(res);
    const params = GenerateMoreCardsParams.safeParse(req.params);
    if (!params.success || !uuidPattern.test(params.data?.noteId ?? "")) {
      res.status(400).json({ error: "Invalid note ID" });
      return;
    }
    const [note] = await db
      .select()
      .from(notesTable)
      .where(
        and(
          eq(notesTable.id, params.data.noteId),
          studyOwnerCondition(owner),
        ),
      )
      .limit(1);
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    if (note.rawText.length > MAX_STUDY_TEXT_CHARACTERS) {
      res.status(413).json({ error: STUDY_TEXT_TOO_LARGE_MESSAGE });
      return;
    }

    const alreadyCovered = await db
      .select({
        sourceExcerpt: generatedCardsTable.sourceExcerpt,
        concept: generatedCardsTable.concept,
        question: generatedCardsTable.question,
      })
      .from(generatedCardsTable)
      .innerJoin(notesTable, eq(generatedCardsTable.noteId, notesTable.id))
      .where(
        and(
          eq(generatedCardsTable.noteId, note.id),
          studyOwnerCondition(owner),
        ),
      )
      .limit(MAX_EXISTING_CARDS_FOR_AI + 1);

    if (alreadyCovered.length > MAX_EXISTING_CARDS_FOR_AI) {
      res.status(413).json({
        error: `Additional generation is limited to ${MAX_EXISTING_CARDS_FOR_AI} existing cards per note.`,
      });
      return;
    }
    const aiContext = buildAdditionalCardsContext(note.rawText, alreadyCovered);
    if (aiContext.length > MAX_AI_CONTEXT_CHARACTERS) {
      res.status(413).json({
        error: `The note and existing cards exceed the ${MAX_AI_CONTEXT_CHARACTERS.toLocaleString()}-character AI context limit.`,
      });
      return;
    }

    try {
      const result = await extractAdditionalCards(
        note.rawText,
        alreadyCovered,
        aiContext,
      );
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

      res.json(
        GenerateMoreCardsResponse.parse({
          cards,
          hasMore: result.hasMore,
          mode: result.mode,
        }),
      );
    } catch (error) {
      req.log.error(
        { err: error, noteId: note.id },
        "Failed to generate additional study cards",
      );
      res.status(503).json({
        error: "Miky couldn’t find more questions just now. Try again shortly.",
      });
    }
  },
);

router.patch("/cards/:cardId/review", async (req, res): Promise<void> => {
  const owner = getStudyOwner(res);
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
    .select(generatedCardFields)
    .from(generatedCardsTable)
    .innerJoin(notesTable, eq(generatedCardsTable.noteId, notesTable.id))
    .where(
      and(
        eq(generatedCardsTable.id, params.data.cardId),
        studyOwnerCondition(owner),
      ),
    )
    .limit(1);
  if (!current) {
    res.status(404).json({ error: "Card not found" });
    return;
  }

  if (parsed.data.action === "discard") {
    const ownedNote = db
      .select({ id: notesTable.id })
      .from(notesTable)
      .where(
        and(
          eq(notesTable.id, generatedCardsTable.noteId),
          studyOwnerCondition(owner),
        ),
      );
    const [updated] = await db
      .update(generatedCardsTable)
      .set({ status: "rejected" })
      .where(
        and(
          eq(generatedCardsTable.id, current.id),
          exists(ownedNote),
        ),
      )
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
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
    const ownedNote = tx
      .select({ id: notesTable.id })
      .from(notesTable)
      .where(
        and(
          eq(notesTable.id, generatedCardsTable.noteId),
          studyOwnerCondition(owner),
        ),
      );
    const [card] = await tx
      .update(generatedCardsTable)
      .set({ ...finalCard, status: "approved" })
      .where(
        and(
          eq(generatedCardsTable.id, current.id),
          exists(ownedNote),
        ),
      )
      .returning();
    if (!card) {
      return undefined;
    }
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

  if (!updated) {
    res.status(404).json({ error: "Card not found" });
    return;
  }
  res.json(ReviewCardResponse.parse(updated));
});

router.get("/library/guides", async (_req, res): Promise<void> => {
  const owner = getStudyOwner(res);
  const guides = await db
    .select({
      noteId: generatedCardsTable.noteId,
      title: notesTable.title,
      approvedCount: sql<number>`count(${libraryCardsTable.id})::int`,
    })
    .from(libraryCardsTable)
    .innerJoin(generatedCardsTable, eq(libraryCardsTable.cardId, generatedCardsTable.id))
    .innerJoin(notesTable, eq(generatedCardsTable.noteId, notesTable.id))
    .where(
      and(
        eq(generatedCardsTable.status, "approved"),
        studyOwnerCondition(owner),
      ),
    )
    .groupBy(generatedCardsTable.noteId, notesTable.title)
    .orderBy(desc(sql`max(${libraryCardsTable.createdAt})`));
  res.json(ListVerifiedGuidesResponse.parse(guides));
});

router.get("/library/guides/:noteId", async (req, res): Promise<void> => {
  const owner = getStudyOwner(res);
  const params = FetchVerifiedGuideParams.safeParse(req.params);
  if (!params.success || !uuidPattern.test(params.data?.noteId ?? "")) {
    res.status(400).json({ error: "Invalid note ID" });
    return;
  }
  const [note] = await db
    .select({ id: notesTable.id, title: notesTable.title })
    .from(notesTable)
    .where(and(eq(notesTable.id, params.data.noteId), studyOwnerCondition(owner)))
    .limit(1);
  if (!note) {
    res.status(404).json({ error: "Note session not found" });
    return;
  }
  const cards = await db
    .select({
      id: libraryCardsTable.id,
      cardId: libraryCardsTable.cardId,
      sourceExcerpt: generatedCardsTable.sourceExcerpt,
      concept: libraryCardsTable.concept,
      question: libraryCardsTable.question,
      answer: libraryCardsTable.answer,
      editedByUser: libraryCardsTable.editedByUser,
      createdAt: libraryCardsTable.createdAt,
    })
    .from(libraryCardsTable)
    .innerJoin(generatedCardsTable, eq(libraryCardsTable.cardId, generatedCardsTable.id))
    .innerJoin(notesTable, eq(generatedCardsTable.noteId, notesTable.id))
    .where(
      and(
        eq(generatedCardsTable.noteId, note.id),
        eq(generatedCardsTable.status, "approved"),
        studyOwnerCondition(owner),
      ),
    )
    .orderBy(desc(libraryCardsTable.createdAt));
  res.json(
    FetchVerifiedGuideResponse.parse({
      noteId: note.id,
      title: note.title,
      cards,
    }),
  );
});

router.get("/library", async (req, res): Promise<void> => {
  const owner = getStudyOwner(res);
  const parsed = SearchLibraryQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const query = parsed.data.query?.trim();
  const cards = await db
    .select({
      id: libraryCardsTable.id,
      cardId: libraryCardsTable.cardId,
      concept: libraryCardsTable.concept,
      question: libraryCardsTable.question,
      answer: libraryCardsTable.answer,
      editedByUser: libraryCardsTable.editedByUser,
      createdAt: libraryCardsTable.createdAt,
    })
    .from(libraryCardsTable)
    .innerJoin(generatedCardsTable, eq(libraryCardsTable.cardId, generatedCardsTable.id))
    .innerJoin(notesTable, eq(generatedCardsTable.noteId, notesTable.id))
    .where(
      and(
        eq(generatedCardsTable.status, "approved"),
        studyOwnerCondition(owner),
        query
          ? or(
            ilike(libraryCardsTable.concept, `%${query}%`),
            ilike(libraryCardsTable.question, `%${query}%`),
            ilike(libraryCardsTable.answer, `%${query}%`),
          )
          : undefined,
      ),
    )
    .orderBy(desc(libraryCardsTable.createdAt));
  res.json(SearchLibraryResponse.parse(cards));
});

router.get("/study/summary", async (_req, res): Promise<void> => {
  const owner = getStudyOwner(res);
  const [noteCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notesTable)
    .where(studyOwnerCondition(owner));
  const [pendingCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(generatedCardsTable)
    .innerJoin(notesTable, eq(generatedCardsTable.noteId, notesTable.id))
    .where(
      and(
        eq(generatedCardsTable.status, "pending"),
        studyOwnerCondition(owner),
      ),
    );
  const [approvedCount] = await db
    .select({ count: sql<number>`count(${libraryCardsTable.id})::int` })
    .from(libraryCardsTable)
    .innerJoin(generatedCardsTable, eq(libraryCardsTable.cardId, generatedCardsTable.id))
    .innerJoin(notesTable, eq(generatedCardsTable.noteId, notesTable.id))
    .where(
      and(
        eq(generatedCardsTable.status, "approved"),
        studyOwnerCondition(owner),
      ),
    );
  res.json(
    GetStudySummaryResponse.parse({
      notes: noteCount.count,
      pending: pendingCount.count,
      approved: approvedCount.count,
    }),
  );
});

export default router;
