import { highlight, type LanguageName } from "sugar-high";
import { lang } from "sugar-high/lang";

function getExtraLanguageAlias(language: string): LanguageName | undefined {
  switch (language) {
    case "console":
    case "shellscript":
      return "shell";
    case "h":
      return "c";
    case "hpp":
    case "hh":
    case "hxx":
      return "cpp";
    case "less":
      return "css";
    default:
      return undefined;
  }
}

interface HighlightMarkdownCodeArgs {
  code: string;
  language: string | null;
}

export function highlightMarkdownCode({
  code,
  language,
}: HighlightMarkdownCodeArgs): string {
  const resolved =
    language === null
      ? undefined
      : (lang(language) ?? getExtraLanguageAlias(language));
  return highlight(code, { lang: resolved });
}
