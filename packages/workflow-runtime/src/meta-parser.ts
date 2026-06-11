// Pure-literal parsing for a workflow file's `meta` object literal, plus the
// `parseWorkflow` brace-scan that splits a workflow file into meta + body. This replaces
// omegacode's throwaway-vm evaluation: the value is recovered by a recursive-descent parser that
// accepts ONLY literals (strings, numbers, booleans, null, arrays, nested objects), so validating
// a workflow never executes author code — an IIFE or computed expression in meta is rejected
// structurally. The parsed value is then validated by `metaSchema` (all 7 meta fields —
// omegacode's `validateMeta` checked only name + description).
//
// Deliberately vm-free: this module (not sandbox.ts) is what server-side validation loads via
// the `@bb/workflow-runtime/validation` subpath, keeping node:vm out of the server's module
// graph entirely.

import { z } from "zod";
import { metaSchema, type Meta } from "./dsl-types.js";

export class WorkflowSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowSyntaxError";
  }
}

/** A value representable by a pure JS literal — the only shapes a meta literal may contain. */
export type MetaLiteralValue =
  | string
  | number
  | boolean
  | null
  | MetaLiteralValue[]
  | { [key: string]: MetaLiteralValue };

/** Parse a meta literal source (`{ … }`) into a validated `Meta` — without executing it. */
export function parseMeta(metaSrc: string): Meta {
  const value = parseMetaLiteral(metaSrc);
  const result = metaSchema.safeParse(value);
  if (!result.success) {
    throw new WorkflowSyntaxError(
      `invalid meta: ${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

/** Parse a source string containing exactly one pure literal. Throws `WorkflowSyntaxError`. */
export function parseMetaLiteral(src: string): MetaLiteralValue {
  return new LiteralParser(src).parse();
}

const PURE_LITERAL_MESSAGE = "meta must be a pure literal";

const IDENTIFIER_START = /[A-Za-z_$]/;
const IDENTIFIER_CONTINUE = /[A-Za-z0-9_$]/;
const NUMBER_PATTERN = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;

class LiteralParser {
  private pos = 0;

  constructor(private readonly src: string) {}

  parse(): MetaLiteralValue {
    this.skipNonTokens();
    const value = this.parseValue();
    this.skipNonTokens();
    if (this.pos < this.src.length) this.fail("unexpected trailing content");
    return value;
  }

  private fail(detail: string): never {
    throw new WorkflowSyntaxError(
      `${PURE_LITERAL_MESSAGE} (${detail} at offset ${this.pos})`,
    );
  }

  /** Advance past whitespace plus line and block comments. */
  private skipNonTokens(): void {
    while (this.pos < this.src.length) {
      const c = this.src[this.pos];
      if (c === " " || c === "\t" || c === "\r" || c === "\n") {
        this.pos += 1;
        continue;
      }
      if (c === "/" && this.src[this.pos + 1] === "/") {
        const nl = this.src.indexOf("\n", this.pos);
        this.pos = nl < 0 ? this.src.length : nl;
        continue;
      }
      if (c === "/" && this.src[this.pos + 1] === "*") {
        const end = this.src.indexOf("*/", this.pos + 2);
        if (end < 0) this.fail("unterminated comment");
        this.pos = end + 2;
        continue;
      }
      break;
    }
  }

  private parseValue(): MetaLiteralValue {
    const c = this.src[this.pos];
    if (c === undefined) this.fail("unexpected end of input");
    if (c === "{") return this.parseObject();
    if (c === "[") return this.parseArray();
    if (c === '"' || c === "'" || c === "`") return this.parseString();
    if (c === "-" || c === "." || (c >= "0" && c <= "9"))
      return this.parseNumber();
    if (IDENTIFIER_START.test(c)) return this.parseKeyword();
    this.fail(`unexpected token \`${c}\``);
  }

  private parseObject(): MetaLiteralValue {
    this.pos += 1; // consume `{`
    const result: { [key: string]: MetaLiteralValue } = {};
    for (;;) {
      this.skipNonTokens();
      if (this.src[this.pos] === "}") {
        this.pos += 1;
        return result;
      }
      const key = this.parseObjectKey();
      this.skipNonTokens();
      // A missing `:` means shorthand properties, methods, or spreads — all non-literal.
      if (this.src[this.pos] !== ":")
        this.fail("expected `:` after object key");
      this.pos += 1;
      this.skipNonTokens();
      result[key] = this.parseValue();
      this.skipNonTokens();
      const sep = this.src[this.pos];
      if (sep === ",") {
        this.pos += 1; // trailing commas handled by the `}` check at loop top
        continue;
      }
      if (sep === "}") {
        this.pos += 1;
        return result;
      }
      this.fail("expected `,` or `}` in object literal");
    }
  }

  private parseObjectKey(): string {
    const c = this.src[this.pos];
    if (c === undefined) this.fail("unexpected end of input");
    const key =
      c === '"' || c === "'"
        ? this.parseString()
        : IDENTIFIER_START.test(c)
          ? this.parseIdentifier()
          : this.failObjectKey(c);
    // Assigning a `__proto__` key would set the result's prototype instead of
    // an own property — invisible to strictObject's unknown-key check while
    // field reads pick up the smuggled values. Checked on the DECODED key so
    // escaped spellings ("__proto__") are caught too.
    if (key === "__proto__") this.fail("`__proto__` keys are not allowed");
    return key;
  }

  private failObjectKey(c: string): never {
    if (c === "`") this.fail("template-literal keys are not allowed");
    if (c === "[") this.fail("computed keys are not allowed");
    if (c === ".") this.fail("spreads are not allowed");
    this.fail(`unexpected token \`${c}\` in object key`);
  }

  private parseIdentifier(): string {
    const start = this.pos;
    while (
      this.pos < this.src.length &&
      IDENTIFIER_CONTINUE.test(this.src[this.pos])
    ) {
      this.pos += 1;
    }
    return this.src.slice(start, this.pos);
  }

  private parseArray(): MetaLiteralValue {
    this.pos += 1; // consume `[`
    const result: MetaLiteralValue[] = [];
    for (;;) {
      this.skipNonTokens();
      const c = this.src[this.pos];
      if (c === "]") {
        this.pos += 1;
        return result;
      }
      if (c === ",") this.fail("array elisions are not allowed");
      result.push(this.parseValue());
      this.skipNonTokens();
      const sep = this.src[this.pos];
      if (sep === ",") {
        this.pos += 1; // trailing commas handled by the `]` check at loop top
        continue;
      }
      if (sep === "]") {
        this.pos += 1;
        return result;
      }
      this.fail("expected `,` or `]` in array literal");
    }
  }

  private parseString(): string {
    const quote = this.src[this.pos];
    this.pos += 1;
    let out = "";
    while (this.pos < this.src.length) {
      const c = this.src[this.pos];
      if (c === quote) {
        this.pos += 1;
        return out;
      }
      if (c === "\\") {
        this.pos += 1;
        out += this.decodeEscape();
        continue;
      }
      if (quote === "`" && c === "$" && this.src[this.pos + 1] === "{") {
        this.fail("template substitutions are not allowed");
      }
      if (quote !== "`" && (c === "\n" || c === "\r")) {
        this.fail("unterminated string literal");
      }
      out += c;
      this.pos += 1;
    }
    this.fail("unterminated string literal");
  }

  /** Decode one escape sequence; `pos` points at the char after the backslash. */
  private decodeEscape(): string {
    const c = this.src[this.pos];
    if (c === undefined) this.fail("unterminated string literal");
    this.pos += 1;
    switch (c) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "v":
        return "\v";
      case "0":
        return "\0";
      case "x":
        return this.decodeHexEscape(2);
      case "u":
        return this.decodeUnicodeEscape();
      case "\n":
        return ""; // line continuation
      case "\r":
        if (this.src[this.pos] === "\n") this.pos += 1;
        return ""; // line continuation
      default:
        return c; // \" \' \` \\ and any other escaped char decode to the char itself
    }
  }

  private decodeHexEscape(digits: number): string {
    const hex = this.src.slice(this.pos, this.pos + digits);
    if (hex.length < digits || !/^[0-9a-fA-F]+$/.test(hex)) {
      this.fail("invalid escape sequence");
    }
    this.pos += digits;
    return String.fromCodePoint(parseInt(hex, 16));
  }

  private decodeUnicodeEscape(): string {
    if (this.src[this.pos] !== "{") return this.decodeHexEscape(4);
    const end = this.src.indexOf("}", this.pos + 1);
    if (end < 0) this.fail("invalid escape sequence");
    const hex = this.src.slice(this.pos + 1, end);
    if (hex.length === 0 || !/^[0-9a-fA-F]+$/.test(hex))
      this.fail("invalid escape sequence");
    const codePoint = parseInt(hex, 16);
    if (codePoint > 0x10ffff) this.fail("invalid escape sequence");
    this.pos = end + 1;
    return String.fromCodePoint(codePoint);
  }

  private parseNumber(): number {
    const match = NUMBER_PATTERN.exec(this.src.slice(this.pos));
    if (!match) this.fail("invalid number literal");
    const next = this.src[this.pos + match[0].length];
    // `5x`, `1n`, hex/binary/octal forms, and numeric separators are not supported.
    if (next !== undefined && IDENTIFIER_CONTINUE.test(next)) {
      this.fail("invalid number literal");
    }
    this.pos += match[0].length;
    return Number(match[0]);
  }

  private parseKeyword(): MetaLiteralValue {
    const start = this.pos;
    const word = this.parseIdentifier();
    if (word === "true") return true;
    if (word === "false") return false;
    if (word === "null") return null;
    this.pos = start;
    this.fail(`identifiers are not allowed (\`${word}\`)`);
  }
}

