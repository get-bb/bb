import { join } from "node:path";

type CodexHomeEnvironment = Readonly<Record<string, string | undefined>>;

export function resolveCodexHome(
  homeDir: string,
  env: CodexHomeEnvironment = process.env,
): string {
  return env.CODEX_HOME?.trim() || join(homeDir, ".codex");
}
