import { z } from "zod";
import type { PromptMentionCommandTrigger } from "@bb/domain";
import type {
  ComposerMentionShape,
  ComposerMentionTargetShape,
  ProviderCommandSuggestion,
} from "@bb/client-core";

export type MentionTarget = ComposerMentionTargetShape;
type ComposerMention = ComposerMentionShape;

const label = z.string();

export const mentionTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("thread"),
    threadId: z.string(),
    projectId: z.string().optional(),
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
    argumentHint: z.string().nullable(),
    label,
  }),
  z.object({ kind: z.literal("attachment"), path: z.string(), label }),
  z.object({
    kind: z.literal("plugin"),
    pluginId: z.string(),
    provider: z.string(),
    id: z.string(),
    icon: z.string().nullable().optional(),
    label,
  }),
]) satisfies z.ZodType<MentionTarget>;

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
  const rightEntries = new Map<string, unknown>(Object.entries(right));
  if (leftEntries.length !== rightEntries.size) return false;
  return leftEntries.every(
    ([key, value]) => rightEntries.has(key) && rightEntries.get(key) === value,
  );
}

export function compareMentions(
  left: ComposerMention,
  right: ComposerMention,
): number {
  return left.from - right.from || left.to - right.to;
}

export function commandMentionTarget(
  command: Pick<
    ProviderCommandSuggestion,
    "name" | "source" | "origin" | "argumentHint"
  >,
  trigger: PromptMentionCommandTrigger,
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
