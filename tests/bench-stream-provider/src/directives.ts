import { z } from "zod";
import { FIXTURE_NAMES, type FixtureName } from "./fixtures/index.js";

const BENCH_HISTORY_DIRECTIVE = "bench_history";
const BENCH_STREAM_DIRECTIVE = "bench_stream";
const BENCH_NOOP_DIRECTIVE = "bench_noop";

const MAX_HISTORY_TOOLS = 6;

export type BenchDirective =
  | { kind: "history"; seed: number; tools: number }
  | {
      kind: "stream";
      doc: FixtureName;
      chunk: number;
      interval: number;
      repeat: number;
      prelude: boolean;
    }
  | { kind: "noop" }
  | { kind: "echo" }
  | { kind: "invalid"; problem: string };

function integerToken(min: number, max: number) {
  return z
    .string()
    .regex(/^\d+$/u, "expected a non-negative integer")
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));
}

const historyTokensSchema = z
  .object({
    seed: integerToken(0, Number.MAX_SAFE_INTEGER),
    tools: integerToken(0, MAX_HISTORY_TOOLS),
  })
  .strict();

const streamTokensSchema = z
  .object({
    doc: z.enum(FIXTURE_NAMES),
    chunk: integerToken(1, 1_000_000),
    interval: integerToken(0, 3_600_000),
    repeat: integerToken(1, 1_000).default(1),
    prelude: z
      .enum(["0", "1"])
      .transform((value) => value === "1")
      .default(true),
  })
  .strict();

function parseTokens(
  directive: string,
  tokens: readonly string[],
):
  | { ok: true; values: Record<string, string> }
  | { ok: false; problem: string } {
  const values: Record<string, string> = {};
  for (const token of tokens) {
    const separator = token.indexOf("=");
    if (separator <= 0) {
      return {
        ok: false,
        problem: `${directive}: expected key=value tokens, got "${token}"`,
      };
    }
    const key = token.slice(0, separator);
    if (Object.hasOwn(values, key)) {
      return { ok: false, problem: `${directive}: duplicate key "${key}"` };
    }
    values[key] = token.slice(separator + 1);
  }
  return { ok: true, values };
}

function describeIssues(directive: string, error: z.ZodError): string {
  return `${directive}: ${error.issues
    .map((issue) =>
      issue.path.length === 0
        ? issue.message
        : `${issue.path.join(".")}: ${issue.message}`,
    )
    .join("; ")}`;
}

export function parseBenchDirective(prompt: string): BenchDirective {
  const firstLine = prompt.trimStart().split("\n", 1)[0]?.trim() ?? "";
  const [name, ...tokens] = firstLine.split(/\s+/u);
  if (name === BENCH_NOOP_DIRECTIVE) {
    return tokens.length === 0
      ? { kind: "noop" }
      : {
          kind: "invalid",
          problem: `${name}: takes no tokens, got "${tokens.join(" ")}"`,
        };
  }
  if (name !== BENCH_HISTORY_DIRECTIVE && name !== BENCH_STREAM_DIRECTIVE) {
    return { kind: "echo" };
  }
  const parsedTokens = parseTokens(name, tokens);
  if (!parsedTokens.ok) {
    return { kind: "invalid", problem: parsedTokens.problem };
  }
  if (name === BENCH_HISTORY_DIRECTIVE) {
    const parsed = historyTokensSchema.safeParse(parsedTokens.values);
    return parsed.success
      ? { kind: "history", ...parsed.data }
      : { kind: "invalid", problem: describeIssues(name, parsed.error) };
  }
  const parsed = streamTokensSchema.safeParse(parsedTokens.values);
  return parsed.success
    ? { kind: "stream", ...parsed.data }
    : { kind: "invalid", problem: describeIssues(name, parsed.error) };
}
