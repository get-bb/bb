export type MiValue = string | MiValue[] | { readonly [name: string]: MiValue };

export interface MiResultRecord {
  kind: "result";
  token: number | null;
  class: string;
  results: Record<string, MiValue>;
}

export interface MiAsyncRecord {
  kind: "async";
  token: number | null;
  asyncKind: "exec" | "status" | "notify";
  class: string;
  results: Record<string, MiValue>;
}

export interface MiStreamRecord {
  kind: "stream";
  stream: "console" | "target" | "log";
  text: string;
}

export interface MiMalformedRecord {
  kind: "malformed";
  raw: string;
  error: string;
}

export type MiRecord = MiResultRecord | MiAsyncRecord | MiStreamRecord | MiMalformedRecord;

class Cursor {
  index = 0;

  constructor(readonly source: string) {}

  peek(): string | undefined { return this.source[this.index]; }
  take(): string {
    const value = this.source[this.index];
    if (value === undefined) throw new Error("unexpected end of MI record");
    this.index += 1;
    return value;
  }
  consume(value: string): boolean {
    if (this.source.startsWith(value, this.index)) {
      this.index += value.length;
      return true;
    }
    return false;
  }
}

function parseIdentifier(cursor: Cursor): string {
  const start = cursor.index;
  while (/[-A-Za-z0-9_]/u.test(cursor.peek() ?? "")) cursor.index += 1;
  if (cursor.index === start) throw new Error("expected MI identifier");
  return cursor.source.slice(start, cursor.index);
}

function parseCString(cursor: Cursor): string {
  if (cursor.take() !== '"') throw new Error("expected MI string");
  let encoded = "";
  while (true) {
    const next = cursor.take();
    if (next === '"') break;
    if (next !== "\\") {
      encoded += next;
      continue;
    }
    const escaped = cursor.take();
    if (escaped === "n") encoded += "\n";
    else if (escaped === "r") encoded += "\r";
    else if (escaped === "t") encoded += "\t";
    else if (escaped === "b") encoded += "\b";
    else if (escaped === "f") encoded += "\f";
    else if (escaped === "v") encoded += "\v";
    else if (escaped === "\\" || escaped === '"') encoded += escaped;
    else if (/[0-7]/u.test(escaped)) {
      let octal = escaped;
      while (octal.length < 3 && /[0-7]/u.test(cursor.peek() ?? "")) octal += cursor.take();
      encoded += String.fromCodePoint(Number.parseInt(octal, 8));
    } else encoded += escaped;
  }
  return encoded;
}

function parseBare(cursor: Cursor): string {
  const start = cursor.index;
  while (cursor.peek() !== undefined && !",]}".includes(cursor.peek()!)) cursor.index += 1;
  if (cursor.index === start) throw new Error("expected MI value");
  return cursor.source.slice(start, cursor.index);
}

function parseValue(cursor: Cursor): MiValue {
  if (cursor.peek() === '"') return parseCString(cursor);
  if (cursor.consume("{")) {
    const tuple: Record<string, MiValue> = {};
    if (cursor.consume("}")) return tuple;
    while (true) {
      const [name, value] = parseResult(cursor);
      tuple[name] = value;
      if (cursor.consume("}")) return tuple;
      if (!cursor.consume(",")) throw new Error("expected ',' or '}' in MI tuple");
    }
  }
  if (cursor.consume("[")) {
    const list: MiValue[] = [];
    if (cursor.consume("]")) return list;
    while (true) {
      const checkpoint = cursor.index;
      try {
        const [name, value] = parseResult(cursor);
        list.push({ [name]: value });
      } catch {
        cursor.index = checkpoint;
        list.push(parseValue(cursor));
      }
      if (cursor.consume("]")) return list;
      if (!cursor.consume(",")) throw new Error("expected ',' or ']' in MI list");
    }
  }
  return parseBare(cursor);
}

function parseResult(cursor: Cursor): [string, MiValue] {
  const name = parseIdentifier(cursor);
  if (!cursor.consume("=")) throw new Error("expected '=' in MI result");
  return [name, parseValue(cursor)];
}

function parseResults(cursor: Cursor): Record<string, MiValue> {
  const results: Record<string, MiValue> = {};
  while (cursor.consume(",")) {
    const [name, value] = parseResult(cursor);
    results[name] = value;
  }
  if (cursor.peek() !== undefined) throw new Error("unexpected trailing MI data");
  return results;
}

export function parseGdbMiLine(raw: string): MiRecord | null {
  const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
  if (line.length === 0 || line === "(gdb)") return null;
  try {
    const cursor = new Cursor(line);
    const tokenStart = cursor.index;
    while (/\d/u.test(cursor.peek() ?? "")) cursor.index += 1;
    const tokenText = cursor.source.slice(tokenStart, cursor.index);
    const token = tokenText.length > 0 ? Number.parseInt(tokenText, 10) : null;
    const prefix = cursor.take();
    if (prefix === "~" || prefix === "@" || prefix === "&") {
      if (token !== null) throw new Error("stream records cannot have tokens");
      const text = parseCString(cursor);
      if (cursor.peek() !== undefined) throw new Error("unexpected trailing stream data");
      return {
        kind: "stream",
        stream: prefix === "~" ? "console" : prefix === "@" ? "target" : "log",
        text,
      };
    }
    const className = parseIdentifier(cursor);
    if (prefix === "^") return { kind: "result", token, class: className, results: parseResults(cursor) };
    if (prefix === "*" || prefix === "+" || prefix === "=") {
      return {
        kind: "async",
        token,
        asyncKind: prefix === "*" ? "exec" : prefix === "+" ? "status" : "notify",
        class: className,
        results: parseResults(cursor),
      };
    }
    throw new Error(`unknown MI record prefix ${prefix}`);
  } catch (error) {
    return {
      kind: "malformed",
      raw: line,
      error: error instanceof Error ? error.message : "invalid MI record",
    };
  }
}

export class GdbMiParser {
  #buffer = "";

  push(chunk: string): MiRecord[] {
    this.#buffer += chunk;
    const lines = this.#buffer.split("\n");
    this.#buffer = lines.pop() ?? "";
    return lines.flatMap((line) => {
      const record = parseGdbMiLine(line);
      return record ? [record] : [];
    });
  }

  finish(): MiRecord[] {
    if (this.#buffer.length === 0) return [];
    const raw = this.#buffer;
    this.#buffer = "";
    return [{ kind: "malformed", raw, error: "truncated MI record" }];
  }
}

export function parseGdbMi(input: string): MiRecord[] {
  const parser = new GdbMiParser();
  return [...parser.push(input.endsWith("\n") ? input : `${input}\n`), ...parser.finish()];
}
