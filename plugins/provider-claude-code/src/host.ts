import os from "node:os";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import {
  experimental_defineHostEntry,
  experimental_nativeRootsHostContract,
} from "@get-bb/plugin-sdk/host";
import { completeClaudeInference } from "./ai/anthropic-client.js";
import { readClaudeAuthCredentials } from "./ai/claude-auth.js";
import { AiServiceFailure, toAiServiceFailure } from "./ai/failure.js";
import {
  claudeAiHostContract,
  type ClaudeAiStatus,
  type ClaudeAiTextResult,
} from "./ai/host-contract.js";
import { resolveClaudeNativeRoots } from "./native-roots.js";

export { experimental_providerBridge } from "./bridge/bridge.js";

const claudeHostContract = defineRpcContract({
  ...claudeAiHostContract,
  ...experimental_nativeRootsHostContract,
});

async function textResult(work: Promise<string>): Promise<ClaudeAiTextResult> {
  try {
    return { ok: true, text: await work };
  } catch (error) {
    return toAiServiceFailure(error);
  }
}

export default experimental_defineHostEntry({
  contract: claudeHostContract,
  handlers: {
    resolveNativeRoots: (input) =>
      resolveClaudeNativeRoots({
        cwd: input.cwd,
        homeDir: os.homedir(),
        env: process.env,
      }),
    "claude.ai.complete": (input, context) =>
      textResult(completeClaudeInference(input, context.signal)),
    "claude.ai.status": async (): Promise<ClaudeAiStatus> => {
      try {
        await readClaudeAuthCredentials();
        return { ready: true };
      } catch (error) {
        return {
          ready: false,
          message:
            error instanceof AiServiceFailure
              ? error.message
              : "Run `claude` on this machine to sign in",
        };
      }
    },
  },
});
