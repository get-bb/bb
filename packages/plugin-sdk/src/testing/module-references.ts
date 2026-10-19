export interface ModuleReference {
  specifier: string;
  dynamic: boolean;
}

interface Token {
  kind: "name" | "string" | "punct" | "literal";
  value: string;
  start: number;
  end: number;
}

class JsxMismatch extends Error {}

const IDENTIFIER_START = /[\p{ID_Start}$_]/u;
const IDENTIFIER_PART = /[\p{ID_Continue}$‌‍]/u;
const JSX_NAME_PART = /[\p{ID_Continue}$\-:.]/u;
const NUMBER_PART = /[\w.]/u;
const WHITESPACE = /\s/u;
const MULTI_CHARACTER_PUNCTUATORS = ["...", "?.", "=>", "++", "--"];
const KEYWORDS_BEFORE_EXPRESSION = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);
const DECLARATION_MODIFIERS = new Set(["type", "typeof", "defer", "source"]);

function tokenize(source: string, jsx: boolean): Token[] {
  const tokens: Token[] = [];
  let pos = source.startsWith("#!")
    ? source.indexOf("\n") + 1 || source.length
    : 0;

  const push = (kind: Token["kind"], value: string, start: number): void => {
    tokens.push({ kind, value, start, end: pos });
  };

  const expressionMayStart = (): boolean => {
    const last = tokens.at(-1);
    if (last === undefined) return true;
    if (last.kind === "punct") {
      return ![")", "]", "++", "--"].includes(last.value);
    }
    return last.kind === "name" && KEYWORDS_BEFORE_EXPRESSION.has(last.value);
  };

  const skipComment = (): boolean => {
    if (source[pos] !== "/") return false;
    if (source[pos + 1] === "/") {
      const newline = source.indexOf("\n", pos);
      pos = newline === -1 ? source.length : newline;
      return true;
    }
    if (source[pos + 1] === "*") {
      const close = source.indexOf("*/", pos + 2);
      pos = close === -1 ? source.length : close + 2;
      return true;
    }
    return false;
  };

  const readString = (): void => {
    const start = pos;
    const quote = source[pos];
    pos++;
    while (pos < source.length) {
      const char = source[pos];
      if (char === "\\") {
        pos += 2;
        continue;
      }
      if (char === "\n") break;
      if (char === quote) {
        pos++;
        push("string", source.slice(start + 1, pos - 1), start);
        return;
      }
      pos++;
    }
    push("literal", source.slice(start, pos), start);
  };

  const readTemplate = (): void => {
    push("literal", "`", pos);
    pos++;
    while (pos < source.length) {
      const char = source[pos];
      if (char === "\\") {
        pos += 2;
        continue;
      }
      if (char === "`") {
        pos++;
        break;
      }
      if (char === "$" && source[pos + 1] === "{") {
        pos += 2;
        scan(true);
        continue;
      }
      pos++;
    }
    push("literal", "`", pos);
  };

  const readRegex = (): void => {
    const start = pos;
    let inClass = false;
    pos++;
    while (pos < source.length) {
      const char = source[pos];
      if (char === "\\") {
        pos += 2;
        continue;
      }
      if (char === "\n") break;
      pos++;
      if (inClass) {
        if (char === "]") inClass = false;
      } else if (char === "[") {
        inClass = true;
      } else if (char === "/") {
        while (pos < source.length && IDENTIFIER_PART.test(source[pos] ?? "")) {
          pos++;
        }
        break;
      }
    }
    push("literal", source.slice(start, pos), start);
  };

  const readWhile = (pattern: RegExp): string => {
    const start = pos;
    while (pos < source.length && pattern.test(source[pos] ?? "")) pos++;
    return source.slice(start, pos);
  };

  const skipJsxSpace = (): void => {
    while (pos < source.length) {
      if (WHITESPACE.test(source[pos] ?? "")) {
        pos++;
      } else if (!skipComment()) {
        return;
      }
    }
  };

  const readJsxName = (): string =>
    IDENTIFIER_START.test(source[pos] ?? "") ? readWhile(JSX_NAME_PART) : "";

  const readJsxContainer = (): void => {
    push("punct", "{", pos);
    pos++;
    if (!scan(true)) throw new JsxMismatch();
    push("punct", "}", pos - 1);
  };

  const readJsxElement = (): void => {
    const start = pos;
    pos++;
    skipJsxSpace();
    const name = readJsxName();
    skipJsxSpace();
    if (name === "" && source[pos] !== ">") throw new JsxMismatch();
    if (
      source[pos] === "," ||
      (source.startsWith("extends", pos) &&
        !IDENTIFIER_PART.test(source[pos + "extends".length] ?? ""))
    ) {
      throw new JsxMismatch();
    }
    push("literal", "<", start);
    for (;;) {
      skipJsxSpace();
      const char = source[pos];
      if (char === "/" && source[pos + 1] === ">") {
        pos += 2;
        return;
      }
      if (char === ">") {
        pos++;
        break;
      }
      if (char === "{") {
        readJsxContainer();
        continue;
      }
      if (readJsxName() === "") throw new JsxMismatch();
      skipJsxSpace();
      if (source[pos] !== "=") continue;
      pos++;
      skipJsxSpace();
      const value = source[pos];
      if (value === '"' || value === "'") {
        const close = source.indexOf(value, pos + 1);
        if (close === -1) throw new JsxMismatch();
        pos = close + 1;
      } else if (value === "{") {
        readJsxContainer();
      } else if (value === "<") {
        readJsxElement();
      } else {
        throw new JsxMismatch();
      }
    }
    while (pos < source.length) {
      const char = source[pos];
      if (char === "{") {
        readJsxContainer();
      } else if (char === "<") {
        const tagStart = pos;
        pos++;
        skipJsxSpace();
        if (source[pos] !== "/") {
          pos = tagStart;
          readJsxElement();
          continue;
        }
        pos++;
        skipJsxSpace();
        const closing = readJsxName();
        skipJsxSpace();
        if (closing !== name || source[pos] !== ">") throw new JsxMismatch();
        pos++;
        return;
      } else {
        pos++;
      }
    }
    throw new JsxMismatch();
  };

  const tryJsx = (): boolean => {
    const savedPos = pos;
    const savedLength = tokens.length;
    try {
      readJsxElement();
      return true;
    } catch (error) {
      if (!(error instanceof JsxMismatch)) throw error;
      pos = savedPos;
      tokens.length = savedLength;
      return false;
    }
  };

  function scan(untilClosingBrace: boolean): boolean {
    let depth = 0;
    while (pos < source.length) {
      const char = source[pos] ?? "";
      const start = pos;
      if (WHITESPACE.test(char) || skipComment()) {
        if (pos === start) pos++;
      } else if (char === '"' || char === "'") {
        readString();
      } else if (char === "`") {
        readTemplate();
      } else if (char === "/" && expressionMayStart()) {
        readRegex();
      } else if (char === "<" && jsx && expressionMayStart() && tryJsx()) {
        continue;
      } else if (
        /\d/u.test(char) ||
        (char === "." && /\d/u.test(source[pos + 1] ?? ""))
      ) {
        push("literal", readWhile(NUMBER_PART), start);
      } else if (IDENTIFIER_START.test(char)) {
        push("name", readWhile(IDENTIFIER_PART), start);
      } else {
        if (char === "{") depth++;
        if (char === "}") {
          if (depth === 0 && untilClosingBrace) {
            pos++;
            return true;
          }
          depth--;
        }
        const punct =
          MULTI_CHARACTER_PUNCTUATORS.find(
            (candidate) =>
              source.startsWith(candidate, pos) &&
              !(candidate === "?." && /\d/u.test(source[pos + 2] ?? "")),
          ) ?? char;
        pos += punct.length;
        push("punct", punct, start);
      }
    }
    return false;
  }

  scan(false);
  return tokens;
}

