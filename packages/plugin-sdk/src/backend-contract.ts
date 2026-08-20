import type Database from "better-sqlite3";
import type { Context } from "hono";
import type * as z from "zod";
import type { ProviderFork } from "@bb/domain/provider-fork";
import type { BbSdk } from "@bb/sdk";
import type { ThreadResponse } from "@bb/server-contract";
import type { JsonValue } from "./json-value.js";
import type { PluginRpcContract, PluginRpcHandlers } from "./rpc-contract.js";
import type {
  ExperimentalHostClient,
  ExperimentalHostSignals,
} from "./host-contract.js";

/**
 * The backend plugin API contract — the `bb` object handed to a plugin's
 * `server.ts` factory (`export default function plugin(bb: BbPluginApi)`).
 *
 * Types only: the implementation lives in the BB server
 * (apps/server/src/services/plugins/plugin-api.ts), which imports these
 * shapes so the contract and the implementation cannot drift. Plugin authors
 * import them type-only (`import type { BbPluginApi } from
 * "@get-bb/plugin-sdk"`); the import is erased when BB loads the file.
 *
 * Runtime classes stay host-side. NeedsConfigurationError in particular is
 * matched by NAME, so plugin code needs no runtime import:
 * `throw Object.assign(new Error(msg), { name: "NeedsConfigurationError" })`.
 */

export interface PluginLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

// ---------------------------------------------------------------------------
// Settings (design §4.2).
// ---------------------------------------------------------------------------

/**
 * Declarative settings descriptors (`bb.settings.define`). Deliberately plain
 * data — not zod — so the host can render settings forms and the CLI can
 * parse values without executing plugin code.
 */
export type PluginSettingDescriptor =
  | {
      type: "string";
      label: string;
      description?: string;
      /** Stored in a 0600 file under <dataDir>/plugins/<id>/secrets/, never in the db or sent to the frontend. */
      secret?: true;
      default?: string;
    }
  | { type: "boolean"; label: string; description?: string; default?: boolean }
  | {
      type: "select";
      label: string;
      description?: string;
      options: string[];
      default?: string;
    }
  | { type: "project"; label: string; description?: string; default?: string };

export type PluginSettingDescriptors = Record<string, PluginSettingDescriptor>;

export type PluginSettingValue = string | boolean;

/** `default` present → non-optional value; absent → `T | undefined`. */
export type PluginSettingsValues<
  Ds extends Record<string, PluginSettingDescriptor>,
> = {
  [K in keyof Ds]: Ds[K] extends { default: string | boolean }
    ? PluginSettingValueOf<Ds[K]>
    : PluginSettingValueOf<Ds[K]> | undefined;
};

type PluginSettingValueOf<D extends PluginSettingDescriptor> = D extends {
  type: "boolean";
}
  ? boolean
  : string;

export interface PluginSettingsHandle<
  Ds extends Record<string, PluginSettingDescriptor>,
> {
  /** Load-safe: callable inside the factory. */
  get(): Promise<PluginSettingsValues<Ds>>;
  /** Fires after values change through the settings route/CLI. */
  onChange(
    listener: (
      next: PluginSettingsValues<Ds>,
      prev: PluginSettingsValues<Ds>,
    ) => void,
  ): void;
}

export interface PluginSettings {
  define<Ds extends Record<string, PluginSettingDescriptor>>(
    descriptors: Ds,
  ): PluginSettingsHandle<Ds>;
}

// ---------------------------------------------------------------------------
// Storage (design §4.3).
// ---------------------------------------------------------------------------

