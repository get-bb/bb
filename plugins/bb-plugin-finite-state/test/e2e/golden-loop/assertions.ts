import { access, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type { GoldenLoopAssertion } from "./scenario.js";

export function assertion(
  name: string,
  passed: boolean,
  detail?: string,
): GoldenLoopAssertion {
  return {
    name,
    passed,
    ...(detail === undefined ? {} : { detail }),
  };
}

export function equalAssertion(
  name: string,
  actual: unknown,
  expected: unknown,
): GoldenLoopAssertion {
  const actualJson = stableJson(actual);
  const expectedJson = stableJson(expected);
  return assertion(
    name,
    actualJson === expectedJson,
    actualJson === expectedJson
      ? undefined
      : `expected ${expectedJson}; received ${actualJson}`,
  );
}

export function includesAssertion(
  name: string,
  actual: string,
  expected: string,
): GoldenLoopAssertion {
  return assertion(
    name,
    actual.includes(expected),
    actual.includes(expected)
      ? undefined
      : `expected text to include ${JSON.stringify(expected)}`,
  );
}

export async function fileAssertion(
  worktree: string,
  path: string,
  expectedText?: string,
): Promise<GoldenLoopAssertion> {
  const absolute = resolve(worktree, path);
  const inside = relative(worktree, absolute);
  if (isAbsolute(inside) || inside === ".." || inside.startsWith("../")) {
    return assertion(`file ${path}`, false, "path escapes disposable worktree");
  }
  try {
    await access(absolute);
    if (expectedText !== undefined) {
      const content = await readFile(absolute, "utf8");
      return includesAssertion(`file ${path}`, content, expectedText);
    }
    return assertion(`file ${path}`, true);
  } catch (error) {
    return assertion(
      `file ${path}`,
      false,
      error instanceof Error ? error.message : "file is unavailable",
    );
  }
}

export function requirePassed(
  assertions: readonly GoldenLoopAssertion[],
): void {
  const failures = assertions.filter(({ passed }) => !passed);
  if (failures.length === 0) return;
  throw new Error(
    failures
      .map(({ name, detail }) => `${name}${detail ? `: ${detail}` : ""}`)
      .join("; "),
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
