import type { PhrasingContent, Text } from "mdast";

export function replaceTextMatches(
  node: Text,
  pattern: RegExp,
  toNode: (match: RegExpExecArray) => PhrasingContent | null,
): PhrasingContent[] {
  const { value } = node;
  pattern.lastIndex = 0;
  const replacements: PhrasingContent[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    const replacement = toNode(match);
    if (replacement === null) {
      continue;
    }
    if (match.index > cursor) {
      replacements.push({
        type: "text",
        value: value.slice(cursor, match.index),
      });
    }
    replacements.push(replacement);
    cursor = match.index + match[0].length;
  }
  if (replacements.length === 0) {
    return [node];
  }
  if (cursor < value.length) {
    replacements.push({ type: "text", value: value.slice(cursor) });
  }
  return replacements;
}
