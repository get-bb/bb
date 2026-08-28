import { z } from "zod";
import {
  isNamespacedGlyph,
  isPluginOwnedIconPath,
  parseNamespacedGlyph,
} from "@bb/domain/plugin-icon";
import { RESERVED_BB_CLI_COMMANDS } from "@bb/domain/plugin-cli";
import { PROVIDER_FORK_VALUES } from "@bb/domain/provider-fork";
import {
  normalizeProviderNativeRoots,
  providerNativeRootsInputSchema,
  providerNativeRootsSchema,
  type ProviderNativeRoots,
} from "@bb/domain";
import { PLUGIN_CLI_OUTPUT_MAX_BYTES } from "../backend-contract.js";
import type {
  PluginAgentToolPresentation,
  PluginAiServiceDeclaration,
  PluginAiServiceKind,
  PluginCliExecutionResult,
  PluginCliOutputLimitError,
  PluginMentionTrigger,
  PluginProviderCapabilities,
  PluginProviderComposerAction,
  PluginProviderDeclaration,
  PluginProviderExtensionKindDeclaration,
  PluginProviderFallbackModel,
  PluginProviderModelCatalogScope,
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

type HostPolicyInput = {} | null | undefined;

const hostPolicyStringSchema = z.string();
const hostPolicyBooleanSchema = z.boolean();
const hostPolicyNumberSchema = z.number();
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
type HostPolicyRecord = Record<string, JsonValue | object | undefined>;
type HostPolicyJsonRecord = Readonly<Record<string, JsonValue>>;
const hostPolicyArrayInputSchema = z.array(z.custom<HostPolicyInput>());
type HostPolicyArray = z.infer<typeof hostPolicyArrayInputSchema>;
const hostPolicyArraySchema = z.custom<HostPolicyArray>(
  (value) => hostPolicyArrayInputSchema.safeParse(value).success,
);

function parseHostPolicyString<T>(value: T): string | undefined {
  const parsed = hostPolicyStringSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function parseHostPolicyBoolean<T>(value: T): boolean | undefined {
  const parsed = hostPolicyBooleanSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function requireHostPolicyBoolean(
  value: HostPolicyInput,
  message: string,
): boolean {
  const parsed = parseHostPolicyBoolean(value);
  if (parsed === undefined) throw new Error(message);
  return parsed;
}

function parseHostPolicyNumber<T>(value: T): number | undefined {
  const parsed = hostPolicyNumberSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  return Object.prototype.toString.call(value) === "[object Number]"
    ? Number(value)
    : undefined;
}

function parseHostPolicyRecord<T>(value: T): HostPolicyRecord | undefined {
  if (
    value === null ||
    Object(value) !== value ||
    Array.isArray(value) ||
    parseHostPolicyFunction(value)
  ) {
    return undefined;
  }
  // SAFETY: Object and array/function checks establish the runtime record shape.
  return value as HostPolicyRecord;
}

function parseHostPolicyJsonRecord<T>(
  value: T,
): HostPolicyJsonRecord | undefined {
  if (
    value === null ||
    Object(value) !== value ||
    Array.isArray(value) ||
    parseHostPolicyFunction(value)
  ) {
    return undefined;
  }
  // SAFETY: Object and array/function checks establish the runtime JSON record shape.
  return value as HostPolicyJsonRecord;
}

function parseHostPolicyFunction<T>(value: T): Function | undefined {
  const kind = Object.prototype.toString.call(value);
  // SAFETY: The function tag establishes that this value is callable.
  return kind.endsWith("Function]") ? (value as Function) : undefined;
}

/**
 * Shared registration policy for the real plugin host and the in-process fake.
 *
 * These rules decide whether `bb.*.register()` throws. The fake host must
 * accept and reject the same names, schemas, and caps as production so plugin
 * unit tests are not lying about load-time behavior.
 */

export { RESERVED_BB_CLI_COMMANDS };

export function pluginCliCollisionWarning(
  pluginId: string,
  commandName: string,
): string | null {
  if (!RESERVED_BB_CLI_COMMANDS.includes(commandName)) return null;
  return `CLI command "${commandName}" collides with core command "bb ${commandName}"; core keeps the short form. Use "bb plugin run ${pluginId}" to invoke this plugin.`;
}

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
      experimental_multiline: z.boolean().optional(),
      default: z.string().optional(),
    })
    .strict()
    // A secret is edited in a one-line password field and never echoed back,
    // so a multi-line secret has no rendering; refuse the pair at define time.
    .refine(
      (descriptor) =>
        !(
          descriptor.secret === true &&
          descriptor.experimental_multiline === true
        ),
      {
        message: "a secret setting cannot be experimental_multiline",
        path: ["experimental_multiline"],
      },
    ),
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
export function registerSettingDescriptors<T>(
  target: PluginSettingDescriptors,
  added: Record<string, T>,
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
export function validateSettingsUpdate<T>(
  descriptors: PluginSettingDescriptors,
  values: Record<string, T>,
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
      if (parseHostPolicyBoolean(value) === undefined) {
        errors.push(`setting "${key}" expects a boolean`);
      }
      continue;
    }
    const stringValue = parseHostPolicyString(value);
    if (stringValue === undefined) {
      errors.push(`setting "${key}" expects a string`);
      continue;
    }
    if (
      descriptor.type === "select" &&
      !descriptor.options.includes(stringValue)
    ) {
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

export function isPluginMentionTrigger<T>(
  value: T,
): value is PluginMentionTrigger & T {
  const parsed = parseHostPolicyString(value);
  return (
    parsed !== undefined &&
    PLUGIN_MENTION_TRIGGER_VALUES.some((trigger) => trigger === parsed)
  );
}

export function normalizeMentionProviderTriggers<T>(
  providerId: string,
  triggers: T,
): readonly PluginMentionTrigger[] {
  if (triggers === undefined) {
    return DEFAULT_PLUGIN_MENTION_TRIGGERS;
  }
  const parsedTriggers = z
    .array(z.custom<HostPolicyInput>())
    .safeParse(triggers);
  if (!parsedTriggers.success) {
    throw new Error(
      `mention provider "${providerId}" triggers must be an array`,
    );
  }
  if (parsedTriggers.data.length === 0) {
    throw new Error(
      `mention provider "${providerId}" triggers must include at least one trigger`,
    );
  }
  const seen = new Set<PluginMentionTrigger>();
  const normalized: PluginMentionTrigger[] = [];
  for (const trigger of parsedTriggers.data) {
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
function validateProviderRelativePath(
  value: HostPolicyInput,
  label: string,
): string {
  const parsed = parseHostPolicyString(value);
  if (parsed === undefined || parsed.trim().length === 0) {
    throw new Error(`provider ${label} must be a non-blank relative path`);
  }
  if (parsed.includes("\\")) {
    throw new Error(
      `provider ${label} must use "/" separators, got ${JSON.stringify(parsed)}`,
    );
  }
  if (parsed.startsWith("/")) {
    throw new Error(
      `provider ${label} must be relative, got ${JSON.stringify(parsed)}`,
    );
  }
  if (parsed.split("/").some((segment) => segment === "..")) {
    throw new Error(
      `provider ${label} must not escape the plugin directory, got ${JSON.stringify(parsed)}`,
    );
  }
  return parsed;
}

function validateProviderLiteralArray<T extends string>(args: {
  providerId: string;
  field: string;
  value: HostPolicyInput;
  allowed: readonly T[];
  requireNonEmpty: boolean;
}): readonly T[] {
  const { providerId, field, value, allowed, requireNonEmpty } = args;
  const parsedValue = z.array(z.custom<HostPolicyInput>()).safeParse(value);
  if (!parsedValue.success) {
    throw new Error(`provider "${providerId}" ${field} must be an array`);
  }
  if (requireNonEmpty && parsedValue.data.length === 0) {
    throw new Error(
      `provider "${providerId}" ${field} must include at least one entry`,
    );
  }
  const seen = new Set<T>();
  const normalized: T[] = [];
  for (const entry of parsedValue.data) {
    const parsedEntry = parseHostPolicyString(entry);
    const literal =
      parsedEntry === undefined
        ? undefined
        : allowed.find((candidate) => candidate === parsedEntry);
    if (literal === undefined) {
      throw new Error(
        `provider "${providerId}" ${field} entry ${JSON.stringify(entry)} is invalid; use one of ${allowed.join(", ")}`,
      );
    }
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
  function visit(current: HostPolicyInput, path: string): JsonValue {
    if (current === null) return current;
    const parsedString = parseHostPolicyString(current);
    if (parsedString !== undefined) return parsedString;
    const parsedBoolean = parseHostPolicyBoolean(current);
    if (parsedBoolean !== undefined) return parsedBoolean;
    const parsedNumber = parseHostPolicyNumber(current);
    if (parsedNumber !== undefined) {
      if (!Number.isFinite(parsedNumber)) {
        throw new Error(
          `provider "${providerId}" ${label}${path} must be finite JSON`,
        );
      }
      return parsedNumber;
    }
    const parsedArray = hostPolicyArraySchema.safeParse(current);
    const parsedRecord = parseHostPolicyRecord(current);
    if (!parsedArray.success && parsedRecord === undefined) {
      throw new Error(`provider "${providerId}" ${label}${path} must be JSON`);
    }
    const container = parsedArray.success ? parsedArray.data : parsedRecord;
    if (container === undefined) {
      throw new Error(`provider "${providerId}" ${label}${path} must be JSON`);
    }
    if (active.has(container)) {
      throw new Error(
        `provider "${providerId}" experimental_bridgeOptions must not contain cycles`,
      );
    }
    active.add(container);
    try {
      if (parsedArray.success) {
        const normalized = parsedArray.data.map((entry, index) =>
          visit(entry, `${path}[${index}]`),
        );
        Object.freeze(normalized);
        return normalized;
      }
      const objectValue = parsedRecord;
      if (objectValue === undefined) {
        throw new Error(
          `provider "${providerId}" ${label}${path} must be JSON`,
        );
      }
      const prototype = Object.getPrototypeOf(objectValue);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error(
          `provider "${providerId}" ${label}${path} must contain only plain JSON objects`,
        );
      }
      const normalized: Record<string, JsonValue> = Object.fromEntries(
        Object.entries(objectValue).map(([key, entry]) => [
          key,
          visit(entry, `${path}.${key}`),
        ]),
      );
      Object.freeze(normalized);
      return normalized;
    } finally {
      active.delete(container);
    }
  }

  const normalized = visit(value, "");
  const normalizedRecord = parseHostPolicyJsonRecord(normalized);
  if (normalizedRecord === undefined) {
    throw new Error(`provider "${providerId}" ${label} must be an object`);
  }
  if (
    Buffer.byteLength(JSON.stringify(normalizedRecord), "utf8") >
    PLUGIN_PROVIDER_BRIDGE_OPTIONS_MAX_BYTES
  ) {
    throw new Error(
      `provider "${providerId}" ${label} exceeds ${PLUGIN_PROVIDER_BRIDGE_OPTIONS_MAX_BYTES} bytes`,
    );
  }
  return normalizedRecord;
}

const PROVIDER_STRING_MAX_CHARS = 512;
const PROVIDER_EXTENSION_KIND_NAME_PATTERN = /^[a-z0-9-]+$/u;
const PROVIDER_EXTENSION_KINDS_MAX = 32;

function requireNonBlankString(args: {
  providerId: string;
  field: string;
  value: HostPolicyInput;
}): string {
  const { providerId, field, value } = args;
  const parsed = parseHostPolicyString(value);
  if (
    parsed === undefined ||
    parsed.trim().length === 0 ||
    parsed.length > PROVIDER_STRING_MAX_CHARS
  ) {
    throw new Error(
      `provider "${providerId}" ${field} must be a non-blank string of at most ${PROVIDER_STRING_MAX_CHARS} characters`,
    );
  }
  return parsed;
}

function validateProviderStrings(
  providerId: string,
  value: HostPolicyInput,
): PluginProviderStrings {
  const record = parseHostPolicyRecord(value);
  if (record === undefined) {
    throw new Error(`provider "${providerId}" strings must be an object`);
  }
  const required = (field: "signInHint" | "expiredHint" | "installUrl") =>
    requireNonBlankString({
      providerId,
      field: `strings.${field}`,
      value: record[field],
    });
  const optional = (field: "brandPrefix" | "planModeCopy") =>
    record[field] === undefined
      ? undefined
      : requireNonBlankString({
          providerId,
          field: `strings.${field}`,
          value: record[field],
        });
  let iconTint: PluginProviderStrings["iconTint"];
  if (record.iconTint !== undefined) {
    const tint = record.iconTint;
    const tintRecord = parseHostPolicyRecord(tint);
    if (tintRecord === undefined) {
      throw new Error(
        `provider "${providerId}" strings.iconTint must be { light, dark }`,
      );
    }
    iconTint = Object.freeze({
      light: requireNonBlankString({
        providerId,
        field: "strings.iconTint.light",
        value: tintRecord.light,
      }),
      dark: requireNonBlankString({
        providerId,
        field: "strings.iconTint.dark",
        value: tintRecord.dark,
      }),
    });
  }
  const brandPrefix = optional("brandPrefix");
  const planModeCopy = optional("planModeCopy");
  const result: PluginProviderStrings = {
    signInHint: required("signInHint"),
    expiredHint: required("expiredHint"),
    installUrl: required("installUrl"),
  };
  if (brandPrefix !== undefined) result.brandPrefix = brandPrefix;
  if (planModeCopy !== undefined) result.planModeCopy = planModeCopy;
  if (iconTint !== undefined) result.iconTint = iconTint;
  return Object.freeze(result);
}

function validateProviderOptionDescriptors(args: {
  providerId: string;
  field: string;
  value: HostPolicyInput;
}): readonly PluginProviderOptionDescriptor[] {
  const { providerId, field, value } = args;
  const parsedValue = z.array(z.custom<HostPolicyInput>()).safeParse(value);
  if (!parsedValue.success || parsedValue.data.length === 0) {
    throw new Error(
      `provider "${providerId}" ${field} must be a non-empty array of { id, label, description? }`,
    );
  }
  const seen = new Set<string>();
  const normalized = parsedValue.data.map(
    (entry, index): PluginProviderOptionDescriptor => {
      const record = parseHostPolicyRecord(entry);
      if (record === undefined) {
        throw new Error(
          `provider "${providerId}" ${field}[${index}] must be { id, label, description? }`,
        );
      }
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
      const result: PluginProviderOptionDescriptor = { id, label };
      if (description !== undefined) result.description = description;
      return Object.freeze(result);
    },
  );
  return Object.freeze(normalized);
}

function validateProviderExtensionKinds(
  providerId: string,
  value: HostPolicyInput,
): Readonly<Record<string, PluginProviderExtensionKindDeclaration>> {
  const parsedValue = parseHostPolicyRecord(value);
  if (parsedValue === undefined) {
    throw new Error(
      `provider "${providerId}" extensionKinds must be an object keyed by kind name`,
    );
  }
  const entries = Object.entries(parsedValue);
  if (entries.length > PROVIDER_EXTENSION_KINDS_MAX) {
    throw new Error(
      `provider "${providerId}" extensionKinds declares more than ${PROVIDER_EXTENSION_KINDS_MAX} kinds`,
    );
  }
  const normalized: Record<string, PluginProviderExtensionKindDeclaration> = {};
  for (const [name, declaration] of entries) {
    if (!PROVIDER_EXTENSION_KIND_NAME_PATTERN.test(name)) {
      throw new Error(
        `provider "${providerId}" extensionKinds name ${JSON.stringify(name)} must match ${PROVIDER_EXTENSION_KIND_NAME_PATTERN}`,
      );
    }
    const parsedDeclaration = parseHostPolicyRecord(declaration);
    if (parsedDeclaration === undefined) {
      throw new Error(
        `provider "${providerId}" extensionKinds.${name} must be { item?, state? }`,
      );
    }
    const item = parsedDeclaration.item;
    const state = parsedDeclaration.state;
    if (item === undefined && state === undefined) {
      throw new Error(
        `provider "${providerId}" extensionKinds.${name} must declare an item schema, a state schema, or both`,
      );
    }
    if (item !== undefined && !isStandardSchema(item)) {
      throw new Error(
        `provider "${providerId}" extensionKinds.${name}.item must be a Standard Schema v1 validator`,
      );
    }
    if (state !== undefined && !isStandardSchema(state)) {
      throw new Error(
        `provider "${providerId}" extensionKinds.${name}.state must be a Standard Schema v1 validator`,
      );
    }
    const normalizedDeclaration: PluginProviderExtensionKindDeclaration = {};
    if (item !== undefined) normalizedDeclaration.item = item;
    if (state !== undefined) normalizedDeclaration.state = state;
    normalized[name] = Object.freeze(normalizedDeclaration);
  }
  return Object.freeze(normalized);
}

const PROVIDER_FALLBACK_MODELS_MAX = 64;
const PROVIDER_ENV_PASSTHROUGH_MAX = 32;
const PROVIDER_ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/u;

function validateProviderEnvPassthrough(
  providerId: string,
  value: HostPolicyInput,
): readonly string[] {
  const parsedValue = parseHostPolicyRecord(value);
  if (parsedValue === undefined) {
    throw new Error(
      `provider "${providerId}" env must be { passthrough: [...] }`,
    );
  }
  const parsedPassthrough = z
    .array(z.custom<HostPolicyInput>())
    .safeParse(parsedValue.passthrough);
  if (!parsedPassthrough.success) {
    throw new Error(
      `provider "${providerId}" env.passthrough must be an array of variable names`,
    );
  }
  if (parsedPassthrough.data.length > PROVIDER_ENV_PASSTHROUGH_MAX) {
    throw new Error(
      `provider "${providerId}" env.passthrough names more than ${PROVIDER_ENV_PASSTHROUGH_MAX} variables`,
    );
  }
  const seen = new Set<string>();
  for (const name of parsedPassthrough.data) {
    const parsedName = parseHostPolicyString(name);
    if (
      parsedName === undefined ||
      !PROVIDER_ENV_NAME_PATTERN.test(parsedName)
    ) {
      throw new Error(
        `provider "${providerId}" env.passthrough entries must match ${PROVIDER_ENV_NAME_PATTERN}`,
      );
    }
    if (seen.has(parsedName)) {
      throw new Error(
        `provider "${providerId}" env.passthrough repeats ${JSON.stringify(parsedName)}`,
      );
    }
    seen.add(parsedName);
  }
  return Object.freeze([...seen]);
}

/**
 * A provider's own skill or command roots: the declaration's input form
 * (paths or paths with options) checked and normalized with the domain's own
 * schemas, so this boundary and the wire schema the daemon parses accept
 * exactly the same roots. Relative paths without dot segments, unique per
 * side, at most 32 per side; `ancestors` only on `project`; a name prefix is
 * a plugin-name-like token ending in ':'.
 */
function validateProviderNativeRoots(
  providerId: string,
  field: "experimental_nativeSkillRoots" | "experimental_nativeCommandRoots",
  value: HostPolicyInput,
): ProviderNativeRoots {
  const input = providerNativeRootsInputSchema.safeParse(value);
  if (!input.success) {
    const issue = input.error.issues[0];
    const where = issue?.path.length ? `.${issue.path.join(".")}` : "";
    throw new Error(
      `provider "${providerId}" ${field}${where} ${issue?.message ?? "is invalid"}`,
    );
  }
  const normalized = normalizeProviderNativeRoots(input.data);
  const wire = providerNativeRootsSchema.safeParse(normalized);
  if (!wire.success) {
    const issue = wire.error.issues[0];
    const where = issue?.path.length ? `.${issue.path.join(".")}` : "";
    throw new Error(
      `provider "${providerId}" ${field}${where} ${issue?.message ?? "is invalid"}`,
    );
  }
  const frozen = Object.freeze({
    user: Object.freeze(wire.data.user.map((root) => Object.freeze(root))),
    project: Object.freeze(
      wire.data.project.map((root) => Object.freeze(root)),
    ),
  });
  // SAFETY: providerNativeRootsSchema validates the root fields before freezing.
  return frozen as ProviderNativeRoots;
}

const PROVIDER_MODEL_CATALOG_SCOPES = [
  "host",
  "workspace",
] as const satisfies readonly PluginProviderModelCatalogScope[];

/**
 * How far one `model/list` answer travels. Absent means `"workspace"`: a
 * bridge bb knows nothing about may read the workspace path, and probing per
 * workspace is the answer that can only cost a redundant probe.
 */
function validateProviderModelCatalogScope(
  providerId: string,
  value: HostPolicyInput,
): PluginProviderModelCatalogScope {
  if (value === undefined) {
    return "workspace";
  }
  const parsed = parseHostPolicyString(value);
  if (
    parsed === undefined ||
    !PROVIDER_MODEL_CATALOG_SCOPES.some((scope) => scope === parsed)
  ) {
    throw new Error(
      `provider "${providerId}" models.scope must be one of ${PROVIDER_MODEL_CATALOG_SCOPES.join(", ")}`,
    );
  }
  return parsed === "host" ? "host" : "workspace";
}

/**
 * Returns undefined when the declaration carries `models` for a
 * reason other than a fallback list — `scope` alone is a valid declaration.
 */
function validateProviderFallbackModels(
  providerId: string,
  value: HostPolicyInput,
): readonly PluginProviderFallbackModel[] | undefined {
  const parsedValue = parseHostPolicyRecord(value);
  if (parsedValue === undefined) {
    throw new Error(`provider "${providerId}" models must be an object`);
  }
  const fallback = parsedValue.fallback;
  if (fallback === undefined) {
    return undefined;
  }
  const parsedFallback = z
    .array(z.custom<HostPolicyInput>())
    .safeParse(fallback);
  if (!parsedFallback.success) {
    throw new Error(
      `provider "${providerId}" models.fallback must be an array`,
    );
  }
  if (parsedFallback.data.length > PROVIDER_FALLBACK_MODELS_MAX) {
    throw new Error(
      `provider "${providerId}" models.fallback lists more than ${PROVIDER_FALLBACK_MODELS_MAX} models`,
    );
  }
  const seen = new Set<string>();
  let defaults = 0;
  const normalized = parsedFallback.data.map(
    (entry, index): PluginProviderFallbackModel => {
      const field = `models.fallback[${index}]`;
      const record = parseHostPolicyRecord(entry);
      if (record === undefined) {
        throw new Error(`provider "${providerId}" ${field} must be an object`);
      }
      const id = requireNonBlankString({
        providerId,
        field: `${field}.id`,
        value: record.id,
      });
      if (seen.has(id)) {
        throw new Error(
          `provider "${providerId}" models.fallback id ${JSON.stringify(id)} is duplicated`,
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
          const effortRecord = parseHostPolicyRecord(effort);
          if (effortRecord === undefined) {
            throw new Error(
              `provider "${providerId}" ${field}.supportedReasoningEfforts[${effortIndex}] must be { reasoningEffort, description }`,
            );
          }
          const reasoningEffort = parseHostPolicyString(
            effortRecord.reasoningEffort,
          );
          const level =
            reasoningEffort === undefined
              ? undefined
              : PLUGIN_PROVIDER_REASONING_LEVEL_VALUES.find(
                  (candidate) => candidate === reasoningEffort,
                );
          if (level === undefined) {
            throw new Error(
              `provider "${providerId}" ${field}.supportedReasoningEfforts[${effortIndex}].reasoningEffort must be one of ${PLUGIN_PROVIDER_REASONING_LEVEL_VALUES.join(", ")}`,
            );
          }
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
              value: effortRecord.description,
            }),
          });
        },
      );
      const defaultReasoningEffort = record.defaultReasoningEffort;
      if (
        parseHostPolicyString(defaultReasoningEffort) === undefined ||
        !levels.has(
          PLUGIN_PROVIDER_REASONING_LEVEL_VALUES.find(
            (candidate) => candidate === defaultReasoningEffort,
          ) ?? "none",
        )
      ) {
        throw new Error(
          `provider "${providerId}" ${field}.defaultReasoningEffort must be one of its supportedReasoningEfforts`,
        );
      }
      const isDefault = parseHostPolicyBoolean(record.isDefault);
      if (isDefault === undefined) {
        throw new Error(
          `provider "${providerId}" ${field}.isDefault must be a boolean`,
        );
      }
      if (isDefault) defaults += 1;
      return Object.freeze({
        id,
        displayName,
        description,
        supportedReasoningEfforts: Object.freeze(supportedReasoningEfforts),
        defaultReasoningEffort:
          PLUGIN_PROVIDER_REASONING_LEVEL_VALUES.find(
            (candidate) => candidate === defaultReasoningEffort,
          ) ?? "none",
        isDefault,
      });
    },
  );
  if (normalized.length > 0 && defaults !== 1) {
    throw new Error(
      `provider "${providerId}" models.fallback must mark exactly one model isDefault (found ${defaults})`,
    );
  }
  return Object.freeze(normalized);
}

const AI_SERVICE_KINDS = new Set<PluginAiServiceKind>(["inference", "voice"]);

/**
 * AI-service ids the server serves itself: `openai` transcription and the
 * builtin inference providers (pi-ai 0.84). A plugin cannot register one —
 * it would capture the user's prompts and audio. This list is the one source
 * for both the fake host and production (`isServerDirectAiServiceId`);
 * apps/server/test/services/plugins/plugin-ai-services.test.ts pins it to
 * pi-ai's provider registry, so a pi-ai bump must move it in the same change.
 */
export const SERVER_DIRECT_AI_SERVICE_IDS: readonly string[] = Object.freeze([
  "openai",
  "amazon-bedrock",
  "ant-ling",
  "anthropic",
  "azure-openai-responses",
  "baseten",
  "cerebras",
  "cloudflare-ai-gateway",
  "cloudflare-workers-ai",
  "deepseek",
  "fireworks",
  "github-copilot",
  "google",
  "google-vertex",
  "groq",
  "huggingface",
  "kimi-coding",
  "minimax",
  "minimax-cn",
  "mistral",
  "moonshotai",
  "moonshotai-cn",
  "nvidia",
  "openai-codex",
  "opencode",
  "opencode-go",
  "openrouter",
  "qwen-token-plan",
  "qwen-token-plan-cn",
  "radius",
  "together",
  "vercel-ai-gateway",
  "xai",
  "xiaomi",
  "xiaomi-token-plan-ams",
  "xiaomi-token-plan-cn",
  "xiaomi-token-plan-sgp",
  "zai",
  "zai-coding-cn",
]);

/**
 * Validate one `bb.experimental_aiServices.register` declaration the same
 * way in the production host and the fake host. Throws on the first problem;
 * returns a normalized, frozen copy carrying only contract fields.
 */
export function validatePluginAiServiceDeclaration(
  declaration: PluginAiServiceDeclaration,
): PluginAiServiceDeclaration {
  const parsedDeclaration = parseHostPolicyRecord(declaration);
  if (parsedDeclaration === undefined) {
    throw new Error("AI service declaration must be an object");
  }
  const id = parseHostPolicyString(parsedDeclaration.id);
  if (id === undefined || !PROVIDER_ID_PATTERN.test(id)) {
    throw new Error(
      `invalid AI service id ${JSON.stringify(id)} — use 2-64 lowercase letters, digits, and "-", starting with a letter or digit`,
    );
  }
  const displayName =
    parseHostPolicyString(parsedDeclaration.displayName)?.trim() ?? "";
  if (displayName.length === 0 || displayName.length > 64) {
    throw new Error(`AI service "${id}" displayName must be 1-64 characters`);
  }
  const parsedKinds = z
    .array(z.custom<HostPolicyInput>())
    .safeParse(parsedDeclaration.kinds);
  if (!parsedKinds.success || parsedKinds.data.length === 0) {
    throw new Error(`AI service "${id}" must declare at least one kind`);
  }
  const seen = new Set<PluginAiServiceKind>();
  for (const kind of parsedKinds.data) {
    const parsedKind = parseHostPolicyString(kind);
    const serviceKind =
      parsedKind === undefined
        ? undefined
        : [...AI_SERVICE_KINDS].find((candidate) => candidate === parsedKind);
    if (serviceKind === undefined) {
      throw new Error(
        `AI service "${id}" kind ${JSON.stringify(kind)} is not one of: ${[...AI_SERVICE_KINDS].join(", ")}`,
      );
    }
    if (seen.has(serviceKind)) {
      throw new Error(`AI service "${id}" declares kind "${kind}" twice`);
    }
    seen.add(serviceKind);
  }
  return Object.freeze({
    id,
    displayName,
    kinds: Object.freeze([...seen]),
  });
}

/**
 * What an AI service binds to, decided at the
 * `bb.experimental_aiServices.register` call: the plugin's built `bb.host`
 * artifact, or — when the plugin declares an entry that failed to build —
 * nothing yet, with the build problem. An unbound service is staged so the
 * factory completes; the load then fails on that problem before the staged
 * registrations flush, so the service never goes live, while a provider the
 * same factory declared can still be retained as unavailable.
 */
export type AiServiceHostBinding<THostArtifact> =
  | { readonly artifact: THostArtifact; readonly problem: null }
  | { readonly artifact: null; readonly problem: string };

/**
 * The refusals a host makes at `bb.experimental_aiServices.register` before
 * it stages the declaration: a reserved server-direct id, and a plugin with
 * no `bb.host` entry for the service to run on. A plugin whose declared
 * entry failed to build is not refused here: the service is staged unbound,
 * carrying the build problem, so the load fails on that problem — the
 * actionable one — after the factory instead of at this call, and a
 * provider the same factory declares is listed as unavailable rather than
 * lost. Returns what the service binds to. The production host and the fake
 * host both call this, so they refuse identically;
 * apps/server/test/services/plugins/plugin-ai-services.test.ts pins the
 * messages.
 */
export function assertAiServiceRegistrable<THostArtifact>(args: {
  id: string;
  /** The plugin's built `bb.host` artifact, or null when it has none. */
  hostArtifact: THostArtifact | null;
  /** Why the artifact is missing when the plugin declared an entry that failed to build. */
  hostArtifactProblem: string | null;
}): AiServiceHostBinding<THostArtifact> {
  if (SERVER_DIRECT_AI_SERVICE_IDS.includes(args.id)) {
    throw new Error(
      `AI service id "${args.id}" is reserved: the server serves it directly, so a plugin cannot register it`,
    );
  }
  if (args.hostArtifact !== null) {
    return { artifact: args.hostArtifact, problem: null };
  }
  if (args.hostArtifactProblem !== null) {
    return { artifact: null, problem: args.hostArtifactProblem };
  }
  throw new Error(
    `AI service "${args.id}" needs a bb.host entry to run on: this plugin declares none`,
  );
}

/** The collision a second registration of a live AI-service id raises. */
export function aiServiceAlreadyRegisteredMessage(id: string): string {
  return `AI service "${id}" is already registered; a plugin cannot shadow an existing service.`;
}

/** The collision a second registration of a live provider id raises. */
export function providerAlreadyRegisteredMessage(id: string): string {
  return `Provider "${id}" is already registered; a plugin cannot shadow an existing provider.`;
}

/**
 * Validate one `bb.providers.register` declaration. Plugin
 * sources are untyped at runtime, so every field is checked; the production
 * host and the fake host both call this, so they accept and reject provider
 * declarations identically. Throws a descriptive error on the first problem;
 * returns a normalized, deeply frozen copy carrying only contract fields.
 */
/**
 * A declaration that has been through {@link validatePluginProviderDeclaration}.
 *
 * The validator fills the defaults it owns, so a consumer reads one explicit
 * value rather than re-deciding what an absent field means. Only the fields
 * the validator GUARANTEES are narrowed here; everything else keeps the
 * author-facing shape.
 */
export type NormalizedPluginProviderDeclaration = Omit<
  PluginProviderDeclaration,
  | "experimental_nativeSkillRoots"
  | "experimental_nativeCommandRoots"
  | "experimental_resolvesNativeRoots"
> & {
  readonly experimental_nativeSkillRoots?: ProviderNativeRoots;
  readonly experimental_nativeCommandRoots?: ProviderNativeRoots;
  readonly experimental_resolvesNativeRoots: boolean;
  readonly maintenance: {
    readonly health: boolean;
    readonly usage: boolean;
    readonly installation: boolean;
  };
  readonly models: {
    readonly fallback?: readonly PluginProviderFallbackModel[];
    readonly scope: PluginProviderModelCatalogScope;
  };
};

type MutableNormalizedPluginProviderDeclaration = {
  -readonly [
    Key in keyof NormalizedPluginProviderDeclaration
  ]: NormalizedPluginProviderDeclaration[Key];
};
type MutableNormalizedPluginProviderModels = {
  scope: PluginProviderModelCatalogScope;
  fallback?: readonly PluginProviderFallbackModel[];
};

/**
 * Declaration fields SDK 0.4.16 renamed when they stabilized (S2). A plugin
 * built against an SDK before 0.4.16 still passes the old key; a validator
 * that reads only the new one would drop the field without a word, so the
 * old key is a registration error that names its replacement.
 */
const RENAMED_PROVIDER_DECLARATION_FIELDS: Readonly<Record<string, string>> =
  Object.freeze({
    experimental_family: "family",
    experimental_strings: "strings",
    experimental_serviceTiers: "serviceTiers",
    experimental_reasoningLevels: "reasoningLevels",
    experimental_extensionKinds: "extensionKinds",
    experimental_models: "models",
    experimental_env: "env",
    experimental_deriveProviderOptions: "deriveProviderOptions",
  });

/** The `capabilities.*` booleans SDK 0.4.16 moved into `maintenance`. */
const MOVED_PROVIDER_CAPABILITY_FIELDS: Readonly<Record<string, string>> =
  Object.freeze({
    experimental_providerHealth: "maintenance.health",
    experimental_providerUsage: "maintenance.usage",
    experimental_providerInstallation: "maintenance.installation",
  });

/**
 * The `experimental_` declaration keys {@link validatePluginProviderDeclaration}
 * still reads. Keep this in step with the reads below: a key listed here but
 * never read is the silent drop this check exists to prevent.
 */
const READ_EXPERIMENTAL_PROVIDER_DECLARATION_FIELDS: ReadonlySet<string> =
  new Set([
    "experimental_bridgeOptions",
    "experimental_visibility",
    "experimental_nativeSkillRoots",
    "experimental_nativeCommandRoots",
    "experimental_resolvesNativeRoots",
  ]);

const RENAMED_PROVIDER_FIELDS_SDK_VERSION = "0.4.16";

/**
 * Reject every `experimental_`-prefixed own key of `value` that the validator
 * does not read. A renamed or moved key gets a message that names the new
 * key; any other prefixed key is unknown. `scope` prefixes the key in the
 * message (`"capabilities."`) so the author can find it.
 */
function rejectStaleExperimentalFields(args: {
  providerId: string;
  value: object;
  scope: string;
  read: ReadonlySet<string>;
  renamed: Readonly<Record<string, string>>;
  verb: "renamed" | "moved";
}): void {
  for (const key of Object.keys(args.value)) {
    if (!key.startsWith("experimental_") || args.read.has(key)) {
      continue;
    }
    const replacement = Object.hasOwn(args.renamed, key)
      ? args.renamed[key]
      : undefined;
    const field = `${args.scope}${key}`;
    if (replacement === undefined) {
      throw new Error(
        `provider "${args.providerId}": unknown declaration field "${field}"`,
      );
    }
    throw new Error(
      `provider "${args.providerId}": "${field}" was ${args.verb} to "${replacement}" in SDK ${RENAMED_PROVIDER_FIELDS_SDK_VERSION}`,
    );
  }
}

export function validatePluginProviderDeclaration(
  declaration: PluginProviderDeclaration,
): NormalizedPluginProviderDeclaration {
  const parsedDeclaration = parseHostPolicyRecord(declaration);
  if (parsedDeclaration === undefined) {
    throw new Error("provider declaration must be an object");
  }
  const id = parseHostPolicyString(parsedDeclaration.id);
  if (id === undefined || !PROVIDER_ID_PATTERN.test(id)) {
    throw new Error(
      `invalid provider id ${JSON.stringify(id)} — use 2-64 lowercase letters, digits, and "-", starting with a letter or digit`,
    );
  }
  // Before any other field: a plugin built against the pre-rename SDK gets
  // the rename message, not a follow-on error about the field it could not
  // set (an old `experimental_providerHealth: true` would otherwise fail the
  // `experimental_visibility` check for a `maintenance.health` it never saw).
  rejectStaleExperimentalFields({
    providerId: id,
    value: parsedDeclaration,
    scope: "",
    read: READ_EXPERIMENTAL_PROVIDER_DECLARATION_FIELDS,
    renamed: RENAMED_PROVIDER_DECLARATION_FIELDS,
    verb: "renamed",
  });
  const familyValue = parsedDeclaration.family;
  const family = parseHostPolicyString(familyValue);
  if (
    familyValue !== undefined &&
    (family === undefined || !PROVIDER_ID_PATTERN.test(family))
  ) {
    throw new Error(
      `provider "${id}" family must use the provider id grammar (2-64 lowercase letters, digits, and "-")`,
    );
  }
  const displayName =
    parseHostPolicyString(parsedDeclaration.displayName)?.trim() ?? "";
  if (
    displayName.length === 0 ||
    displayName.length > PLUGIN_PROVIDER_DISPLAY_NAME_MAX_CHARS
  ) {
    throw new Error(
      `provider "${id}" displayName must be 1-${PLUGIN_PROVIDER_DISPLAY_NAME_MAX_CHARS} non-blank characters`,
    );
  }
  let icon: string | undefined;
  const iconValue = parsedDeclaration.icon;
  if (iconValue !== undefined) {
    const parsedIcon = parseHostPolicyString(iconValue);
    if (parsedIcon === undefined || parsedIcon.trim() === "") {
      throw new Error(
        `provider "${id}" icon must be a non-blank string — a named host glyph ("Zap"), a plugin-relative path ("./icons/agent.svg"), or a declared icon ("<pluginId>/<name>")`,
      );
    }
    // The `bb.branding.icon` forms plus one: a leading "./" means a
    // plugin-owned file and gets the escape rules; "<pluginId>/<name>" names
    // an entry of the plugin's `bb.branding.experimental_icons` map (the host
    // checks the plugin id and the name at registration, since only it holds
    // the manifest; `bb.branding.icon` itself refuses this form); anything
    // else names a host glyph. A path-shaped value that is neither would
    // otherwise be read as a glyph name that resolves to nothing.
    if (isPluginOwnedIconPath(parsedIcon)) {
      icon = validateProviderRelativePath(parsedIcon, `"${id}" icon`);
    } else if (isNamespacedGlyph(parsedIcon)) {
      icon = parsedIcon;
    } else if (/[/\\]/u.test(parsedIcon)) {
      throw new Error(
        `provider "${id}" icon looks like a path but does not start with "./" — use "./icons/agent.svg" for a plugin file, "<pluginId>/<name>" for a declared icon, or a bare host glyph name like "Zap"`,
      );
    } else {
      icon = parsedIcon;
    }
  }
  const capabilities = parseHostPolicyRecord(parsedDeclaration.capabilities);
  if (capabilities === undefined) {
    throw new Error(`provider "${id}" capabilities must be an object`);
  }
  rejectStaleExperimentalFields({
    providerId: id,
    value: capabilities,
    scope: "capabilities.",
    read: new Set(),
    renamed: MOVED_PROVIDER_CAPABILITY_FIELDS,
    verb: "moved",
  });
  // Maintenance support: an omitted object or key means the bridge does not
  // implement that request. Filled here once, then an explicit boolean
  // everywhere inside bb.
  const maintenance =
    parsedDeclaration.maintenance === undefined
      ? {}
      : parseHostPolicyRecord(parsedDeclaration.maintenance);
  if (maintenance === undefined) {
    throw new Error(`provider "${id}" maintenance must be an object`);
  }
  for (const key of ["health", "usage", "installation"] as const) {
    const value = maintenance[key];
    if (value !== undefined && parseHostPolicyBoolean(value) === undefined) {
      throw new Error(`provider "${id}" maintenance.${key} must be a boolean`);
    }
  }
  const normalizedMaintenance = Object.freeze({
    health:
      maintenance.health === undefined
        ? false
        : requireHostPolicyBoolean(
            maintenance.health,
            `provider "${id}" maintenance.health must be a boolean`,
          ),
    usage:
      maintenance.usage === undefined
        ? false
        : requireHostPolicyBoolean(
            maintenance.usage,
            `provider "${id}" maintenance.usage must be a boolean`,
          ),
    installation:
      maintenance.installation === undefined
        ? false
        : requireHostPolicyBoolean(
            maintenance.installation,
            `provider "${id}" maintenance.installation must be a boolean`,
          ),
  });
  const booleanCapabilityFields = [
    "supportsServiceTier",
    "supportsNativeUserQuestion",
    "supportsManualCompaction",
    "supportsThreadArchive",
    "supportsThreadRename",
  ] as const;
  for (const field of booleanCapabilityFields) {
    if (parseHostPolicyBoolean(capabilities[field]) === undefined) {
      throw new Error(
        `provider "${id}" capabilities.${field} must be a boolean`,
      );
    }
  }
  const fork = parseHostPolicyString(capabilities.fork);
  const normalizedFork = PROVIDER_FORK_VALUES.find(
    (candidate) => candidate === fork,
  );
  if (fork === undefined || normalizedFork === undefined) {
    throw new Error(
      `provider "${id}" capabilities.fork must be one of ${PROVIDER_FORK_VALUES.join(", ")}`,
    );
  }
  const normalizedCapabilities: PluginProviderCapabilities = Object.freeze({
    supportsServiceTier: requireHostPolicyBoolean(
      capabilities.supportsServiceTier,
      `provider "${id}" capabilities.supportsServiceTier must be a boolean`,
    ),
    supportsNativeUserQuestion: requireHostPolicyBoolean(
      capabilities.supportsNativeUserQuestion,
      `provider "${id}" capabilities.supportsNativeUserQuestion must be a boolean`,
    ),
    fork: normalizedFork,
    supportsManualCompaction: requireHostPolicyBoolean(
      capabilities.supportsManualCompaction,
      `provider "${id}" capabilities.supportsManualCompaction must be a boolean`,
    ),
    supportsThreadArchive: requireHostPolicyBoolean(
      capabilities.supportsThreadArchive,
      `provider "${id}" capabilities.supportsThreadArchive must be a boolean`,
    ),
    supportsThreadRename: requireHostPolicyBoolean(
      capabilities.supportsThreadRename,
      `provider "${id}" capabilities.supportsThreadRename must be a boolean`,
    ),
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
    value: parsedDeclaration.composerActions,
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
  const visibility = parsedDeclaration.experimental_visibility ?? "always";
  if (visibility !== "always" && visibility !== "installed") {
    throw new Error(
      `provider "${id}" experimental_visibility must be "always" or "installed"`,
    );
  }
  if (visibility === "installed" && !normalizedMaintenance.health) {
    throw new Error(
      `provider "${id}" experimental_visibility "installed" requires maintenance.health`,
    );
  }
  // Target-state declaration fields: validated and carried when present so
  // WS2a can project them, never silently dropped.
  const strings =
    parsedDeclaration.strings === undefined
      ? undefined
      : validateProviderStrings(id, parsedDeclaration.strings);
  const serviceTiers =
    parsedDeclaration.serviceTiers === undefined
      ? undefined
      : validateProviderOptionDescriptors({
          providerId: id,
          field: "serviceTiers",
          value: parsedDeclaration.serviceTiers,
        });
  const reasoningLevels =
    parsedDeclaration.reasoningLevels === undefined
      ? undefined
      : validateProviderOptionDescriptors({
          providerId: id,
          field: "reasoningLevels",
          value: parsedDeclaration.reasoningLevels,
        });
  const extensionKinds =
    parsedDeclaration.extensionKinds === undefined
      ? undefined
      : validateProviderExtensionKinds(id, parsedDeclaration.extensionKinds);
  const fallbackModels =
    parsedDeclaration.models === undefined
      ? undefined
      : validateProviderFallbackModels(id, parsedDeclaration.models);
  // Filled in at the boundary rather than left absent: every consumer reads
  // one value, and the default is a decision this validator owns.
  const modelCatalogScope = validateProviderModelCatalogScope(
    id,
    declaration.models?.scope,
  );
  const envPassthrough =
    parsedDeclaration.env === undefined
      ? undefined
      : validateProviderEnvPassthrough(id, parsedDeclaration.env);
  const nativeSkillRoots =
    parsedDeclaration.experimental_nativeSkillRoots === undefined
      ? undefined
      : validateProviderNativeRoots(
          id,
          "experimental_nativeSkillRoots",
          parsedDeclaration.experimental_nativeSkillRoots,
        );
  const nativeCommandRoots =
    parsedDeclaration.experimental_nativeCommandRoots === undefined
      ? undefined
      : validateProviderNativeRoots(
          id,
          "experimental_nativeCommandRoots",
          parsedDeclaration.experimental_nativeCommandRoots,
        );
  const resolvesNativeRoots = declaration.experimental_resolvesNativeRoots;
  const parsedResolvesNativeRoots = parseHostPolicyBoolean(resolvesNativeRoots);
  if (
    resolvesNativeRoots !== undefined &&
    parsedResolvesNativeRoots === undefined
  ) {
    throw new Error(
      `provider "${id}" experimental_resolvesNativeRoots must be a boolean`,
    );
  }
  const deriveProviderOptions = declaration.deriveProviderOptions;
  if (
    deriveProviderOptions !== undefined &&
    parseHostPolicyFunction(deriveProviderOptions) === undefined
  ) {
    throw new Error(
      `provider "${id}" deriveProviderOptions must be a function (context) => providerOptions`,
    );
  }
  const models: MutableNormalizedPluginProviderModels = {
    scope: modelCatalogScope,
  };
  if (fallbackModels !== undefined) models.fallback = fallbackModels;
  const normalized: MutableNormalizedPluginProviderDeclaration = {
    id,
    displayName,
    experimental_visibility: visibility,
    maintenance: normalizedMaintenance,
    capabilities: normalizedCapabilities,
    composerActions,
    models: Object.freeze(models),
    experimental_resolvesNativeRoots: parsedResolvesNativeRoots ?? false,
  };
  if (family !== undefined) normalized.family = family;
  if (icon !== undefined) normalized.icon = icon;
  if (bridgeOptions !== undefined) {
    normalized.experimental_bridgeOptions = bridgeOptions;
  }
  if (strings !== undefined) normalized.strings = strings;
  if (serviceTiers !== undefined) normalized.serviceTiers = serviceTiers;
  if (reasoningLevels !== undefined)
    normalized.reasoningLevels = reasoningLevels;
  if (extensionKinds !== undefined) normalized.extensionKinds = extensionKinds;
  if (envPassthrough !== undefined) {
    normalized.env = Object.freeze({ passthrough: envPassthrough });
  }
  if (nativeSkillRoots !== undefined) {
    normalized.experimental_nativeSkillRoots = nativeSkillRoots;
  }
  if (nativeCommandRoots !== undefined) {
    normalized.experimental_nativeCommandRoots = nativeCommandRoots;
  }
  if (deriveProviderOptions !== undefined) {
    normalized.deriveProviderOptions = deriveProviderOptions;
  }
  return Object.freeze(normalized);
}

/**
 * Run a declaration's `deriveProviderOptions` hook for one
 * command and validate its result as a bounded, plain-JSON object — the same
 * rules as `experimental_bridgeOptions`, because the result rides the same
 * wire slot. Shared by the real host and the fake so a hook that works in
 * tests works in production.
 */
export function deriveValidatedProviderOptions(args: {
  declaration: PluginProviderDeclaration;
  context: Parameters<
    NonNullable<PluginProviderDeclaration["deriveProviderOptions"]>
  >[0];
}): Readonly<Record<string, JsonValue>> {
  const hook = args.declaration.deriveProviderOptions;
  if (hook === undefined) return Object.freeze({});
  const result = hook(args.context);
  return normalizeProviderBridgeOptions(
    args.declaration.id,
    result,
    "deriveProviderOptions result",
  );
}

export function isStandardSchema<T>(value: T): value is StandardSchemaV1 & T {
  const parsedValue = parseHostPolicyRecord(value);
  if (parsedValue === undefined) return false;
  const standard = parseHostPolicyRecord(parsedValue["~standard"]);
  if (standard === undefined) return false;
  return (
    parseHostPolicyNumber(standard.version) === 1 &&
    parseHostPolicyString(standard.vendor) !== undefined &&
    parseHostPolicyFunction(standard.validate) !== undefined
  );
}

export function readRpcMethodContract<T>(
  method: string,
  value: T,
): PluginRpcMethodContract {
  const parsedValue = parseHostPolicyRecord(value);
  if (parsedValue === undefined) {
    throw new Error(
      `rpc method "${method}" contract must provide input and output Standard Schemas`,
    );
  }
  const input = parsedValue.input;
  const output = parsedValue.output;
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
export function isZodSchemaLike<T>(value: T): boolean {
  const parsedValue = parseHostPolicyRecord(value);
  return (
    parsedValue !== undefined &&
    parseHostPolicyFunction(parsedValue.safeParse) !== undefined
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

function isJsonSchemaObject<T>(value: T): value is HostPolicyRecord & T {
  return parseHostPolicyRecord(value) !== undefined;
}

function decodeJsonPointerToken(token: string): string {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

function resolveLocalJsonSchemaReference(
  document: HostPolicyRecord,
  anchors: ReadonlyMap<string, HostPolicyRecord>,
  reference: string,
): HostPolicyInput {
  if (!reference.startsWith("#")) return undefined;
  let pointer: string;
  try {
    pointer = decodeURIComponent(reference.slice(1));
  } catch {
    return undefined;
  }
  if (pointer.length === 0) return document;
  if (!pointer.startsWith("/")) return anchors.get(pointer);

  let current: HostPolicyInput = document;
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
  schema: HostPolicyRecord,
  visit: (child: HostPolicyInput) => void,
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
export function assertNoRecursiveJsonSchemaReferences<T>(
  schema: T,
  subject: string,
): void {
  if (!isJsonSchemaObject(schema)) return;
  const document = schema;
  const anchors = new Map<string, HostPolicyRecord>();
  const indexed = new Set<object>();

  function indexAnchors(candidate: HostPolicyInput): void {
    if (!isJsonSchemaObject(candidate) || indexed.has(candidate)) return;
    indexed.add(candidate);
    for (const keyword of ["$anchor", "$dynamicAnchor"] as const) {
      const anchor = candidate[keyword];
      const parsedAnchor = parseHostPolicyString(anchor);
      if (parsedAnchor !== undefined) anchors.set(parsedAnchor, candidate);
    }
    for (const keyword of ["$id", "id"] as const) {
      const id = candidate[keyword];
      const parsedId = parseHostPolicyString(id);
      if (parsedId !== undefined && /^#[^/]+$/.test(parsedId)) {
        anchors.set(parsedId.slice(1), candidate);
      }
    }
    forEachJsonSchemaChild(candidate, indexAnchors);
  }

  indexAnchors(document);

  const visited = new Set<object>();
  const visiting = new Set<object>();

  function visit(
    candidate: HostPolicyInput,
    viaReference?: { keyword: string; value: string },
  ): void {
    if (
      parseHostPolicyBoolean(candidate) !== undefined ||
      !isJsonSchemaObject(candidate)
    ) {
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
      const parsedReference = parseHostPolicyString(reference);
      if (parsedReference !== undefined && parsedReference.startsWith("#")) {
        const target = resolveLocalJsonSchemaReference(
          document,
          anchors,
          parsedReference,
        );
        if (target !== undefined) {
          visit(target, { keyword, value: parsedReference });
        }
      }
    }
    forEachJsonSchemaChild(candidate, visit);

    visiting.delete(candidate);
    visited.add(candidate);
  }

  visit(schema);
}

/**
 * Registration fields SDK 0.4.16 renamed or folded away. A plugin compiled
 * against an older SDK still passes them, and dropping them silently would
 * change how its tool rows render, so each names its replacement.
 */
const RENAMED_AGENT_TOOL_FIELDS: ReadonlyMap<string, string> = new Map([
  [
    "experimental_presentation",
    '"experimental_presentation" was renamed to "presentation" in SDK 0.4.16',
  ],
  [
    "experimental_statusLabels",
    '"experimental_statusLabels" was folded into "presentation" (labels) in SDK 0.4.16',
  ],
]);

/**
 * Reject the fields a registration never reads. Renamed fields get the
 * message above; any other `experimental_` field is unknown (the same
 * rule configure() output follows in the plugin service). The production
 * host and the fake host both call this before parsing `presentation`, so
 * a registration built against an older SDK fails a plugin's own unit test
 * with the message bb would give it.
 */
export function rejectStaleAgentToolFields<T extends object>(
  toolName: string,
  tool: T,
): void {
  const unknownKeys: string[] = [];
  for (const key of Object.keys(tool).sort()) {
    const renamed = RENAMED_AGENT_TOOL_FIELDS.get(key);
    if (renamed !== undefined) {
      throw new Error(`registerTool: ${renamed} (tool "${toolName}")`);
    }
    if (key.startsWith("experimental_")) {
      unknownKeys.push(key);
    }
  }
  if (unknownKeys.length > 0) {
    throw new Error(
      `registerTool: tool "${toolName}" contains unknown field${unknownKeys.length === 1 ? "" : "s"}: ${unknownKeys.join(", ")}`,
    );
  }
}

/**
 * The declared shape of `presentation`, copied field by field so
 * a plugin's object cannot smuggle prototypes or extra markup into the
 * persisted row. Labels share the status-label length cap. The production
 * host and the fake host both call this, so a presentation that registers
 * in a plugin unit test registers in bb, and one bb rejects is rejected
 * with the same message.
 */
export function parsePluginAgentToolPresentation<T>(
  toolName: string,
  value: T,
): PluginAgentToolPresentation | null {
  if (value === undefined) {
    return null;
  }
  const declared = parseHostPolicyRecord(value);
  if (declared === undefined) {
    throw new Error(`tool "${toolName}" presentation must be an object`);
  }
  const presentation: PluginAgentToolPresentation = {};
  if (declared.label !== undefined) {
    const label = parseHostPolicyRecord(declared.label);
    const pending = parseHostPolicyString(label?.pending);
    const completed = parseHostPolicyString(label?.completed);
    if (
      label === undefined ||
      pending === undefined ||
      completed === undefined
    ) {
      throw new Error(
        `tool "${toolName}" presentation.label must provide pending and completed strings`,
      );
    }
    if (
      pending.trim().length === 0 ||
      completed.trim().length === 0 ||
      pending.length > PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS ||
      completed.length > PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS
    ) {
      throw new Error(
        `tool "${toolName}" presentation.label strings must be non-empty and at most ${PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS} characters`,
      );
    }
    presentation.label = { pending, completed };
  }
  if (declared.icon !== undefined) {
    const icon = parseHostPolicyRecord(declared.icon);
    const glyph = parseHostPolicyString(icon?.glyph);
    if (glyph === undefined || glyph.trim().length === 0) {
      throw new Error(
        `tool "${toolName}" presentation.icon must be { glyph: string }`,
      );
    }
    presentation.icon = { glyph };
  }
  if (declared.suppress !== undefined) {
    const suppress = parseHostPolicyBoolean(declared.suppress);
    if (suppress === undefined) {
      throw new Error(
        `tool "${toolName}" presentation.suppress must be a boolean`,
      );
    }
    presentation.suppress = suppress;
  }
  if (declared.tint !== undefined) {
    const tint = parseHostPolicyRecord(declared.tint);
    const light = parseHostPolicyString(tint?.light);
    const dark = parseHostPolicyString(tint?.dark);
    if (light === undefined || dark === undefined) {
      throw new Error(
        `tool "${toolName}" presentation.tint must provide light and dark strings`,
      );
    }
    presentation.tint = { light, dark };
  }
  return presentation;
}

/** Compact issue summary from a (possibly foreign-instance) zod error. */
export function summarizeParseIssues<T>(error: T): string {
  const errorRecord = parseHostPolicyRecord(error);
  const parsedIssues = z
    .array(z.custom<HostPolicyInput>())
    .safeParse(errorRecord?.issues);
  if (parsedIssues.success && parsedIssues.data.length > 0) {
    return parsedIssues.data
      .map((issue) => {
        const issueRecord = parseHostPolicyRecord(issue);
        const path = z
          .array(z.custom<PropertyKey>())
          .safeParse(issueRecord?.path);
        const message = parseHostPolicyString(issueRecord?.message);
        return `${path.success && path.data.length > 0 ? path.data.join(".") : "(input)"}: ${message ?? "invalid"}`;
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
export function adoptHttpRouteResponse<T>(value: T): Response {
  if (value instanceof Response) return value;
  if (!isResponseLike(value)) {
    throw new Error("http route handler must return a Response");
  }
  const status = value.status;
  const isNullBodyStatus =
    status === 101 || status === 204 || status === 205 || status === 304;
  const init: ResponseInit = {
    status,
    statusText: parseHostPolicyString(value.statusText) ?? "",
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
  value: HostPolicyInput,
): value is ReadableStream<Uint8Array> {
  const parsedValue = parseHostPolicyRecord(value);
  return (
    parsedValue !== undefined &&
    parseHostPolicyFunction(parsedValue.getReader) !== undefined
  );
}

function isResponseLike<T>(value: T): value is Response & T {
  const candidate = parseHostPolicyRecord(value);
  if (candidate === undefined) return false;
  return (
    parseHostPolicyNumber(candidate.status) !== undefined &&
    parseHostPolicyRecord(candidate.headers) !== undefined &&
    parseHostPolicyFunction(candidate.arrayBuffer) !== undefined &&
    parseHostPolicyFunction(candidate.clone) !== undefined
  );
}

/**
 * The one rule for a namespaced glyph (`"<pluginId>/<name>"`) wherever a
 * plugin may reference its own declared icons — a tool presentation at
 * `bb.agents.registerTool`, a provider icon at `bb.providers.register`, and a
 * row presentation at ingest: the plugin id must be the emitting plugin's
 * and the name must be in its `bb.branding.experimental_icons` map. The
 * server and the fake plugin host apply it from here, so a registration the
 * fake accepts is one the server accepts.
 *
 * Returns the reason a glyph is refused, always naming the glyph and the
 * plugin, or null when the glyph is acceptable. A host glyph (no `/`) is
 * never refused here: whether the client can draw it is the client's call.
 */
export function undeclaredIconProblem(
  pluginId: string,
  declaredIconNames: ReadonlySet<string>,
  glyph: string,
): string | null {
  const parsed = parseNamespacedGlyph(glyph);
  if (parsed === null) {
    return null;
  }
  if (parsed.pluginId !== pluginId || !declaredIconNames.has(parsed.name)) {
    return `"${glyph}" is not an icon declared by plugin "${pluginId}"`;
  }
  return null;
}

/** `bb.providers.register` refusal for an icon {@link undeclaredIconProblem} rejects. */
export function providerIconRefusalMessage(
  providerId: string,
  problem: string,
): string {
  return `provider "${providerId}" icon ${problem}`;
}

/** `bb.agents.registerTool` refusal for a glyph {@link undeclaredIconProblem} rejects. */
export function agentToolIconRefusalMessage(
  toolName: string,
  problem: string,
): string {
  return `tool "${toolName}" presentation.icon ${problem}`;
}

/**
 * `bb.providers.register` refusal for a plugin whose manifest declares no
 * `bb.host` entry: a declaration is metadata, and the bridge it runs on is
 * that entry.
 */
export function providerWithoutBridgeMessage(providerId: string): string {
  return `provider "${providerId}" has no bridge to run on: this plugin declares no "bb.host" entry in its manifest`;
}
