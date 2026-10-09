import { useBbNavigate } from "@get-bb/plugin-sdk/app";

const LEADING_BOLD = /^\*\*(.+?)\*\*\s*(.*)$/s;

function plainText(markdown: string): string {
  return markdown
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function trimEndPunctuation(text: string): string {
  return text.replace(/[\s.:;,!]+$/, "");
}

export interface HighlightSubject {
  title: string;
  text: string | null;
}

export function highlightSubject(item: string): HighlightSubject {
  const match = LEADING_BOLD.exec(item.trim());
  if (match === null) {
    return { title: trimEndPunctuation(plainText(item)), text: null };
  }
  const [, bold = "", remainder = ""] = match;
  const titled = /[.:]$/.test(bold) || /^[.:]/.test(remainder);
  const title = trimEndPunctuation(plainText(bold));
  const text = trimEndPunctuation(
    plainText(titled ? remainder.replace(/^[.:]\s*/, "") : item),
  );
  return { title, text: text === "" ? null : text };
}

export function highlightWalkthroughPrompt(item: string): string {
  const { title, text } = highlightSubject(item);
  const subject = text === null ? title : `${title}: ${text}`;
  return `Walk me through ${subject} in this bb, one step at a time, and check each step with me. If the interactive_answer tool is available, show the steps as an interactive answer; otherwise reply with plain numbered steps.`;
}

export function ShowMeAction({ item }: { item: string }) {
  const navigate = useBbNavigate();
  const { title } = highlightSubject(item);
  return (
    <button
      type="button"
      data-whats-new-show-me
      aria-label={`Show me ${title}`}
      onClick={() =>
        navigate.toCompose({
          initialPrompt: highlightWalkthroughPrompt(item),
          focusPrompt: true,
        })
      }
      className="ml-1.5 inline cursor-pointer whitespace-nowrap rounded-sm text-xs text-subtle-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      Show me
    </button>
  );
}
