import type { ReactNode } from "react";
import { UrlLink } from "@get-bb/plugin-sdk/app";

const INLINE_TOKEN = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(INLINE_TOKEN)) {
    const index = match.index;
    if (index > cursor) {
      nodes.push(text.slice(cursor, index));
    }
    const [whole, bold, code, label, href] = match;
    if (bold !== undefined) {
      nodes.push(
        <strong key={index} className="font-semibold text-foreground">
          {renderInlineMarkdown(bold)}
        </strong>,
      );
    } else if (code !== undefined) {
      nodes.push(
        <code
          key={index}
          className="rounded-sm bg-muted px-1 py-px font-mono text-xs text-foreground"
        >
          {code}
        </code>,
      );
    } else if (label !== undefined && href !== undefined) {
      nodes.push(
        <UrlLink
          key={index}
          href={href}
          className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
        >
          {renderInlineMarkdown(label)}
        </UrlLink>,
      );
    }
    cursor = index + whole.length;
  }
  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  return nodes;
}

export function InlineMarkdown({ text }: { text: string }) {
  return <>{renderInlineMarkdown(text)}</>;
}
