export const MAX_STUDY_TEXT_CHARACTERS = 100_000;
export const MAX_AI_CONTEXT_CHARACTERS = 120_000;
export const MAX_EXISTING_CARDS_FOR_AI = 100;

export const STUDY_TEXT_TOO_LARGE_MESSAGE =
  `Study notes must be ${MAX_STUDY_TEXT_CHARACTERS.toLocaleString()} characters or fewer.`;
