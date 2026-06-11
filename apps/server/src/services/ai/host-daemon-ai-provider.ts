import {
  getBuiltInAgentProviderServerCapabilities,
  isAgentProviderId,
} from "@bb/agent-providers";

/**
 * Whether a configured AI-service provider string (from `BB_TRANSCRIPTION` /
 * `BB_INFERENCE`) routes through the host daemon. True for the agent provider
 * whose catalog entry declares `backsHostDaemonAiServices`; other config
 * providers (e.g. `openai`, pi-ai models) are handled directly by the server.
 */
export function backsHostDaemonAiServices(provider: string): boolean {
  if (!isAgentProviderId(provider)) {
    return false;
  }
  return getBuiltInAgentProviderServerCapabilities(provider)
    .backsHostDaemonAiServices;
}
