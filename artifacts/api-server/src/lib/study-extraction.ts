import { openai } from "@workspace/integrations-openai-ai-server";
import {
  MAX_AI_CONTEXT_CHARACTERS,
  MAX_STUDY_TEXT_CHARACTERS,
} from "./study-limits";

export type ExtractedCard = {
  sourceExcerpt: string;
  concept: string;
  question: string;
  answer: string;
};

export class StudyInputLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudyInputLimitError";
  }
}

export function buildAdditionalCardsContext(
  rawText: string,
  alreadyCovered: Pick<ExtractedCard, "concept" | "question">[],
): string {
  return JSON.stringify({
    source: rawText,
    alreadyCovered: alreadyCovered.map(({ concept, question }) => ({
      concept,
      question,
    })),
  });
}

const parseCards = (content: string, allowEmpty = false): ExtractedCard[] => {
  const decoded: unknown = JSON.parse(content);
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    !("cards" in decoded) ||
    !Array.isArray(decoded.cards)
  ) {
    throw new Error("AI response did not contain a cards array");
  }

  const cards = decoded.cards.filter(
    (card): card is ExtractedCard =>
      typeof card === "object" &&
      card !== null &&
      "sourceExcerpt" in card &&
      typeof card.sourceExcerpt === "string" &&
      "concept" in card &&
      typeof card.concept === "string" &&
      "question" in card &&
      typeof card.question === "string" &&
      "answer" in card &&
      typeof card.answer === "string",
  );
  if (!allowEmpty && cards.length === 0) {
    throw new Error("AI response did not contain valid study cards");
  }
  return cards;
};

const normalizeText = (value: string) =>
  value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const questionSimilarity = (left: string, right: string) => {
  const leftWords = new Set(normalizeText(left).split(/\s+/).filter((word) => word.length > 2));
  const rightWords = new Set(normalizeText(right).split(/\s+/).filter((word) => word.length > 2));
  if (leftWords.size === 0 || rightWords.size === 0) return 0;
  const intersection = [...leftWords].filter((word) => rightWords.has(word)).length;
  const union = new Set([...leftWords, ...rightWords]).size;
  return intersection / union;
};

const hasDuplicateQuestion = (
  candidate: ExtractedCard,
  existing: Pick<ExtractedCard, "concept" | "question">,
) => {
  const candidateQuestion = normalizeText(candidate.question);
  const existingQuestion = normalizeText(existing.question);
  const sameConcept = normalizeText(candidate.concept) === normalizeText(existing.concept);
  const similarity = questionSimilarity(candidate.question, existing.question);
  return (
    candidateQuestion === existingQuestion ||
    similarity >= 0.9 ||
    (sameConcept && similarity >= 0.58)
  );
};

const filterSourceLinkedUniqueCards = (
  rawText: string,
  candidates: ExtractedCard[],
  alreadyCovered: Pick<ExtractedCard, "concept" | "question">[] = [],
) => {
  const seen = [...alreadyCovered];
  const unique: ExtractedCard[] = [];
  for (const card of candidates) {
    if (
      !rawText.includes(card.sourceExcerpt) ||
      !card.sourceExcerpt.trim() ||
      !card.concept.trim() ||
      !card.question.trim() ||
      !card.answer.trim() ||
      seen.some((existing) => hasDuplicateQuestion(card, existing))
    ) {
      continue;
    }
    unique.push(card);
    seen.push(card);
  }
  return unique;
};

export const makeDemoCards = (rawText: string): ExtractedCard[] => {
  const sentences = rawText
    .match(/[^.!?]+[.!?]?/g)
    ?.map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 10) ?? [];

  const sourceSentences = sentences.length > 0 ? sentences : [rawText.trim()];
  const candidates = sourceSentences.map((sentence) => {
    const concept = sentence
      .replace(/[.!?]+$/, "")
      .split(/\s+/)
      .slice(0, 5)
      .join(" ");
    return {
      sourceExcerpt: sentence,
      concept,
      question: `What is the key idea behind ${concept}?`,
      answer: sentence,
    };
  });
  return filterSourceLinkedUniqueCards(rawText, candidates);
};

