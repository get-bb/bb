import { Fragment } from "react";
import type { ReactNode } from "react";

type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; children: InlineToken[] };

function appendText(tokens: InlineToken[], text: string): void {
  if (!text) {
    return;
  }
  const previous = tokens.at(-1);
  if (previous?.kind === "text") {
    previous.text += text;
    return;
  }
  tokens.push({ kind: "text", text });
}

function parseInline(text: string, allowStrong: boolean): InlineToken[] {
  const tokens: InlineToken[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const codeStart = text.indexOf("`", cursor);
    const strongStart = allowStrong ? text.indexOf("**", cursor) : -1;
    const tokenStart =
      codeStart === -1
        ? strongStart
        : strongStart === -1
          ? codeStart
          : Math.min(codeStart, strongStart);

    if (tokenStart === -1) {
      appendText(tokens, text.slice(cursor));
      break;
    }

    appendText(tokens, text.slice(cursor, tokenStart));
    const isCode = tokenStart === codeStart;
    const delimiter = isCode ? "`" : "**";
    const contentStart = tokenStart + delimiter.length;
    const tokenEnd = text.indexOf(delimiter, contentStart);

    if (tokenEnd === -1) {
      appendText(tokens, delimiter);
      cursor = contentStart;
      continue;
    }

    const content = text.slice(contentStart, tokenEnd);
    if (isCode) {
      tokens.push({ kind: "code", text: content });
    } else {
      tokens.push({
        kind: "strong",
        children: parseInline(content, false),
      });
    }
    cursor = tokenEnd + delimiter.length;
  }

  return tokens;
}

function renderTokens(tokens: InlineToken[]): ReactNode {
  return tokens.map((token, index) => {
    switch (token.kind) {
      case "code":
        return <code key={index}>{token.text}</code>;
      case "strong":
        return <strong key={index}>{renderTokens(token.children)}</strong>;
      case "text":
        return <Fragment key={index}>{token.text}</Fragment>;
    }
  });
}

export function ChangelogInline({ text }: { text: string }): ReactNode {
  return renderTokens(parseInline(text, true));
}
