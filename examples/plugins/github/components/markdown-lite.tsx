// A tiny zero-dependency markdown renderer for issue/comment bodies.
// Supports: # headings, paragraphs, fenced code blocks, - lists,
// `inline code`, **bold**, *italic*, [links](url), ![images](url), and raw
// `<img …>` tags (GitHub's attachment uploader emits HTML img tags, not
// markdown). Everything is built as React elements — img attributes are
// extracted and whitelisted, so no HTML is ever injected.
import { cn } from "@/lib/utils";

const INLINE_PATTERN =
  // Image forms first: `![…](…)` must win over the link pattern (which
  // would otherwise match its tail), and `<img …>` before generic text.
  /(!\[[^\]]*\]\([^)\s]+\))|(<img\s[^>]*?\/?>)|(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)\s]+\))/g;

/** Extract a quoted attribute from a raw `<img …>` tag. */
function imgAttribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
  return match?.[1];
}

/**
 * Safe image element from an alt/src pair (+ optional intrinsic size from a
 * raw img tag). Only http(s) sources render — anything else falls back to
 * the original text. `h-auto`/`max-w-full` keep clamped images undistorted.
 */
function renderImage(
  key: number,
  src: string | undefined,
  alt: string,
  raw: string,
  width?: string,
  height?: string,
): React.ReactNode {
  if (!src || !/^https?:\/\//.test(src)) return raw;
  return (
    <img
      key={key}
      src={src}
      alt={alt}
      loading="lazy"
      {...(width && /^\d+$/.test(width) ? { width: Number(width) } : {})}
      {...(height && /^\d+$/.test(height) ? { height: Number(height) } : {})}
      className="my-1 inline-block h-auto max-w-full rounded-md border border-border"
    />
  );
}

function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    const token = match[0];
    if (token.startsWith("![")) {
      const closeBracket = token.indexOf("](");
      nodes.push(
        renderImage(
          key++,
          token.slice(closeBracket + 2, -1),
          token.slice(2, closeBracket),
          token,
        ),
      );
    } else if (token.startsWith("<img")) {
      nodes.push(
        renderImage(
          key++,
          imgAttribute(token, "src"),
          imgAttribute(token, "alt") ?? "",
          token,
          imgAttribute(token, "width"),
          imgAttribute(token, "height"),
        ),
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code
          key={key++}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else {
      const closeBracket = token.indexOf("](");
      const label = token.slice(1, closeBracket);
      const href = token.slice(closeBracket + 2, -1);
      nodes.push(
        <a
          key={key++}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline underline-offset-2"
        >
          {renderInline(label)}
        </a>,
      );
    }
    last = index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const HEADING_CLASSES = [
  "text-lg font-semibold",
  "text-base font-semibold",
  "text-sm font-semibold",
];

export function Markdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    const fence = line.match(/^```/);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing fence (or end of input)
      blocks.push(
        <pre
          key={key++}
          className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs"
        >
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 3);
      const Tag = `h${heading[1].length <= 3 ? heading[1].length : 4}` as
        | "h1"
        | "h2"
        | "h3"
        | "h4";
      blocks.push(
        <Tag key={key++} className={HEADING_CLASSES[level - 1]}>
          {renderInline(heading[2])}
        </Tag>,
      );
      i++;
      continue;
    }
    if (/^\s*-\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        items.push(
          <li key={key++}>{renderInline(lines[i].replace(/^\s*-\s+/, ""))}</li>,
        );
        i++;
      }
      blocks.push(
        <ul key={key++} className="list-disc space-y-1 pl-5">
          {items}
        </ul>,
      );
      continue;
    }
    // Paragraph: absorb consecutive non-empty, non-block lines.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*-\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="whitespace-pre-wrap break-words">
        {renderInline(para.join("\n"))}
      </p>,
    );
  }
  return <div className={cn("space-y-3", className)}>{blocks}</div>;
}
