// Portable type declarations for `@get-bb/plugin-sdk`. Unpublished BB
// workspace contracts are flattened; public subpaths may reuse the
// package root without requiring any other @bb/* package.
//
// Confused by the API, or need a symbol that isn't here? Clone the BB repo
// and read the real source: https://github.com/get-bb/bb

import { BbPluginApi, PluginSettingValue, PluginSharedPortTunnelIdentity, PluginAgentToolExperimentalStatusLabels, PluginAgentToolContext, PluginAgentToolResult, PluginCliCommandInfo, PluginCliContext, PluginCliResult, PluginHttpAuthMode, PluginHttpHandler, PluginMentionTrigger, PluginMentionSearchContext, PluginMentionItem, JsonValue, PluginCliExecutionResult, PluginThreadEventName, PluginThreadEventPayloads, PluginAgentConfigurationContext, PluginSettingDescriptors, PluginAgentConfiguration, PluginInteractionRequest } from '@get-bb/plugin-sdk';

type BbSdk = BbPluginApi["sdk"];
/**
 * Recordable `bb.sdk` stand-in for {@link createFakePluginHost}. Every call
 * through the fake is recorded (post plugin-attribution defaulting, so
 * assertions see what the server would receive); calls without a stubbed
 * implementation throw with a message naming the exact path to stub.
 */
/** One recorded `bb.sdk` call. `path` is dot-joined, e.g. "threads.spawn". */
interface FakeSdkCall {
    path: string;
    args: unknown[];
}
/**
 * A stub keeps the real method's parameter types but may return anything —
 * tests usually only build the fields the plugin reads, not the full wire
 * response.
 */
type LooseStub<F> = F extends (...args: infer A) => unknown ? (...args: A) => unknown : never;
/**
 * Stub implementations keyed like `BbSdk`: an object per area with a subset
 * of its methods, or a function for the root-level members (`on`).
 */
type FakeSdkOverrideTree<T> = {
    [K in keyof T]?: T[K] extends (...args: never[]) => unknown ? LooseStub<T[K]> : FakeSdkOverrideTree<T[K]>;
};
type FakeSdkOverrides = FakeSdkOverrideTree<BbSdk>;
interface FakeSdkHarness {
    /** Every `bb.sdk` call in order, including ones whose stub threw. */
    readonly calls: FakeSdkCall[];
    /** Argument lists of the calls to one dot-joined path. */
    callsTo(path: string): unknown[][];
    /** Add or replace one method's implementation after creation. */
    stub(path: string, implementation: (...args: never[]) => unknown): void;
}
declare function createFakeSdk(options: {
    pluginId: string;
    overrides?: FakeSdkOverrides;
}): {
    sdk: BbSdk;
    harness: FakeSdkHarness;
};

/**
 * `createFakePluginHost` — an in-process stand-in for the BB server's plugin
 * runtime (apps/server/src/services/plugins/plugin-api.ts), for unit-testing
 * a plugin's `server.ts` without a server. `bb` satisfies {@link BbPluginApi};
 * `harness` drives and inspects it.
 *
 * Faithful where a plugin can observe it: registration name validation and
 * error messages, the kv 256KB cap, append-only database migrations, settings
 * read/update semantics (including onChange), schema-validated rpc/cli
 * invocation shapes (strict JSON boundaries, exit-code normalization), `threads.spawn`
 * attribution, atomic reload, and dispose order (services aborted, hooks LIFO,
 * database closed, stale handles throw). New tests can keep host inputs,
 * assertions, and shutdown explicit through `harness.behavior`,
 * `harness.inspection`, and `harness.lifecycle`; direct members remain aliases.
 *
 * Deliberately different from the real host:
 * - storage is process-local: kv in a Map, `storage.database()` one shared
 *   better-sqlite3 handle in a temp directory (same data across calls, like
 *   the host's shared file), secret settings alongside plain values (no files).
 * - `bb.sdk` is always bound (no listen gate) and every unstubbed method
 *   throws instead of hitting a server.
 * - http auth modes are recorded but not enforced — signature checks and
 *   token handling inside handlers still run.
 * - background services/schedules never run on timers; `harness.runService`
 *   and `harness.runSchedule` invoke them deterministically.
 */
