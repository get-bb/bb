import type { UrlTransform } from "streamdown";

const SAFE_MARKDOWN_URL_PROTOCOL_PATTERN = /^(https?|ircs?|mailto|xmpp)$/iu;

/**
 * Keep React Markdown's former default URL policy. Streamdown's exported
 * default transform is pass-through, so BB must reject unsafe schemes before
 * custom anchors or images receive them.
 */
export const safeMarkdownUrlTransform: UrlTransform = (value) => {
  const colon = value.indexOf(":");
  const questionMark = value.indexOf("?");
  const numberSign = value.indexOf("#");
  const slash = value.indexOf("/");

  if (
    colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign) ||
    SAFE_MARKDOWN_URL_PROTOCOL_PATTERN.test(value.slice(0, colon))
  ) {
    return value;
  }

  return "";
};

/** Streamdown still calls its block parser in static mode; avoid that work. */
export function parseStaticMarkdownIntoBlocks(markdown: string): string[] {
  return [markdown];
}
