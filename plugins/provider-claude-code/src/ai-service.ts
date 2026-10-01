import type { BbPluginApi, PluginAiServiceStatus } from "@get-bb/plugin-sdk";
import {
  claudeAiHostContract,
  type ClaudeAiFailureCode,
  type ClaudeAiTextResult,
} from "./ai/host-contract.js";

const CLAUDE_TEXT_MODEL = "claude-haiku-4-5-20251001";
const COMPLETE_TIMEOUT_MS = 5_000;
const HOST_CALL_GRACE_MS = 1_000;
const RETRY_CODES: ReadonlySet<ClaudeAiFailureCode> = new Set([
  "rate_limited",
  "service_unavailable",
  "invalid_response",
]);

export function registerClaudeCodeAiService(bb: BbPluginApi): void {
  const host = bb.hosts.experimental_client({ contract: claudeAiHostContract });

  async function primaryHostId(): Promise<string | null> {
    return (await bb.sdk.system.config()).primaryHostId;
  }

  async function requirePrimaryHostId(): Promise<string> {
    const hostId = await primaryHostId();
    if (hostId === null) {
      throw new Error("No primary machine is connected");
    }
    return hostId;
  }

  function textOrThrow(result: ClaudeAiTextResult): string {
    if (result.ok) return result.text;
    throw new Error(result.message);
  }

  bb.experimental_aiServices.register({
    id: "claude-code",
    displayName: "Claude Code",
    async complete(prompt, { signal }) {
      const hostId = await requirePrimaryHostId();
      let last: ClaudeAiTextResult | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        last = await host.call(
          "claude.ai.complete",
          { model: CLAUDE_TEXT_MODEL, prompt, timeoutMs: COMPLETE_TIMEOUT_MS },
          {
            hostId,
            signal,
            timeoutMs: COMPLETE_TIMEOUT_MS + HOST_CALL_GRACE_MS,
          },
        );
        if (last.ok || !RETRY_CODES.has(last.code) || signal.aborted) break;
      }
      if (last === null) throw new Error("Claude did not answer");
      return textOrThrow(last);
    },
    async status(): Promise<PluginAiServiceStatus> {
      const hostId = await primaryHostId();
      if (hostId === null) {
        return { ready: false, message: "No primary machine is connected" };
      }
      return host.call("claude.ai.status", {}, { hostId, timeoutMs: 5_000 });
    },
  });
}
