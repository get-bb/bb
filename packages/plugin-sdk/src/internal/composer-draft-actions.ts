import { z } from "zod";
import type {
  ComposerDraftSnapshot,
  PluginComposerApi,
} from "../app-contract.js";
import type { ComposerHandleTarget } from "./composer-handle.js";

const range = {
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  label: z.string(),
};
const mentionSchema = z.discriminatedUnion("kind", [
  z.object({
    ...range,
    kind: z.literal("thread"),
    threadId: z.string(),
    projectId: z.string().optional(),
  }),
  z.object({ ...range, kind: z.literal("project"), projectId: z.string() }),
  z.object({ ...range, kind: z.literal("section"), sectionId: z.string() }),
  z.object({
    ...range,
    kind: z.literal("path"),
    path: z.string(),
    source: z.enum(["workspace", "thread-storage"]),
    entryKind: z.enum(["file", "directory"]),
  }),
  z.object({
    ...range,
    kind: z.literal("command"),
    trigger: z.enum(["/", "$"]),
    name: z.string(),
    source: z.enum(["skill", "command"]),
    origin: z.enum(["builtin", "project", "user"]),
    argumentHint: z.string().nullable(),
  }),
  z.object({
    ...range,
    kind: z.literal("plugin"),
    pluginId: z.string(),
    provider: z
      .string()
      .min(1)
      .refine((value) => !value.includes(":")),
    id: z.string(),
    icon: z.string().nullable().optional(),
  }),
]);
const attachmentFields = {
  type: z.enum(["localImage", "localFile"]),
  path: z.string().min(1),
  name: z.string(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().nonnegative().optional(),
};
const attachmentsSchema = z.array(
  z.union([
    z.object({
      ...attachmentFields,
      experimental_hostId: z.string().min(1),
      experimental_sourceProjectId: z.undefined().optional(),
    }),
    z.object({
      ...attachmentFields,
      experimental_sourceProjectId: z.string().min(1).optional(),
      experimental_hostId: z.undefined().optional(),
    }),
  ]),
);
const replacementSchema = z
  .object({
    text: z.string(),
    mentions: z.array(mentionSchema),
    attachments: attachmentsSchema.optional(),
  })
  .superRefine((draft, context) => {
    let end = 0;
    for (const mention of [...draft.mentions].sort((a, b) => a.from - b.from)) {
      if (
        mention.from < end ||
        mention.to <= mention.from ||
        mention.to > draft.text.length
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Mention ranges must be non-overlapping and inside the draft text.",
        });
      }
      end = mention.to;
    }
  });

type DraftTarget = Pick<
  ComposerHandleTarget,
  "getDraft" | "setDraft" | "isAvailable" | "focus"
>;

export function createComposerDraftActions(
  target: () => DraftTarget,
): Pick<PluginComposerApi, "draft" | "replace" | "focus"> {
  let cached: {
    content: ComposerDraftSnapshot;
    snapshot: ComposerDraftSnapshot;
  } | null = null;
  const snapshotOf = (current: DraftTarget): ComposerDraftSnapshot => {
    const content = current.getDraft();
    if (cached?.content === content) return cached.snapshot;
    const snapshot = Object.freeze({
      text: content.text,
      mentions: Object.freeze(
        content.mentions.map((mention) => Object.freeze({ ...mention })),
      ),
      attachments: Object.freeze(
        content.attachments.map((attachment) =>
          Object.freeze({ ...attachment }),
        ),
      ),
    });
    cached = { content, snapshot };
    return snapshot;
  };
  const requireAvailable = (current: DraftTarget) => {
    if (!current.isAvailable())
      throw new Error("This composer is no longer available.");
  };
  return {
    get draft() {
      return snapshotOf(target());
    },
    replace(next) {
      const current = target();
      requireAvailable(current);
      const snapshot = snapshotOf(current);
      const result = typeof next === "function" ? next(snapshot) : next;
      requireAvailable(current);
      if (result === snapshot) return;
      const parsed = replacementSchema.safeParse(result);
      if (!parsed.success)
        throw new Error(
          "Invalid composer draft: text, mention ranges, or attachments are invalid.",
        );
      current.setDraft(parsed.data);
    },
    focus() {
      const current = target();
      requireAvailable(current);
      current.focus();
    },
  };
}
