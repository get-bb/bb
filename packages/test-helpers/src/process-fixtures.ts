import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

function readErrorCode(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

export async function resolveProjectEnvCandidates(
  repoRoot: string,
): Promise<string[]> {
  const candidates = new Set<string>([path.join(repoRoot, ".env")]);
  const gitMetadataPath = path.join(repoRoot, ".git");

  try {
    const gitMetadata = await fs.stat(gitMetadataPath);
    if (!gitMetadata.isFile()) {
      return [...candidates];
    }

    const gitdirPointer = await fs.readFile(gitMetadataPath, "utf8");
    const match = /^gitdir:\s*(.+)\s*$/m.exec(gitdirPointer);
    if (!match?.[1]) {
      return [...candidates];
    }

    const worktreeGitDir = path.resolve(repoRoot, match[1]);
    const commonGitDir = path.dirname(path.dirname(worktreeGitDir));
    candidates.add(path.join(path.dirname(commonGitDir), ".env"));
  } catch (error) {
    if (readErrorCode(error) === "ENOENT") {
      return [...candidates];
    }
    throw error;
  }

  return [...candidates];
}

export async function listOpenFilePids(targetPath: string): Promise<number[]> {
  try {
    const { stdout } = await execFile("lsof", ["-t", "+D", targetPath], {
      encoding: "utf8",
    });
    return stdout
      .split("\n")
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isInteger(value) && value > 0);
  } catch (error) {
    const code = readErrorCode(error);
    if (code === "ENOENT" || code === 1) {
      return [];
    }
    throw error;
  }
}

export async function readPositivePidFile(
  filePath: string,
): Promise<number | null> {
  try {
    const rawPid = await fs.readFile(filePath, "utf8");
    const pid = Number.parseInt(rawPid.trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (error) {
    if (readErrorCode(error) === "ENOENT") {
      return null;
    }
    throw error;
  }
}
