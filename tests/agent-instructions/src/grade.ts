import { z } from "zod";
import type { Check, Matcher } from "./cases.js";

export interface Observation {
  bbCalls: string[];
  commands: string[];
  tools: string[];
  skills: string[];
  texts: string[];
  final: string;
}

export interface CheckResult {
  label: string;
  passed: boolean;
}

function count(pattern: string, values: readonly string[]): number {
  const regex = new RegExp(pattern, "gi");
  return values.reduce(
    (sum, value) => sum + [...value.matchAll(regex)].length,
    0,
  );
}

function matches(matcher: Matcher, observation: Observation): boolean {
  if (matcher.skill !== undefined) {
    const found = observation.skills.filter(
      (skill) => skill === matcher.skill,
    ).length;
    return matcher.times === undefined ? found > 0 : found === matcher.times;
  }
  const [pattern, values] =
    matcher.bb !== undefined
      ? [matcher.bb, observation.bbCalls]
      : matcher.command !== undefined
        ? [matcher.command, observation.commands]
        : matcher.tool !== undefined
          ? [matcher.tool, observation.tools]
          : matcher.text !== undefined
            ? [matcher.text, observation.texts]
            : [matcher.final ?? "", [observation.final]];
  const found = count(pattern, values);
  return matcher.times === undefined ? found > 0 : found === matcher.times;
}

export function gradeObservation(
  checks: readonly Check[],
  observation: Observation,
): CheckResult[] {
  return checks.map((check) => {
    const matched = check.anyOf.some((matcher) =>
      matches(matcher, observation),
    );
    return { label: check.label, passed: check.not ? !matched : matched };
  });
}

export function casePassed(samplePasses: readonly boolean[]): boolean {
  const failures = samplePasses.filter((passed) => !passed).length;
  return failures * 2 < samplePasses.length;
}

const SKILL_PREFIX = /^bb-global-skills(?:-[0-9a-f]{8})?:/;

const contentBlockSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("tool_use"),
    name: z.string(),
    input: z.record(z.string(), z.unknown()),
  }),
  z.object({ type: z.string() }),
]);

const streamEventSchema = z.union([
  z.object({ type: z.literal("result"), result: z.string() }),
  z.object({
    type: z.literal("assistant"),
    message: z.object({ content: z.array(contentBlockSchema) }),
  }),
]);

function parseLine(line: string): z.infer<typeof streamEventSchema> | null {
  try {
    const parsed = streamEventSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function observeStream(
  lines: readonly string[],
  bbCalls: readonly string[],
): Observation {
  const commands: string[] = [];
  const tools: string[] = [];
  const skills: string[] = [];
  const texts: string[] = [];
  let final = "";
  for (const line of lines) {
    const event = parseLine(line);
    if (event === null) continue;
    if (event.type === "result") {
      final = event.result;
      continue;
    }
    for (const block of event.message.content) {
      if ("text" in block) {
        texts.push(block.text);
        continue;
      }
      if (!("input" in block)) continue;
      tools.push(`${block.name} ${JSON.stringify(block.input)}`);
      const { command, skill } = block.input;
      if (block.name === "Bash" && typeof command === "string") {
        commands.push(command);
      }
      if (block.name === "Skill" && typeof skill === "string") {
        skills.push(skill.replace(SKILL_PREFIX, ""));
      }
    }
  }
  return { bbCalls: [...bbCalls], commands, tools, skills, texts, final };
}
