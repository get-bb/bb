import { z } from "zod";
import { isPluginOwnedIconPath } from "@bb/domain/plugin-icon";
import { RESERVED_BB_CLI_COMMANDS } from "@bb/domain/plugin-cli";
import { PROVIDER_FORK_VALUES } from "@bb/domain/provider-fork";
import { PLUGIN_CLI_OUTPUT_MAX_BYTES } from "../backend-contract.js";
import type {
  PluginCliExecutionResult,
  PluginCliOutputLimitError,
  PluginMentionTrigger,
  PluginProviderCapabilities,
  PluginProviderComposerAction,
  PluginProviderDeclaration,
  PluginProviderExtensionKindDeclaration,
  PluginProviderFallbackModel,
  PluginProviderOptionDescriptor,
  PluginProviderPermissionMode,
  PluginProviderReasoningLevel,
  PluginProviderStrings,
  PluginSettingDescriptor,
  PluginSettingDescriptors,
} from "../backend-contract.js";
import type { JsonValue } from "../json-value.js";
import type {
  PluginRpcMethodContract,
  StandardSchemaV1,
} from "../rpc-contract.js";

/**
 * Shared registration policy for the real plugin host and the in-process fake.
 *
 * These rules decide whether `bb.*.register()` throws. The fake host must
 * accept and reject the same names, schemas, and caps as production so plugin
 * unit tests are not lying about load-time behavior.
 */

export { RESERVED_BB_CLI_COMMANDS };

/**
 * Built-in dynamic tool names plugins may not shadow. Maintained by hand —
 * kept in sync with the built-in tools in
 * apps/server/src/services/threads/thread-runtime-config.ts by
 * apps/server/test/services/plugins/plugin-agent-tools.test.ts.
 */
export const RESERVED_AGENT_TOOL_NAMES: readonly string[] = [
  "update_environment_directory",
];

/** JSON values ≤256KB; larger writes are rejected with a clear error. */
export const KV_VALUE_MAX_BYTES = 256 * 1024;

export const PLUGIN_HTTP_METHODS: ReadonlySet<string> = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

// Rpc method names become URL path segments.
export const RPC_METHOD_PATTERN = /^[a-zA-Z0-9_-]+$/;

// Service/schedule names appear in status text and plugin_schedules rows.
export const BACKGROUND_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

// CLI command names become `bb <name>` invocations.
export const CLI_COMMAND_NAME_PATTERN = /^[a-z0-9-]+$/;

// Agent tool names are shown to (and called by) the model.
export const AGENT_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export const PLUGIN_AGENT_STATIC_INSTRUCTIONS_MAX_CHARS = 4096;
/** Status labels ride on every tool-call event and share one timeline row. */
export const PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS = 80;
export const PLUGIN_AGENT_SELECTION_MAX_IDS = 256;
export const PLUGIN_AGENT_DYNAMIC_INSTRUCTIONS_MAX_CHARS = 4096;
export const PLUGIN_AGENT_TOOL_PARAMETERS_MAX_BYTES = 128 * 1024;

// Mention provider ids prefix wire item ids ("<providerId>:<itemId>"), so
// ":" is excluded to keep the split unambiguous.
export const MENTION_PROVIDER_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// Agent provider ids are stable public identifiers: thread rows persist them
// and routes/pickers reference them. 2-64 chars, lowercase.
export const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
export const PLUGIN_PROVIDER_BRIDGE_OPTIONS_MAX_BYTES = 64 * 1024;

// Settings keys become file names (secrets) and CLI arguments.
export const SETTING_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;

const settingsBaseFields = {
  label: z.string().min(1),
  description: z.string().min(1).optional(),
};

const settingDescriptorSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("string"),
      ...settingsBaseFields,
      secret: z.literal(true).optional(),
      default: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("boolean"),
      ...settingsBaseFields,
      default: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("select"),
      ...settingsBaseFields,
      options: z.array(z.string().min(1)).min(1),
      default: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("project"),
      ...settingsBaseFields,
      default: z.string().optional(),
    })
    .strict(),
]);

/**
 * Validate freeform descriptors from plugin code and merge them into the
 * plugin's registered schema. Plugin source is not type-safe at runtime, so
 * both the production and fake hosts must enforce this boundary identically.
 */
export function registerSettingDescriptors(
  target: PluginSettingDescriptors,
  added: Record<string, unknown>,
): PluginSettingDescriptors {
  const validated: PluginSettingDescriptors = {};
  for (const [key, raw] of Object.entries(added)) {
    if (!SETTING_KEY_PATTERN.test(key)) {
      throw new Error(
        `invalid setting key "${key}" — use letters, digits, "-" and "_"`,
      );
    }
    if (key in target) {
      throw new Error(`setting "${key}" is already defined`);
    }
    const parsed = settingDescriptorSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.join(".") ?? "";
      throw new Error(
        `invalid descriptor for setting "${key}"${path ? ` (${path})` : ""}: ${issue?.message ?? "unknown error"}`,
      );
    }
    const descriptor = parsed.data;
    if (
      descriptor.type === "select" &&
      descriptor.default !== undefined &&
      !descriptor.options.includes(descriptor.default)
    ) {
      throw new Error(
        `default for setting "${key}" must be one of its options`,
      );
    }
    validated[key] = descriptor;
  }
  Object.assign(target, validated);
  return validated;
}