export interface ParsedWorkflow {
  meta: Meta;
  body: string;
}

/**
 * Extract the leading `export const meta = {...}` literal and return it + the
 * remaining body. Pure lexing + the literal parser above — never executes
 * author code, never touches node:vm — so server-side validation and the
 * runner child consume the exact same parse (server-accepted ==
 * daemon-runnable by construction).
 */
export function parseWorkflow(source: string): ParsedWorkflow {
  // `export const meta` must be the FIRST statement — only whitespace and comments may precede it.
  // Anchoring to the file start prevents silently discarding code that appears before a non-leading
  // meta declaration (the body slice below begins right after the meta literal).
  const lead = leadingNonCodeLength(source);
  const after = source.slice(lead);
  const m = /^export\s+const\s+meta\s*=\s*/.exec(after);
  if (!m) {
    throw new WorkflowSyntaxError(
      "`export const meta = { name, description }` must be the first statement",
    );
  }
  // The literal must open RIGHT after the `=` (the regex consumed the
  // whitespace). Scanning forward to the first `{` would accept wrappers like
  // `makeMeta({...})` — passing validation for a script that fails at runtime —
  // and silently blank non-literal code (e.g. `f(), {...}`) out of the body.
  const braceStart = lead + m[0].length;
  if (source[braceStart] !== "{") {
    throw new WorkflowSyntaxError("meta must be a pure object literal");
  }
  const braceEnd = matchBrace(source, braceStart);
  const metaSrc = source.slice(braceStart, braceEnd + 1);

  const meta = parseMeta(metaSrc);

  // Consume an optional trailing semicolon right after the meta literal.
  let tailStart = braceEnd + 1;
  const trailing = /^\s*;/.exec(source.slice(tailStart));
  if (trailing) tailStart += trailing[0].length;

  // Preserve line numbers: replace everything stripped (leading comments + the meta declaration)
  // with the same count of blank lines so workflow stack traces point at the real source line.
  const stripped = source.slice(0, tailStart);
  const blanks = "\n".repeat(countNewlines(stripped));
  const body = blanks + source.slice(tailStart);
  return { meta, body };
}

/** Length of the leading run of whitespace + line/block comments before the first real token. */
function leadingNonCodeLength(src: string): number {
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl < 0 ? src.length : nl;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    break;
  }
  return i;
}

function countNewlines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === "\n") n++;
  return n;
}

/** Match the brace at `openIndex`, skipping strings and comments. Returns the matching `}` index. */
function matchBrace(src: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      i = src.indexOf("\n", i);
      if (i < 0) return src.length - 1;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i, c);
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new WorkflowSyntaxError("unbalanced braces in meta literal");
}

function skipString(src: string, i: number, quote: string): number {
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === "\\") {
      j++;
      continue;
    }
    if (c === quote) return j;
  }
  return src.length;
}
