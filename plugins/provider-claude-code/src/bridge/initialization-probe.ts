import {
  query,
  type SDKControlInitializeResponse,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { translateMissingClaudeCliCatalogError } from "./missing-cli-error.js";
import {
  BB_CLAUDE_CODE_ENTRYPOINT,
  resolveClaudeCodeExecutable,
} from "./session-options.js";

async function* promptWithoutMessages(
  signal: AbortSignal,
): AsyncGenerator<SDKUserMessage> {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

export async function probeClaudeInitialization(args: {
  env: NodeJS.ProcessEnv;
  cwd: string;
}): Promise<SDKControlInitializeResponse> {
  const pathToClaudeCodeExecutable = resolveClaudeCodeExecutable({
    env: args.env,
  });
  const promptEnd = new AbortController();
  let session: ReturnType<typeof query>;
  try {
    session = query({
      prompt: promptWithoutMessages(promptEnd.signal),
      options: {
        cwd: args.cwd,
        env: { ...args.env, CLAUDE_CODE_ENTRYPOINT: BB_CLAUDE_CODE_ENTRYPOINT },
        persistSession: false,
        settingSources: ["user", "project", "local"],
        ...(pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable } : {}),
      },
    });
  } catch (error) {
    promptEnd.abort();
    throw translateMissingClaudeCliCatalogError(error);
  }

  try {
    return await session.initializationResult();
  } catch (error) {
    throw translateMissingClaudeCliCatalogError(error);
  } finally {
    promptEnd.abort();
    session.close();
  }
}
