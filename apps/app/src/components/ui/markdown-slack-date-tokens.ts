import type { Html, Root, Text } from "mdast";
import { SKIP, visit } from "unist-util-visit";

const TOKEN = /^<!date\^(\d+)\^([^|^>]*)(?:\^[^|>]*)?(?:\|[^>]*)?>$/u;
const SECONDS = /\{time_secs[^}]*\}/u;
const TIME = /\{time[^}]*\}/u;
const DATE = /\{date[^}]*\}/u;

export function formatSlackDateToken(token: string): string | null {
  const match = TOKEN.exec(token);
  if (match === null) {
    return null;
  }
  const seconds = Number(match[1]);
  if (!Number.isSafeInteger(seconds)) {
    return null;
  }
  const timestamp = new Date(seconds * 1000);
  if (Number.isNaN(timestamp.getTime())) {
    return null;
  }
  const format = match[2] ?? "";
  const withSeconds = SECONDS.test(format);
  const withTime = withSeconds || TIME.test(format);
  if (!withTime && !DATE.test(format)) {
    return null;
  }
  const iso = timestamp.toISOString();
  const date = iso.slice(0, 10);
  if (!withTime) {
    return date;
  }
  const time = withSeconds ? iso.slice(11, 19) : iso.slice(11, 16);
  return `${date} ${time} UTC`;
}

export function remarkSlackDateTokens() {
  return (tree: Root) => {
    visit(tree, "html", (node: Html, index, parent) => {
      const formatted = formatSlackDateToken(node.value);
      if (formatted === null || index === undefined || parent === undefined) {
        return;
      }
      const replacement: Text = { type: "text", value: formatted };
      parent.children[index] = replacement;
      return SKIP;
    });
  };
}
