export const WORKTREE_PORT_BLOCK_SIZE = 10;

export function buildWorktreePortEnv(
  worktreePortBase: number | null | undefined,
): Record<string, string> {
  if (worktreePortBase == null) {
    return {};
  }

  const env: Record<string, string> = {
    BB_PORT: String(worktreePortBase),
  };
  for (let offset = 1; offset < WORKTREE_PORT_BLOCK_SIZE; offset += 1) {
    env[`BB_PORT_${offset}`] = String(worktreePortBase + offset);
  }
  return env;
}
