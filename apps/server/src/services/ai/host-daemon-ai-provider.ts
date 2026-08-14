import type { ProviderRegistryService } from "../providers/provider-registry.js";

/**
 * Whether a configured AI-service provider string (from `BB_TRANSCRIPTION` /
 * `BB_INFERENCE`) routes through the host daemon. True for the agent provider
 * whose registry entry declares `backsHostDaemonAiServices`; other config
 * providers (e.g. `openai`, pi-ai models) are handled directly by the server.
 */
export function backsHostDaemonAiServices(
  registry: ProviderRegistryService,
  provider: string,
): boolean {
  return (
    registry.getServerCapabilities(provider)?.backsHostDaemonAiServices ?? false
  );
}
