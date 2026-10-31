import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const cardStatusEnum = pgEnum("study_card_status", [
  "pending",
  "approved",
  "rejected",
]);

export const notesTable = pgTable("study_notes", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  rawText: text("raw_text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const generatedCardsTable = pgTable("generated_study_cards", {
  id: uuid("id").defaultRandom().primaryKey(),
  noteId: uuid("note_id")
    .notNull()
    .references(() => notesTable.id, { onDelete: "cascade" }),
  sourceExcerpt: text("source_excerpt").notNull(),
  concept: text("concept").notNull(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  status: cardStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const libraryCardsTable = pgTable(
  "study_library_cards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cardId: uuid("card_id")
      .notNull()
      .references(() => generatedCardsTable.id, { onDelete: "cascade" }),
    concept: text("concept").notNull(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    editedByUser: boolean("edited_by_user").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("study_library_card_id_unique").on(table.cardId)],
);

export const insertNoteSchema = createInsertSchema(notesTable).omit({
  id: true,
  createdAt: true,
});
export const insertGeneratedCardSchema = createInsertSchema(
  generatedCardsTable,
).omit({ id: true, createdAt: true });
export const insertLibraryCardSchema = createInsertSchema(libraryCardsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertNote = z.infer<typeof insertNoteSchema>;
export type Note = typeof notesTable.$inferSelect;
export type InsertGeneratedCard = z.infer<typeof insertGeneratedCardSchema>;
export type GeneratedCard = typeof generatedCardsTable.$inferSelect;
export type InsertLibraryCard = z.infer<typeof insertLibraryCardSchema>;
export type LibraryCard = typeof libraryCardsTable.$inferSelect;
