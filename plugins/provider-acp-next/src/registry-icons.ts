const PLUGIN_ID = "bb--provider-acp-next";

export const REGISTRY_ICON_AGENT_IDS: readonly string[] = [
  "agoragentic-acp",
  "amp-acp",
  "antigravity-acp",
  "auggie",
  "autohand",
  "claude-acp",
  "cline",
  "codebuddy-code",
  "codex-acp",
  "cortex-code",
  "corust-agent",
  "crow-cli",
  "cursor",
  "deepagents",
  "devin",
  "dimcode",
  "dirac",
  "factory-droid",
  "fast-agent",
  "gemini",
  "github-copilot-cli",
  "glm-acp-agent",
  "goose",
  "grok-build",
  "harn",
  "junie",
  "kilo",
  "kimchi",
  "kimi",
  "minimax-code",
  "minion-code",
  "mistral-vibe",
  "nova",
  "opencode",
  "pi-acp",
  "poolside",
  "qoder",
  "qwen-code",
  "sigit",
  "stakpak",
  "vtcode",
];

const registryIconAgentIds = new Set(REGISTRY_ICON_AGENT_IDS);

export function registryAgentIcon(agentId: string): string | undefined {
  return registryIconAgentIds.has(agentId)
    ? `${PLUGIN_ID}/registry-${agentId}`
    : undefined;
}
