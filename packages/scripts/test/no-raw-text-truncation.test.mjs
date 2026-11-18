import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const OXLINT = join(ROOT, "node_modules", "oxlint", "bin", "oxlint");

const flagged = [
  "export const a = (text: string) => text.slice(0, MAX_CHARS);",
  "export const b = (command: string) => `${command.slice(0, 200)}…`;",
  "export const c = (value: string, limit: number) => value.trim().slice(0, limit);",
  "export const d = (stderr: string) => stderr.slice(-8192);",
  "export const e = (name: string) => name.substring(0, 40);",
  "export const f = (ref: string, title: string) => `${ref}: ${title}`.slice(0, 120);",
  "export const g = (output: string, maxLength: number) => output.slice(0, maxLength - 1).trimEnd();",
];
const allowed = [
  "export const h = (items: string[]) => items.slice(0, MAX_ITEMS);",
  "export const i = (line: string, separatorIndex: number) => line.slice(0, separatorIndex);",
  "export const j = (sha: string) => sha.slice(0, 12);",
  "export const k = (commit: string) => `${commit.slice(0, 7)}`;",
  "export const l = (text: string) => text.slice(0, -1);",
  "export const m = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;",
  "export const n = (text: string, end: number) => text.slice(0, end);",
];

describe("bb/no-raw-text-truncation", () => {
  let dir;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "no-raw-text-truncation-"));
    await writeFile(
      join(dir, ".oxlintrc.json"),
      JSON.stringify({
        jsPlugins: [join(ROOT, "scripts", "oxlint-plugin.mjs")],
        categories: { correctness: "off" },
        rules: { "bb/no-raw-text-truncation": "error" },
      }),
    );
    await writeFile(
      join(dir, "fixture.ts"),
      [
        "declare const MAX_CHARS: number;",
        "declare const MAX_ITEMS: number;",
        ...flagged,
        ...allowed,
      ].join("\n"),
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("flags length-capped text cuts and leaves index, array, and id cuts alone", async () => {
    const result = await execFileAsync(
      process.execPath,
      [
        OXLINT,
        "-c",
        join(dir, ".oxlintrc.json"),
        "-f",
        "unix",
        join(dir, "fixture.ts"),
      ],
      { cwd: dir },
    ).catch((error) => {
      if (typeof error.code !== "number") throw error;
      return error;
    });
    const flaggedLines = [
      ...String(result.stdout).matchAll(
        /fixture\.ts:(\d+):\d+:.*no-raw-text-truncation/gu,
      ),
    ].map((match) => Number(match[1]));

    const firstCaseLine = 3;
    expect(flaggedLines).toEqual(
      flagged.map((_source, index) => firstCaseLine + index),
    );
  });
});
