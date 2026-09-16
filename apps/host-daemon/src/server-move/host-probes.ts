import { execFile } from "node:child_process";
import { stat, statfs } from "node:fs/promises";
import { createServer } from "node:net";
import { isFileNotFoundError } from "./fs.js";

const GH_AUTH_STATUS_TIMEOUT_MS = 10_000;

export type GhAuthenticationCheck = (
  env: NodeJS.ProcessEnv,
) => Promise<boolean | null>;

export type PortAvailabilityCheck = (port: number) => Promise<boolean>;

function canListen(port: number, host: string): Promise<boolean> {
  return new Promise((resolveListen) => {
    const server = createServer();
    server.once("error", () => resolveListen(false));
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolveListen(true));
    });
  });
}

export const defaultPortAvailabilityCheck: PortAvailabilityCheck = async (
  port,
) => (await canListen(port, "127.0.0.1")) && (await canListen(port, "0.0.0.0"));

export const defaultGhAuthenticationCheck: GhAuthenticationCheck = (env) =>
  new Promise((resolveCheck) => {
    execFile(
      "gh",
      ["auth", "status"],
      { env, timeout: GH_AUTH_STATUS_TIMEOUT_MS },
      (error) => {
        if (error === null) {
          resolveCheck(true);
          return;
        }
        if (
          ("code" in error && error.code === "ENOENT") ||
          ("killed" in error && error.killed === true)
        ) {
          resolveCheck(null);
          return;
        }
        resolveCheck(false);
      },
    );
  });

export async function readDiskFreeBytes(path: string): Promise<number | null> {
  try {
    const stats = await statfs(path);
    const free = Number(stats.bavail) * Number(stats.bsize);
    return Number.isSafeInteger(free) && free >= 0 ? free : null;
  } catch {
    return null;
  }
}

export async function readFileSizeBytes(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}
