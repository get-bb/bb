import path from "node:path";

export interface ProviderHomeContext {
  homeDir: string;
  cwd: string | null;
  env: Readonly<Record<string, string | undefined>>;
}

export function resolveCodexHome(args: ProviderHomeContext): string {
  return path.resolve(
    args.cwd ?? args.homeDir,
    args.env.CODEX_HOME?.trim() || path.join(args.homeDir, ".codex"),
  );
}

export function resolveSharedCodexHome(args: {
  homeDir: string;
  env: Readonly<Record<string, string | undefined>>;
}): string | null {
  const configured = args.env.CODEX_HOME?.trim();
  if (configured && !path.isAbsolute(configured)) return null;
  return resolveCodexHome({ ...args, cwd: null });
}
