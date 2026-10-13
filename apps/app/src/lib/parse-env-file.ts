export interface ParsedEnvEntry {
  name: string;
  value: string;
}

export interface ParsedEnvFile {
  entries: ParsedEnvEntry[];
  errors: string[];
}

function unescapeDoubleQuoted(value: string): string {
  return value.replace(/\\(n|r|t|"|\\)/gu, (_match, escaped: string) => {
    if (escaped === "n") return "\n";
    if (escaped === "r") return "\r";
    if (escaped === "t") return "\t";
    return escaped;
  });
}

function stripInlineComment(value: string): string {
  const match = /\s+#/u.exec(value);
  return match ? value.slice(0, match.index) : value;
}

export function parseEnvFile(text: string): ParsedEnvFile {
  const lines = text.split(/\r?\n/u);
  const entries: ParsedEnvEntry[] = [];
  const errors: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const raw = lines[index] ?? "";
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const assignment = /^(?:export\s+)?([^=\s]+)\s*=\s*(.*)$/su.exec(line);
    if (!assignment) {
      errors.push(`Line ${index + 1}: expected NAME=value.`);
      continue;
    }
    const name = assignment[1] ?? "";
    let rest = assignment[2] ?? "";
    const quote = rest.startsWith('"')
      ? '"'
      : rest.startsWith("'")
        ? "'"
        : null;
    if (quote === null) {
      entries.push({ name, value: stripInlineComment(rest).trim() });
      continue;
    }
    rest = rest.slice(1);
    let value = "";
    let closed = false;
    for (;;) {
      let closing = -1;
      let escaped = false;
      for (let position = 0; position < rest.length; position += 1) {
        const character = rest[position];
        if (character === quote && !escaped) {
          closing = position;
          break;
        }
        escaped = quote === '"' && character === "\\" && !escaped;
      }
      if (closing !== -1) {
        const trailing = rest.slice(closing + 1).trim();
        if (trailing !== "" && !trailing.startsWith("#")) {
          errors.push(
            `Line ${lineNumber}: unexpected text after closing quote.`,
          );
        }
        value += rest.slice(0, closing);
        closed = true;
        break;
      }
      value += `${rest}\n`;
      index += 1;
      if (index >= lines.length) break;
      rest = lines[index] ?? "";
    }
    if (!closed) {
      errors.push(`Line ${lineNumber}: unterminated ${quote} quote.`);
      continue;
    }
    entries.push({
      name,
      value: quote === '"' ? unescapeDoubleQuoted(value) : value,
    });
  }
  return { entries, errors };
}
