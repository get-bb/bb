import { z } from "zod";
import type {
  ProviderCapabilities,
  ProviderComposerAction,
  ProviderInfo,
  ReasoningLevel,
} from "@bb/domain";

const AGENT_PROVIDER_ID_VALUES = [
  "codex",
  "claude-code",
  "pi",
  "acp-cursor",
] as const;
export const agentProviderIdSchema = z.enum(AGENT_PROVIDER_ID_VALUES);
export type AgentProviderId = z.infer<typeof agentProviderIdSchema>;

const ACP_AGENT_PROVIDER_ID_VALUES = [
  "acp-cursor",
] as const satisfies readonly AgentProviderId[];
export type AcpAgentProviderId = (typeof ACP_AGENT_PROVIDER_ID_VALUES)[number];
const ACP_PROVIDER_ID_PREFIX = "acp-";

export function isAcpAgentProviderId(
  value: string,
): value is AcpAgentProviderId {
  return (ACP_AGENT_PROVIDER_ID_VALUES as readonly string[]).includes(value);
}

export function isAcpProviderId(value: string): boolean {
  return value.startsWith(ACP_PROVIDER_ID_PREFIX);
}

/**
 * Server- and daemon-internal capability facts about a built-in provider —
 * the answers that previously lived as `providerId === "..."` literals in
 * server policy modules. Distinct from the wire-facing `ProviderCapabilities`
 * (which the client also reads): these never leave the backend, so they stay
 * off the `ProviderInfo` contract.
 *
 * Adding a provider: every new catalog entry MUST declare all of these (and
 * the wire `info` block below). See the checklist at
 * `BUILT_IN_AGENT_PROVIDER_CATALOG`.
 */
export interface ProviderServerCapabilities {
  /**
   * Whether sessions get the Workflows feature (dynamic multi-agent
   * orchestration). The Workflow tool's own opt-in rules govern actual use.
   */
  supportsWorkflows: boolean;
  /**
   * Whether the provider applies a changed model/reasoning level in place on
   * `thread/resume` while preserving context (sticky execution override).
   * Providers without verified in-place swap require respawning the thread.
   */
  supportsExecutionOverride: boolean;
  /**
   * Whether this provider backs host-daemon-routed AI services (voice
   * transcription and structured inference) via its `*.voice.transcribe` /
   * `*.inference.complete` daemon commands.
   */
  backsHostDaemonAiServices: boolean;
  /**
   * The coarse, ordered per-provider reasoning ladder. Used as a fallback when
   * a precise per-model `supportedReasoningEfforts` set is unavailable. Mirrors
   * daemon-side translation: codex rejects "max"/"ultracode" provider-wide and
   * the pi bridge caps at xhigh, so those ladders stop at xhigh.
   */
  reasoningLevels: readonly ReasoningLevel[];
}

export interface BuiltInAgentProviderInfo extends ProviderInfo {
  id: AgentProviderId;
}

export interface BuiltInAgentProviderCatalogEntry {
  info: BuiltInAgentProviderInfo;
  serverCapabilities: ProviderServerCapabilities;
}

export interface BuildAcpProviderInfoArgs {
  displayName: string;
  id: string;
}

type PiDefaultModelPerProvider = Partial<Record<string, string>>;

const CODEX_CAPABILITIES: ProviderCapabilities = {
  supportsArchive: true,
  supportsRename: true,
  supportsServiceTier: true,
  supportsUserQuestion: false,
  supportsFork: true,
  supportedPermissionModes: ["full", "workspace-write", "readonly"],
};

const CLAUDE_CAPABILITIES: ProviderCapabilities = {
  supportsArchive: false,
  supportsRename: false,
  supportsServiceTier: false,
  supportsUserQuestion: true,
  supportsFork: true,
  supportedPermissionModes: ["full", "workspace-write", "readonly"],
};

const PI_CAPABILITIES: ProviderCapabilities = {
  supportsArchive: false,
  supportsRename: false,
  supportsServiceTier: false,
  supportsUserQuestion: false,
  supportsFork: true,
  supportedPermissionModes: ["full"],
};

const CODEX_COMPOSER_ACTIONS: ProviderComposerAction[] = [
  { kind: "skills", trigger: "/" },
  {
    kind: "plan",
    command: { trigger: "/", name: "plan", trailingText: " " },
  },
  {
    kind: "goal",
    command: { trigger: "/", name: "goal", trailingText: " " },
  },
];

const CLAUDE_COMPOSER_ACTIONS: ProviderComposerAction[] = [
  { kind: "skills", trigger: "/" },
  {
    kind: "plan",
    command: { trigger: "/", name: "plan", trailingText: " " },
  },
];

