export interface DotenvReconcileResult {
  content: string;
  added: number;
  updated: number;
  unchanged: number;
}

function assignmentPattern(name: string): RegExp {
  return new RegExp(`^(\\s*(?:export\\s+)?${name}\\s*=\\s*)(.*)$`, "u");
}

export function assertNoDuplicateAssignments(
  content: string,
  names: readonly string[],
): void {
  const lines = content.split(/\r?\n/u);
  for (const name of names) {
    const pattern = assignmentPattern(name);
    const count = lines.filter((line) => pattern.test(line)).length;
    if (count > 1) {
      throw new Error(
        `Dotenv file contains duplicate assignments for ${name}.`,
      );
    }
  }
}

function encodeValue(value: string): string {
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  if (!value.includes('"') && !/\\[nr]/u.test(value)) {
    return `"${value}"`;
  }
  if (value === value.trim() && !value.includes("#")) {
    return value;
  }
  throw new Error(
    "A secret value cannot be represented safely in a single dotenv assignment.",
  );
}

function trailingComment(rest: string): string {
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let index = 0; index < rest.length; index += 1) {
    const character = rest[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quote === '"') {
      escaped = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = quote === character ? null : (quote ?? character);
      continue;
    }
    if (character !== "#" || quote !== null || index === 0) continue;
    if (!/\s/u.test(rest[index - 1] ?? "")) continue;
    let suffixStart = index;
    while (suffixStart > 0 && /\s/u.test(rest[suffixStart - 1] ?? "")) {
      suffixStart -= 1;
    }
    return rest.slice(suffixStart);
  }
  return "";
}

export function reconcileDotenv(
  content: string,
  values: Readonly<Record<string, string>>,
): DotenvReconcileResult {
  const names = Object.keys(values);
  assertNoDuplicateAssignments(content, names);
  const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
  const endedWithNewline = content.endsWith("\n");
  const lines = content.length === 0 ? [] : content.split(/\r?\n/u);
  if (endedWithNewline) lines.pop();

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  const missing = new Set(names);
  const next = lines.map((line) => {
    for (const name of names) {
      const match = assignmentPattern(name).exec(line);
      if (!match) continue;
      missing.delete(name);
      const replacement = `${match[1]}${encodeValue(values[name] ?? "")}${trailingComment(match[2] ?? "")}`;
      if (replacement === line) unchanged += 1;
      else updated += 1;
      return replacement;
    }
    return line;
  });
  for (const name of names) {
    if (!missing.has(name)) continue;
    next.push(`${name}=${encodeValue(values[name] ?? "")}`);
    added += 1;
  }

  const joined = next.join(lineEnding);
  return {
    content:
      joined.length === 0
        ? ""
        : `${joined}${endedWithNewline || added > 0 ? lineEnding : ""}`,
    added,
    updated,
    unchanged,
  };
}
