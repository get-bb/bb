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
import type { JsonObject } from "@bb/domain";
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

/**
 * The scripted echo bridge's TypeScript entry, used as the artifact directly:
 * from source the bridge bootstrap runs under tsx, which imports `.ts`
 * modules, so no build step stands between a test and the bridge.
 */
export const scriptedEchoBridgeModulePath = fileURLToPath(
  new URL(
    "../../../../tests/scripted-echo-provider/src/provider-bridge.ts",
    import.meta.url,
  ),
);

/**
 * Scripted behaviour the bridge reads from `options.providerOptions.scripted`
 * on every session/turn command (the runtime merges a launch's
 * `providerOptions` into every command). Mirrors `ScriptedEchoOptions` in
 * tests/scripted-echo-provider; the bridge validates it.
 */
export interface ScriptedEchoLaunchScript {
  startDelayMs?: number;
  identityFromThreadId?: boolean;
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
   * failure to the first that many calls (per process).
   */
  failMethods?: {
    method: string;
    message: string;
    code?: number;
    times?: number;
  }[];
  goalClearNotifyDelayMs?: number;
  /** The `cleared` value `thread/goal/clear` answers (default true). */
  goalClearReportsCleared?: boolean;
  swallowTurnStart?: boolean;
  sessionRestorable?: boolean;
  warnOnTurn?: boolean;
  /** The bb thread id hint the bridge puts on its tool-call requests. */
  toolCallThreadIdHint?: string;
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
      experimental_providerInstallation: false,
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

/**
 * Attach a bridge launch to every runtime entry point that can start a
 * provider, as the server does on every command it sends the daemon.
 */
export function withBridgeLaunch(
  runtime: AgentRuntime,
  bridgeLaunch: AgentRuntimeBridgeLaunch,
): AgentRuntime {
  return {
    ...runtime,
    ensureProvider: (args) => runtime.ensureProvider({ bridgeLaunch, ...args }),
    startThread: (args) => runtime.startThread({ bridgeLaunch, ...args }),
    prepareThreadRewind: (args) =>
      runtime.prepareThreadRewind({ bridgeLaunch, ...args }),
    resumeThread: (args) => runtime.resumeThread({ bridgeLaunch, ...args }),
    listModels: (args) => runtime.listModels({ bridgeLaunch, ...args }),
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
): AgentRuntime {
  const runtime = createAgentRuntime({
    onToolCall: async () => ({ contentItems: [], success: true }),
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
