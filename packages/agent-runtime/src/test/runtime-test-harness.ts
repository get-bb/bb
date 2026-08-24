/**
 * The runtime unit suites' provider: the scripted echo bridge
 * (`tests/scripted-echo-provider`), launched exactly as the daemon launches a
 * plugin bridge — through the bridge bootstrap, the bridge-protocol adapter
 * and the delta assembler. There is no test-only adapter path; a test that
 * needs the provider to misbehave scripts it (`scripted` options on the
 * launch, or prompt directives) and a test that needs to see what reached the
 * provider reads the bridge's request record.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { JsonObject, ProviderRecoveryKind } from "@bb/domain";
import { createAgentRuntime } from "../runtime.js";
import type {
  AgentRuntime,
  AgentRuntimeBridgeLaunch,
  AgentRuntimeExecutionOptions,
  AgentRuntimeOptions,
} from "../types.js";
export {
  waitForRuntimeState,
  waitForRuntimeThreadEvent,
  waitForThreadAgentMessageText,
  waitForThreadTurnCompleted,
  waitForThreadTurnStarted,
} from "./runtime-wait-helpers.js";

export const fullRuntimeOptions = {
  model: "test-model",
  serviceTier: "default",
  reasoningLevel: "medium",
  providerOptions: {},
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
} satisfies AgentRuntimeExecutionOptions;

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const prebuiltTestBridgeDir = fileURLToPath(
  new URL("../../dist/test-bridges/", import.meta.url),
);

/**
 * Turbo builds the bridge worker and scripted echo artifact once before the
 * unit suite. Keeping the generated path explicit makes a missing Turbo task
 * fail instead of silently falling back to transforming TypeScript on every
 * bridge spawn and restart.
 */
export const scriptedEchoBridgeModulePath = join(
  prebuiltTestBridgeDir,
  "scripted-echo-provider.mjs",
);

/**
 * Scripted behaviour the bridge reads from `options.providerOptions.scripted`
 * on every session/turn command (the runtime merges a launch's
 * `providerOptions` into every command). Mirrors `ScriptedEchoOptions` in
 * tests/scripted-echo-provider; the bridge validates it.
 */
export interface ScriptedEchoLaunchScript {
  startDelayMs?: number;
  answerStartWithoutIdentity?: boolean;
  archivedSession?: boolean;
  unarchiveFails?: boolean;
  exitAfterArchivedError?: boolean;
  discardFailsOnce?: boolean;
  crashOn?: string;
  exitAfter?: string;
  unsupportedMethods?: string[];
  /**
   * `code` is the JSON-RPC error code (default -32000); `times` bounds the
   * failure to the first that many calls (per process). Entries for one
   * method apply in order once the earlier ones are exhausted.
   */
  failMethods?: {
    method: string;
    message: string;
    code?: number;
    times?: number;
    /** A typed recovery hint on the rejection (`error.data.recovery`). */
    recovery?: { kind: ProviderRecoveryKind; retryable: boolean };
  }[];
  goalClearNotifyDelayMs?: number;
  /** The `cleared` value `thread/goal/clear` answers (default true). */
  goalClearReportsCleared?: boolean;
  swallowTurnStart?: boolean;
  sessionRestorable?: boolean;
  warnOnTurn?: boolean;
  /** The bb thread id hint the bridge puts on its tool-call requests. */
  toolCallThreadIdHint?: string;
  /** The bb thread id the bridge names on its unsolicited recovery hints. */
  recoveryThreadIdHint?: string;
  /** Handshake `approvalEnforcedBy`; process-level (`scriptedEchoProcessEnv`). */
  approvalEnforcedBy?: "runtime" | "provider";
  /** Provider thread ids `prov-<pid>-<n>` and answers prefixed `pid:<pid>:`. */
  identifyProcess?: boolean;
  /** Refuse `thread/stop` for these bb thread ids. */
  failStopForThreadIds?: string[];
  /** Emit a late `thread/identity` on SIGTERM; process-level. */
  emitIdentityOnSigterm?: boolean;
}

