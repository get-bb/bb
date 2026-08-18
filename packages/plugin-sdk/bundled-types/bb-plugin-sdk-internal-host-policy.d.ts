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
 * How completely a provider can clone one of its sessions — the single
 * vocabulary shared by the provider declaration
 * (`bb.agents.experimental_registerProvider`), the server→daemon
 * `bridgeLaunch`, and the bridge's `initialize` handshake.
 *
 * - `"none"`: sessions cannot be cloned at all.
 * - `"tip"`: only the current end of a session can be cloned (ACP
 *   `session/fork`), so thread fork works but edit-past-message rewind
 *   cannot.
 * - `"checkpoint"`: a session can be recreated at an earlier point, which is
 *   what edit-past-message rewind needs.
 *
 * The values are ordered least to most capable: a declaration is a ceiling
 * the handshake may narrow but never widen.
 */
declare const PROVIDER_FORK_VALUES: readonly ["none", "tip", "checkpoint"];
type ProviderFork = (typeof PROVIDER_FORK_VALUES)[number];

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
/**
 * Permission modes a provider can run a session in — BB's own permission
 * vocabulary, ordered least ("accept-edits") to most ("full") privileged.
 */
type PluginProviderPermissionMode = "accept-edits" | "auto" | "full";
/**
 * Coarse reasoning-effort ladder entries, ordered lowest to highest. The
 * declared ladder is a fallback only: precise per-model reasoning sets come
 * from the provider's model list at runtime.
 */
type PluginProviderReasoningLevel = "high" | "low" | "max" | "medium" | "none" | "ultra" | "ultracode" | "xhigh";
/**
 * Composer actions a provider supports, by name only. The skills
 * slash-command typeahead is universal — BB injects skills into every
 * provider — so it is implicit and never declared, and the composer owns the
 * trigger syntax (`/plan `, `/goal `) rather than each declaration repeating
 * it.
 */
type PluginProviderComposerAction = "goal" | "plan";
/**
 * Pre-session capability facts about a provider. A capability earns a field
 * here only when it passes BOTH tests: (1) a consumer outside the provider's
 * own plugin needs the fact, and (2) the fact is needed before / without a
 * live session (picker rendering, route gating, cross-plugin tool
 * composition — including with the host offline). Every boolean is a
 * provider-native fact — the provider implements the feature; the flag only
 * tells external consumers it exists. Everything else is a handshake fact the
 * bridge reports at `initialize`, where it cannot drift from behavior.
 */
interface PluginProviderCapabilities {
    /** The provider accepts a fast/priority service-tier choice — shows the
     * service-tier toggle in the picker. */
    supportsServiceTier: boolean;
    /** The provider ships its own native ask-user-question tool — the
     * ask-user-question plugin skips registering its duplicate. */
    supportsNativeUserQuestion: boolean;
    /**
     * How completely the provider can clone a session: `"none"` (not at all),
     * `"tip"` (only the current end, so thread fork works but edit-past-message
     * rewind cannot), or `"checkpoint"` (recreate the session at an earlier
     * point, which rewind needs). Gates the fork and edit-past-message
     * affordances. The bridge reports the same fact at `initialize`, where it
     * may narrow this declaration but never widen it.
     */
    fork: ProviderFork;
    /** The provider accepts an explicit context-compaction request — gates the
     * compact affordance. */
    supportsManualCompaction: boolean;
    /** The provider keeps its own thread archive, so BB mirrors archive and
     * unarchive onto it instead of tracking the state only in bb's own rows. */
    supportsThreadArchive: boolean;
    /** The provider stores a thread name of its own, so BB forwards renames to
     * it. */
    supportsThreadRename: boolean;
    /** The provider can run BB's Workflow tools — gates the workflows opt-in on
     * new threads. */
    supportsWorkflows: boolean;
    /** Permission modes the provider can actually run in. Non-empty, no
     * duplicates. */
    permissionModes: readonly PluginProviderPermissionMode[];
    /** The provider's coarse fallback reasoning ladder (see
     * {@link PluginProviderReasoningLevel}). Non-empty, no duplicates. */
    reasoningLevels: readonly PluginProviderReasoningLevel[];
}
/**
 * One provider this plugin contributes to BB's provider registry.
 *
 * Ids are stable public identifiers — thread rows and routes reference them —
 * and are collision-rejected: a declaration whose id matches another plugin's
 * live registration, or reserves a first-party provider it does not own, is
 * refused. Registrations are replaced wholesale on plugin reload, like every
 * other plugin surface.
 *
 * A declaration is metadata only. The implementation is the plugin's own
 * provider bridge, named by `bb.providerBridge` in the manifest and built into
 * the artifact BB ships to hosts — declaring a provider without one is
 * refused, because the picker entry would exist and no turn on it could ever
 * run.
 */
