import { highlight, type LanguageName } from "sugar-high";
import { lang } from "sugar-high/lang";

// sugar-high resolves fence aliases it knows (`sh`/`bash`/`zsh` -> shell,
// `py` -> python, `c++`/`cc` -> cpp, `yml` -> yaml, ...). These cover the
// aliases agents emit that it does not know. A language it cannot resolve
// falls through to the core JavaScript highlighter, which still tokenizes
// identifiers, strings, and comments rather than failing.
const EXTRA_LANGUAGE_ALIASES: Record<string, LanguageName> = {
  console: "shell",
  shellscript: "shell",
  h: "c",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  less: "css",
};

interface HighlightMarkdownCodeArgs {
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
  const resolved =
    language === null
      ? undefined
      : (lang(language) ?? EXTRA_LANGUAGE_ALIASES[language]);
  return highlight(code, { lang: resolved });
}
