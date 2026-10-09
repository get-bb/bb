import { z } from "zod";
import type { ExtensionKind } from "./provider-extension-kind.js";
import {
  sessionOptionSelectionsSchema,
  type SessionOptionSelections,
  type SessionOptionValue,
} from "./shared-types.js";

export const THREAD_PROVIDER_COMMANDS_STATE_KIND =
  "bb/provider-commands" satisfies ExtensionKind;
export const THREAD_SESSION_OPTIONS_STATE_KIND =
  "bb/session-options" satisfies ExtensionKind;

export const threadProviderCommandSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  inputHint: z.string().min(1).optional(),
});
export type ThreadProviderCommand = z.infer<typeof threadProviderCommandSchema>;

export const threadProviderCommandsStateSchema = z.object({
  commands: z.array(threadProviderCommandSchema).max(500),
});
export type ThreadProviderCommandsState = z.infer<
  typeof threadProviderCommandsStateSchema
>;

export const threadSessionOptionValueSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  group: z.string().min(1).optional(),
});
export type ThreadSessionOptionValue = z.infer<
  typeof threadSessionOptionValueSchema
>;

const threadSessionOptionBaseShape = {
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
};

export const threadSessionOptionSchema = z.discriminatedUnion("type", [
  z.object({
    ...threadSessionOptionBaseShape,
    type: z.literal("select"),
    value: z.string(),
    values: z.array(threadSessionOptionValueSchema).max(1000),
  }),
  z.object({
    ...threadSessionOptionBaseShape,
    type: z.literal("boolean"),
    value: z.boolean(),
  }),
]);
export type ThreadSessionOption = z.infer<typeof threadSessionOptionSchema>;

export const threadSessionOptionsStateSchema = z.object({
  options: z.array(threadSessionOptionSchema).max(64),
});
export type ThreadSessionOptionsState = z.infer<
  typeof threadSessionOptionsStateSchema
>;

export const THREAD_SESSION_OPTION_SELECTIONS_STATE_KIND =
  "bb/session-option-selections" satisfies ExtensionKind;

export const threadSessionOptionSelectionsStateSchema = z.object({
  selections: sessionOptionSelectionsSchema,
});
export type ThreadSessionOptionSelectionsState = z.infer<
  typeof threadSessionOptionSelectionsStateSchema
>;

export type SessionOptionSelectionPatch = Record<
  string,
  SessionOptionValue | null
>;

export type SessionOptionSelectionPatchResult =
  | { ok: true; selections: SessionOptionSelections }
  | { ok: false; message: string };

function sessionOptionAcceptsValue(
  option: ThreadSessionOption,
  value: SessionOptionValue,
): boolean {
  return option.type === "boolean"
    ? typeof value === "boolean"
    : typeof value === "string" &&
        option.values.some((candidate) => candidate.id === value);
}

export function pendingSessionOptionSelections(
  options: readonly ThreadSessionOption[],
  selections: SessionOptionSelections,
): SessionOptionSelections {
  const pending: SessionOptionSelections = {};
  for (const option of options) {
    if (!Object.hasOwn(selections, option.id)) {
      continue;
    }
    const selected = selections[option.id];
    if (
      selected !== option.value &&
      sessionOptionAcceptsValue(option, selected)
    ) {
      pending[option.id] = selected;
    }
  }
  return pending;
}

export function applySessionOptionSelectionPatch(args: {
  options: readonly ThreadSessionOption[];
  selections: SessionOptionSelections;
  patch: SessionOptionSelectionPatch;
}): SessionOptionSelectionPatchResult {
  const next: SessionOptionSelections = { ...args.selections };
  for (const [optionId, value] of Object.entries(args.patch)) {
    if (value === null) {
      delete next[optionId];
      continue;
    }
    const option = args.options.find((candidate) => candidate.id === optionId);
    if (option === undefined) {
      return {
        ok: false,
        message:
          args.options.length === 0
            ? `This thread's agent has not reported any session options, so "${optionId}" cannot be set.`
            : `This thread's agent has no session option "${optionId}". Available options: ${args.options.map((candidate) => candidate.id).join(", ")}.`,
      };
    }
    if (!sessionOptionAcceptsValue(option, value)) {
      return {
        ok: false,
        message:
          option.type === "boolean"
            ? `Session option "${optionId}" takes true or false.`
            : `Session option "${optionId}" has no value ${JSON.stringify(value)}. Available values: ${option.values.map((candidate) => candidate.id).join(", ")}.`,
      };
    }
    next[optionId] = value;
  }
  return {
    ok: true,
    selections: pendingSessionOptionSelections(args.options, next),
  };
}

const CORE_THREAD_STATE_SCHEMAS = {
  [THREAD_PROVIDER_COMMANDS_STATE_KIND]: threadProviderCommandsStateSchema,
  [THREAD_SESSION_OPTIONS_STATE_KIND]: threadSessionOptionsStateSchema,
} as const;

export const CORE_THREAD_STATE_PLUGIN_ID = "bb";

export function coreThreadStateSchema(kind: string): z.ZodType | null {
  return Object.hasOwn(CORE_THREAD_STATE_SCHEMAS, kind)
    ? CORE_THREAD_STATE_SCHEMAS[kind as keyof typeof CORE_THREAD_STATE_SCHEMAS]
    : null;
}