export const extractCards = async (
  rawText: string,
): Promise<{ cards: ExtractedCard[]; mode: "ai" | "demo" }> => {
  if (rawText.length > MAX_STUDY_TEXT_CHARACTERS) {
    throw new StudyInputLimitError(
      `Study notes must be ${MAX_STUDY_TEXT_CHARACTERS.toLocaleString()} characters or fewer.`,
    );
  }
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.6-luna",
      max_completion_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Analyze the complete notes and identify distinct, meaningful learning opportunities across definitions, explanations, examples, relationships, and applications. Target 5 to 10 useful study cards when the source supports that many; generate more when the source contains more distinct concepts. There is no fixed upper card limit. If the source supports fewer useful cards, return fewer rather than padding. Use varied question forms without repetition. Return only JSON shaped as {\"cards\":[{\"sourceExcerpt\":\"...\",\"concept\":\"...\",\"question\":\"...\",\"answer\":\"...\"}]}. Every sourceExcerpt must be copied exactly as a contiguous sentence or phrase from the notes. Keep each question and answer grounded only in its excerpt and the supplied notes; do not invent facts.",
        },
        { role: "user", content: rawText },
      ],
    });
    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("AI returned an empty response");
    const cards = filterSourceLinkedUniqueCards(rawText, parseCards(content));
    if (cards.length === 0) {
      throw new Error("AI did not return exact source excerpts");
    }
    return { cards, mode: "ai" };
  } catch {
    return { cards: makeDemoCards(rawText), mode: "demo" };
  }
};

export const extractAdditionalCards = async (
  rawText: string,
  alreadyCovered: Pick<ExtractedCard, "sourceExcerpt" | "concept" | "question">[],
  checkedUserContext?: string,
): Promise<{ cards: ExtractedCard[]; hasMore: boolean; mode: "ai" }> => {
  if (rawText.length > MAX_STUDY_TEXT_CHARACTERS) {
    throw new StudyInputLimitError(
      `Study notes must be ${MAX_STUDY_TEXT_CHARACTERS.toLocaleString()} characters or fewer.`,
    );
  }
  const userContext =
    checkedUserContext ?? buildAdditionalCardsContext(rawText, alreadyCovered);
  if (userContext.length > MAX_AI_CONTEXT_CHARACTERS) {
    throw new StudyInputLimitError(
      `The note and existing cards exceed the ${MAX_AI_CONTEXT_CHARACTERS.toLocaleString()}-character AI context limit.`,
    );
  }
  const completion = await openai.chat.completions.create({
    model: "gpt-5.6-luna",
    max_completion_tokens: 8192,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Find new learning opportunities in the complete source that are not already covered by the existing cards. Generate an additional useful batch of distinct, source-grounded questions when the notes support it. Do not repeat or paraphrase an existing question or retest a concept that is already adequately covered. Do not add filler. Return only JSON shaped as {\"cards\":[{\"sourceExcerpt\":\"...\",\"concept\":\"...\",\"question\":\"...\",\"answer\":\"...\"}],\"moreAvailable\":true}. Set moreAvailable to false and cards to [] when the remaining source has no other distinct, relevant question. Every sourceExcerpt must be copied exactly as a contiguous sentence or phrase from the notes. Do not invent facts.",
      },
      {
        role: "user",
        content: userContext,
      },
    ],
  });
  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("AI returned an empty response");

  const decoded: unknown = JSON.parse(content);
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    !("moreAvailable" in decoded) ||
    typeof decoded.moreAvailable !== "boolean"
  ) {
    throw new Error("AI response did not include additional-question availability");
  }

  const candidates = filterSourceLinkedUniqueCards(
    rawText,
    parseCards(content, true),
    alreadyCovered,
  );
  return {
    cards: candidates,
    hasMore: decoded.moreAvailable && candidates.length > 0,
    mode: "ai",
  };
};