interface PluginProviderDeclaration {
    /** Stable provider id: 2–64 characters of lowercase letters, digits, and
     * "-", starting with a letter or digit. Existing ids must never change —
     * threads persist them. */
    id: string;
    /** Picker display name: 1–80 characters, non-blank. */
    displayName: string;
    /**
     * Optional picker icon, in the same grammar as `bb.branding.icon`: either a
     * named host glyph (`"Zap"`) or a plugin-relative path starting with `"./"`
     * (`"./icons/agent.svg"`). Paths follow the manifest entry-path escape rules
     * — no leading "/", no ".." segments, no backslashes.
     */
    icon?: string;
    /** Pre-session capability facts (see the declaration tests on
     * {@link PluginProviderCapabilities}). */
    capabilities: PluginProviderCapabilities;
    /** Composer actions this provider supports. No duplicates; may be empty
     * (the universal skills typeahead is implicit). */
    composerActions: readonly PluginProviderComposerAction[];
}
type PluginMentionTrigger = "!" | "#" | "$" | "@" | "~";

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
declare const PROVIDER_ID_PATTERN: RegExp;
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
declare const PLUGIN_PROVIDER_DISPLAY_NAME_MAX_CHARS = 80;
declare const PLUGIN_PROVIDER_PERMISSION_MODE_VALUES: readonly ["accept-edits", "auto", "full"];
declare const PLUGIN_PROVIDER_REASONING_LEVEL_VALUES: readonly ["none", "low", "medium", "high", "xhigh", "ultracode", "max", "ultra"];
declare const PLUGIN_PROVIDER_COMPOSER_ACTION_VALUES: readonly ["plan", "goal"];
/**
 * Validate one `bb.agents.experimental_registerProvider` declaration. Plugin
 * sources are untyped at runtime, so every field is checked; the production
 * host and the fake host both call this, so they accept and reject provider
 * declarations identically. Throws a descriptive error on the first problem;
 * returns a normalized, deeply frozen copy carrying only contract fields.
 */
declare function validatePluginProviderDeclaration(declaration: PluginProviderDeclaration): PluginProviderDeclaration;
declare function isStandardSchema(value: unknown): value is StandardSchemaV1;
declare function readRpcMethodContract(method: string, value: unknown): PluginRpcMethodContract;
/** Duck-typed zod detection: plugin sources may carry their own zod copy,
 * so instanceof is useless — anything with safeParse is treated as zod. */
declare function isZodSchemaLike(value: unknown): boolean;
/**
 * Reject recursive local references before a tool schema reaches a provider.
 * Some providers reject the complete tool list when any one schema contains a
 * recursive `$ref`, so this is a shared production/fake-host boundary rule.
 */
declare function assertNoRecursiveJsonSchemaReferences(schema: unknown, subject: string): void;
/** Compact issue summary from a (possibly foreign-instance) zod error. */
declare function summarizeParseIssues(error: unknown): string;
declare function enforcePluginCliOutputLimit(result: Omit<PluginCliExecutionResult, "error">, jsonOutput: boolean): PluginCliExecutionResult;
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
declare function adoptHttpRouteResponse(value: unknown): Response;

export { AGENT_TOOL_NAME_PATTERN, BACKGROUND_NAME_PATTERN, CLI_COMMAND_NAME_PATTERN, KV_VALUE_MAX_BYTES, MENTION_PROVIDER_ID_PATTERN, PLUGIN_AGENT_DYNAMIC_INSTRUCTIONS_MAX_CHARS, PLUGIN_AGENT_SELECTION_MAX_IDS, PLUGIN_AGENT_STATIC_INSTRUCTIONS_MAX_CHARS, PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS, PLUGIN_AGENT_TOOL_PARAMETERS_MAX_BYTES, PLUGIN_HTTP_METHODS, PLUGIN_MENTION_TRIGGER_VALUES, PLUGIN_PROVIDER_COMPOSER_ACTION_VALUES, PLUGIN_PROVIDER_DISPLAY_NAME_MAX_CHARS, PLUGIN_PROVIDER_PERMISSION_MODE_VALUES, PLUGIN_PROVIDER_REASONING_LEVEL_VALUES, PROVIDER_ID_PATTERN, RESERVED_AGENT_TOOL_NAMES, RESERVED_BB_CLI_COMMANDS, RPC_METHOD_PATTERN, SETTING_KEY_PATTERN, adoptHttpRouteResponse, assertNoRecursiveJsonSchemaReferences, enforcePluginCliOutputLimit, isPluginMentionTrigger, isStandardSchema, isZodSchemaLike, normalizeMentionProviderTriggers, readRpcMethodContract, registerSettingDescriptors, summarizeParseIssues, validatePluginProviderDeclaration, validateSettingsUpdate };