export interface PluginKvStorage {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export interface PluginStorage {
  /** Namespaced JSON key-value rows in bb.db; values ≤256KB each. */
  kv: PluginKvStorage;
  /**
   * The plugin's own SQLite database at <dataDir>/plugins/<id>/data.db — the
   * server's better-sqlite3, WAL mode, busy_timeout 5000. Returns the same
   * open handle for the whole plugin load, so calling it per request is
   * cheap; a new handle is opened only on the first call or after the
   * plugin closed the previous one. The host closes handles on
   * dispose/reload; a closed handle throws on use.
   */
  database(): Database.Database;
  /**
   * Ordered-statement migration helper: statement index = migration id in a
   * `_bb_migrations` table; unapplied statements run in one transaction.
   * Append-only — never reorder or edit shipped statements.
   */
  migrate(db: Database.Database, statements: string[]): void;
}

// ---------------------------------------------------------------------------
// Thread lifecycle events (design §4.5).
// ---------------------------------------------------------------------------

/**
 * Thread lifecycle events a plugin can observe (design §4.5). Observe-only:
 * handlers run fire-and-forget after the transition is applied and can never
 * block or veto it. `thread` is the same public DTO GET /threads/:id serves.
 */
export interface PluginThreadEventPayloads {
  /** Fired after a thread row is created. */
  "thread.created": { thread: ThreadResponse };
  /** Fired when a thread transitions into `active`. */
  "thread.active": { thread: ThreadResponse };
  /** Fired when a thread transitions into `idle`. `lastAssistantText` is
   * assembled the same way GET /threads/:id/output is. */
  "thread.idle": { thread: ThreadResponse; lastAssistantText: string | null };
  /** Fired when a thread transitions into `error`. `error` is the latest
   * system/error event message, when one exists. */
  "thread.failed": { thread: ThreadResponse; error: string | null };
  /** Fired after a thread is archived (including cascade archives). */
  "thread.archived": { thread: ThreadResponse };
  /** Fired after a thread is soft-deleted. */
  "thread.deleted": { thread: ThreadResponse };
}

export type PluginThreadEventName = keyof PluginThreadEventPayloads;

export type PluginThreadEventHandler<E extends PluginThreadEventName> = (
  payload: PluginThreadEventPayloads[E],
) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Wire surfaces: HTTP, rpc, realtime (design §4.6/§4.7).
// ---------------------------------------------------------------------------

export type PluginHttpAuthMode = "local" | "token" | "none";

export type PluginHttpHandler = (
  context: Context,
) => Response | Promise<Response>;

export interface PluginHttp {
  /**
   * Register an HTTP route, mounted at
   * `/api/v1/plugins/<id>/http/<path>`. Auth modes (default "local"):
   * - "local": Origin/Host must be a local BB app origin; non-GET requires
   *   content-type application/json (forces a CORS preflight).
   * - "token": requires the per-plugin token (`bb plugin token <id>`) via
   *   the x-bb-plugin-token header or ?token=.
   * - "none": no checks — only for signature-verified webhooks.
   */
  route(
    method: string,
    path: string,
    handler: PluginHttpHandler,
    opts?: { auth?: PluginHttpAuthMode },
  ): void;
}

export interface PluginRpc {
  /**
   * Register a Standard Schema-driven rpc contract and its inferred handlers,
   * served at POST
   * `/api/v1/plugins/<id>/rpc/<method>` with "local" auth semantics. The
   * host validates input before invocation and output before strict JSON
   * serialization. The response is `{ ok: true, result }` or
   * `{ ok: false, error: { code, message, issues? } }`.
   */
  register<Contract extends PluginRpcContract>(
    contract: Contract,
    handlers: PluginRpcHandlers<Contract>,
  ): void;
}

export interface PluginRealtime {
  /**
   * Broadcast an ephemeral `plugin-signal` WS message
   * `{ pluginId, channel, payload }` to every connected client (V1 has no
   * per-channel subscriptions). `payload` must be JSON-serializable;
   * `undefined` is normalized to `null`. Nothing is persisted.
   */
  publish(channel: string, payload: unknown): void;
}

// ---------------------------------------------------------------------------
// Background services and schedules (design §4.8).
// ---------------------------------------------------------------------------

export interface PluginBackground {
  /**
   * Register a long-lived background service. `start` runs after the
   * factory completes and should resolve when `signal` aborts
   * (dispose/reload/disable/shutdown). A crash restarts it with capped
   * exponential backoff; throwing NeedsConfigurationError marks the plugin
   * `needs-configuration` and stops restarting until the next load.
   */
  service(
    name: string,
    service: { start(signal: AbortSignal): void | Promise<void> },
  ): void;
  /**
   * Register a cron schedule (5-field expression, server-local time). The
   * durable row keyed (pluginId, name) is upserted at load; the periodic
   * sweep claims due rows with a CAS on next_run_at, but only while this
   * plugin is loaded. Failures land in last_status/last_error, visible in
   * `bb plugin list`.
   */
  schedule(name: string, cron: string, fn: () => void | Promise<void>): void;
}

// ---------------------------------------------------------------------------
// Agent-facing CLI subcommands (design §4.4).
// ---------------------------------------------------------------------------

export interface PluginCliCommandInfo {
  name: string;
  summary: string;
  usage: string;
}

/** Context forwarded from the invoking CLI when known; all fields optional. */
export interface PluginCliContext {
  cwd?: string;
  threadId?: string;
  projectId?: string;
  /** Aborted when the invoking CLI HTTP request disconnects. */
  signal?: AbortSignal;
}

export type PluginInteractionCancelReason =
  | "user"
  | "request-aborted"
  | "thread-stopped"
  | "thread-deleted"
  | "plugin-disposed"
  | "server-restarted"
  | "timeout";

export type PluginInteractionResult =
  | { outcome: "submitted"; value: JsonValue }
  | { outcome: "cancelled"; reason: PluginInteractionCancelReason };

export interface PluginInteractionRequest {
  threadId: string;
  rendererId: string;
  title: string;
  payload: JsonValue;
  /** Defaults to ten minutes; capped at one hour. */
  timeoutMs?: number;
}

export interface PluginCliResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

/**
 * Maximum combined UTF-8 bytes accepted from plugin CLI stdout and stderr.
 * This is the shared source of truth for production and the testing harness.
 */
export const PLUGIN_CLI_OUTPUT_MAX_BYTES = 1024 * 1024;

export interface PluginCliOutputLimitError {
  code: "plugin_cli_output_too_large";
  message: string;
  maxBytes: number;
  stdoutBytes: number;
  stderrBytes: number;
  totalBytes: number;
}

/** Normalized host result returned by the plugin CLI HTTP/testing boundary. */
export interface PluginCliExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: PluginCliOutputLimitError;
}

