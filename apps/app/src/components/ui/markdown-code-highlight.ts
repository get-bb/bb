import { highlight } from "sugar-high";
import { c, css, go, java, python, rust } from "sugar-high/presets";

// sugar-high's core highlighter targets JavaScript/JSX/TypeScript. These presets
// extend it to the other languages agents emit most often. A language without a
// preset falls through to the core highlighter, which still tokenizes
// identifiers, strings, and comments rather than failing.
const PRESET_BY_LANGUAGE: Record<string, typeof rust> = {
  rust,
  rs: rust,
  python,
  py: python,
  go,
  c,
  "c++": c,
  cpp: c,
  cc: c,
  h: c,
  hpp: c,
  java,
  kotlin: java,
  kt: java,
  css,
  scss: css,
  less: css,
};

export interface HighlightMarkdownCodeArgs {
  code: string;
  language: string | null;
}

/**
 * Returns sugar-high HTML for a fenced code block. sugar-high HTML-escapes the
 * input (`<` becomes `&lt;`), so the returned markup is safe to inject with
 * dangerouslySetInnerHTML; the input is fenced code text, never user-authored
 * HTML. Token colors come from the `--sh-*` custom properties scoped to
 * `.bb-code-highlight` (see markdown-code-highlight.css).
 */
export function highlightMarkdownCode({
  code,
  language,
}: HighlightMarkdownCodeArgs): string {
  const preset = language === null ? undefined : PRESET_BY_LANGUAGE[language];
  return highlight(code, preset);
}
