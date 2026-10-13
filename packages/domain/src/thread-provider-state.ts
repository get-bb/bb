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
    fixed: z.boolean().optional(),
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

export interface SessionOptionConflict {
  optionId: string;
  optionLabel: string;
  selected: SessionOptionValue;
  selectedLabel: string;
  kind: "boolean" | "select";
}

interface SessionOptionModelSource {
  sessionOptions?: readonly ThreadSessionOption[] | undefined;
}

function mergeDeclaredOption(
  existing: ThreadSessionOption,
  declared: ThreadSessionOption,
): ThreadSessionOption {
  if (existing.type === "boolean" && declared.type === "boolean") {
    if (existing.fixed !== true) {
      return existing;
    }
    if (declared.fixed !== true) {
      return declared;
    }
    return existing.value === declared.value
      ? existing
      : { ...existing, value: false, fixed: false };
  }
  if (existing.type === "select" && declared.type === "select") {
    const known = new Set(existing.values.map((value) => value.id));
    return {
      ...existing,
      values: [
        ...existing.values,
        ...declared.values.filter((value) => !known.has(value.id)),
      ],
    };
  }
  return existing;
}

export function collectDeclaredSessionOptions(
  models: readonly SessionOptionModelSource[],
): ThreadSessionOption[] {
  const byId = new Map<string, ThreadSessionOption>();
  for (const model of models) {
    for (const option of model.sessionOptions ?? []) {
      const existing = byId.get(option.id);
      byId.set(
        option.id,
        existing === undefined ? option : mergeDeclaredOption(existing, option),
      );
    }
  }
  return [...byId.values()].map((option) =>
    option.type === "boolean" && option.fixed !== undefined
      ? { ...option, fixed: false }
      : option,
  );
}

export function modelSessionOptionConflict(
  model: SessionOptionModelSource,
  selections: SessionOptionSelections,
): SessionOptionConflict | null {
  for (const option of model.sessionOptions ?? []) {
    if (!Object.hasOwn(selections, option.id)) {
      continue;
    }
    const selected = selections[option.id];
    if (option.type === "boolean") {
      if (
        typeof selected === "boolean" &&
        option.fixed === true &&
        selected !== option.value
      ) {
        return {
          optionId: option.id,
          optionLabel: option.label,
          selected,
          selectedLabel: selected ? "On" : "Off",
          kind: "boolean",
        };
      }
      continue;
    }
    if (
      typeof selected === "string" &&
      !option.values.some((value) => value.id === selected)
    ) {
      return {
        optionId: option.id,
        optionLabel: option.label,
        selected,
        selectedLabel: selected,
        kind: "select",
      };
    }
  }
  return null;
}

export function describeSessionOptionConflict(
  conflict: SessionOptionConflict,
): string {
  return conflict.kind === "boolean"
    ? `Turn ${conflict.selected === true ? "off" : "on"} ${conflict.optionLabel} to use this model`
    : `Not available with ${conflict.optionLabel} set to ${conflict.selectedLabel}`;
}

export function effectiveSessionOptionSelections(
  declared: readonly ThreadSessionOption[],
  selections: SessionOptionSelections,
): SessionOptionSelections {
  const effective: SessionOptionSelections = {};
  for (const option of declared) {
    if (!Object.hasOwn(selections, option.id)) {
      continue;
    }
    const selected = selections[option.id];
    if (sessionOptionAcceptsValue(option, selected)) {
      effective[option.id] = selected;
    }
  }
  return effective;
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
