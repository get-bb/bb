import path from "node:path";
import { internal_DO_NOT_USE_providerPathsHostContract } from "@get-bb/plugin-sdk/host";
import { resolveSharedCodexHome } from "./config-home.js";
import os from "node:os";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import {
  experimental_defineHostEntry,
  experimental_nativeRootsHostContract,
  type ExperimentalNativeRootsResolveAnswer,
} from "@get-bb/plugin-sdk/host";
import {
  completeCodexInference,
  transcribeCodexVoice,
} from "./ai/chatgpt-client.js";
import { readCodexAuthCredentials } from "./ai/codex-auth.js";
import { AiServiceFailure, toAiServiceFailure } from "./ai/failure.js";
import {
  codexAiHostContract,
  type CodexAiStatus,
  type CodexAiTextResult,
} from "./ai/host-contract.js";
import { resolveCodexNativeRoots } from "./native-roots.js";

export { experimental_providerBridge } from "./bridge/bridge.js";

const codexHostContract = defineRpcContract({
  ...codexAiHostContract,
  ...experimental_nativeRootsHostContract,
  ...internal_DO_NOT_USE_providerPathsHostContract,
});

async function textResult(work: Promise<string>): Promise<CodexAiTextResult> {
  try {
    return { ok: true, text: await work };
  } catch (error) {
    return toAiServiceFailure(error);
  }
}

export default experimental_defineHostEntry({
  contract: codexHostContract,
  handlers: {
    resolveProviderPaths: (_input, context) => {
      const codexHome = resolveSharedCodexHome({
        homeDir: os.homedir(),
        env: context.experimental_env,
      });
      return {
        skillInstallRoots: [],
        credentialFiles:
          codexHome === null ? [] : [path.join(codexHome, "auth.json")],
      };
    },
    resolveNativeRoots: (
      input,
      context,
    ): Promise<ExperimentalNativeRootsResolveAnswer> =>
      resolveCodexNativeRoots({
        cwd: input.cwd,
        homeDir: os.homedir(),
        env: context.experimental_env,
      }),
    "codex.ai.complete": (input, context) =>
      textResult(
        completeCodexInference(input, context.signal, context.experimental_env),
      ),
    "codex.ai.transcribe": (input, context) =>
      textResult(
        transcribeCodexVoice(input, context.signal, context.experimental_env),
      ),
    "codex.ai.status": async (_input, context): Promise<CodexAiStatus> => {
      try {
        await readCodexAuthCredentials(context.experimental_env);
        return { ready: true };
      } catch (error) {
        return {
          ready: false,
          message:
            error instanceof AiServiceFailure &&
            error.detailCode !== "codex_auth_missing"
              ? error.message
              : "Run `codex login` on the primary machine to sign in",
        };
      }
    },
  },
});