const PI_COMPOSER_ACTIONS: ProviderComposerAction[] = [];
const ACP_COMPOSER_ACTIONS: ProviderComposerAction[] = [];

// Shared by all ACP (Agent Client Protocol) providers: the external agent owns
// its own model selection, tool execution, and session naming, so BB-side
// capabilities stay minimal. Permission modes are enforced cooperatively by
// the ACP bridge (permission-request policy + client fs write policy).
// Cursor exposes a `-fast` service tail per model; the bridge resolves it from
// the serviceTier (the "Fast mode" toggle), so service tier is supported here
// rather than fanning fast variants out as separate model-list entries.
const ACP_CAPABILITIES: ProviderCapabilities = {
  supportsArchive: false,
  supportsRename: false,
  supportsServiceTier: true,
  supportsUserQuestion: false,
  // ACP has no session-fork primitive; the adapter has no thread/fork handler,
  // so forks are blocked at the server boundary rather than failing at runtime.
  supportsFork: false,
  supportedPermissionModes: ["full", "workspace-write", "readonly"],
};

const CODEX_SERVER_CAPABILITIES: ProviderServerCapabilities = {
  supportsWorkflows: false,
  supportsExecutionOverride: false,
  backsHostDaemonAiServices: true,
  reasoningLevels: ["low", "medium", "high", "xhigh"],
};

const CLAUDE_SERVER_CAPABILITIES: ProviderServerCapabilities = {
  supportsWorkflows: true,
  supportsExecutionOverride: true,
  backsHostDaemonAiServices: false,
  reasoningLevels: ["low", "medium", "high", "xhigh", "ultracode", "max"],
};

const PI_SERVER_CAPABILITIES: ProviderServerCapabilities = {
  supportsWorkflows: false,
  supportsExecutionOverride: false,
  backsHostDaemonAiServices: false,
  reasoningLevels: ["low", "medium", "high", "xhigh"],
};

// ACP agents manage reasoning effort internally; "medium" is the single
// synthetic level so execution-option resolution has a valid value to carry.
const ACP_SERVER_CAPABILITIES: ProviderServerCapabilities = {
  supportsWorkflows: false,
  supportsExecutionOverride: false,
  backsHostDaemonAiServices: false,
  // Cursor encodes reasoning effort in its model ids (`gpt-5.3-codex-high`);
  // the ACP bridge resolves (model, level) to the exact variant id at session
  // launch. This ladder is the coarse fallback — per-model efforts from
  // `model/list` are the precise set.
  reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
};

/**
 * Adding a provider checklist — a new entry MUST declare:
 *   1. `info.id` (add it to `AGENT_PROVIDER_ID_VALUES` above) and
 *      `info.displayName` / `info.available`.
 *   2. `info.capabilities` (wire-facing `ProviderCapabilities`): archive,
 *      rename, service tier, user question, supported permission modes.
 *   3. `info.composerActions` (wire-facing composer affordances): skills,
 *      plan, goal, or an explicit empty array.
 *   4. `serverCapabilities` (`ProviderServerCapabilities`, backend-only):
 *      workflows, execution override, host-daemon AI services, reasoning ladder.
 *   5. Its adapter + factory in `@bb/agent-runtime` (`provider-registry.ts`).
 * Host-local specifics stay with the daemon: provider CLI executable/install
 * metadata (`provider-cli-health.ts`) and injected-skill root layout
 * (`injected-skills.ts`), both keyed by this `info.id`.
 */
const BUILT_IN_AGENT_PROVIDER_CATALOG: BuiltInAgentProviderCatalogEntry[] = [
  {
    info: {
      available: true,
      capabilities: CODEX_CAPABILITIES,
      composerActions: CODEX_COMPOSER_ACTIONS,
      displayName: "Codex",
      id: "codex",
    },
    serverCapabilities: CODEX_SERVER_CAPABILITIES,
  },
  {
    info: {
      available: true,
      capabilities: CLAUDE_CAPABILITIES,
      composerActions: CLAUDE_COMPOSER_ACTIONS,
      displayName: "Claude Code",
      id: "claude-code",
    },
    serverCapabilities: CLAUDE_SERVER_CAPABILITIES,
  },
  {
    info: {
      available: true,
      capabilities: PI_CAPABILITIES,
      composerActions: PI_COMPOSER_ACTIONS,
      displayName: "Pi",
      id: "pi",
    },
    serverCapabilities: PI_SERVER_CAPABILITIES,
  },
  {
    info: {
      available: true,
      capabilities: ACP_CAPABILITIES,
      composerActions: ACP_COMPOSER_ACTIONS,
      displayName: "Cursor",
      id: "acp-cursor",
    },
    serverCapabilities: ACP_SERVER_CAPABILITIES,
  },
];

