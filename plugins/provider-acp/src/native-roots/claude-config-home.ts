import path from "node:path";
import type { AcpNativeRootsResolverArgs } from "./resolver.js";

export function resolveClaudeConfigDir(
  args: AcpNativeRootsResolverArgs,
): string {
  return path.resolve(
    args.cwd ?? args.homeDir,
    (
      args.env.CLAUDE_CONFIG_DIR ?? path.join(args.homeDir, ".claude")
    ).normalize("NFC"),
  );
}
