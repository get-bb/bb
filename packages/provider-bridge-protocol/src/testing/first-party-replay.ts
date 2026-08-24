/**
 * The first-party half of the parity harness: where each bridge bb ships
 * lives inside a checkout, and how each one is pointed at the replay child.
 * Private — `@bb/provider-parity` and the first-party recorded-conformance
 * suites use it; the published kit (`@get-bb/plugin-sdk/provider-bridge/
 * testing`) exposes only the provider-agnostic core in `parity.ts`, which a
 * plugin feeds its own bridge module and profile.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
  checkRecordedCellReplay,
  RECORDED_CONFORMANCE_CELLS,
  type RecordedCellReplay,
} from "../conformance/recorded.js";
import { formatConformanceReport } from "../conformance/index.js";
import { createBridgeDeltaEventCollector } from "./bridge-delta-assembly.js";
import {
  replayRecordedCells,
  resolveProviderBridgeLaunch,
  type ProviderBridgeLaunch,
  type ReplayProviderProfile,
  type ReplayRecordedCellsOptions,
} from "./parity.js";
import {
  COMMITTED_RECORDINGS_ROOT,
  type BridgeRecording,
  type RecordedCell,
} from "./recording.js";

/**
 * Where each first-party bridge lives inside a checkout.
 *
 * `modulePath` is where it lives today; `legacyModulePaths` are where it lived
 * before. A two-checkout parity run spawns the SAME provider from an older
 * checkout, so a bridge that moved must still be found there — otherwise the
 * old leg silently produces no events and every cell "fails" for a reason
 * that has nothing to do with the change under test.
 */
export const FIRST_PARTY_BRIDGE_MODULES: Readonly<
  Record<
    string,
    { modulePath: string; legacyModulePaths?: string[]; pluginId: string }
  >
> = {
  codex: {
    modulePath: "plugins/provider-codex/src/bridge/bridge.ts",
    pluginId: "provider-codex",
  },
  "claude-code": {
    modulePath: "plugins/provider-claude-code/src/bridge/bridge.ts",
    pluginId: "provider-claude-code",
  },
  acp: {
    // The plugin's `bb.host` entry, which re-exports the published kit
    // (`packages/provider-bridge-acp`). The bridge itself no longer lives in
    // the plugin, and this is the file the daemon runs for it.
    modulePath: "plugins/provider-acp/src/host.ts",
    // Before the ACP bridge became the published kit, the plugin's host
    // artifact was the bridge module itself.
    legacyModulePaths: ["plugins/provider-acp/src/bridge/bridge.ts"],
    pluginId: "provider-acp",
  },
  pi: {
    // The plugin's `bb.host` entry, which re-exports the bridge beside the
    // host RPC that reads pi's skill roots.
    modulePath: "plugins/provider-pi/src/host.ts",
    // Before the host entry existed the bridge module was the artifact. Before
    // pi became a plugin its bridge ran in-process from the daemon's bundle
    // (`packages/agent-runtime/src/pi/bridge/bridge.ts`): no provider child,
    // so that checkout is not a legacy path — a leg there cannot replay and
    // the pre-check must say so instead of launching it.
    legacyModulePaths: ["plugins/provider-pi/src/bridge/bridge.ts"],
    pluginId: "provider-pi",
  },
};

/** The bootstrap inside a checkout (a leg runs its own checkout's). */
const BRIDGE_WORKER_ENTRY =
  "packages/provider-bridge-protocol/src/bridge-worker-entry.ts";

export interface ParityBridgeSpec {
  /** A bb checkout root (the pre-migration worktree, or `.`). */
  checkoutRoot: string;
  providerId: string;
  /** Override the bridge module; defaults to the provider's first-party path. */
  modulePath?: string;
  pluginId?: string;
}

export class UnreplayableProviderError extends Error {
  constructor(providerId: string, reason: string) {
    super(`provider "${providerId}" cannot be replayed: ${reason}`);
    this.name = "UnreplayableProviderError";
  }
}

type FirstPartyReplayProfile = ReplayProviderProfile & {
  bridgeFamily: keyof typeof FIRST_PARTY_BRIDGE_MODULES;
};

