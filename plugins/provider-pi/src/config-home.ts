import path from "node:path";

export interface ProviderHomeContext {
  homeDir: string;
  cwd: string | null;
  env: Readonly<Record<string, string | undefined>>;
}

export function resolvePiAgentDir(args: ProviderHomeContext): string {
  const configured = args.env.PI_CODING_AGENT_DIR?.trim();
  if (!configured) return path.join(args.homeDir, ".pi", "agent");
  if (configured === "~") return args.homeDir;
  if (configured.startsWith("~/"))
    return path.join(args.homeDir, configured.slice(2));
  return path.resolve(args.cwd ?? args.homeDir, configured);
}