/** Validate a settings update. `null` means unset. */
export function validateSettingsUpdate(
  descriptors: PluginSettingDescriptors,
  values: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const descriptor: PluginSettingDescriptor | undefined = descriptors[key];
    if (!descriptor) {
      errors.push(`unknown setting "${key}"`);
      continue;
    }
    if (value === null) continue;
    if (descriptor.type === "boolean") {
      if (typeof value !== "boolean") {
        errors.push(`setting "${key}" expects a boolean`);
      }
      continue;
    }
    if (typeof value !== "string") {
      errors.push(`setting "${key}" expects a string`);
      continue;
    }
    if (descriptor.type === "select" && !descriptor.options.includes(value)) {
      errors.push(
        `setting "${key}" must be one of: ${descriptor.options.join(", ")}`,
      );
    }
  }
  return errors;
}

export const PLUGIN_MENTION_TRIGGER_VALUES = [
  "@",
  "#",
  "$",
  "!",
  "~",
] as const satisfies readonly PluginMentionTrigger[];

const DEFAULT_PLUGIN_MENTION_TRIGGERS = [
  "@",
] as const satisfies readonly PluginMentionTrigger[];

export function isPluginMentionTrigger(
  value: unknown,
): value is PluginMentionTrigger {
  return (
    typeof value === "string" &&
    (PLUGIN_MENTION_TRIGGER_VALUES as readonly string[]).includes(value)
  );
}

export function normalizeMentionProviderTriggers(
  providerId: string,
  triggers: unknown,
): readonly PluginMentionTrigger[] {
  if (triggers === undefined) {
    return DEFAULT_PLUGIN_MENTION_TRIGGERS;
  }
  if (!Array.isArray(triggers)) {
    throw new Error(
      `mention provider "${providerId}" triggers must be an array`,
    );
  }
  if (triggers.length === 0) {
    throw new Error(
      `mention provider "${providerId}" triggers must include at least one trigger`,
    );
  }
  const seen = new Set<PluginMentionTrigger>();
  const normalized: PluginMentionTrigger[] = [];
  for (const trigger of triggers) {
    if (!isPluginMentionTrigger(trigger)) {
      throw new Error(
        `mention provider "${providerId}" trigger ${JSON.stringify(trigger)} is invalid; use one of ${PLUGIN_MENTION_TRIGGER_VALUES.join(" ")}`,
      );
    }
    if (seen.has(trigger)) {
      throw new Error(
        `mention provider "${providerId}" trigger ${JSON.stringify(trigger)} is duplicated`,
      );
    }
    seen.add(trigger);
    normalized.push(trigger);
  }
  return normalized;
}

export const PLUGIN_PROVIDER_DISPLAY_NAME_MAX_CHARS = 80;

export const PLUGIN_PROVIDER_PERMISSION_MODE_VALUES = [
  "accept-edits",
  "auto",
  "full",
] as const satisfies readonly PluginProviderPermissionMode[];

export const PLUGIN_PROVIDER_REASONING_LEVEL_VALUES = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "ultracode",
  "max",
  "ultra",
] as const satisfies readonly PluginProviderReasoningLevel[];

export const PLUGIN_PROVIDER_COMPOSER_ACTION_VALUES = [
  "plan",
  "goal",
] as const satisfies readonly PluginProviderComposerAction[];

/** Plugin-relative path rules shared by provider icon assets and bridge
 * entries — the manifest entry-path escape rules, minus the rootDir resolve
 * (the SDK has no rootDir): relative, no ".." segments, no backslashes. */
