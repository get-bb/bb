import type { ExecutionTarget, RunFidelity } from "../events/events.ts";
export type ProviderClass = "local-acp" | "managed-session" | "outpost-worker";
export type ReasoningLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra" | "ultracode" | "ultrathink";
export interface NativeSkillRoot {
    readonly path: string;
    readonly recursive?: boolean;
    readonly ancestors?: boolean;
    readonly skipIfManifest?: string;
}
export interface NativeSkillRoots {
    readonly user: readonly NativeSkillRoot[];
    readonly project: readonly NativeSkillRoot[];
}
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
    readonly executionTargets: readonly ExecutionTarget[];
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
    readonly controlPlane: {
        readonly createSession: string;
        readonly sendEvent: string;
        readonly listEvents: string;
        readonly streamEvents: string;
    };
    readonly workerEnv: readonly string[];
    readonly workerEntry: string;
}
export interface OutpostWorkerProvider extends ProviderBase {
    readonly providerClass: "outpost-worker";
    readonly queueDescription: string;
    readonly inboundPortRequired: false;
}
export type ProviderDefinition = LocalAcpProvider | ManagedSessionProvider | OutpostWorkerProvider;
const CLAUDE_SKILLS_ROOT: NativeSkillRoot = {
    path: ".claude/skills",
    skipIfManifest: ".claude-plugin/plugin.json",
};
const OPULENT_SKILLS_ROOT: NativeSkillRoot = { path: ".agents/skills" };
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
    notes: "Verified from docs ([S19]); the exact flag surface of `devin acp` must be probed on a machine with the CLI installed before M2 ships.",
};
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
    notes: "Resume is a replay, not a reconnect: events.list(session_id, order='asc') rebuilds the session ([S16]), which matches the journal's replay-then-tail contract.",
};
export const DEVIN_OUTPOST: OutpostWorkerProvider = {
    id: "devin-outpost",
    displayName: "Devin Outpost",
    providerClass: "outpost-worker",
    executionTargets: ["modal", "daytona", "local"],
    maxFidelity: "lifecycle",
    installUrl: "https://modal.com/blog/devin-outposts-run-devin-in-modal-sandoxes",
    queueDescription: "Cognition-hosted outpost queue; an orchestrator watches it and claims queued sessions.",
    inboundPortRequired: false,
    notes: "Alpha as of 2026-07-21 ([S17]). Fidelity is `lifecycle` by construction: we observe worker and queue state, not the agent's token stream, so this provider never yields Tier-2 training data.",
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
export function providersForTarget(target: ExecutionTarget): readonly ProviderDefinition[] {
    return DEFAULT_PROVIDERS.filter((p) => p.executionTargets.includes(target));
}
export function acpArgv(provider: LocalAcpProvider): readonly string[] {
    return [provider.launch.command, ...provider.launch.args];
}
