import { highlight, type LanguageName } from "sugar-high";
import { lang } from "sugar-high/lang";

const EXTRA_LANGUAGE_ALIASES: Record<string, LanguageName> = {
  console: "shell",
  shellscript: "shell",
  h: "c",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  less: "css",
};

const HIGHLIGHT_CACHE_MAX_ENTRIES = 128;
const HIGHLIGHT_CACHE_MAX_CHARS = 4_000_000;
const HIGHLIGHT_CACHE_MAX_CODE_LENGTH = 128_000;

const highlightCache = new Map<string, string>();
let highlightCacheChars = 0;

interface HighlightMarkdownCodeArgs {
  code: string;
  language: string | null;
}

function highlightUncached({
  code,
  language,
}: HighlightMarkdownCodeArgs): string {
  const resolved =
    language === null
      ? undefined
      : (lang(language) ?? EXTRA_LANGUAGE_ALIASES[language]);
  return highlight(code, { lang: resolved });
}

function highlightCacheKey({
  code,
  language,
}: HighlightMarkdownCodeArgs): string {
  return language === null
    ? `:${code}`
    : `${language.length}:${language}:${code}`;
}

export function highlightMarkdownCode(args: HighlightMarkdownCodeArgs): string {
  if (args.code.length > HIGHLIGHT_CACHE_MAX_CODE_LENGTH) {
    return highlightUncached(args);
  }
  const key = highlightCacheKey(args);
  const cached = highlightCache.get(key);
  if (cached !== undefined) {
    highlightCache.delete(key);
    highlightCache.set(key, cached);
    return cached;
  }
  const html = highlightUncached(args);
  const entryChars = key.length + html.length;
  if (entryChars > HIGHLIGHT_CACHE_MAX_CHARS) {
    return html;
  }
  highlightCache.set(key, html);
  highlightCacheChars += entryChars;
  for (const [oldestKey, oldestHtml] of highlightCache) {
    if (
      highlightCache.size <= HIGHLIGHT_CACHE_MAX_ENTRIES &&
      highlightCacheChars <= HIGHLIGHT_CACHE_MAX_CHARS
    ) {
      break;
    }
    highlightCache.delete(oldestKey);
    highlightCacheChars -= oldestKey.length + oldestHtml.length;
  }
  return html;
}