const builtInAgentProviderById = new Map(
  BUILT_IN_AGENT_PROVIDER_CATALOG.map((provider) => [
    provider.info.id,
    provider,
  ]),
);

/**
 * Best default model per provider. Subset of pi-mono's `defaultModelPerProvider`:
 * https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/model-resolver.ts
 */
export const PI_DEFAULT_MODEL_PER_PROVIDER: PiDefaultModelPerProvider = {
  anthropic: "claude-opus-4-8",
  openai: "gpt-5.4",
  "openai-codex": "gpt-5.5",
  "amazon-bedrock": "us.anthropic.claude-opus-4-8",
  google: "gemini-2.5-pro",
  "google-gemini-cli": "gemini-2.5-pro",
  "google-vertex": "gemini-3-pro-preview",
  openrouter: "openai/gpt-5.1-codex",
  "vercel-ai-gateway": "anthropic/claude-opus-4.8",
  xai: "grok-4-fast-non-reasoning",
  mistral: "devstral-medium-latest",
};

function cloneCapabilities(
  capabilities: ProviderCapabilities,
): ProviderCapabilities {
  return {
    supportsArchive: capabilities.supportsArchive,
    supportsRename: capabilities.supportsRename,
    supportsServiceTier: capabilities.supportsServiceTier,
    supportsUserQuestion: capabilities.supportsUserQuestion,
    supportsFork: capabilities.supportsFork,
    supportedPermissionModes: [...capabilities.supportedPermissionModes],
  };
}

function cloneComposerAction(
  action: ProviderComposerAction,
): ProviderComposerAction {
  switch (action.kind) {
    case "skills":
      return { kind: "skills", trigger: action.trigger };
    case "plan":
      return { kind: "plan", command: { ...action.command } };
    case "goal":
      return { kind: "goal", command: { ...action.command } };
  }
}

function cloneBuiltInAgentProviderInfo(
  info: BuiltInAgentProviderInfo,
): BuiltInAgentProviderInfo {
  return {
    available: info.available,
    capabilities: cloneCapabilities(info.capabilities),
    composerActions: info.composerActions.map(cloneComposerAction),
    displayName: info.displayName,
    id: info.id,
  };
}

export function buildAcpProviderInfo(
  args: BuildAcpProviderInfoArgs,
): ProviderInfo {
  if (!isAcpProviderId(args.id)) {
    throw new Error(`ACP provider id "${args.id}" must start with "acp-".`);
  }
  return {
    available: true,
    capabilities: cloneCapabilities(ACP_CAPABILITIES),
    composerActions: ACP_COMPOSER_ACTIONS.map(cloneComposerAction),
    displayName: args.displayName,
    id: args.id,
  };
}

export function getAcpProviderServerCapabilities(
  providerId: string,
): ProviderServerCapabilities {
  if (!isAcpProviderId(providerId)) {
    throw new Error(`ACP provider id "${providerId}" must start with "acp-".`);
  }
  return ACP_SERVER_CAPABILITIES;
}

export function getAgentProviderServerCapabilities(
  providerId: string,
): ProviderServerCapabilities | null {
  if (isAgentProviderId(providerId)) {
    return getBuiltInAgentProviderServerCapabilities(providerId);
  }
  if (isAcpProviderId(providerId)) {
    return getAcpProviderServerCapabilities(providerId);
  }
  return null;
}

export function isAgentProviderId(value: string): value is AgentProviderId {
  return agentProviderIdSchema.safeParse(value).success;
}

export function listBuiltInAgentProviderInfos(): BuiltInAgentProviderInfo[] {
  return BUILT_IN_AGENT_PROVIDER_CATALOG.map((provider) =>
    cloneBuiltInAgentProviderInfo(provider.info),
  );
}

export function getBuiltInAgentProviderInfo(
  providerId: AgentProviderId,
): BuiltInAgentProviderInfo {
  const provider = builtInAgentProviderById.get(providerId);
  if (!provider) {
    throw new Error(`Unsupported agent provider "${providerId}".`);
  }
  return cloneBuiltInAgentProviderInfo(provider.info);
}

export function getBuiltInAgentProviderServerCapabilities(
  providerId: AgentProviderId,
): ProviderServerCapabilities {
  const provider = builtInAgentProviderById.get(providerId);
  if (!provider) {
    throw new Error(`Unsupported agent provider "${providerId}".`);
  }
  return provider.serverCapabilities;
}

export function resolvePiDefaultModelId(
  providerId: string,
): string | undefined {
  return PI_DEFAULT_MODEL_PER_PROVIDER[providerId];
}