/** Same shape (and name) the real host throws for stale API handles. */
declare class PluginContextStaleError extends Error {
    constructor(pluginId: string);
}
type FakeLogLevel = "debug" | "info" | "warn" | "error";
interface FakeLogEntry {
    level: FakeLogLevel;
    message: string;
}
interface FakeHttpRouteRecord {
    method: string;
    path: string;
    auth: PluginHttpAuthMode;
    handler: PluginHttpHandler;
}
interface FakeScheduleRecord {
    name: string;
    cron: string;
    fn: () => void | Promise<void>;
}
interface FakeServiceRecord {
    name: string;
    start: (signal: AbortSignal) => void | Promise<void>;
}
interface FakeCliRecord {
    name: string;
    summary: string;
    commands: PluginCliCommandInfo[];
    run: (argv: string[], ctx: PluginCliContext) => PluginCliResult | Promise<PluginCliResult>;
}
interface FakeAgentToolRecord {
    name: string;
    description: string;
    experimentalStatusLabels: PluginAgentToolExperimentalStatusLabels | null;
    instructions: string | null;
    /** JSON-schema object the host would send providers. */
    inputSchema: unknown;
    parse(input: unknown): {
        ok: true;
        value: unknown;
    } | {
        ok: false;
        error: string;
    };
    execute(params: unknown, ctx: PluginAgentToolContext): PluginAgentToolResult | Promise<PluginAgentToolResult>;
}
interface FakeMentionProviderRecord {
    id: string;
    label: string;
    triggers: readonly PluginMentionTrigger[];
    search: (ctx: PluginMentionSearchContext) => PluginMentionItem[] | Promise<PluginMentionItem[]>;
    resolve: (itemId: string) => {
        context: string;
    } | Promise<{
        context: string;
    }>;
}
interface FakeRealtimeSignal {
    channel: string;
    /** JSON-round-tripped, like the WS broadcast; `undefined` → `null`. */
    payload: unknown;
}
/** Everything the plugin registered, exposed raw for assertions. */
interface FakePluginRegistrations {
    settingsDescriptors: PluginSettingDescriptors;
    httpRoutes: FakeHttpRouteRecord[];
    rpcMethods: string[];
    services: FakeServiceRecord[];
    schedules: FakeScheduleRecord[];
    cli: FakeCliRecord | null;
    agentTools: FakeAgentToolRecord[];
    /** Provider from bb.agents.configure, or null when none registered. */
    agentConfigurationProvider: ((context: PluginAgentConfigurationContext) => PluginAgentConfiguration) | null;
    /** Provider from contributeInstructions, or null when none registered. */
    instructionProvider: ((ctx: {
        threadId: string;
        projectId: string;
    }) => string | null) | null;
    threadEventHandlers: Record<PluginThreadEventName, number>;
    mentionProviders: FakeMentionProviderRecord[];
}
/** Read-only state for assertions after a plugin registers or handles work. */
interface FakePluginInspectionState {
    readonly pluginId: string;
    /** Every `bb.log` line, in order. */
    readonly logEntries: FakeLogEntry[];
    /** Every `bb.realtime.publish`, payload normalized like the wire. */
    readonly realtimeSignals: FakeRealtimeSignal[];
    /** Every `bb.status.needsConfiguration` message, in order. */
    readonly needsConfigurationMessages: string[];
    /** Recorded `bb.sdk` calls + stub control. */
    readonly sdk: FakeSdkHarness;
    readonly registrations: FakePluginRegistrations;
    readonly sharedPortDeclarations: Array<{
        hostId: string;
        ports: number[];
    }>;
    readonly pendingInteractions: readonly (PluginInteractionRequest & {
        id: string;
    })[];
}
/** Deterministic inputs that stand in for behavior normally driven by BB. */
interface FakePluginBehaviorDrivers {
    submitInteraction(id: string, value: JsonValue): void;
    cancelInteraction(id: string): void;
    /**
     * Apply a settings update the way the host's settings save does:
     * validate against the declared descriptors (`null` unsets), store, and
     * fire `onChange` listeners when effective values changed. Throws on
     * unknown keys or wrong value types.
     */
    setSettings(values: Record<string, PluginSettingValue | null>): Promise<void>;
    /**
     * Invoke a registered rpc method with host semantics: input/output schemas,
     * strict JSON result normalization, and structured failure codes. Rejects
     * with the same message/code/issues the frontend client surfaces.
     */
    callRpc(method: string, input?: unknown): Promise<unknown>;
    /**
     * Invoke the plugin's CLI command with host semantics: the result's
     * exitCode must be a number, stdout/stderr default to "", and a throwing
     * run() becomes `{ exitCode: 1, stderr: "bb <name> failed: …" }`.
     */
    runCli(argv: string[], ctx?: PluginCliContext): Promise<PluginCliExecutionResult>;
    /**
     * Dispatch a request to a registered `bb.http` route (exact method+path
     * match, like the host's V1 router) through a real Hono context. Auth
     * modes are not enforced. A throwing handler yields the host's 500
     * `{ ok: false, error: "plugin route failed: …" }` response.
     */
    fetchHttp(method: string, path: string, init?: RequestInit): Promise<Response>;
    /**
     * Start a registered background service once, deterministically. `done`
     * settles when `start` returns; abort `controller` to signal shutdown.
     * A thrown NeedsConfigurationError (matched by name, like the host) is
     * recorded via needsConfiguration and resolves `done`; other errors
     * reject it.
     */
    runService(name: string): {
        controller: AbortController;
        done: Promise<void>;
    };
    /** Run a registered schedule's function once (no timers, no cron sweep). */
    runSchedule(name: string): Promise<void>;
    /**
     * Deliver a thread lifecycle event to every `bb.events.on` handler. Handlers run
     * sequentially; errors are caught and logged like the host's
     * fire-and-forget dispatch, and returned for assertions.
     */
    emitThreadEvent<E extends PluginThreadEventName>(event: E, payload: PluginThreadEventPayloads[E]): Promise<{
        errors: unknown[];
    }>;
    /**
     * Call a registered agent tool the way a provider tool-call would:
     * arguments go through the tool's parse step (zod-validated for zod
     * registrations; a parse failure throws), then execute. `ctx` fields
     * default to "thread-test"/"project-test" and a fresh signal.
     */
    callAgentTool(name: string, input: unknown, ctx?: Partial<PluginAgentToolContext>): Promise<PluginAgentToolResult>;
    /** Evaluate `bb.agents.configure` with production validation/fail-closed
     * semantics. With no callback, every registered tool/declared test skill is
     * selected. Callback failures are logged and return empty selections. */
    resolveAgentConfiguration(context: PluginAgentConfigurationContext): Promise<{
        tools: FakeAgentToolRecord[];
        skills: string[];
        instructions: string | null;
    }>;
}
/** Reload/shutdown controls, kept separate from behavior and inspection. */
interface FakePluginLifecycleControls {
    /**
     * Load a replacement against the same persisted settings, kv, and database.
     * The current host remains live when the factory throws; on success its
     * services/hooks are disposed and the returned host becomes current.
     */
    reload(factory: (bb: BbPluginApi) => void | Promise<void>): Promise<FakePluginHost>;
    /**
     * Dispose like a host reload/disable: abort services started via
     * runService, run onDispose hooks LIFO (isolated), close database handles,
     * then poison the `bb` handle (further use throws
     * PluginContextStaleError). Idempotent.
     */
    dispose(): Promise<void>;
}
/**
 * Complete fake-host harness. Direct members are retained for compatibility;
 * the named views make intent explicit in new tests.
 */
