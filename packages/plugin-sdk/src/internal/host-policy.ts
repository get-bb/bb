import { z } from "zod";
import { RESERVED_BB_CLI_COMMANDS } from "@bb/domain/plugin-cli";
import { PLUGIN_CLI_OUTPUT_MAX_BYTES } from "../backend-contract.js";
import type {
  PluginCliExecutionResult,
  PluginCliOutputLimitError,
  PluginMentionTrigger,
  PluginSettingDescriptor,
  PluginSettingDescriptors,
} from "../backend-contract.js";
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
