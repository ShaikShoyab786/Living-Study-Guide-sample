import { openai } from "@workspace/integrations-openai-ai-server";

export type ExtractedCard = {
  sourceExcerpt: string;
  concept: string;
  question: string;
  answer: string;
};

const parseCards = (content: string): ExtractedCard[] => {
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
  if (cards.length === 0) {
    throw new Error("AI response did not contain valid study cards");
  }
  return cards;
};

export const makeDemoCards = (rawText: string): ExtractedCard[] => {
  const sentences = rawText
    .replace(/\s+/g, " ")
    .match(/[^.!?]+[.!?]?/g)
    ?.map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 10)
    .slice(0, 8) ?? [];

  const sourceSentences = sentences.length > 0 ? sentences : [rawText.trim()];
  return sourceSentences.map((sentence) => {
    const concept = sentence
      .replace(/[.!?]+$/, "")
      .split(" ")
      .slice(0, 5)
      .join(" ");
    return {
      sourceExcerpt: sentence,
      concept,
      question: `What is the key idea behind ${concept}?`,
      answer: sentence,
    };
  });
};

export const extractCards = async (
  rawText: string,
): Promise<{ cards: ExtractedCard[]; mode: "ai" | "demo" }> => {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.6-luna",
      max_completion_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Turn lecture notes into 4 to 8 useful study cards. Return only JSON shaped as {\"cards\":[{\"sourceExcerpt\":\"...\",\"concept\":\"...\",\"question\":\"...\",\"answer\":\"...\"}]}. Each sourceExcerpt must be copied exactly as a contiguous sentence or phrase from the notes. Keep questions clear and answers concise. Do not invent facts.",
        },
        { role: "user", content: rawText },
      ],
    });
    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("AI returned an empty response");
    const cards = parseCards(content).filter(
      (card) =>
        rawText.includes(card.sourceExcerpt) &&
        card.sourceExcerpt.trim().length > 0 &&
        card.concept.trim().length > 0 &&
        card.question.trim().length > 0 &&
        card.answer.trim().length > 0,
    );
    if (cards.length === 0) {
      throw new Error("AI did not return exact source excerpts");
    }
    return { cards, mode: "ai" };
  } catch {
    return { cards: makeDemoCards(rawText), mode: "demo" };
  }
};
