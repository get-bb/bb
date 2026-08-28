import { forkSession, query } from "@anthropic-ai/claude-agent-sdk";

export interface ClaudeSdkDependencies {
  forkSession: typeof forkSession;
  query: typeof query;
}

const defaultClaudeSdkDependencies: ClaudeSdkDependencies = {
  forkSession,
  query,
};

let claudeSdkDependencies = defaultClaudeSdkDependencies;

export function getClaudeSdkDependencies(): ClaudeSdkDependencies {
  return claudeSdkDependencies;
}

export function installClaudeSdkDependencies(
  replacements: Partial<ClaudeSdkDependencies>,
): () => void {
  const previous = claudeSdkDependencies;
  const installed = { ...previous, ...replacements };
  claudeSdkDependencies = installed;
  return () => {
    if (claudeSdkDependencies === installed) {
      claudeSdkDependencies = previous;
    }
  };
}
