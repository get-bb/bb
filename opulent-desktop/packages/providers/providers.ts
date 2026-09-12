/**
 * Opulent Desktop provider registry.
 *
 * Three provider classes, separated by who owns the agent loop — the distinction Modal
 * draws between the Agent SDK and Managed Agents ([S15]), generalized to cover Outposts:
 *
 *   local-acp        we spawn the process; it speaks ACP (JSON-RPC over stdio).
 *   managed-session  a hosted loop drives the session; tool calls run in our sandbox.
 *   outpost-worker   their queue, their loop; we run one worker per claimed session.
 *
 * The `AcpLaunchSpec` shape is bb's custom-agent schema verbatim
 * (research/src/get-bb_bb/plugins/provider-acp/src/agents.ts and
 *  packages/provider-bridge-acp/src/launch-spec.ts — [S4], [S5]), so these records are
 * registerable against a bb-derived runtime without translation.
 */

import type { ExecutionTarget, RunFidelity } from "../events/events.ts";

export type ProviderClass = "local-acp" | "managed-session" | "outpost-worker";

export type ReasoningLevel =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultra"
  | "ultracode"
  | "ultrathink";

/** Per-agent skill directories. bb resolves these with recursive/ancestor semantics [S4]. */
export interface NativeSkillRoot {
  readonly path: string;
  readonly recursive?: boolean;
  readonly ancestors?: boolean;
  /** Skip this root when the named manifest exists (bb's plugin-vs-skills disambiguation). */
  readonly skipIfManifest?: string;
}

export interface NativeSkillRoots {
  readonly user: readonly NativeSkillRoot[];
  readonly project: readonly NativeSkillRoot[];
}

/** Model discovery through the agent's own CLI, as bb does it [S4]. */
export interface ModelCli {
  readonly listArgs: readonly string[];
  readonly selectFlag?: string;
  readonly primaryModels: readonly string[];
}

export interface ReasoningCli {
  readonly flag: string;
  readonly supportedLevels: readonly ReasoningLevel[];
  readonly defaultLevel?: ReasoningLevel;
}

export interface PermissionCli {
  readonly full?: readonly string[];
  readonly workspaceWrite?: readonly string[];
  readonly readonly?: readonly string[];
  readonly insertAfterArgs?: number;
}

/** Mirrors bb's `acpLaunchSpecSchema` [S5]. */
export interface AcpLaunchSpec {
  readonly displayName: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly modelCli?: ModelCli;
  readonly reasoningCli?: ReasoningCli;
  readonly permissionCli?: PermissionCli;
  readonly nativeSkillRoots?: NativeSkillRoots;
}

interface ProviderBase {
  readonly id: string;
  readonly displayName: string;
  readonly providerClass: ProviderClass;
  /** Execution targets this provider can be paired with. */
  readonly executionTargets: readonly ExecutionTarget[];
  /** Best fidelity this provider can deliver; gates SkyRL token export. */
  readonly maxFidelity: RunFidelity;
  readonly installUrl?: string;
  readonly signInCommand?: string;
  readonly notes?: string;
}

export interface LocalAcpProvider extends ProviderBase {
  readonly providerClass: "local-acp";
  readonly launch: AcpLaunchSpec;
  readonly dialect?: string;
}

export interface ManagedSessionProvider extends ProviderBase {
  readonly providerClass: "managed-session";
  /** Control-plane calls the engine makes; data plane runs in the sandbox. */
  readonly controlPlane: {
    readonly createSession: string;
    readonly sendEvent: string;
    readonly listEvents: string;
    readonly streamEvents: string;
  };
  /** Environment variables the sandbox worker requires. */
  readonly workerEnv: readonly string[];
  /** Entry the sandbox image runs to attach to the hosted loop. */
  readonly workerEntry: string;
}

export interface OutpostWorkerProvider extends ProviderBase {
  readonly providerClass: "outpost-worker";
  /** How the orchestrator learns about queued sessions. */
  readonly queueDescription: string;
  /** Outbound-only: the worker dials the control plane, nothing dials in [S18]. */
  readonly inboundPortRequired: false;
}

export type ProviderDefinition =
  | LocalAcpProvider
  | ManagedSessionProvider
  | OutpostWorkerProvider;

const CLAUDE_SKILLS_ROOT: NativeSkillRoot = {
  path: ".claude/skills",
  skipIfManifest: ".claude-plugin/plugin.json",
};
const OPULENT_SKILLS_ROOT: NativeSkillRoot = { path: ".agents/skills" };

/**
 * opencode over ACP.
 *
 * bb ships this exact launch today ([S4]). Under `modal` the same agent is reached as a
 * server rather than a child process: `opencode serve --hostname=0.0.0.0 --port=4096`
 * in a Sandbox with `encrypted_ports=[4096]`, attached via `sandbox.tunnels()[4096].url`
 * ([S14]) — the launch spec below is the local half.
 */
export const OPENCODE: LocalAcpProvider = {
  id: "opencode",
  displayName: "opencode",
  providerClass: "local-acp",
  executionTargets: ["local", "modal", "daytona"],
  maxFidelity: "event",
  installUrl: "https://opencode.ai/docs",
  signInCommand: "opencode auth login",
  dialect: "opencode",
  launch: {
    displayName: "opencode",
    command: "opencode",
    args: ["acp"],
    env: {},
    nativeSkillRoots: {
      user: [CLAUDE_SKILLS_ROOT, OPULENT_SKILLS_ROOT],
      project: [
        { path: ".opencode/skills", ancestors: true },
        { ...CLAUDE_SKILLS_ROOT, ancestors: true },
        { ...OPULENT_SKILLS_ROOT, ancestors: true },
      ],
    },
  },
};