export interface PluginCliRegistration {
  /** Top-level command name (`bb <name> …`): lowercase [a-z0-9-]+, and not
   * a core bb command (see RESERVED_BB_CLI_COMMANDS in the server). */
  name: string;
  summary: string;
  /** Subcommand metadata rendered in help and the plugin-commands skill
   * without executing plugin code. Parsing argv is plugin-owned. */
  commands?: PluginCliCommandInfo[];
  run(
    argv: string[],
    ctx: PluginCliContext,
  ): PluginCliResult | Promise<PluginCliResult>;
}

export interface PluginCli {
  /**
   * Register this plugin's `bb` subcommand. One registration per factory
   * execution; a repeated call is rejected. Core bb commands always win
   * name collisions; reserved names are rejected at registration.
   */
  register(registration: PluginCliRegistration): void;
}

// ---------------------------------------------------------------------------
// Agent surfaces: per-turn context and native tools (design §4.4).
// ---------------------------------------------------------------------------

/** Per-turn context handed to bb.agents context providers (design §4.4). */
/** MCP-style content parts a native tool may return (design §4.4). */
export type PluginAgentToolContentPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type PluginAgentToolResult =
  | string
  | { content: PluginAgentToolContentPart[]; isError?: boolean };

/** Per-call context handed to a native tool's execute (design §4.4). */
export interface PluginAgentToolContext {
  threadId: string;
  projectId: string;
  /** The tool-call request's abort signal (aborts if the daemon round-trip
   * is torn down mid-call). */
  signal: AbortSignal;
}

/**
 * Native timeline labels for a plugin tool, keyed by BB's own timeline row
 * status. This is experimental: BB may refine its presentation contract
 * before the field is stabilized.
 */
export interface PluginAgentToolExperimentalStatusLabels {
  /** Label shown while the tool call is pending. */
  pending: string;
  /** Label shown after the tool call completes successfully. */
  completed: string;
}

