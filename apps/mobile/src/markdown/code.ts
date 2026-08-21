import type { LanguageName } from "sugar-high";
import { SugarHigh, tokenize } from "sugar-high/core";
import { lang, languages } from "sugar-high/lang";

/**
 * Fenced-code tokenization for the native renderer. `sugar-high` ships
 * tokenizer configs for the languages agents emit most often and resolves
 * the fence aliases it knows (`sh`/`bash`/`zsh` -> shell, `py` -> python, ...).
 * A fence with no language, or one it cannot resolve, uses the JavaScript
 * tokenizer, exactly like sugar-high's own `highlight()`; `sugar-high/core`'s
 * bare `tokenize(code, undefined)` is a generic lexer with no keywords or
 * comments, so it is never called without a config.
 * Mirrors the web's `markdown-code-highlight.ts`, but returns a span model
 * instead of HTML.
 */

export type CodeTokenType =
  | "identifier"
  | "keyword"
  | "string"
  | "class"
  | "property"
  | "entity"
  | "jsxliterals"
  | "sign"
  | "comment"
  | "break"
  | "space";

export interface CodeSpan {
  text: string;
  type: CodeTokenType;
}

/** One source line as spans (no trailing newline). */
export type CodeLine = CodeSpan[];

/** Fence aliases agents emit that sugar-high's `lang()` does not resolve. */
const EXTRA_LANGUAGE_ALIASES: Record<string, LanguageName> = {
  console: "shell",
  shellscript: "shell",
  h: "c",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  less: "css",
};

function tokenizerConfigFor(language: string | null) {
  const resolved =
    language === null
      ? "javascript"
      : (lang(language) ?? EXTRA_LANGUAGE_ALIASES[language] ?? "javascript");
  return languages.find(({ id }) => id === resolved)?.config;
}

/**
 * Beyond this size a block renders as plain monospace text: a single RN
 * `Text` with tens of thousands of nested spans is slow to lay out and the
 * colour adds little to a log dump.
 */
export const CODE_HIGHLIGHT_CHAR_LIMIT = 20_000;

function tokenTypeName(index: number): CodeTokenType {
  const name: string | undefined = SugarHigh.TokenTypes[index];
  switch (name) {
    case "identifier":
    case "keyword":
    case "string":
    case "class":
    case "property":
    case "entity":
    case "jsxliterals":
    case "sign":
    case "comment":
    case "break":
    case "space":
      return name;
    default:
      return "identifier";
  }
}

/** Normalizes an info-string language (`TypeScript ` → `typescript`). */
export function normalizeCodeLanguage(
  language: string | null | undefined,
): string | null {
  if (language === null || language === undefined) {
    return null;
  }
  const trimmed = language.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/** Languages whose fenced blocks are shown as source, never highlighted. */
function isPlainCodeLanguage(language: string | null): boolean {
  return (
    language === "mermaid" ||
    language === "math" ||
    language === "latex" ||
    language === "tex" ||
    language === "text" ||
    language === "txt" ||
    language === "plain" ||
    language === "plaintext"
  );
}

function plainLines(code: string): CodeLine[] {
  return code
    .split("\n")
    .map((line) =>
      line.length === 0 ? [] : [{ text: line, type: "identifier" as const }],
    );
}

/**
 * Tokenizes `code` into lines of spans. Consecutive spans of the same type
 * are merged so a line typically yields a handful of `Text` children.
 */
export function tokenizeCodeLines(
  code: string,
  language: string | null,
): CodeLine[] {
  if (
    code.length > CODE_HIGHLIGHT_CHAR_LIMIT ||
    isPlainCodeLanguage(language)
  ) {
    return plainLines(code);
  }
  let tokens: Array<[number, string]>;
  try {
    tokens = tokenize(code, tokenizerConfigFor(language));
  } catch {
    return plainLines(code);
  }
  const lines: CodeLine[] = [];
  let current: CodeLine = [];
  const push = (text: string, type: CodeTokenType) => {
    if (text.length === 0) {
      return;
    }
    const last = current[current.length - 1];
    if (last !== undefined && last.type === type) {
      last.text += text;
      return;
    }
    current.push({ text, type });
  };
  for (const [typeIndex, value] of tokens) {
    const type = tokenTypeName(typeIndex);
    if (type === "break") {
      // A break token may carry several newlines.
      const count = value.split("\n").length - 1;
      for (let i = 0; i < Math.max(1, count); i += 1) {
        lines.push(current);
        current = [];
      }
      continue;
    }
    // Spaces and other tokens can still contain newlines in edge cases
    // (e.g. multi-line strings/comments); split them so lines stay honest.
    if (value.includes("\n")) {
      const parts = value.split("\n");
      parts.forEach((part, index) => {
        if (index > 0) {
          lines.push(current);
          current = [];
        }
        push(part, type);
      });
      continue;
    }
    push(value, type);
  }
  lines.push(current);
  return lines;
}

/**
 * Syntax palette (hex equivalents of the `--sh-*` oklch literals scoped to
 * `.bb-code-highlight` in the web app). Identifiers, signs, and comments ride
 * the theme's foreground tiers and are resolved by the renderer; only the
 * hued token types are fixed here. Dark values are lifted like the app's
 * neutral ramp.
 */
const CODE_TOKEN_COLORS: Record<
  "light" | "dark",
  Partial<Record<CodeTokenType, string>>
> = {
  light: {
    keyword: "#ab2f3f",
    string: "#266739",
    class: "#2266a4",
    property: "#3b5690",
    entity: "#5e499d",
    jsxliterals: "#5e499d",
  },
  dark: {
    keyword: "#f68389",
    string: "#7ccd8e",
    class: "#79b6f4",
    property: "#97b7f8",
    entity: "#b9a9fe",
    jsxliterals: "#b9a9fe",
  },
};

export interface CodeTokenThemeTokens {
  foreground: string;
  mutedForeground: string;
  subtleForeground: string;
}

/** Colour for one span given the mode and the theme's neutral tiers. */
export function codeTokenColor(
  type: CodeTokenType,
  mode: "light" | "dark",
  tokens: CodeTokenThemeTokens,
): string {
  switch (type) {
    case "sign":
      return tokens.mutedForeground;
    case "comment":
      return tokens.subtleForeground;
    case "identifier":
    case "space":
    case "break":
      return tokens.foreground;
    default:
      return CODE_TOKEN_COLORS[mode][type] ?? tokens.foreground;
  }
}
