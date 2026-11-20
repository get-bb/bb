import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const matcherSchema = z
  .object({
    bb: z.string().optional(),
    skill: z.string().optional(),
    command: z.string().optional(),
    text: z.string().optional(),
    final: z.string().optional(),
    times: z.number().int().nonnegative().optional(),
  })
  .refine(
    (matcher) =>
      [
        matcher.bb,
        matcher.skill,
        matcher.command,
        matcher.text,
        matcher.final,
      ].filter((value) => value !== undefined).length === 1,
    "A matcher names exactly one of bb, skill, command, text or final",
  );
export type Matcher = z.infer<typeof matcherSchema>;

const checkSchema = z.object({
  label: z.string(),
  anyOf: z.array(matcherSchema).min(1),
  not: z.boolean().default(false),
});
export type Check = z.infer<typeof checkSchema>;

const bbResponseSchema = z.object({
  args: z.string(),
  stdout: z.string(),
  exitCode: z.number().int().default(0),
});

export const evalCaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(["bad", "guard", "control"]),
  source: z.string(),
  experience: z.string(),
  plugins: z.array(z.string()).default([]),
  parentThreadId: z.string().nullable().default(null),
  allowEdits: z.boolean().default(false),
  prompt: z.string(),
  files: z.record(z.string(), z.string()).default({}),
  bb: z
    .object({
      status: z.string().optional(),
      responses: z.array(bbResponseSchema).default([]),
    })
    .default({ responses: [] }),
  checks: z.array(checkSchema).min(1),
});
export type EvalCase = z.infer<typeof evalCaseSchema>;

export const CASES_DIR = fileURLToPath(new URL("../cases/", import.meta.url));

export function loadCases(dir = CASES_DIR): EvalCase[] {
  const cases = readdirSync(dir)
    .filter((file) => file.endsWith(".jsonl"))
    .sort()
    .flatMap((file) =>
      readFileSync(join(dir, file), "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line, index) => {
          const parsed = evalCaseSchema.safeParse(JSON.parse(line));
          if (!parsed.success) {
            throw new Error(
              `${file}:${index + 1}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
            );
          }
          return parsed.data;
        }),
    );
  const ids = new Set<string>();
  for (const evalCase of cases) {
    if (ids.has(evalCase.id)) throw new Error(`Duplicate case ${evalCase.id}`);
    ids.add(evalCase.id);
  }
  return cases;
}
