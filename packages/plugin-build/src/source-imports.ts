interface SourceToken {
  kind: "identifier" | "punctuation" | "string";
  value: string;
}

function sourceTokens(source: string): SourceToken[] {
  const tokens: SourceToken[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index] ?? "";
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      index = source.indexOf("\n", index + 2);
      if (index === -1) break;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      const quote = character;
      let value = "";
      index += 1;
      while (index < source.length) {
        const next = source[index] ?? "";
        if (next === "\\") {
          value += source[index + 1] ?? "";
          index += 2;
          continue;
        }
        if (next === quote) {
          index += 1;
          break;
        }
        value += next;
        index += 1;
      }
      tokens.push({ kind: "string", value });
      continue;
    }
    if (character === "`") {
      index += 1;
      while (index < source.length) {
        const next = source[index] ?? "";
        if (next === "\\") index += 2;
        else if (next === "`") {
          index += 1;
          break;
        } else index += 1;
      }
      continue;
    }
    if (/[A-Za-z0-9_$]/u.test(character)) {
      const start = index;
      index += 1;
      while (/[A-Za-z0-9_$]/u.test(source[index] ?? "")) index += 1;
      tokens.push({
        kind: "identifier",
        value: source.slice(start, index),
      });
      continue;
    }
    tokens.push({ kind: "punctuation", value: character });
    index += 1;
  }
  return tokens;
}

interface SourceImport {
  specifier: string;
  fromClause: boolean;
  names: string[];
}

export function sourceImports(source: string): SourceImport[] {
  const tokens = sourceTokens(source);
  const imports: SourceImport[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.kind !== "string") continue;
    const previous = tokens[index - 1]?.value;
    const callee = previous === "(" ? tokens[index - 2]?.value : undefined;
    if (
      previous === "from" ||
      previous === "import" ||
      callee === "import" ||
      callee === "require"
    ) {
      imports.push({
        specifier: token.value,
        fromClause: previous === "from",
        names: importedNames(tokens, index),
      });
    }
  }
  return imports;
}

function importedNames(tokens: SourceToken[], index: number): string[] {
  if (tokens[index - 1]?.value !== "from") {
    const next = tokens[index + 1]?.value;
    return tokens[index - 1]?.value === "import" || next === ")" || next === ","
      ? ["*"]
      : [];
  }
  let start = index - 2;
  while (start >= 0) {
    const candidate = tokens[start];
    if (
      candidate?.kind === "identifier" &&
      (candidate.value === "import" || candidate.value === "export")
    ) {
      break;
    }
    start -= 1;
  }
  if (start < 0) return [];
  const clause = tokens.slice(start + 1, index - 1);
  if (
    clause[0]?.kind === "identifier" &&
    clause[0].value === "type" &&
    clause.length > 1 &&
    clause[1]?.value !== ","
  ) {
    return [];
  }
  const names: string[] = [];
  let braceDepth = 0;
  let entry: SourceToken[] = [];
  let previousTopLevel: SourceToken | undefined;
  const flushEntry = () => {
    const first = entry[0];
    if (first !== undefined) {
      const typeOnly =
        first.kind === "identifier" &&
        first.value === "type" &&
        entry.length > 1 &&
        entry[1]?.value !== "as";
      if (!typeOnly) names.push(first.value);
    }
    entry = [];
  };
  for (const item of clause) {
    if (item.kind === "punctuation" && item.value === "{") {
      braceDepth += 1;
      continue;
    }
    if (item.kind === "punctuation" && item.value === "}") {
      flushEntry();
      braceDepth -= 1;
      continue;
    }
    if (item.kind === "punctuation" && item.value === ",") {
      if (braceDepth > 0) flushEntry();
      continue;
    }
    if (braceDepth > 0) {
      entry.push(item);
      continue;
    }
    if (item.kind === "punctuation" && item.value === "*") {
      names.push("*");
    } else if (
      item.kind === "identifier" &&
      item.value !== "as" &&
      previousTopLevel?.value !== "as"
    ) {
      names.push("default");
    }
    previousTopLevel = item;
  }
  return names;
}