/**
 * Devin CLI over ACP.
 *
 * `devin acp` is documented as a subcommand "intended to be launched by an ACP-aware
 * client (like Zed) as a subprocess — it speaks JSON-RPC over stdio" ([S19]). bb has no
 * Devin entry ([S4], [S8]), but its custom-agent schema accepts exactly this record
 * ([S5]) — so Devin CLI is a configuration change, not an integration project.
 */
export const DEVIN_CLI: LocalAcpProvider = {
  id: "devin-cli",
  displayName: "Devin CLI",
  providerClass: "local-acp",
  executionTargets: ["local", "modal", "daytona"],
  maxFidelity: "event",
  installUrl: "https://docs.devin.ai/cli",
  dialect: "devin",
  launch: {
    displayName: "Devin CLI",
    command: "devin",
    args: ["acp"],
    env: {},
    nativeSkillRoots: {
      user: [OPULENT_SKILLS_ROOT, CLAUDE_SKILLS_ROOT],
      project: [
        { path: ".devin/skills", ancestors: true },
        { ...OPULENT_SKILLS_ROOT, ancestors: true },
        { ...CLAUDE_SKILLS_ROOT, ancestors: true },
      ],
    },
  },
  notes:
    "Verified from docs ([S19]); the exact flag surface of `devin acp` must be probed on a machine with the CLI installed before M2 ships.",
};

/** Cursor over ACP — ships in bb today [S4]; kept so the picker matches bb parity. */
export const CURSOR: LocalAcpProvider = {
  id: "cursor",
  displayName: "Cursor",
  providerClass: "local-acp",
  executionTargets: ["local", "modal", "daytona"],
  maxFidelity: "event",
  installUrl: "https://cursor.com/docs/cli/installation",
  signInCommand: "cursor-agent login",
  dialect: "cursor",
  launch: {
    displayName: "Cursor",
    command: "cursor-agent",
    args: ["acp"],
    env: {},
    modelCli: { listArgs: ["--list-models"], primaryModels: [] },
    nativeSkillRoots: {
      user: [{ path: ".cursor/skills", recursive: true }, OPULENT_SKILLS_ROOT],
      project: [
        { path: ".cursor/skills", recursive: true, ancestors: true },
        { ...OPULENT_SKILLS_ROOT, ancestors: true },
      ],
    },
  },
};

/**
 * Claude Managed Agents.
 *
 * Anthropic hosts the agent loop; every tool call executes in our sandbox ([S15]). The
 * control-plane calls and the worker contract below are read from Modal's reference
 * implementation ([S16]): the sandbox entrypoint calls
 * `beta.environments.work.worker(environment_key, workdir, max_idle).handle_item()`
 * with the three ANTHROPIC_* variables injected.
 */
export const CLAUDE_MANAGED: ManagedSessionProvider = {
  id: "claude-managed",
  displayName: "Claude Managed Agents",
  providerClass: "managed-session",
  executionTargets: ["modal", "daytona"],
  maxFidelity: "event",
  installUrl: "https://platform.claude.com/docs/en/managed-agents/overview",
  controlPlane: {
    createSession: "beta.sessions.create",
    sendEvent: "beta.sessions.events.send",
    listEvents: "beta.sessions.events.list",
    streamEvents: "beta.sessions.events.stream",
  },
  workerEnv: [
    "ANTHROPIC_ENVIRONMENT_KEY",
    "ANTHROPIC_WORK_ID",
    "ANTHROPIC_SESSION_ID",
  ],
  workerEntry: "beta.environments.work.worker(...).handle_item()",
  notes:
    "Resume is a replay, not a reconnect: events.list(session_id, order='asc') rebuilds the session ([S16]), which matches the journal's replay-then-tail contract.",
};

/**
 * Devin Outposts.
 *
 * Devin's reasoning stays in Cognition's cloud; execution moves to a machine we control.
 * The outpost is the control-plane queue; we implement the data plane as an orchestrator
 * that starts one isolated sandbox worker per queued session ([S17]). modal-cursor is the
 * same shape against Cursor's pending-request API, and its workers connect outbound with
 * no inbound port or public IP ([S18]).
 */
export const DEVIN_OUTPOST: OutpostWorkerProvider = {
  id: "devin-outpost",
  displayName: "Devin Outpost",
  providerClass: "outpost-worker",
  executionTargets: ["modal", "daytona", "local"],
  maxFidelity: "lifecycle",
  installUrl: "https://modal.com/blog/devin-outposts-run-devin-in-modal-sandoxes",
  queueDescription:
    "Cognition-hosted outpost queue; an orchestrator watches it and claims queued sessions.",
  inboundPortRequired: false,
  notes:
    "Alpha as of 2026-07-21 ([S17]). Fidelity is `lifecycle` by construction: we observe worker and queue state, not the agent's token stream, so this provider never yields Tier-2 training data.",
};

export const DEFAULT_PROVIDERS: readonly ProviderDefinition[] = [
  OPENCODE,
  DEVIN_CLI,
  CLAUDE_MANAGED,
  DEVIN_OUTPOST,
  CURSOR,
];

export function providerById(id: string): ProviderDefinition | undefined {
  return DEFAULT_PROVIDERS.find((p) => p.id === id);
}

export function providersForTarget(
  target: ExecutionTarget,
): readonly ProviderDefinition[] {
  return DEFAULT_PROVIDERS.filter((p) => p.executionTargets.includes(target));
}

/**
 * Render a local-ACP provider as the argv a runtime would spawn.
 * Kept separate from the record so the record stays declarative and testable.
 */
export function acpArgv(provider: LocalAcpProvider): readonly string[] {
  return [provider.launch.command, ...provider.launch.args];
}
