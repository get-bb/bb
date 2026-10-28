import path from "node:path";

export interface ProviderHomeContext {
  homeDir: string;
  cwd: string | null;
  env: Readonly<Record<string, string | undefined>>;
}

export function resolveStoredPath(
  homeDir: string,
  value: string,
  baseDir: string,
): string {
  if (value === "~") return homeDir;
  if (value.startsWith("~/")) return path.join(homeDir, value.slice(2));
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

export function resolvePiAgentDir(args: ProviderHomeContext): string {
  const configured = args.env.PI_CODING_AGENT_DIR?.trim();
  return configured
    ? resolveStoredPath(args.homeDir, configured, args.cwd ?? args.homeDir)
    : path.join(args.homeDir, ".pi", "agent");
}