function isPunct(token: Token | undefined, value: string): boolean {
  return token?.kind === "punct" && token.value === value;
}

function isName(token: Token | undefined, value?: string): boolean {
  return (
    token?.kind === "name" && (value === undefined || token.value === value)
  );
}

function closingIndex(
  tokens: readonly Token[],
  open: number,
  opener: string,
  closer: string,
): number {
  let depth = 0;
  for (let index = open; index < tokens.length; index++) {
    if (isPunct(tokens[index], opener)) depth++;
    if (isPunct(tokens[index], closer) && --depth === 0) return index;
  }
  return -1;
}

function specifierAfterFrom(
  tokens: readonly Token[],
  index: number,
): string | undefined {
  const specifier = tokens[index + 1];
  return isName(tokens[index], "from") && specifier?.kind === "string"
    ? specifier.value
    : undefined;
}

function importDeclarationSpecifier(
  tokens: readonly Token[],
  keyword: number,
): string | undefined {
  let index = keyword + 1;
  const first = tokens[index];
  if (first?.kind === "string") return first.value;
  const afterModifier = tokens[index + 1];
  if (
    first?.kind === "name" &&
    DECLARATION_MODIFIERS.has(first.value) &&
    (isPunct(afterModifier, "{") ||
      isPunct(afterModifier, "*") ||
      (isName(afterModifier) && afterModifier?.value !== "from"))
  ) {
    index++;
  }
  if (isName(tokens[index])) {
    index++;
    if (!isPunct(tokens[index], ",")) return specifierAfterFrom(tokens, index);
    index++;
  }
  if (isPunct(tokens[index], "{")) {
    const close = closingIndex(tokens, index, "{", "}");
    return close === -1 ? undefined : specifierAfterFrom(tokens, close + 1);
  }
  if (isPunct(tokens[index], "*") && isName(tokens[index + 1], "as")) {
    return specifierAfterFrom(tokens, index + 3);
  }
  return undefined;
}

