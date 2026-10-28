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

export function resolveClaudeProfile(args: ProviderHomeContext): {
  configDir: string;
  configured: string | null;
} {
  return {
    configDir: resolveClaudeConfigDir(args),
    configured: args.env.CLAUDE_CONFIG_DIR || null,
  };
}
