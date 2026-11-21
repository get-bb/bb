import { createInterface } from "node:readline/promises";
import {
  reasoningLevelSchema,
  reasoningLevelValues,
  type ReasoningLevel,
} from "@bb/domain";
import type { ResolvedId } from "../context-env.js";

export {
  type ResolvedId,
  requireThreadId,
  requireThreadIdOrSelf,
} from "../context-env.js";

const REASONING_LEVELS: readonly ReasoningLevel[] = reasoningLevelValues;

export function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function printThreadContextLabel(resolved: ResolvedId): void {
  if (resolved.source === "env") {
    console.error(`Thread ${resolved.id} (from BB_THREAD_ID)`);
  }
}

export async function confirmDestructiveAction(
  message: string,
): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Refusing destructive action without an interactive terminal. Re-run with --yes to confirm.",
    );
  }

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await readline.question(`${message} [y/N] `);
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  } finally {
    readline.close();
  }
}

export function getErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const seen = new Set<Error>();
  const messages: string[] = [];
  const pending: Error[] = [err];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);

    if (current.message.length > 0) {
      messages.push(current.message);
    }

    const children: Error[] = [];
    if (current.cause instanceof Error) {
      children.push(current.cause);
    }
    if (current instanceof AggregateError) {
      children.push(
        ...current.errors.filter(
          (nested): nested is Error => nested instanceof Error,
        ),
      );
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return messages.join(": ");
}

export function parseReasoningLevel(
  value: string | undefined,
): ReasoningLevel | undefined {
  if (value === undefined) return undefined;
  const parsed = reasoningLevelSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new Error(
    `Invalid reasoning level '${value}'. Expected a level id the model lists, such as ${joinValues(REASONING_LEVELS)}.`,
  );
}

export function prependErrorContext(context: string, err: unknown): Error {
  return new Error(`${context}: ${getErrorMessage(err)}`);
}

export function joinValues(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(" or ");
}

export const LIST_COMMAND_DEFAULT_LIMIT = 200;

export function parseNonNegativeIntegerOption(
  value: string | undefined,
  optionName: "--limit" | "--offset",
): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/u.test(value)) {
    throw new Error(`${optionName} must be a non-negative integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${optionName} must be a non-negative integer.`);
  }
  return parsed;
}

interface PrintListPageNoticeArgs {
  count: number;
  limit: number;
  noun: string;
  offset: number | undefined;
}

export function printListPageNotice(args: PrintListPageNoticeArgs): void {
  if (args.count < args.limit) return;
  const offset = args.offset ?? 0;
  console.error(
    `(Showing ${args.count} ${args.noun} from offset ${offset}; more may follow. Use --offset ${offset + args.count} for the next page.)`,
  );
}
