import {
  query,
  type AccountInfo,
  type Query,
  type SDKControlGetUsageResponse,
  type SDKControlInitializeResponse,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { translateMissingClaudeCliCatalogError } from "./missing-cli-error.js";
import { resolveClaudeCodeExecutable } from "./session-options.js";

interface ClaudeProbeArgs {
  env: NodeJS.ProcessEnv;
  cwd: string;
}

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

async function withInitializedClaude<T>(
  args: ClaudeProbeArgs,
  read: (
    session: Query,
    initialization: SDKControlInitializeResponse,
  ) => Promise<T>,
): Promise<T> {
  const pathToClaudeCodeExecutable = resolveClaudeCodeExecutable({
    env: args.env,
  });
  const promptEnd = new AbortController();
  let session: Query;
  try {
    session = query({
      prompt: promptWithoutMessages(promptEnd.signal),
      options: {
        cwd: args.cwd,
        env: args.env,
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
    return await read(session, await session.initializationResult());
  } catch (error) {
    throw translateMissingClaudeCliCatalogError(error);
  } finally {
    promptEnd.abort();
    session.close();
  }
}

export function probeClaudeInitialization(
  args: ClaudeProbeArgs,
): Promise<SDKControlInitializeResponse> {
  return withInitializedClaude(args, (_session, initialization) =>
    Promise.resolve(initialization),
  );
}

export function probeClaudeUsage(args: ClaudeProbeArgs): Promise<{
  account: AccountInfo;
  usage: SDKControlGetUsageResponse;
}> {
  return withInitializedClaude(args, async (session, initialization) => ({
    account: initialization.account,
    usage:
      await session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
        skipBehaviors: true,
      }),
  }));
}