export function resolveReplayProfile(
  providerId: string,
): FirstPartyReplayProfile {
  if (providerId === "codex") {
    return {
      dialect: "json-rpc",
      bridgeFamily: "codex",
      env: ({ replayCommand }) => ({
        BB_CODEX_BRIDGE_APP_SERVER_COMMAND: replayCommand[0],
        BB_CODEX_BRIDGE_APP_SERVER_ARGS: JSON.stringify(replayCommand.slice(1)),
      }),
    };
  }
  if (providerId === "claude-code") {
    return {
      dialect: "claude-cli",
      bridgeFamily: "claude-code",
      // The Agent SDK runs a `.mjs` executable through node itself, so the
      // wrapper module (which bakes the replay arguments in) is the "CLI".
      // The config dir is the replay's own: the SDK reads and writes session
      // transcripts under it, and a replay must not touch the user's.
      env: ({ wrapperPath, stateDir }) => ({
        BB_CLAUDE_CODE_EXECUTABLE: wrapperPath,
        CLAUDE_CONFIG_DIR: claudeConfigDir(stateDir),
      }),
      prepareState: seedClaudeForkTranscripts,
    };
  }
  if (providerId.startsWith("acp-")) {
    return {
      dialect: "json-rpc",
      bridgeFamily: "acp",
      env: () => ({}),
      rewriteRuntimeLine: (line, { replayCommand }) =>
        rewriteAcpLaunchSpec(line, replayCommand),
    };
  }
  if (providerId === "pi") {
    return {
      dialect: "pi-rpc",
      bridgeFamily: "pi",
      // The session dir is the replay's own: the bridge checks a fork's
      // source session file there, and pi would write sessions under the
      // user's otherwise.
      env: ({ replayCommand, stateDir }) => ({
        BB_PI_BRIDGE_COMMAND: replayCommand[0],
        BB_PI_BRIDGE_ARGS: JSON.stringify(replayCommand.slice(1)),
        BB_PI_BRIDGE_SESSION_DIR: piSessionDir(stateDir),
      }),
      prepareState: seedPiSessionFiles,
    };
  }
  throw new UnreplayableProviderError(providerId, "no replay profile");
}

function claudeConfigDir(stateDir: string): string {
  return join(stateDir, "claude-config");
}

function piSessionDir(stateDir: string): string {
  return join(stateDir, "pi-sessions");
}

/**
 * The pi bridge refuses a fork whose source session file is missing; the
 * extension (inside the replayed child) is what reads and writes the files,
 * so an empty file per source thread is all the bridge needs.
 */
function seedPiSessionFiles(args: {
  recording: BridgeRecording;
  stateDir: string;
}): void {
  const sessionDir = piSessionDir(args.stateDir);
  mkdirSync(sessionDir, { recursive: true });
  for (const entry of args.recording.entries) {
    if (entry.dir !== "runtime→bridge") continue;
    const message = parseWire(entry.line);
    if (message === null || message.method !== "thread/fork") continue;
    const params = message.params as
      | { sourceProviderThreadId?: unknown }
      | undefined;
    const sourceThreadId = params?.sourceProviderThreadId;
    if (typeof sourceThreadId !== "string") continue;
    writeFileSync(
      join(
        sessionDir,
        `${sourceThreadId.replace(/[^A-Za-z0-9._-]/g, "_")}.jsonl`,
      ),
      "",
    );
  }
}