export interface CreateScriptedEchoLaunchOptions {
  /** The plugin id the bridge runs under; scopes its data directory. */
  pluginId?: string;
  /** A distinct digest gives the provider a distinct process key. */
  digest?: string;
  scripted?: ScriptedEchoLaunchScript;
  providerOptions?: JsonObject;
  capabilities?: Partial<AgentRuntimeBridgeLaunch["capabilities"]>;
  /** Another bridge module to run instead of the scripted echo bridge. */
  modulePath?: string;
}

/**
 * A bridge launch for the scripted echo bridge, the way the server would
 * attach one for a plugin provider. The data dir is fresh per launch.
 */
export function createScriptedEchoLaunch(
  options: CreateScriptedEchoLaunchOptions = {},
): AgentRuntimeBridgeLaunch {
  const pluginId = options.pluginId ?? "provider-scripted-echo";
  return {
    pluginId,
    dataDir: mkdtempSync(join(tmpdir(), `bb-${pluginId}-data-`)),
    source: {
      kind: "artifact",
      digest: options.digest ?? "scripted-echo",
      artifactPath: options.modulePath ?? scriptedEchoBridgeModulePath,
    },
    capabilities: {
      providerInstallation: false,
      supportsServiceTier: false,
      permissionModes: ["accept-edits", "auto", "full"],
      supportsThreadArchive: true,
      supportsThreadRename: true,
      fork: "checkpoint",
      ...options.capabilities,
    },
    providerOptions: {
      ...options.providerOptions,
      ...(options.scripted === undefined
        ? {}
        : { scripted: scriptToJson(options.scripted) }),
    },
    envPassthrough: [],
  };
}

function scriptToJson(script: ScriptedEchoLaunchScript): JsonObject {
  // The script is plain data; the round trip drops `undefined` members so
  // the launch stays a JSON object.
  return JSON.parse(JSON.stringify(script)) as JsonObject;
}

/**
 * Process-level scripted behaviour, for the runtime's `env`: the bridge reads
 * `SCRIPTED_ECHO_OPTIONS` at startup, so this reaches commands that carry no
 * session options (archive/unarchive on a thread the process never opened,
 * a recovery unarchive after a rejected resume). Per-command `scripted`
 * options on the launch win over these.
 */
export function scriptedEchoProcessEnv(
  script: ScriptedEchoLaunchScript,
): Record<string, string> {
  return { SCRIPTED_ECHO_OPTIONS: JSON.stringify(script) };
}

/** The runtime entry points that carry a bridge launch. */
type LaunchBearingMethod =
  | "ensureProvider"
  | "startThread"
  | "prepareThreadRewind"
  | "resumeThread"
  | "archiveThread"
  | "unarchiveThread"
  | "listModels"
  | "providerHealth"
  | "providerUsage"
  | "providerInstallationStatus"
  | "providerInstallationRun";

type WithDefaultBridgeLaunch<TMethod extends (args: never) => unknown> = (
  args: Omit<Parameters<TMethod>[0], "bridgeLaunch"> & {
    bridgeLaunch?: AgentRuntimeBridgeLaunch;
  },
) => ReturnType<TMethod>;

/**
 * An {@link AgentRuntime} whose launch-bearing entry points default to one
 * bridge launch. The runtime itself requires a launch on every such call
 * (the server attaches one to every command); the harness plays the
 * server's part so a test names the launch only when it wants another one.
 * Structurally an `AgentRuntime`, so it passes wherever one is expected.
 */
export type LaunchBoundAgentRuntime = Omit<
  AgentRuntime,
  LaunchBearingMethod
> & {
  [TMethod in LaunchBearingMethod]: WithDefaultBridgeLaunch<
    AgentRuntime[TMethod]
  >;
};

/**
 * Attach a bridge launch to every runtime entry point that carries one, as
 * the server does on every command it sends the daemon.
 */