export interface PluginAgentToolRegistrationBase {
  /** Tool name shown to the model: [a-zA-Z0-9_-]+, unique across plugins,
   * and not a built-in dynamic tool (see RESERVED_AGENT_TOOL_NAMES in the
   * server). */
  name: string;
  description: string;
  /**
   * Optional usage snippet appended to the thread instructions whenever
   * this tool is in the session's tool set (mirrors the built-in
   * update_environment_directory guidance). Limited to 4096 characters.
   */
  instructions?: string;
  /**
   * Optional native timeline labels. When omitted, BB shows the standard
   * tool name and arguments (for example, `Ran tool search_docs …`). Labels
   * apply only while the call is pending and after successful completion;
   * approval, error, and interruption states keep BB's standard rendering.
   */
  experimental_statusLabels?: PluginAgentToolExperimentalStatusLabels;
}

/** Stable, plain-data context resolved by the server for one agent session. */
export interface PluginAgentConfigurationContext {
  thread: {
    id: string;
    title: string | null;
    parentThreadId: string | null;
    sourceThreadId: string | null;
  };
  project: {
    id: string;
    kind: "standard" | "personal";
    name: string;
    gitRemoteUrl: string | null;
  };
  environment: {
    id: string;
    name: string | null;
    path: string | null;
    workspaceProvisionType: "unmanaged" | "managed-worktree" | "personal";
    branchName: string | null;
  };
  host: {
    id: string;
    name: string;
  };
  provider: {
    id: string;
    model: string;
    /**
     * The provider's declared capabilities, so a plugin can decide what to
     * contribute from what the provider says it does rather than from its own
     * copy of a provider id list.
     */
    capabilities: {
      /**
       * The provider ships its own user-question affordance and bb routes it
       * into the pending-interaction path. A plugin offering the same thing
       * should withhold it here, or the model gets two ways to ask once.
       */
      supportsNativeUserQuestion: boolean;
    };
  };
  /** How the thread was spawned. A side chat is the builtin side-chat
   * plugin's fork: `{ kind: "fork", pluginId: "side-chat" }`. */
  origin: {
    kind: "fork" | null;
    pluginId: string | null;
  };
}

/** Object form of a {@link PluginAgentConfiguration} tools entry: selects a
 * registered tool and overrides the parameter schema advertised to the
 * provider for this resolution only. */
export interface PluginAgentToolSelection {
  /** Name of a tool registered by this plugin via `registerTool`. */
  name: string;
  /** JSON-schema object (root `type: "object"`, JSON-serializable, at most
   * 128 KiB serialized) sent to the provider in place of the registered
   * parameter schema. Execution-side validation still runs the registered
   * parameters, so the override must only narrow what the registered schema
   * already accepts. Recursive local `$ref` chains are rejected. */
  parameters: Record<string, unknown>;
}

/** Per-resolution selection returned by {@link PluginAgents.configure}. */
export interface PluginAgentConfiguration {
  /** Tool names registered by this plugin, or {@link PluginAgentToolSelection}
   * entries to also override a tool's advertised parameter schema for this
   * resolution. Duplicate or unknown names, or an invalid override, reject
   * this plugin's complete selection for the resolution. */
  tools: Array<string | PluginAgentToolSelection>;
  /** Skill frontmatter names from this plugin's manifest skill roots.
   * Duplicate or unknown names reject this plugin's complete selection. */
  skills: string[];
  /** Optional dynamic instructions. Output is truncated to 4096 characters. */
  instructions?: string;
}

// ---------------------------------------------------------------------------
// Agent provider declarations (plans/agent-provider-plugin-surface.md §3).
// ---------------------------------------------------------------------------

/**
 * Permission modes a provider can run a session in — BB's own permission
 * vocabulary, ordered least ("accept-edits") to most ("full") privileged.
 */
export type PluginProviderPermissionMode = "accept-edits" | "auto" | "full";

/**
 * Coarse reasoning-effort ladder entries, ordered lowest to highest. The
 * declared ladder is a fallback only: precise per-model reasoning sets come
 * from the provider's model list at runtime.
 */
export type PluginProviderReasoningLevel =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "ultracode"
  | "max"
  | "ultra";

/**
 * Composer actions a provider supports, by name only. The skills
 * slash-command typeahead is universal — BB injects skills into every
 * provider — so it is implicit and never declared, and the composer owns the
 * trigger syntax (`/plan `, `/goal `) rather than each declaration repeating
 * it.
 */
