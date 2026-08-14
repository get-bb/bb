// Portable type declarations for `@get-bb/plugin-sdk`. Unpublished BB
// workspace contracts are flattened; public subpaths may reuse the
// package root without requiring any other @bb/* package.
//
// Confused by the API, or need a symbol that isn't here? Clone the BB repo
// and read the real source: https://github.com/get-bb/bb

/**
 * Core `bb` CLI top-level command names (plus commander's built-in help).
 * Plugin CLI commands may not shadow these. Maintained by hand and checked
 * against the real Commander program by
 * apps/cli/src/__tests__/plugin-cli-proxy.test.ts.
 *
 * "automation" and "connect" are intentionally absent: builtin plugins own
 * those top-level commands and the CLI proxies them.
 */
declare const RESERVED_BB_CLI_COMMANDS: readonly string[];

/**
 * The validator-neutral subset of Standard Schema v1 used by plugin RPC.
 * Zod 4 schemas implement this interface directly; other validators can do
 * the same without becoming part of BB's public protocol.
 */
interface StandardSchemaV1<Input = unknown, Output = Input> {
    readonly "~standard": {
        readonly version: 1;
        readonly vendor: string;
        readonly validate: (value: unknown) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>;
        readonly types?: {
            readonly input: Input;
            readonly output: Output;
        };
    };
}
type StandardSchemaV1Result<Output> = {
    readonly value: Output;
    readonly issues?: undefined;
} | {
    readonly issues: readonly StandardSchemaV1Issue[];
};
interface StandardSchemaV1Issue {
    readonly message: string;
    readonly path?: PropertyKey | readonly (PropertyKey | {
        readonly key: PropertyKey;
    })[];
}
interface PluginRpcMethodContract<InputSchema extends StandardSchemaV1 = StandardSchemaV1, OutputSchema extends StandardSchemaV1 = StandardSchemaV1> {
    readonly input: InputSchema;
    readonly output: OutputSchema;
}

/**
 * Declarative settings descriptors (`bb.settings.define`). Deliberately plain
 * data — not zod — so the host can render settings forms and the CLI can
 * parse values without executing plugin code.
 */
type PluginSettingDescriptor = {
    type: "string";
    label: string;
    description?: string;
    /** Stored in a 0600 file under <dataDir>/plugins/<id>/secrets/, never in the db or sent to the frontend. */
    secret?: true;
    default?: string;
} | {
    type: "boolean";
    label: string;
    description?: string;
    default?: boolean;
} | {
    type: "select";
    label: string;
    description?: string;
    options: string[];
    default?: string;
} | {
    type: "project";
    label: string;
    description?: string;
    default?: string;
};
type PluginSettingDescriptors = Record<string, PluginSettingDescriptor>;
interface PluginCliOutputLimitError {
    code: "plugin_cli_output_too_large";
    message: string;
    maxBytes: number;
    stdoutBytes: number;
    stderrBytes: number;
    totalBytes: number;
}
/** Normalized host result returned by the plugin CLI HTTP/testing boundary. */
interface PluginCliExecutionResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    error?: PluginCliOutputLimitError;
}
type PluginMentionTrigger = "@" | "#" | "$" | "!" | "~";

/**
 * Built-in dynamic tool names plugins may not shadow. Maintained by hand —
 * kept in sync with the built-in tools in
 * apps/server/src/services/threads/thread-runtime-config.ts by
 * apps/server/test/services/plugins/plugin-agent-tools.test.ts.
 */
declare const RESERVED_AGENT_TOOL_NAMES: readonly string[];
/** JSON values ≤256KB; larger writes are rejected with a clear error. */
declare const KV_VALUE_MAX_BYTES: number;
declare const PLUGIN_HTTP_METHODS: ReadonlySet<string>;
declare const RPC_METHOD_PATTERN: RegExp;
declare const BACKGROUND_NAME_PATTERN: RegExp;
declare const CLI_COMMAND_NAME_PATTERN: RegExp;
declare const AGENT_TOOL_NAME_PATTERN: RegExp;
declare const PLUGIN_AGENT_STATIC_INSTRUCTIONS_MAX_CHARS = 4096;
/** Status labels ride on every tool-call event and share one timeline row. */
declare const PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS = 80;
declare const PLUGIN_AGENT_SELECTION_MAX_IDS = 256;
declare const PLUGIN_AGENT_DYNAMIC_INSTRUCTIONS_MAX_CHARS = 4096;
declare const PLUGIN_AGENT_TOOL_PARAMETERS_MAX_BYTES: number;
declare const MENTION_PROVIDER_ID_PATTERN: RegExp;
declare const SETTING_KEY_PATTERN: RegExp;
/**
 * Validate freeform descriptors from plugin code and merge them into the
 * plugin's registered schema. Plugin source is not type-safe at runtime, so
 * both the production and fake hosts must enforce this boundary identically.
 */
declare function registerSettingDescriptors(target: PluginSettingDescriptors, added: Record<string, unknown>): PluginSettingDescriptors;
/** Validate a settings update. `null` means unset. */
declare function validateSettingsUpdate(descriptors: PluginSettingDescriptors, values: Record<string, unknown>): string[];
declare const PLUGIN_MENTION_TRIGGER_VALUES: readonly ["@", "#", "$", "!", "~"];
declare function isPluginMentionTrigger(value: unknown): value is PluginMentionTrigger;
declare function normalizeMentionProviderTriggers(providerId: string, triggers: unknown): readonly PluginMentionTrigger[];
declare function isStandardSchema(value: unknown): value is StandardSchemaV1;
declare function readRpcMethodContract(method: string, value: unknown): PluginRpcMethodContract;
/** Duck-typed zod detection: plugin sources may carry their own zod copy,
 * so instanceof is useless — anything with safeParse is treated as zod. */
declare function isZodSchemaLike(value: unknown): boolean;
/** Compact issue summary from a (possibly foreign-instance) zod error. */
declare function summarizeParseIssues(error: unknown): string;
declare function enforcePluginCliOutputLimit(result: Omit<PluginCliExecutionResult, "error">, jsonOutput: boolean): PluginCliExecutionResult;

export { AGENT_TOOL_NAME_PATTERN, BACKGROUND_NAME_PATTERN, CLI_COMMAND_NAME_PATTERN, KV_VALUE_MAX_BYTES, MENTION_PROVIDER_ID_PATTERN, PLUGIN_AGENT_DYNAMIC_INSTRUCTIONS_MAX_CHARS, PLUGIN_AGENT_SELECTION_MAX_IDS, PLUGIN_AGENT_STATIC_INSTRUCTIONS_MAX_CHARS, PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS, PLUGIN_AGENT_TOOL_PARAMETERS_MAX_BYTES, PLUGIN_HTTP_METHODS, PLUGIN_MENTION_TRIGGER_VALUES, RESERVED_AGENT_TOOL_NAMES, RESERVED_BB_CLI_COMMANDS, RPC_METHOD_PATTERN, SETTING_KEY_PATTERN, enforcePluginCliOutputLimit, isPluginMentionTrigger, isStandardSchema, isZodSchemaLike, normalizeMentionProviderTriggers, readRpcMethodContract, registerSettingDescriptors, summarizeParseIssues, validateSettingsUpdate };