function validateProviderRelativePath(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`provider ${label} must be a non-blank relative path`);
  }
  if (value.includes("\\")) {
    throw new Error(
      `provider ${label} must use "/" separators, got ${JSON.stringify(value)}`,
    );
  }
  if (value.startsWith("/")) {
    throw new Error(
      `provider ${label} must be relative, got ${JSON.stringify(value)}`,
    );
  }
  if (value.split("/").some((segment) => segment === "..")) {
    throw new Error(
      `provider ${label} must not escape the plugin directory, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function validateProviderLiteralArray<T extends string>(args: {
  providerId: string;
  field: string;
  value: unknown;
  allowed: readonly T[];
  requireNonEmpty: boolean;
}): readonly T[] {
  const { providerId, field, value, allowed, requireNonEmpty } = args;
  if (!Array.isArray(value)) {
    throw new Error(`provider "${providerId}" ${field} must be an array`);
  }
  if (requireNonEmpty && value.length === 0) {
    throw new Error(
      `provider "${providerId}" ${field} must include at least one entry`,
    );
  }
  const seen = new Set<T>();
  const normalized: T[] = [];
  for (const entry of value) {
    if (
      typeof entry !== "string" ||
      !(allowed as readonly string[]).includes(entry)
    ) {
      throw new Error(
        `provider "${providerId}" ${field} entry ${JSON.stringify(entry)} is invalid; use one of ${allowed.join(", ")}`,
      );
    }
    const literal = entry as T;
    if (seen.has(literal)) {
      throw new Error(
        `provider "${providerId}" ${field} entry ${JSON.stringify(entry)} is duplicated`,
      );
    }
    seen.add(literal);
    normalized.push(literal);
  }
  return Object.freeze(normalized);
}

function normalizeProviderBridgeOptions(
  providerId: string,
  value: Readonly<Record<string, JsonValue>>,
  label = "experimental_bridgeOptions",
): Readonly<Record<string, JsonValue>> {
  const active = new Set<object>();
  function visit(current: unknown, path: string): JsonValue {
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean"
    ) {
      return current;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new Error(
          `provider "${providerId}" ${label}${path} must be finite JSON`,
        );
      }
      return current;
    }
    if (typeof current !== "object") {
      throw new Error(
        `provider "${providerId}" ${label}${path} must be JSON`,
      );
    }
    if (active.has(current)) {
      throw new Error(
        `provider "${providerId}" experimental_bridgeOptions must not contain cycles`,
      );
    }
    active.add(current);
    try {
      if (Array.isArray(current)) {
        const normalized = current.map((entry, index) =>
          visit(entry, `${path}[${index}]`),
        );
        Object.freeze(normalized);
        return normalized;
      }
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error(
          `provider "${providerId}" ${label}${path} must contain only plain JSON objects`,
        );
      }
      const normalized: Record<string, JsonValue> = Object.fromEntries(
        Object.entries(current).map(([key, entry]) => [
          key,
          visit(entry, `${path}.${key}`),
        ]),
      );
      Object.freeze(normalized);
      return normalized;
    } finally {
      active.delete(current);
    }
  }

  const normalized = visit(value, "");
  if (
    normalized === null ||
    Array.isArray(normalized) ||
    typeof normalized !== "object"
  ) {
    throw new Error(
      `provider "${providerId}" ${label} must be an object`,
    );
  }
  if (
    Buffer.byteLength(JSON.stringify(normalized), "utf8") >
    PLUGIN_PROVIDER_BRIDGE_OPTIONS_MAX_BYTES
  ) {
    throw new Error(
      `provider "${providerId}" ${label} exceeds ${PLUGIN_PROVIDER_BRIDGE_OPTIONS_MAX_BYTES} bytes`,
    );
  }
  return normalized;
}

const PROVIDER_STRING_MAX_CHARS = 512;
const PROVIDER_EXTENSION_KIND_NAME_PATTERN = /^[a-z0-9-]+$/u;
const PROVIDER_EXTENSION_KINDS_MAX = 32;

function requireNonBlankString(args: {
  providerId: string;
  field: string;
  value: unknown;
}): string {
  const { providerId, field, value } = args;
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > PROVIDER_STRING_MAX_CHARS
  ) {
    throw new Error(
      `provider "${providerId}" ${field} must be a non-blank string of at most ${PROVIDER_STRING_MAX_CHARS} characters`,
    );
  }
  return value;
}

function validateProviderStrings(
  providerId: string,
  value: unknown,
): PluginProviderStrings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `provider "${providerId}" experimental_strings must be an object`,
    );
  }
  const record: Record<string, unknown> = Object.fromEntries(
    Object.entries(value),
  );
  const required = (field: "signInHint" | "expiredHint" | "installUrl") =>
    requireNonBlankString({
      providerId,
      field: `experimental_strings.${field}`,
      value: record[field],
    });
  const optional = (field: "brandPrefix" | "planModeCopy") =>
    record[field] === undefined
      ? undefined
      : requireNonBlankString({
          providerId,
          field: `experimental_strings.${field}`,
          value: record[field],
        });
  let iconTint: PluginProviderStrings["iconTint"];
  if (record.iconTint !== undefined) {
    const tint = record.iconTint;
    if (typeof tint !== "object" || tint === null || Array.isArray(tint)) {
      throw new Error(
        `provider "${providerId}" experimental_strings.iconTint must be { light, dark }`,
      );
    }
    const tintRecord: Record<string, unknown> = Object.fromEntries(
      Object.entries(tint),
    );
    iconTint = Object.freeze({
      light: requireNonBlankString({
        providerId,
        field: "experimental_strings.iconTint.light",
        value: tintRecord.light,
      }),
      dark: requireNonBlankString({
        providerId,
        field: "experimental_strings.iconTint.dark",
        value: tintRecord.dark,
      }),
    });
  }
  const brandPrefix = optional("brandPrefix");
  const planModeCopy = optional("planModeCopy");
  return Object.freeze({
    signInHint: required("signInHint"),
    expiredHint: required("expiredHint"),
    installUrl: required("installUrl"),
    ...(brandPrefix === undefined ? {} : { brandPrefix }),
    ...(planModeCopy === undefined ? {} : { planModeCopy }),
    ...(iconTint === undefined ? {} : { iconTint }),
  });
}

function validateProviderOptionDescriptors(args: {
  providerId: string;
  field: string;
  value: unknown;
}): readonly PluginProviderOptionDescriptor[] {
  const { providerId, field, value } = args;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      `provider "${providerId}" ${field} must be a non-empty array of { id, label, description? }`,
    );
  }
  const seen = new Set<string>();
  const normalized = value.map(
    (entry, index): PluginProviderOptionDescriptor => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        throw new Error(
          `provider "${providerId}" ${field}[${index}] must be { id, label, description? }`,
        );
      }
      const record: Record<string, unknown> = Object.fromEntries(
        Object.entries(entry),
      );
      const id = requireNonBlankString({
        providerId,
        field: `${field}[${index}].id`,
        value: record.id,
      });
      if (seen.has(id)) {
        throw new Error(
          `provider "${providerId}" ${field} id ${JSON.stringify(id)} is duplicated`,
        );
      }
      seen.add(id);
      const label = requireNonBlankString({
        providerId,
        field: `${field}[${index}].label`,
        value: record.label,
      });
      const description =
        record.description === undefined
          ? undefined
          : requireNonBlankString({
              providerId,
              field: `${field}[${index}].description`,
              value: record.description,
            });
      return Object.freeze({
        id,
        label,
        ...(description === undefined ? {} : { description }),
      });
    },
  );
  return Object.freeze(normalized);
}

function validateProviderExtensionKinds(
  providerId: string,
  value: unknown,
): Readonly<Record<string, PluginProviderExtensionKindDeclaration>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `provider "${providerId}" experimental_extensionKinds must be an object keyed by kind name`,
    );
  }
  const entries = Object.entries(value);
  if (entries.length > PROVIDER_EXTENSION_KINDS_MAX) {
    throw new Error(
      `provider "${providerId}" experimental_extensionKinds declares more than ${PROVIDER_EXTENSION_KINDS_MAX} kinds`,
    );
  }
  const normalized: Record<string, PluginProviderExtensionKindDeclaration> = {};
  for (const [name, declaration] of entries) {
    if (!PROVIDER_EXTENSION_KIND_NAME_PATTERN.test(name)) {
      throw new Error(
        `provider "${providerId}" experimental_extensionKinds name ${JSON.stringify(name)} must match ${PROVIDER_EXTENSION_KIND_NAME_PATTERN}`,
      );
    }
    if (
      typeof declaration !== "object" ||
      declaration === null ||
      Array.isArray(declaration)
    ) {
      throw new Error(
        `provider "${providerId}" experimental_extensionKinds.${name} must be { item?, state? }`,
      );
    }
    const item = Reflect.get(declaration, "item");
    const state = Reflect.get(declaration, "state");
    if (item === undefined && state === undefined) {
      throw new Error(
        `provider "${providerId}" experimental_extensionKinds.${name} must declare an item schema, a state schema, or both`,
      );
    }
    if (item !== undefined && !isStandardSchema(item)) {
      throw new Error(
        `provider "${providerId}" experimental_extensionKinds.${name}.item must be a Standard Schema v1 validator`,
      );
    }
    if (state !== undefined && !isStandardSchema(state)) {
      throw new Error(
        `provider "${providerId}" experimental_extensionKinds.${name}.state must be a Standard Schema v1 validator`,
      );
    }
    normalized[name] = Object.freeze({
      ...(item === undefined ? {} : { item }),
      ...(state === undefined ? {} : { state }),
    });
  }
  return Object.freeze(normalized);
}

const PROVIDER_FALLBACK_MODELS_MAX = 64;
const PROVIDER_ENV_PASSTHROUGH_MAX = 32;
const PROVIDER_ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/u;

function validateProviderEnvPassthrough(
  providerId: string,
  value: unknown,
): readonly string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `provider "${providerId}" experimental_env must be { passthrough: [...] }`,
    );
  }
  const passthrough = Reflect.get(value, "passthrough");
  if (!Array.isArray(passthrough)) {
    throw new Error(
      `provider "${providerId}" experimental_env.passthrough must be an array of variable names`,
    );
  }
  if (passthrough.length > PROVIDER_ENV_PASSTHROUGH_MAX) {
    throw new Error(
      `provider "${providerId}" experimental_env.passthrough names more than ${PROVIDER_ENV_PASSTHROUGH_MAX} variables`,
    );
  }
  const seen = new Set<string>();
  for (const name of passthrough) {
    if (typeof name !== "string" || !PROVIDER_ENV_NAME_PATTERN.test(name)) {
      throw new Error(
        `provider "${providerId}" experimental_env.passthrough entries must match ${PROVIDER_ENV_NAME_PATTERN}`,
      );
    }
    if (seen.has(name)) {
      throw new Error(
        `provider "${providerId}" experimental_env.passthrough repeats ${JSON.stringify(name)}`,
      );
    }
    seen.add(name);
  }
  return Object.freeze([...seen]);
}

function validateProviderFallbackModels(
  providerId: string,
  value: unknown,
): readonly PluginProviderFallbackModel[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `provider "${providerId}" experimental_models must be { fallback: [...] }`,
    );
  }
  const fallback = Reflect.get(value, "fallback");
  if (!Array.isArray(fallback)) {
    throw new Error(
      `provider "${providerId}" experimental_models.fallback must be an array`,
    );
  }
  if (fallback.length > PROVIDER_FALLBACK_MODELS_MAX) {
    throw new Error(
      `provider "${providerId}" experimental_models.fallback lists more than ${PROVIDER_FALLBACK_MODELS_MAX} models`,
    );
  }
  const seen = new Set<string>();
  let defaults = 0;
  const normalized = fallback.map((entry, index): PluginProviderFallbackModel => {
    const field = `experimental_models.fallback[${index}]`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`provider "${providerId}" ${field} must be an object`);
    }
    const record: Record<string, unknown> = Object.fromEntries(
      Object.entries(entry),
    );
    const id = requireNonBlankString({
      providerId,
      field: `${field}.id`,
      value: record.id,
    });
    if (seen.has(id)) {
      throw new Error(
        `provider "${providerId}" experimental_models.fallback id ${JSON.stringify(id)} is duplicated`,
      );
    }
    seen.add(id);
    const displayName = requireNonBlankString({
      providerId,
      field: `${field}.displayName`,
      value: record.displayName,
    });
    const description = requireNonBlankString({
      providerId,
      field: `${field}.description`,
      value: record.description,
    });
    const efforts = record.supportedReasoningEfforts;
    if (!Array.isArray(efforts) || efforts.length === 0) {
      throw new Error(
        `provider "${providerId}" ${field}.supportedReasoningEfforts must be a non-empty array`,
      );
    }
    const levels = new Set<PluginProviderReasoningLevel>();
    const supportedReasoningEfforts = efforts.map(
      (
        effort,
        effortIndex,
      ): PluginProviderFallbackModel["supportedReasoningEfforts"][number] => {
        if (
          typeof effort !== "object" ||
          effort === null ||
          Array.isArray(effort)
        ) {
          throw new Error(
            `provider "${providerId}" ${field}.supportedReasoningEfforts[${effortIndex}] must be { reasoningEffort, description }`,
          );
        }
        const reasoningEffort = Reflect.get(effort, "reasoningEffort");
        if (
          typeof reasoningEffort !== "string" ||
          !(PLUGIN_PROVIDER_REASONING_LEVEL_VALUES as readonly string[]).includes(
            reasoningEffort,
          )
        ) {
          throw new Error(
            `provider "${providerId}" ${field}.supportedReasoningEfforts[${effortIndex}].reasoningEffort must be one of ${PLUGIN_PROVIDER_REASONING_LEVEL_VALUES.join(", ")}`,
          );
        }
        const level = reasoningEffort as PluginProviderReasoningLevel;
        if (levels.has(level)) {
          throw new Error(
            `provider "${providerId}" ${field}.supportedReasoningEfforts repeats ${JSON.stringify(level)}`,
          );
        }
        levels.add(level);
        return Object.freeze({
          reasoningEffort: level,
          description: requireNonBlankString({
            providerId,
            field: `${field}.supportedReasoningEfforts[${effortIndex}].description`,
            value: Reflect.get(effort, "description"),
          }),
        });
      },
    );
    const defaultReasoningEffort = record.defaultReasoningEffort;
    if (
      typeof defaultReasoningEffort !== "string" ||
      !levels.has(defaultReasoningEffort as PluginProviderReasoningLevel)
    ) {
      throw new Error(
        `provider "${providerId}" ${field}.defaultReasoningEffort must be one of its supportedReasoningEfforts`,
      );
    }
    if (typeof record.isDefault !== "boolean") {
      throw new Error(
        `provider "${providerId}" ${field}.isDefault must be a boolean`,
      );
    }
    if (record.isDefault) defaults += 1;
    return Object.freeze({
      id,
      displayName,
      description,
      supportedReasoningEfforts: Object.freeze(supportedReasoningEfforts),
      defaultReasoningEffort:
        defaultReasoningEffort as PluginProviderReasoningLevel,
      isDefault: record.isDefault,
    });
  });
  if (normalized.length > 0 && defaults !== 1) {
    throw new Error(
      `provider "${providerId}" experimental_models.fallback must mark exactly one model isDefault (found ${defaults})`,
    );
  }
  return Object.freeze(normalized);
}

/**
 * Validate one `bb.providers.register` declaration. Plugin
 * sources are untyped at runtime, so every field is checked; the production
 * host and the fake host both call this, so they accept and reject provider
 * declarations identically. Throws a descriptive error on the first problem;
 * returns a normalized, deeply frozen copy carrying only contract fields.
 */
export function validatePluginProviderDeclaration(
  declaration: PluginProviderDeclaration,
): PluginProviderDeclaration {
  if (typeof declaration !== "object" || declaration === null) {
    throw new Error("provider declaration must be an object");
  }
  const id = declaration.id;
  if (typeof id !== "string" || !PROVIDER_ID_PATTERN.test(id)) {
    throw new Error(
      `invalid provider id ${JSON.stringify(id)} — use 2-64 lowercase letters, digits, and "-", starting with a letter or digit`,
    );
  }
  const family = declaration.experimental_family;
  if (
    family !== undefined &&
    (typeof family !== "string" || !PROVIDER_ID_PATTERN.test(family))
  ) {
    throw new Error(
      `provider "${id}" experimental_family must use the provider id grammar (2-64 lowercase letters, digits, and "-")`,
    );
  }
  const displayName =
    typeof declaration.displayName === "string"
      ? declaration.displayName.trim()
      : "";
  if (
    displayName.length === 0 ||
    displayName.length > PLUGIN_PROVIDER_DISPLAY_NAME_MAX_CHARS
  ) {
    throw new Error(
      `provider "${id}" displayName must be 1-${PLUGIN_PROVIDER_DISPLAY_NAME_MAX_CHARS} non-blank characters`,
    );
  }
  let icon: string | undefined;
  if (declaration.icon !== undefined) {
    if (
      typeof declaration.icon !== "string" ||
      declaration.icon.trim() === ""
    ) {
      throw new Error(
        `provider "${id}" icon must be a non-blank string — a named host glyph ("Zap") or a plugin-relative path ("./icons/agent.svg")`,
      );
    }
    // Same grammar as `bb.branding.icon`: a leading "./" means a plugin-owned
    // file and gets the escape rules; anything else names a host glyph. A
    // path-shaped value without the "./" prefix is neither, and would
    // otherwise be read as a glyph name that resolves to nothing.
    if (isPluginOwnedIconPath(declaration.icon)) {
      icon = validateProviderRelativePath(declaration.icon, `"${id}" icon`);
    } else if (/[/\\]/u.test(declaration.icon)) {
      throw new Error(
        `provider "${id}" icon looks like a path but does not start with "./" — use "./icons/agent.svg" for a plugin file, or a bare host glyph name like "Zap"`,
      );
    } else {
      icon = declaration.icon;
    }
  }
  const capabilities = declaration.capabilities;
  if (typeof capabilities !== "object" || capabilities === null) {
    throw new Error(`provider "${id}" capabilities must be an object`);
  }
  // These fields were originally reported by the bridge handshake. Treat an
  // omitted value from a plugin compiled against that older experimental API
  // as false, then carry an explicit boolean everywhere inside bb.
  const experimentalProviderHealth =
    capabilities.experimental_providerHealth ?? false;
  const experimentalProviderUsage =
    capabilities.experimental_providerUsage ?? false;
  const experimentalProviderInstallation =
    capabilities.experimental_providerInstallation ?? false;
  if (typeof experimentalProviderHealth !== "boolean") {
    throw new Error(
      `provider "${id}" capabilities.experimental_providerHealth must be a boolean`,
    );
  }
  if (typeof experimentalProviderUsage !== "boolean") {
    throw new Error(
      `provider "${id}" capabilities.experimental_providerUsage must be a boolean`,
    );
  }
  if (typeof experimentalProviderInstallation !== "boolean") {
    throw new Error(
      `provider "${id}" capabilities.experimental_providerInstallation must be a boolean`,
    );
  }
  const booleanCapabilityFields = [
    "supportsServiceTier",
    "supportsNativeUserQuestion",
    "supportsManualCompaction",
    "supportsThreadArchive",
    "supportsThreadRename",
  ] as const;
  for (const field of booleanCapabilityFields) {
    if (typeof capabilities[field] !== "boolean") {
      throw new Error(
        `provider "${id}" capabilities.${field} must be a boolean`,
      );
    }
  }
  if (
    !(PROVIDER_FORK_VALUES as readonly string[]).includes(capabilities.fork)
  ) {
    throw new Error(
      `provider "${id}" capabilities.fork must be one of ${PROVIDER_FORK_VALUES.join(", ")}`,
    );
  }
  const normalizedCapabilities: PluginProviderCapabilities = Object.freeze({
    experimental_providerHealth: experimentalProviderHealth,
    experimental_providerUsage: experimentalProviderUsage,
    experimental_providerInstallation: experimentalProviderInstallation,
    supportsServiceTier: capabilities.supportsServiceTier,
    supportsNativeUserQuestion: capabilities.supportsNativeUserQuestion,
    fork: capabilities.fork,
    supportsManualCompaction: capabilities.supportsManualCompaction,
    supportsThreadArchive: capabilities.supportsThreadArchive,
    supportsThreadRename: capabilities.supportsThreadRename,
    permissionModes: validateProviderLiteralArray({
      providerId: id,
      field: "capabilities.permissionModes",
      value: capabilities.permissionModes,
      allowed: PLUGIN_PROVIDER_PERMISSION_MODE_VALUES,
      requireNonEmpty: true,
    }),
    reasoningLevels: validateProviderLiteralArray({
      providerId: id,
      field: "capabilities.reasoningLevels",
      value: capabilities.reasoningLevels,
      allowed: PLUGIN_PROVIDER_REASONING_LEVEL_VALUES,
      requireNonEmpty: true,
    }),
  });
  const composerActions = validateProviderLiteralArray({
    providerId: id,
    field: "composerActions",
    value: declaration.composerActions,
    allowed: PLUGIN_PROVIDER_COMPOSER_ACTION_VALUES,
    requireNonEmpty: false,
  });
  const bridgeOptions =
    declaration.experimental_bridgeOptions === undefined
      ? undefined
      : normalizeProviderBridgeOptions(
          id,
          declaration.experimental_bridgeOptions,
        );
  const visibility = declaration.experimental_visibility ?? "always";
  if (visibility !== "always" && visibility !== "installed") {
    throw new Error(
      `provider "${id}" experimental_visibility must be "always" or "installed"`,
    );
  }
  if (
    visibility === "installed" &&
    !normalizedCapabilities.experimental_providerHealth
  ) {
    throw new Error(
      `provider "${id}" experimental_visibility "installed" requires experimental_providerHealth`,
    );
  }
  // Target-state declaration fields: validated and carried when present so
  // WS2a can project them, never silently dropped.
  const strings =
    declaration.experimental_strings === undefined
      ? undefined
      : validateProviderStrings(id, declaration.experimental_strings);
  const serviceTiers =
    declaration.experimental_serviceTiers === undefined
      ? undefined
      : validateProviderOptionDescriptors({
          providerId: id,
          field: "experimental_serviceTiers",
          value: declaration.experimental_serviceTiers,
        });
  const reasoningLevels =
    declaration.experimental_reasoningLevels === undefined
      ? undefined
      : validateProviderOptionDescriptors({
          providerId: id,
          field: "experimental_reasoningLevels",
          value: declaration.experimental_reasoningLevels,
        });
  const extensionKinds =
    declaration.experimental_extensionKinds === undefined
      ? undefined
      : validateProviderExtensionKinds(
          id,
          declaration.experimental_extensionKinds,
        );
  const fallbackModels =
    declaration.experimental_models === undefined
      ? undefined
      : validateProviderFallbackModels(id, declaration.experimental_models);
  const envPassthrough =
    declaration.experimental_env === undefined
      ? undefined
      : validateProviderEnvPassthrough(id, declaration.experimental_env);
  const deriveProviderOptions = declaration.experimental_deriveProviderOptions;
  if (
    deriveProviderOptions !== undefined &&
    typeof deriveProviderOptions !== "function"
  ) {
    throw new Error(
      `provider "${id}" experimental_deriveProviderOptions must be a function (context) => providerOptions`,
    );
  }
  return Object.freeze({
    id,
    displayName,
    ...(family === undefined ? {} : { experimental_family: family }),
    ...(icon === undefined ? {} : { icon }),
    ...(bridgeOptions === undefined
      ? {}
      : { experimental_bridgeOptions: bridgeOptions }),
    experimental_visibility: visibility,
    capabilities: normalizedCapabilities,
    composerActions,
    ...(strings === undefined ? {} : { experimental_strings: strings }),
    ...(serviceTiers === undefined
      ? {}
      : { experimental_serviceTiers: serviceTiers }),
    ...(reasoningLevels === undefined
      ? {}
      : { experimental_reasoningLevels: reasoningLevels }),
    ...(extensionKinds === undefined
      ? {}
      : { experimental_extensionKinds: extensionKinds }),
    ...(fallbackModels === undefined
      ? {}
      : { experimental_models: Object.freeze({ fallback: fallbackModels }) }),
    ...(envPassthrough === undefined
      ? {}
      : { experimental_env: Object.freeze({ passthrough: envPassthrough }) }),
    ...(deriveProviderOptions === undefined
      ? {}
      : { experimental_deriveProviderOptions: deriveProviderOptions }),
  });
}

/**
 * Run a declaration's `experimental_deriveProviderOptions` hook for one
 * command and validate its result as a bounded, plain-JSON object — the same
 * rules as `experimental_bridgeOptions`, because the result rides the same
 * wire slot. Shared by the real host and the fake so a hook that works in
 * tests works in production.
 */
export function deriveValidatedProviderOptions(args: {
  declaration: PluginProviderDeclaration;
  context: Parameters<
    NonNullable<PluginProviderDeclaration["experimental_deriveProviderOptions"]>
  >[0];
}): Readonly<Record<string, JsonValue>> {
  const hook = args.declaration.experimental_deriveProviderOptions;
  if (hook === undefined) return Object.freeze({});
  const result = hook(args.context);
  return normalizeProviderBridgeOptions(
    args.declaration.id,
    result,
    "experimental_deriveProviderOptions result",
  );
}

export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  if (typeof value !== "object" || value === null) return false;
  const standard = Reflect.get(value, "~standard");
  return (
    typeof standard === "object" &&
    standard !== null &&
    Reflect.get(standard, "version") === 1 &&
    typeof Reflect.get(standard, "vendor") === "string" &&
    typeof Reflect.get(standard, "validate") === "function"
  );
}

export function readRpcMethodContract(
  method: string,
  value: unknown,
): PluginRpcMethodContract {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `rpc method "${method}" contract must provide input and output Standard Schemas`,
    );
  }
  const input = Reflect.get(value, "input");
  const output = Reflect.get(value, "output");
  if (!isStandardSchema(input)) {
    throw new Error(
      `rpc method "${method}" input must be a Standard Schema v1 validator`,
    );
  }
  if (!isStandardSchema(output)) {
    throw new Error(
      `rpc method "${method}" output must be a Standard Schema v1 validator`,
    );
  }
  return { input, output };
}

/** Duck-typed zod detection: plugin sources may carry their own zod copy,
 * so instanceof is useless — anything with safeParse is treated as zod. */
export function isZodSchemaLike(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { safeParse?: unknown }).safeParse === "function"
  );
}

const SINGLE_SCHEMA_KEYWORDS = [
  "additionalItems",
  "additionalProperties",
  "contains",
  "contentSchema",
  "else",
  "if",
  "items",
  "not",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
] as const;

const SCHEMA_ARRAY_KEYWORDS = [
  "allOf",
  "anyOf",
  "oneOf",
  "prefixItems",
] as const;

const SCHEMA_MAP_KEYWORDS = [
  "$defs",
  "definitions",
  "dependentSchemas",
  "patternProperties",
  "properties",
] as const;

function isJsonSchemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeJsonPointerToken(token: string): string {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

function resolveLocalJsonSchemaReference(
  document: Record<string, unknown>,
  anchors: ReadonlyMap<string, Record<string, unknown>>,
  reference: string,
): unknown {
  if (!reference.startsWith("#")) return undefined;
  let pointer: string;
  try {
    pointer = decodeURIComponent(reference.slice(1));
  } catch {
    return undefined;
  }
  if (pointer.length === 0) return document;
  if (!pointer.startsWith("/")) return anchors.get(pointer);

  let current: unknown = document;
  for (const encodedToken of pointer.slice(1).split("/")) {
    const token = decodeJsonPointerToken(encodedToken);
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token)) return undefined;
      current = current[Number(token)];
      continue;
    }
    if (!isJsonSchemaObject(current) || !Object.hasOwn(current, token)) {
      return undefined;
    }
    current = current[token];
  }
  return current;
}

function forEachJsonSchemaChild(
  schema: Record<string, unknown>,
  visit: (child: unknown) => void,
): void {
  for (const keyword of SINGLE_SCHEMA_KEYWORDS) {
    const child = schema[keyword];
    if (Array.isArray(child)) {
      for (const entry of child) visit(entry);
    } else {
      visit(child);
    }
  }
  for (const keyword of SCHEMA_ARRAY_KEYWORDS) {
    const children = schema[keyword];
    if (!Array.isArray(children)) continue;
    for (const child of children) visit(child);
  }
  for (const keyword of SCHEMA_MAP_KEYWORDS) {
    const children = schema[keyword];
    if (!isJsonSchemaObject(children)) continue;
    for (const child of Object.values(children)) visit(child);
  }
  const dependencies = schema.dependencies;
  if (isJsonSchemaObject(dependencies)) {
    for (const dependency of Object.values(dependencies)) {
      if (!Array.isArray(dependency)) visit(dependency);
    }
  }
}

/**
 * Reject recursive local references before a tool schema reaches a provider.
 * Some providers reject the complete tool list when any one schema contains a
 * recursive `$ref`, so this is a shared production/fake-host boundary rule.
 */
export function assertNoRecursiveJsonSchemaReferences(
  schema: unknown,
  subject: string,
): void {
  if (!isJsonSchemaObject(schema)) return;
  const document = schema;
  const anchors = new Map<string, Record<string, unknown>>();
  const indexed = new Set<object>();

  function indexAnchors(candidate: unknown): void {
    if (!isJsonSchemaObject(candidate) || indexed.has(candidate)) return;
    indexed.add(candidate);
    for (const keyword of ["$anchor", "$dynamicAnchor"] as const) {
      const anchor = candidate[keyword];
      if (typeof anchor === "string") anchors.set(anchor, candidate);
    }
    for (const keyword of ["$id", "id"] as const) {
      const id = candidate[keyword];
      if (typeof id === "string" && /^#[^/]+$/.test(id)) {
        anchors.set(id.slice(1), candidate);
      }
    }
    forEachJsonSchemaChild(candidate, indexAnchors);
  }

  indexAnchors(document);

  const visited = new Set<object>();
  const visiting = new Set<object>();

  function visit(
    candidate: unknown,
    viaReference?: { keyword: string; value: string },
  ): void {
    if (typeof candidate === "boolean" || !isJsonSchemaObject(candidate)) {
      return;
    }
    if (visiting.has(candidate)) {
      throw new Error(
        `${subject} contains recursive JSON Schema ${viaReference?.keyword ?? "$ref"} ${JSON.stringify(viaReference?.value ?? "#")}`,
      );
    }
    if (visited.has(candidate)) return;

    visiting.add(candidate);
    for (const keyword of ["$ref", "$recursiveRef", "$dynamicRef"] as const) {
      const reference = candidate[keyword];
      if (typeof reference === "string" && reference.startsWith("#")) {
        const target = resolveLocalJsonSchemaReference(
          document,
          anchors,
          reference,
        );
        if (target !== undefined) {
          visit(target, { keyword, value: reference });
        }
      }
    }
    forEachJsonSchemaChild(candidate, visit);

    visiting.delete(candidate);
    visited.add(candidate);
  }

  visit(schema);
}

/** Compact issue summary from a (possibly foreign-instance) zod error. */
export function summarizeParseIssues(error: unknown): string {
  const issues = (
    error as { issues?: Array<{ path?: PropertyKey[]; message?: string }> }
  )?.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    return issues
      .map((issue) => {
        const path =
          Array.isArray(issue.path) && issue.path.length > 0
            ? issue.path.join(".")
            : "(input)";
        return `${path}: ${issue.message ?? "invalid"}`;
      })
      .join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

export function enforcePluginCliOutputLimit(
  result: Omit<PluginCliExecutionResult, "error">,
  jsonOutput: boolean,
): PluginCliExecutionResult {
  const stdoutBytes = Buffer.byteLength(result.stdout, "utf8");
  const stderrBytes = Buffer.byteLength(result.stderr, "utf8");
  const totalBytes = stdoutBytes + stderrBytes;
  if (totalBytes <= PLUGIN_CLI_OUTPUT_MAX_BYTES) return result;

  const error: PluginCliOutputLimitError = {
    code: "plugin_cli_output_too_large",
    message:
      `Plugin CLI output is ${totalBytes} bytes (${stdoutBytes} stdout + ${stderrBytes} stderr), ` +
      `exceeding the ${PLUGIN_CLI_OUTPUT_MAX_BYTES}-byte limit. Narrow the query, request a smaller page, or use a file/streaming command.`,
    maxBytes: PLUGIN_CLI_OUTPUT_MAX_BYTES,
    stdoutBytes,
    stderrBytes,
    totalBytes,
  };
  return jsonOutput
    ? {
        exitCode: 1,
        stdout: JSON.stringify({ error }),
        stderr: "",
        error,
      }
    : { exitCode: 1, stdout: "", stderr: error.message, error };
}

/**
 * Adopt the value a plugin HTTP route handler returned.
 *
 * Plugin handlers can run in a different realm (jiti-loaded modules, bundled
 * fetch polyfills), so a valid `Response` from a handler can fail
 * `instanceof Response` in the host (#1661). Both the real host and the fake
 * host accept a structurally valid Response from any realm and re-wrap it
 * into a this-realm `Response`, so Hono always consumes a native object and a
 * malformed return still fails at the invoke boundary with a pointed error.
 *
 * The body streams through: a foreign `body` stream is piped chunk by chunk
 * with cancellation forwarded to the source, so no full-size buffer is made.
 */
export function adoptHttpRouteResponse(value: unknown): Response {
  if (value instanceof Response) return value;
  if (!isResponseLike(value)) {
    throw new Error("http route handler must return a Response");
  }
  const status = value.status;
  const isNullBodyStatus =
    status === 101 || status === 204 || status === 205 || status === 304;
  const init: ResponseInit = {
    status,
    statusText: typeof value.statusText === "string" ? value.statusText : "",
    headers: new Headers(value.headers),
  };
  if (isNullBodyStatus || value.body === null) {
    return new Response(null, init);
  }
  return new Response(adoptBodyStream(value), init);
}

function adoptBodyStream(value: Response): ReadableStream<Uint8Array> {
  const source = value.body;
  if (!isReadableStreamLike(source)) {
    // No usable stream (for example a body already consumed by a proxy):
    // fall back to the buffered body so the route still returns its content.
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new Uint8Array(await value.arrayBuffer()));
        controller.close();
      },
    });
  }
  const reader = source.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value: chunk } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}

function isReadableStreamLike(
  value: unknown,
): value is ReadableStream<Uint8Array> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as ReadableStream).getReader === "function"
  );
}

function isResponseLike(value: unknown): value is Response {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<Response>;
  return (
    typeof candidate.status === "number" &&
    typeof candidate.headers === "object" &&
    candidate.headers !== null &&
    typeof candidate.arrayBuffer === "function" &&
    typeof candidate.clone === "function"
  );
}
