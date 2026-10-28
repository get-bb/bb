import path from "node:path";

export interface ProviderHomeContext {
  homeDir: string;
  cwd: string | null;
  env: Readonly<Record<string, string | undefined>>;
}

export function resolveClaudeConfigDir(args: ProviderHomeContext): string {
  const configured = args.env.CLAUDE_CONFIG_DIR;
  return path.resolve(
    args.cwd ?? args.homeDir,
    (configured ?? path.join(args.homeDir, ".claude")).normalize("NFC"),
  );
}

export function resolveCodexHome(args: ProviderHomeContext): string {
  return path.resolve(
    args.cwd ?? args.homeDir,
    args.env.CODEX_HOME?.trim() || path.join(args.homeDir, ".codex"),
  );
}

export function resolvePiAgentDir(args: ProviderHomeContext): string {
  const configured = args.env.PI_CODING_AGENT_DIR?.trim();
  if (!configured) return path.join(args.homeDir, ".pi", "agent");
  if (configured === "~") return args.homeDir;
  if (configured.startsWith("~/"))
    return path.join(args.homeDir, configured.slice(2));
  return path.resolve(args.cwd ?? args.homeDir, configured);
}