/** The Agent SDK's project directory name for a workspace path. */
function claudeProjectDirName(workspaceDir: string): string {
  return workspaceDir.replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * `forkSession` in the Agent SDK is a local file operation: it reads the
 * source session's transcript from the config dir's project directory and
 * writes the forked copy beside it. The transcript of the recorded source
 * session lives on the machine that recorded it, and its content does not
 * reach the replay (the forked "CLI" is the replay child), so every recorded
 * `thread/fork` gets a minimal transcript for its source session: one user
 * and one assistant entry, the assistant carrying the checkpoint id the fork
 * names, if any.
 */
function seedClaudeForkTranscripts(args: {
  recording: BridgeRecording;
  stateDir: string;
  workspaceDir: string;
}): void {
  const projectDir = join(
    claudeConfigDir(args.stateDir),
    "projects",
    claudeProjectDirName(args.workspaceDir),
  );
  for (const entry of args.recording.entries) {
    if (entry.dir !== "runtime→bridge") continue;
    const message = parseWire(entry.line);
    if (message === null || message.method !== "thread/fork") continue;
    const params = message.params as
      | {
          sourceProviderThreadId?: unknown;
          sourceProviderCheckpointId?: unknown;
        }
      | undefined;
    const sessionId = params?.sourceProviderThreadId;
    if (typeof sessionId !== "string") continue;
    const checkpointId =
      typeof params?.sourceProviderCheckpointId === "string"
        ? params.sourceProviderCheckpointId
        : randomUUID();
    const userUuid = randomUUID();
    const timestamp = "2026-01-01T00:00:00.000Z";
    const transcript = [
      {
        type: "user",
        uuid: userUuid,
        parentUuid: null,
        sessionId,
        timestamp,
        cwd: args.workspaceDir,
        message: { role: "user", content: "recorded source session" },
      },
      {
        type: "assistant",
        uuid: checkpointId,
        parentUuid: userUuid,
        sessionId,
        timestamp,
        cwd: args.workspaceDir,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "ready" }],
        },
      },
    ];
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, `${sessionId}.jsonl`),
      `${transcript.map((line) => JSON.stringify(line)).join("\n")}\n`,
    );
  }
}

function rewriteAcpLaunchSpec(line: string, replayCommand: string[]): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return line;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return line;
  }
  const message = parsed as {
    params?: { options?: { providerOptions?: Record<string, unknown> } };
  };
  const providerOptions = message.params?.options?.providerOptions;
  const spec = providerOptions?.acpLaunchSpec;
  if (
    providerOptions === undefined ||
    typeof spec !== "object" ||
    spec === null
  ) {
    return line;
  }
  // The replay child is the whole agent: no model CLI to probe, no model flag
  // to splice into its argv (`modelCli` would have the bridge run
  // `node --list-models` and insert `--model` before the script path).
  const { modelCli: _modelCli, ...rest } = spec as Record<string, unknown>;
  providerOptions.acpLaunchSpec = {
    ...rest,
    command: replayCommand[0],
    args: replayCommand.slice(1),
    env: {},
  };
  return JSON.stringify(parsed);
}

function parseWire(line: string): { method?: string; params?: unknown } | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as { method?: string; params?: unknown })
      : null;
  } catch {
    return null;
  }
}

/**
 * The bridge module as this checkout has it: the current path when it exists,
 * else the first legacy path that does. An unknown path is left alone so the
 * spawn fails loudly instead of silently replaying nothing.
 */
/**
 * The bridge module a checkout has for a bridge family: the current path, or
 * the first legacy path that exists there; `null` when the checkout has none.
 * The launch and the parity CLI's old-leg pre-check both go through this, so
 * a leg the pre-check admits is a leg the launch can start.
 */
export function resolveFirstPartyBridgeModulePath(
  checkoutRoot: string,
  entry: { modulePath: string; legacyModulePaths?: string[] },
): string | null {
  for (const candidate of [
    entry.modulePath,
    ...(entry.legacyModulePaths ?? []),
  ]) {
    if (existsSync(join(checkoutRoot, candidate))) {
      return candidate;
    }
  }
  return null;
}

function resolveModulePath(
  checkoutRoot: string,
  entry: { modulePath: string; legacyModulePaths?: string[] },
): string {
  return (
    resolveFirstPartyBridgeModulePath(checkoutRoot, entry) ?? entry.modulePath
  );
}

/**
 * The process that runs a first-party bridge out of a checkout: that
 * checkout's bootstrap and module, through tsx with workspace sources.
 */
