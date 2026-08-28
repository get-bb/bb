const HTML_ESCAPE_REPLACEMENTS = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
  ["'", "&#39;"],
]);

export function escapeHtmlText(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) => HTML_ESCAPE_REPLACEMENTS.get(character) ?? character,
  );
}
