const HTML_ESCAPE_REPLACEMENTS: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtmlText(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) => HTML_ESCAPE_REPLACEMENTS[character] ?? character,
  );
}