function exportDeclarationSpecifier(
  tokens: readonly Token[],
  keyword: number,
): string | undefined {
  let index = keyword + 1;
  if (isName(tokens[index], "type")) index++;
  if (isPunct(tokens[index], "*")) {
    return isName(tokens[index + 1], "as")
      ? specifierAfterFrom(tokens, index + 3)
      : specifierAfterFrom(tokens, index + 1);
  }
  if (isPunct(tokens[index], "{")) {
    const close = closingIndex(tokens, index, "{", "}");
    return close === -1 ? undefined : specifierAfterFrom(tokens, close + 1);
  }
  return undefined;
}

export function moduleReferences(
  source: string,
  options: { jsx: boolean },
): ModuleReference[] {
  const tokens = tokenize(source, options.jsx);
  const references: ModuleReference[] = [];
  tokens.forEach((token, index) => {
    if (token.kind !== "name") return;
    const previous = tokens[index - 1];
    if ([".", "?.", "#"].some((value) => isPunct(previous, value))) return;
    const keyword = token.value;
    if (
      (keyword === "import" || keyword === "require") &&
      isPunct(tokens[index + 1], "(")
    ) {
      const close = closingIndex(tokens, index + 1, "(", ")");
      const after = tokens[close + 1];
      if (
        close === -1 ||
        close === index + 2 ||
        isPunct(after, "{") ||
        (isPunct(after, ":") && !isPunct(previous, "?"))
      ) {
        return;
      }
      const argument = tokens[index + 2];
      const argumentEnd = tokens[index + 3];
      if (
        argument?.kind === "string" &&
        (isPunct(argumentEnd, ")") || isPunct(argumentEnd, ","))
      ) {
        references.push({ specifier: argument.value, dynamic: false });
        return;
      }
      const open = tokens[index + 1];
      const closeToken = tokens[close];
      if (open === undefined || closeToken === undefined) return;
      references.push({
        specifier: source.slice(open.end, closeToken.start).trim(),
        dynamic: true,
      });
      return;
    }
    const specifier =
      keyword === "import"
        ? importDeclarationSpecifier(tokens, index)
        : keyword === "export"
          ? exportDeclarationSpecifier(tokens, index)
          : undefined;
    if (specifier !== undefined) {
      references.push({ specifier, dynamic: false });
    }
  });
  return references;
}