export function withBridgeLaunch(
  runtime: AgentRuntime,
  bridgeLaunch: AgentRuntimeBridgeLaunch,
): LaunchBoundAgentRuntime {
  return {
    ...runtime,
    ensureProvider: (args) => runtime.ensureProvider({ bridgeLaunch, ...args }),
    startThread: (args) => runtime.startThread({ bridgeLaunch, ...args }),
    prepareThreadRewind: (args) =>
      runtime.prepareThreadRewind({ bridgeLaunch, ...args }),
    resumeThread: (args) => runtime.resumeThread({ bridgeLaunch, ...args }),
    archiveThread: (args) => runtime.archiveThread({ bridgeLaunch, ...args }),
    unarchiveThread: (args) =>
      runtime.unarchiveThread({ bridgeLaunch, ...args }),
    listModels: (args) => runtime.listModels({ bridgeLaunch, ...args }),
    providerHealth: (args) => runtime.providerHealth({ bridgeLaunch, ...args }),
    providerUsage: (args) => runtime.providerUsage({ bridgeLaunch, ...args }),
    providerInstallationStatus: (args) =>
      runtime.providerInstallationStatus({ bridgeLaunch, ...args }),
    providerInstallationRun: (args) =>
      runtime.providerInstallationRun({ bridgeLaunch, ...args }),
  };
}

export interface CreateScriptedEchoRuntimeArgs {
  runtime: Omit<AgentRuntimeOptions, "onToolCall"> &
    Partial<Pick<AgentRuntimeOptions, "onToolCall">>;
  launch?: CreateScriptedEchoLaunchOptions;
}

/**
 * A runtime whose every provider-launching entry point runs the scripted
 * echo bridge. Tests that want several providers build their own launches
 * with {@link createScriptedEchoLaunch} and pass them per call.
 */
export function createScriptedEchoRuntime(
  args: CreateScriptedEchoRuntimeArgs,
): LaunchBoundAgentRuntime {
  const runtime = createAgentRuntime({
    onToolCall: async () => ({ contentItems: [], success: true }),
    ...(args.launch?.modulePath === undefined
      ? { bridgeBundleDir: prebuiltTestBridgeDir }
      : {}),
    ...args.runtime,
  });
  return withBridgeLaunch(runtime, createScriptedEchoLaunch(args.launch));
}

// ---------------------------------------------------------------------------
// The bridge's process log (SCRIPTED_ECHO_PROCESS_LOG_PATH)
// ---------------------------------------------------------------------------

export interface ScriptedEchoProcessLog {
  /** Pass as (part of) the runtime's `env`. */
  env: Record<string, string>;
  path: string;
  /** `spawn:<pid>`, `exit:<pid>`, `<method>:<pid>:<threadId>[:<extra>]`. */
  read(): string[];
}

/**
 * A fresh process log: the bridge appends one line per process-lifecycle step
 * (spawn, SIGTERM exit, thread start/resume, turn start, thread stop), each
 * stamped with its pid — the per-process view a request record cannot give.
 */
export function createScriptedEchoProcessLog(): ScriptedEchoProcessLog {
  const path = join(
    mkdtempSync(join(tmpdir(), "bb-scripted-echo-process-log-")),
    "process.log",
  );
  return {
    env: { SCRIPTED_ECHO_PROCESS_LOG_PATH: path },
    path,
    read() {
      let raw: string;
      try {
        raw = readFileSync(path, "utf8");
      } catch {
        return [];
      }
      return raw.split("\n").filter((line) => line.length > 0);
    },
  };
}

// ---------------------------------------------------------------------------
// The bridge's request record (SCRIPTED_ECHO_RECORD_PATH)
// ---------------------------------------------------------------------------

export interface RecordedBridgeRequest {
  method: string;
  params: Record<string, unknown> | null;
}

export interface ScriptedEchoRequestRecord {
  /** Pass as the runtime's `env` so every bridge this runtime spawns records. */
  env: Record<string, string>;
  path: string;
  read(): RecordedBridgeRequest[];
  /** The last recorded request of a method, or undefined. */
  last(method: string): RecordedBridgeRequest | undefined;
}

/** A fresh record file; the bridge appends every request it handles to it. */
export function createScriptedEchoRequestRecord(): ScriptedEchoRequestRecord {
  const path = join(
    mkdtempSync(join(tmpdir(), "bb-scripted-echo-record-")),
    "requests.jsonl",
  );
  const read = (): RecordedBridgeRequest[] => {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      return [];
    }
    return raw
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as RecordedBridgeRequest);
  };
  return {
    env: { SCRIPTED_ECHO_RECORD_PATH: path },
    path,
    read,
    last(method) {
      const requests = read();
      for (let index = requests.length - 1; index >= 0; index -= 1) {
        if (requests[index]?.method === method) {
          return requests[index];
        }
      }
      return undefined;
    },
  };
}
