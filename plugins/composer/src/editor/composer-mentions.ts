import * as z from "zod/mini";
import type {
  ComposerMention,
  ExperimentalComposerCommandSuggestion,
  ExperimentalComposerCommandTrigger,
  ExperimentalComposerMentionTarget,
} from "@get-bb/plugin-sdk/app";

export type MentionTarget = ExperimentalComposerMentionTarget;

const label = z.string();

export const mentionTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("thread"),
    threadId: z.string(),
    projectId: z.optional(z.string()),
    label,
  }),
  z.object({ kind: z.literal("project"), projectId: z.string(), label }),
  z.object({ kind: z.literal("section"), sectionId: z.string(), label }),
  z.object({
    kind: z.literal("path"),
    path: z.string(),
    source: z.enum(["workspace", "thread-storage"]),
    entryKind: z.enum(["file", "directory"]),
    label,
  }),
  z.object({
    kind: z.literal("command"),
    trigger: z.enum(["/", "$"]),
    name: z.string(),
    source: z.enum(["skill", "command"]),
    origin: z.enum(["builtin", "project", "user"]),
    argumentHint: z.nullable(z.string()),
    label,
  }),
  z.object({ kind: z.literal("attachment"), path: z.string(), label }),
  z.object({
    kind: z.literal("plugin"),
    pluginId: z.string(),
    provider: z.string(),
    id: z.string(),
    icon: z.optional(z.nullable(z.string())),
    label,
  }),
]) satisfies z.ZodMiniType<MentionTarget>;

export function mentionTarget(mention: ComposerMention): MentionTarget {
  const { from: _from, to: _to, ...target } = mention;
  return target;
}

export function mentionInRange(
  target: MentionTarget,
  from: number,
  to: number,
): ComposerMention {
  return { ...target, from, to };
}

export function shiftMention(
  mention: ComposerMention,
  delta: number,
): ComposerMention {
  return { ...mention, from: mention.from + delta, to: mention.to + delta };
}

export function sameMention(
  left: ComposerMention,
  right: ComposerMention,
): boolean {
  if (left === right) return true;
  const leftEntries = Object.entries(left);
  if (leftEntries.length !== Object.keys(right).length) return false;
  const rightRecord: Readonly<Record<string, unknown>> = right;
  return leftEntries.every(([key, value]) => rightRecord[key] === value);
}

export function compareMentions(
  left: ComposerMention,
  right: ComposerMention,
): number {
  return left.from - right.from || left.to - right.to;
}

export function commandMentionTarget(
  command: Pick<
    ExperimentalComposerCommandSuggestion,
    "name" | "source" | "origin" | "argumentHint"
  >,
  trigger: ExperimentalComposerCommandTrigger,
): Extract<MentionTarget, { kind: "command" }> {
  return {
    kind: "command",
    trigger,
    name: command.name,
    source: command.source,
    origin: command.origin,
    label: command.name,
    argumentHint: command.argumentHint,
  };
}