export type PluginProviderComposerAction = "plan" | "goal";

/**
 * Pre-session capability facts about a provider. A capability earns a field
 * here only when it passes BOTH tests: (1) a consumer outside the provider's
 * own plugin needs the fact, and (2) the fact is needed before / without a
 * live session (picker rendering, route gating, cross-plugin tool
 * composition — including with the host offline). Every boolean is a
 * provider-native fact — the provider implements the feature; the flag only
 * tells external consumers it exists. Session-behavior facts remain handshake
 * capabilities reported by the running bridge. Sessionless maintenance
 * methods are declared here so callers can decide whether to probe without
 * starting the bridge first.
 */
export interface PluginProviderCapabilities {
  /** The provider bridge implements the sessionless `provider/health`
   * request. This is host-local readiness, not a network health check. */
  experimental_providerHealth: boolean;
  /** The provider bridge implements the sessionless `provider/usage`
   * request. A supported method may still report that usage is unavailable
   * for a particular provider or return no usage windows. */
  experimental_providerUsage: boolean;
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
export interface PluginProviderDeclaration {
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

export interface PluginAgents {
  /**
   * Select this plugin's statically registered tools and manifest skills for
   * each thread/session resolution, with optional dynamic instructions. The
   * callback is synchronous and runs at `thread.start` / `turn.submit`; it
   * never rebuilds registrations. Exactly one callback may be registered per
   * factory execution. A throw, malformed result, duplicate id, unknown id,
   * or more than 256 tool/skill ids fails closed for this plugin only.
   *
   * Tools take effect when the provider session is next started or resumed;
   * an already-running session is not hot-mutated. Instructions follow the
   * same boundary: a live provider session keeps the instructions it was
   * constructed with, and a changed selection applies when the session is
   * next constructed. Skill changes follow BB's environment runtime policy:
   * a busy runtime keeps its current catalog until a safe relaunch. Side chats
   * are ordinary plugin-owned forks here — read `origin` to detect them — and
   * their returned tool, skill, and dynamic-instruction selections apply at the
   * same boundaries.
   */
  configure(
    provider: (
      context: PluginAgentConfigurationContext,
    ) => PluginAgentConfiguration,
  ): void;
  /**
   * Register a native dynamic tool (design §4.4). `parameters` is either a
   * zod schema (validated per call; execute receives the parsed value) or a
   * plain JSON-schema object (no validation; execute receives the raw
   * arguments as `unknown`). Tool-set changes apply on the NEXT session
   * start — a tool registered mid-session is not hot-added to running
   * provider sessions. A second registration of the same name within this
   * plugin is rejected; a name already registered by another plugin is
   * rejected and surfaced as this plugin's status detail. Recursive local
   * JSON Schema `$ref` chains are rejected because some model providers reject
   * the complete tool list when any one tool contains them.
   */
  registerTool<Schema extends z.ZodType>(
    tool: PluginAgentToolRegistrationBase & {
      parameters: Schema;
      execute(
        params: z.output<Schema>,
        ctx: PluginAgentToolContext,
      ): PluginAgentToolResult | Promise<PluginAgentToolResult>;
    },
  ): void;
  registerTool(
    tool: PluginAgentToolRegistrationBase & {
      /** Raw JSON-schema escape hatch; params arrive unvalidated. */
      parameters: Record<string, unknown>;
      execute(
        params: unknown,
        ctx: PluginAgentToolContext,
      ): PluginAgentToolResult | Promise<PluginAgentToolResult>;
    },
  ): void;
  /**
   * Contribute a dynamic section appended to thread instructions. The
   * provider runs when a thread's runtime command config is resolved
   * (thread.start / turn.submit); return null to contribute nothing for
   * that resolution. A live provider session keeps the instructions it was
   * constructed with — a changed contribution takes effect when the
   * provider session is next constructed (thread start or resume after a
   * daemon restart, environment switch, or provider restart), never
   * mid-session. Must be synchronous and fast — it sits on the
   * thread-start path. Output longer than 4096 characters is truncated; a
   * throwing provider is logged against the plugin and contributes nothing.
   * A repeated registration within one factory execution is rejected.
   */
  contributeInstructions(
    provider: (ctx: { threadId: string; projectId: string }) => string | null,
  ): void;
  /**
   * Register an agent provider this plugin contributes (experimental — see
   * docs/api_to_audit.md before relying on it). The declaration is validated
   * at call time; the provider joins the server's provider registry when the
   * plugin load commits and then appears in provider listings. Ids are stable
   * and collision-rejected: an id already claimed by a core provider or
   * another plugin fails this plugin's load. A plugin may register several
   * providers and may re-register after `dispose()` (a settings-driven
   * re-declaration); registrations are replaced wholesale on plugin reload,
   * like every other surface. The disposer removes the registration.
   */
  experimental_registerProvider(declaration: PluginProviderDeclaration): {
    dispose(): void;
  };
}

// ---------------------------------------------------------------------------
// Host-rendered UI contributions (design §4.9).
// ---------------------------------------------------------------------------

export type PluginMentionTrigger = "@" | "#" | "$" | "!" | "~";

/** Search context handed to a mention provider (design §4.9). `projectId`/
 * `threadId` are null when the composer has not committed one yet. */
export interface PluginMentionSearchContext {
  trigger: PluginMentionTrigger;
  query: string;
  projectId: string | null;
  threadId: string | null;
}

/** One row a mention provider returns from `search`. `id` is the provider's
 * own item id — the host namespaces it before it reaches the wire. */
export interface PluginMentionItem {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
}

export interface PluginMentionProviderRegistration {
  /** Unique within this plugin: [a-zA-Z0-9_-]+ (no ":" — the host composes
   * wire item ids as "<providerId>:<itemId>"). */
  id: string;
  /** Section label shown above this provider's rows in the mention menu. */
  label: string;
  /**
   * Composer trigger characters this provider should answer. Omit to use the
   * default `@` mention trigger. Valid triggers are `@`, `#`, `$`, `!`, and `~`.
   */
  triggers?: readonly PluginMentionTrigger[];
  /**
   * Runs server-side as the user types after one of this provider's triggers
   * in the composer. Each call is time-boxed (2s) and failure-isolated: a slow
   * or throwing provider contributes an empty list — it can never break the
   * mention menu.
   */
  search(
    ctx: PluginMentionSearchContext,
  ): PluginMentionItem[] | Promise<PluginMentionItem[]>;
  /**
   * Resolves one picked item into agent context, called once per unique
   * item at message send time. The returned `context` is attached to the
   * message as an agent-visible (user-hidden) prompt input. Throwing blocks
   * the send with a visible error.
   */
  resolve(itemId: string): { context: string } | Promise<{ context: string }>;
}

export interface PluginUi {
  /** Block until the app submits or cancels a plugin-owned composer form. */
  requestInput(
    request: PluginInteractionRequest,
    options?: { signal?: AbortSignal },
  ): Promise<PluginInteractionResult>;
  /**
   * Register a mention provider for the shipped app's composer (design §4.9).
   * Providers default to the `@` trigger and may opt into `#`, `$`, `!`, or
   * `~` with `triggers`. Items group under `label` in the mention menu; a
   * picked item becomes a `{ kind: "plugin" }` mention resource whose context
   * is resolved once at send time. Multiple providers per plugin; ids must be
   * unique within the plugin.
   */
  registerMentionProvider(provider: PluginMentionProviderRegistration): void;
}

export interface PluginEvents {
  /**
   * Add a thread lifecycle listener. Multiple listeners for the same event are
   * additive and run independently in registration order.
   */
  on<E extends PluginThreadEventName>(
    event: E,
    handler: PluginThreadEventHandler<E>,
  ): void;
}

// ---------------------------------------------------------------------------
// Server info.
// ---------------------------------------------------------------------------

export interface PluginServerApi {
  /**
   * This BB server's own loopback base URL (e.g. "http://127.0.0.1:38886"),
   * which serves the SPA + /api + /ws. For plugins that proxy or relay
   * traffic back to the server itself (e.g. a tunnel). Bind-gated like
   * `bb.sdk`: reading it before the server is listening throws, so prefer
   * reading it from handlers, services, and timers.
   */
  readonly loopbackBaseUrl: string;
}

// ---------------------------------------------------------------------------
// Host control plane.
// ---------------------------------------------------------------------------

export interface PluginSharedPortTunnelIdentity {
  /** Gate routing label assigned to this machine. */
  label: string;
  /** Gate apex without a scheme, e.g. "getbb.app". */
  baseDomain: string;
}

export interface PluginHosts {
  /** Create the owning plugin's typed client for its singular `bb.host` entry. */
  experimental_client<
    Contract extends PluginRpcContract,
    Signals extends ExperimentalHostSignals = {},
  >(args: {
    contract: Contract;
    experimental_signals?: Signals;
  }): ExperimentalHostClient<Contract, Signals>;

