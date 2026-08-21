export const BB_DESKTOP_SPELLCHECK_GLOBAL_NAME = "__bbDesktopSpellcheck";

interface BbDesktopSpellcheckCorrectionContext {
  dictionarySuggestions: string[];
  misspelledWord: string;
}

export interface BbDesktopSpellcheckApi {
  getCorrectionContext(
    word: string,
  ): BbDesktopSpellcheckCorrectionContext | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseBbDesktopSpellcheckCorrectionContext(
  value: unknown,
): BbDesktopSpellcheckCorrectionContext | null {
  if (!isRecord(value)) {
    return null;
  }
  const { dictionarySuggestions, misspelledWord } = value;
  if (
    typeof misspelledWord !== "string" ||
    !Array.isArray(dictionarySuggestions) ||
    dictionarySuggestions.some((suggestion) => typeof suggestion !== "string")
  ) {
    return null;
  }
  return {
    dictionarySuggestions,
    misspelledWord,
  };
}

export function buildBbDesktopSpellcheckLookupScript(word: string): string {
  return `globalThis[${JSON.stringify(BB_DESKTOP_SPELLCHECK_GLOBAL_NAME)}]?.getCorrectionContext(${JSON.stringify(word)}) ?? null`;
}
