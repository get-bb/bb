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
