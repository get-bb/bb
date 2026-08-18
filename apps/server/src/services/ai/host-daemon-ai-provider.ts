/**
 * The one agent provider whose AI services the host daemon serves itself: it
 * ships a ChatGPT client and answers the `codex.inference.complete` /
 * `codex.voice.transcribe` commands, using the codex CLI's own auth on the
 * host.
 *
 * This is a fact about bb's AI-services feature and what the daemon bundle
 * contains — not provider metadata. A plugin cannot make the daemon grow a
 * client, so it was never the provider declaration's to declare. The eventual
 * home is a bounded host RPC a plugin can offer; until that exists, the feature
 * states its own routing here.
 */
const DAEMON_BACKED_AI_SERVICE_PROVIDER = "codex";

/**
 * Whether a configured AI-service provider string (from `BB_TRANSCRIPTION` /
 * `BB_INFERENCE`) routes through the host daemon. Other config providers (e.g.
 * `openai`, pi-ai models) are handled directly by the server.
 */
export function backsHostDaemonAiServices(provider: string): boolean {
  return provider === DAEMON_BACKED_AI_SERVICE_PROVIDER;
}
