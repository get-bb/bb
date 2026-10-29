import { execHostFile } from "./host-process.js";
import {
  probeWindowsProcessIdentity,
  type ProcessIdentity,
  type ProcessIdentityProbe,
} from "./process-start.js";

export type { ProcessIdentity, ProcessIdentityProbe };

const execFileAsync = execHostFile;

export async function readProcessIdentity(
  pid: number,
): Promise<ProcessIdentity | null> {
  const probe = await probeProcessIdentity(pid);
  return probe.state === "running" ? probe.identity : null;
}

export async function probeProcessIdentity(
  pid: number,
): Promise<ProcessIdentityProbe> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return { state: "gone" };
  if (process.platform === "win32") return probeWindowsProcessIdentity(pid);
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "ps",
      ["-p", String(pid), "-o", "etime=", "-o", "command="],
      {
        timeout: 5_000,
        maxBuffer: 1024 * 1024,
      },
    ));
  } catch (error) {
    return isEmptyPsResult(error) ? { state: "gone" } : { state: "unknown" };
  }
  const match = stdout.trim().match(/^(\S+)\s+([\s\S]+)$/u);
  if (match === null) return { state: "gone" };
  const elapsed = parseElapsedSeconds(match[1] ?? "");
  return {
    state: "running",
    identity: {
      command: match[2] ?? null,
      startedAt: elapsed === null ? null : Date.now() - elapsed * 1_000,
    },
  };
}

function isEmptyPsResult(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === 1 &&
    "stdout" in error &&
    typeof error.stdout === "string" &&
    error.stdout.trim() === ""
  );
}

export function parseElapsedSeconds(rawElapsed: string): number | null {
  const match = rawElapsed
    .trim()
    .match(/^(?:(?:(\d+)-)?(\d+):)?(\d{1,2}):(\d{2})$/u);
  if (match === null) {
    return null;
  }
  const days = Number(match[1] ?? "0");
  const hours = Number(match[2] ?? "0");
  const minutes = Number(match[3]);
  const seconds = Number(match[4]);
  return ((days * 24 + hours) * 60 + minutes) * 60 + seconds;
}
