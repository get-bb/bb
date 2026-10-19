import fs from "node:fs";
import path from "node:path";
import type { ServerLogger } from "../../types.js";
import { isFsErrorWithCode } from "../lib/fs-errors.js";

export const DATA_DIR_AGENT_INSTRUCTIONS_RELATIVE_PATH = "AGENTS.md";

export const WORKSPACE_AGENT_INSTRUCTIONS_RELATIVE_PATH = ".bb/AGENTS.md";

function readAgentInstructionsFile(
  logger: ServerLogger,
  filePath: string,
): string | null {
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
      "Skipping unreadable agent instructions file",
    );
    return null;
  }

  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readDataDirAgentInstructions(
  logger: ServerLogger,
  dataDir: string,
): string | null {
  return readAgentInstructionsFile(
    logger,
    path.join(dataDir, DATA_DIR_AGENT_INSTRUCTIONS_RELATIVE_PATH),
  );
}
