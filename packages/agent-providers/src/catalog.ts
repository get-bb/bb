import { z } from "zod";
import type {
  ProviderCapabilities,
  ProviderInfo,
  ReasoningLevel,
} from "@bb/domain";

const AGENT_PROVIDER_ID_VALUES = ["codex", "claude-code", "pi"] as const;
export const agentProviderIdSchema = z.enum(AGENT_PROVIDER_ID_VALUES);
export type AgentProviderId = z.infer<typeof agentProviderIdSchema>;

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

/**
 * Adding a provider checklist — a new entry MUST declare:
 *   1. `info.id` (add it to `AGENT_PROVIDER_ID_VALUES` above) and
 *      `info.displayName` / `info.available`.
 *   2. `info.capabilities` (wire-facing `ProviderCapabilities`): archive,
 *      rename, service tier, user question, supported permission modes.
 *   3. `serverCapabilities` (`ProviderServerCapabilities`, backend-only):
 *      workflows, execution override, host-daemon AI services, reasoning ladder.
 *   4. Its adapter + factory in `@bb/agent-runtime` (`provider-registry.ts`).
 * Host-local specifics stay with the daemon: provider CLI executable/install
 * metadata (`provider-cli-health.ts`) and injected-skill root layout
 * (`injected-skills.ts`), both keyed by this `info.id`.
 */
const BUILT_IN_AGENT_PROVIDER_CATALOG: BuiltInAgentProviderCatalogEntry[] = [
  {
    info: {
      available: true,
      capabilities: CODEX_CAPABILITIES,
      displayName: "Codex",
      id: "codex",
    },
    serverCapabilities: CODEX_SERVER_CAPABILITIES,
  },
  {
    info: {
      available: true,
      capabilities: CLAUDE_CAPABILITIES,
      displayName: "Claude Code",
      id: "claude-code",
    },
    serverCapabilities: CLAUDE_SERVER_CAPABILITIES,
  },
  {
    info: {
      available: true,
      capabilities: PI_CAPABILITIES,
      displayName: "Pi",
      id: "pi",
    },
    serverCapabilities: PI_SERVER_CAPABILITIES,
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

function cloneBuiltInAgentProviderInfo(
  info: BuiltInAgentProviderInfo,
): BuiltInAgentProviderInfo {
  return {
    available: info.available,
    capabilities: cloneCapabilities(info.capabilities),
    displayName: info.displayName,
    id: info.id,
  };
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