interface FakePluginHarness extends FakePluginInspectionState, FakePluginBehaviorDrivers, FakePluginLifecycleControls {
    readonly behavior: FakePluginBehaviorDrivers;
    readonly inspection: FakePluginInspectionState;
    readonly lifecycle: FakePluginLifecycleControls;
}
interface CreateFakePluginHostOptions {
    /** Defaults to "test-plugin". */
    pluginId?: string;
    /**
     * Value served by `bb.server.loopbackBaseUrl` (always bound here, like
     * `bb.sdk`). Defaults to "http://127.0.0.1:38886".
     */
    loopbackBaseUrl?: string;
    /**
     * Pre-seeded stored settings values (as if saved before this load) —
     * including secret ones, which the fake keeps in memory instead of
     * files. Values with the wrong type for their descriptor fall back to
     * the descriptor default on read, like the host.
     */
    settings?: Record<string, PluginSettingValue>;
    /** Initial `bb.sdk` stubs; extend later via `harness.sdk.stub`. */
    sdk?: FakeSdkOverrides;
    /** Static manifest skill ids available to configure() in this fake host. */
    agentSkillIds?: readonly string[];
    /** Read-only identities returned by bb.hosts.ensureSharedPortTunnel. */
    sharedPortTunnelIdentities?: Record<string, PluginSharedPortTunnelIdentity>;
}
interface FakePluginHost {
    bb: BbPluginApi;
    harness: FakePluginHarness;
}
declare function createFakePluginHost(options?: CreateFakePluginHostOptions): FakePluginHost;

type ThreadResponse = PluginThreadEventPayloads["thread.created"]["thread"];
/**
 * A complete, deterministic `ThreadResponse` for thread lifecycle event
 * payloads (`harness.emitThreadEvent`). Defaults are the minimal idle
 * thread; override the fields the test cares about. If the contract grows a
 * required field, this builder fails typecheck — update the default here.
 */
declare function makeThreadResponse(overrides?: Partial<ThreadResponse>): ThreadResponse;

export { PluginContextStaleError, createFakePluginHost, createFakeSdk, makeThreadResponse };
export type { CreateFakePluginHostOptions, FakeAgentToolRecord, FakeCliRecord, FakeHttpRouteRecord, FakeLogEntry, FakeLogLevel, FakeMentionProviderRecord, FakePluginBehaviorDrivers, FakePluginHarness, FakePluginHost, FakePluginInspectionState, FakePluginLifecycleControls, FakePluginRegistrations, FakeRealtimeSignal, FakeScheduleRecord, FakeSdkCall, FakeSdkHarness, FakeSdkOverrides, FakeServiceRecord };