export function resolveBridgeLaunch(
  spec: ParityBridgeSpec,
): ProviderBridgeLaunch {
  const checkoutRoot = resolve(spec.checkoutRoot);
  const profile = resolveReplayProfile(spec.providerId);
  const defaults = FIRST_PARTY_BRIDGE_MODULES[profile.bridgeFamily];
  const modulePath =
    spec.modulePath ?? resolveModulePath(checkoutRoot, defaults);
  return resolveProviderBridgeLaunch({
    modulePath: isAbsolute(modulePath)
      ? modulePath
      : join(checkoutRoot, modulePath),
    pluginId: spec.pluginId ?? defaults.pluginId,
    bootstrapPath: join(checkoutRoot, BRIDGE_WORKER_ENTRY),
    cwd: checkoutRoot,
  });
}

/** A first-party cell's bridge and profile, for `replayRecordedCells`. */
export function firstPartyReplayBridge(
  providerId: string,
  checkoutRoot: string,
): { launch: ProviderBridgeLaunch; profile: ReplayProviderProfile } {
  return {
    launch: resolveBridgeLaunch({ checkoutRoot, providerId }),
    profile: resolveReplayProfile(providerId),
  };
}

export interface ReplayFirstPartyRecordedCellsOptions extends Omit<
  ReplayRecordedCellsOptions,
  "bridge" | "recordingsRoot"
> {
  /** The checkout whose bridge replays; defaults to the recordings' own. */
  checkoutRoot?: string;
  /** Defaults to the committed fixtures. */
  recordingsRoot?: string;
}

/**
 * `replayRecordedCells` for a bridge bb ships: the committed recordings,
 * replayed through this checkout's bridge with the provider's own profile.
 */
export function replayFirstPartyRecordedCells(
  options: ReplayFirstPartyRecordedCellsOptions,
): Promise<RecordedCellReplay[]> {
  const recordingsRoot = options.recordingsRoot ?? COMMITTED_RECORDINGS_ROOT;
  const checkoutRoot =
    options.checkoutRoot ?? resolve(recordingsRoot, "../../..");
  const {
    checkoutRoot: _checkoutRoot,
    recordingsRoot: _recordingsRoot,
    ...rest
  } = options;
  return replayRecordedCells({
    ...rest,
    recordingsRoot,
    bridge: (cell: RecordedCell) =>
      firstPartyReplayBridge(cell.provider, checkoutRoot),
  });
}

export interface FirstPartyRecordedConformanceOptions {
  /** Which committed recordings replay: the provider ids this bridge serves. */
  servesProvider: (providerId: string) => boolean;
  /** Names the report, e.g. "codex". */
  label: string;
}

export interface FirstPartyRecordedConformanceRun {
  /** The cells that replayed, sorted. */
  cells: string[];
  /** Every non-passing recorded-cell rule as `<id>: <detail>`; empty when green. */
  failures: string[];
  /** The human-readable report, for the test log. */
  report: string;
}

/**
 * The recorded-traffic conformance run every first-party bridge ships: each
 * committed recording of the live-QA matrix core this bridge serves is
 * replayed through this checkout's bridge, with the recorded provider lines
 * as the child, assembled through the runtime's real delta assembler, and
 * judged by the kit's recorded-cell rules. The suite asserts on the result;
 * nothing here imports a test runner.
 */
export async function runFirstPartyRecordedConformance(
  options: FirstPartyRecordedConformanceOptions,
): Promise<FirstPartyRecordedConformanceRun> {
  const replays = await replayFirstPartyRecordedCells({
    servesProvider: options.servesProvider,
    cells: RECORDED_CONFORMANCE_CELLS,
    createAssembler: (providerId) => {
      const collector = createBridgeDeltaEventCollector(providerId);
      return {
        assembleMessage: (message) => collector.assembleMessage(message),
      };
    },
    timeoutMs: 60_000,
    onStderr: (text) => process.stderr.write(`[bridge] ${text}`),
  });
  const results = replays.flatMap((replay) => checkRecordedCellReplay(replay));
  const report = formatConformanceReport({
    results,
    passed: results.every((result) => result.status === "pass"),
  });
  return {
    cells: replays.map((replay) => replay.cell).sort(),
    failures: results
      .filter((result) => result.status !== "pass")
      .map((result) => `${result.id}: ${result.detail}`),
    report: `${options.label} recorded conformance:\n${report}`,
  };
}