  /**
   * Ensure this enrolled host has a gate label and return its read-only public
   * identity. The daemon chooses the trusted gate and desired label; plugins
   * cannot influence either credential-bearing destination.
   */
  ensureSharedPortTunnel(
    hostId: string,
  ): Promise<PluginSharedPortTunnelIdentity>;

  /**
   * Replace this plugin's desired shared-loopback ports for one host. The
   * server aggregates declarations, owns generations, and delivers the
   * resulting set to that host's daemon. Tunnel identity is deliberately not
   * accepted here: it is owned by the daemon's trusted enrollment.
   */
  declareSharedPorts(hostId: string, ports: readonly number[]): void;
}

// ---------------------------------------------------------------------------
// Status + the API root.
// ---------------------------------------------------------------------------

export interface PluginStatusApi {
  /**
   * Mark this plugin `needs-configuration` (with a message shown in
   * `bb plugin list` and the UI) instead of failing — e.g. a factory or
   * service that finds no API key configured. Cleared on the next load;
   * saving settings does not auto-reload in V1, so ask the user to
   * `bb plugin reload <id>` after configuring.
   */
  needsConfiguration(message: string): void;
}

/**
 * The API object handed to a plugin's factory (design §4). Implemented by
 * the BB server; this contract is what plugin `server.ts` files compile
 * against.
 */
export interface BbPluginApi {
  /** The plugin's own id (namespaces storage, routes, commands). */
  readonly pluginId: string;
  /** Leveled, plugin-scoped logger. */
  readonly log: PluginLogger;
  /** Declarative settings (design §4.2). */
  readonly settings: PluginSettings;
  /** Namespaced KV + per-plugin database (design §4.3). */
  readonly storage: PluginStorage;
  /** HTTP routes under /api/v1/plugins/<id>/http/* (design §4.6). */
  readonly http: PluginHttp;
  /** RPC methods under /api/v1/plugins/<id>/rpc/<method> (design §4.6). */
  readonly rpc: PluginRpc;
  /** Ephemeral push to connected frontends (design §4.7). */
  readonly realtime: PluginRealtime;
  /** Long-lived services + cron schedules (design §4.8). */
  readonly background: PluginBackground;
  /** Agent-facing `bb` CLI subcommand (design §4.4). */
  readonly cli: PluginCli;
  /** Per-turn agent context contributions (design §4.4). */
  readonly agents: PluginAgents;
  /** Host-rendered UI contributions (design §4.9). */
  readonly ui: PluginUi;
  /** Additive plugin lifecycle listeners (design §4.5). */
  readonly events: PluginEvents;
  /** Plugin-reported status (needs-configuration). */
  readonly status: PluginStatusApi;
  /** Read-only facts about the running server (loopback base URL). */
  readonly server: PluginServerApi;
  /** Server-to-daemon host control-plane declarations. */
  readonly hosts: PluginHosts;
  /**
   * The full BB SDK, bound to this server over loopback (design §4.1).
   * Bind-gated: reading this before the host binds the SDK throws. The real
   * server binds it before loading plugins, so it is available from the
   * moment factories run there — but isolated harnesses may not, so prefer
   * using it from handlers, services, and timers for portability.
   * `threads.spawn` defaults `origin` to "plugin" and `originPluginId` to
   * this plugin's id so spawned threads are attributed automatically.
   */
  readonly sdk: BbSdk;
  /**
   * Register cleanup to run on reload/disable/shutdown. Hooks run LIFO.
   * The sanctioned place to clear timers and close connections.
   */
  onDispose(hook: () => void | Promise<void>): void;
}
