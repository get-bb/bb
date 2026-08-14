import { z } from "zod";
import { RESERVED_BB_CLI_COMMANDS } from "@bb/domain/plugin-cli";
import { PLUGIN_CLI_OUTPUT_MAX_BYTES } from "../backend-contract.js";
import type {
  PluginCliExecutionResult,
  PluginCliOutputLimitError,
  PluginMentionTrigger,
  PluginProviderCapabilities,
  PluginProviderComposerAction,
  PluginProviderDeclaration,
  PluginProviderKind,
  PluginProviderPermissionMode,
  PluginProviderReasoningLevel,
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

// Agent provider ids are stable public identifiers: thread rows persist them
// and routes/pickers reference them. 2-64 chars, lowercase.
export const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

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

export const PLUGIN_PROVIDER_KIND_VALUES = [
  "agent",
  "router",
] as const satisfies readonly PluginProviderKind[];

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

/**
 * Validate one `bb.agents.experimental_registerProvider` declaration. Plugin
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
  const kind = declaration.kind;
  if (
    typeof kind !== "string" ||
    !(PLUGIN_PROVIDER_KIND_VALUES as readonly string[]).includes(kind)
  ) {
    throw new Error(
      `provider "${id}" kind must be one of ${PLUGIN_PROVIDER_KIND_VALUES.join(", ")}`,
    );
  }
  let icon: { asset: string } | undefined;
  if (declaration.icon !== undefined) {
    if (typeof declaration.icon !== "object" || declaration.icon === null) {
      throw new Error(`provider "${id}" icon must be { asset: string }`);
    }
    icon = Object.freeze({
      asset: validateProviderRelativePath(
        declaration.icon.asset,
        `"${id}" icon.asset`,
      ),
    });
  }
  let bridge: { entry: string } | undefined;
  if (kind === "agent") {
    if (typeof declaration.bridge !== "object" || declaration.bridge === null) {
      throw new Error(
        `provider "${id}" kind "agent" requires bridge: { entry: string }`,
      );
    }
    bridge = Object.freeze({
      entry: validateProviderRelativePath(
        declaration.bridge.entry,
        `"${id}" bridge.entry`,
      ),
    });
  } else if (declaration.bridge !== undefined) {
    throw new Error(
      `provider "${id}" kind "router" must not declare a bridge — routers never execute sessions themselves`,
    );
  }
  const capabilities = declaration.capabilities;
  if (typeof capabilities !== "object" || capabilities === null) {
    throw new Error(`provider "${id}" capabilities must be an object`);
  }
  const booleanCapabilityFields = [
    "supportsServiceTier",
    "supportsHostAiServices",
    "supportsNativeUserQuestion",
    "supportsNativeFork",
    "supportsNativeSessionRewind",
    "supportsManualCompaction",
  ] as const;
  for (const field of booleanCapabilityFields) {
    if (typeof capabilities[field] !== "boolean") {
      throw new Error(
        `provider "${id}" capabilities.${field} must be a boolean`,
      );
    }
  }
  const normalizedCapabilities: PluginProviderCapabilities = Object.freeze({
    supportsServiceTier: capabilities.supportsServiceTier,
    supportsHostAiServices: capabilities.supportsHostAiServices,
    supportsNativeUserQuestion: capabilities.supportsNativeUserQuestion,
    supportsNativeFork: capabilities.supportsNativeFork,
    supportsNativeSessionRewind: capabilities.supportsNativeSessionRewind,
    supportsManualCompaction: capabilities.supportsManualCompaction,
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
  return Object.freeze({
    id,
    displayName,
    ...(icon === undefined ? {} : { icon }),
    kind,
    ...(bridge === undefined ? {} : { bridge }),
    capabilities: normalizedCapabilities,
    composerActions,
  });
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
