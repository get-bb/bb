import fs from "node:fs";
import path from "node:path";
import type { ServerLogger } from "../../types.js";

/** Workspace-relative path bb reads project agent instructions from. */
export const WORKSPACE_AGENT_INSTRUCTIONS_RELATIVE_PATH = path.join(
  ".bb",
  "AGENTS.md",
);

function isFsErrorWithCode(error: Error, code: string): boolean {
  return "code" in error && error.code === code;
}

/**
 * Reads workspace-level agent instructions from `<workspacePath>/.bb/AGENTS.md`.
 * Returns the trimmed contents, or `null` when the file is missing, empty, or
 * unreadable. Unreadable (non-missing) files are logged and skipped so a bad
 * file never breaks thread start.
 */
export function readWorkspaceAgentInstructions(
  logger: ServerLogger,
  workspacePath: string,
): string | null {
  const filePath = path.join(
    workspacePath,
    WORKSPACE_AGENT_INSTRUCTIONS_RELATIVE_PATH,
  );
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && isFsErrorWithCode(error, "ENOENT")) {
      return null;
    }
    logger.warn(
      {
        filePath,
        reason: error instanceof Error ? error.message : String(error),
      },
      "Skipping unreadable workspace agent instructions file",
    );
    return null;
  }

  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed : null;
}
