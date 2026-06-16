export interface GetMarkdownCodeLanguageArgs {
  className: string | undefined;
}

export interface IsMarkdownCodeBlockArgs {
  codeText: string;
  language: string | null;
}

const MARKDOWN_CODE_LANGUAGE_CLASS_PREFIX = "language-";

export function getMarkdownCodeLanguage({
  className,
}: GetMarkdownCodeLanguageArgs): string | null {
  const classNames = className?.split(/\s+/u) ?? [];
  for (const classNamePart of classNames) {
    if (!classNamePart.startsWith(MARKDOWN_CODE_LANGUAGE_CLASS_PREFIX)) {
      continue;
    }

    const language = classNamePart
      .slice(MARKDOWN_CODE_LANGUAGE_CLASS_PREFIX.length)
      .trim();
    return language.length > 0 ? language.toLowerCase() : null;
  }
  return null;
}

export function isMarkdownCodeBlock({
  codeText,
  language,
}: IsMarkdownCodeBlockArgs): boolean {
  return language !== null || codeText.includes("\n");
}
