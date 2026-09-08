import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

const recordSchema = z.object({
  operationId: z.string(),
  path: z.string(),
  kind: z.enum(["setup", "teardown"]),
  pid: z.number().int().positive().nullable(),
  processStartedAt: z.string().nullable(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  error: z.string().nullable(),
});
export type EnvironmentHookRecord = z.infer<typeof recordSchema>;

export function environmentHookRecordStore(
  dataDir: string,
  operationId: string,
) {
  const directory = join(dataDir, "environment-hooks");
  const key = createHash("sha256").update(operationId).digest("hex");
  const recordPath = join(directory, `${key}.json`);
  const cancellationPath = join(directory, `${key}.cancelled`);
  const write = (path: string, value: object): void => {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(value), {
      mode: 0o600,
      flush: true,
    });
    renameSync(temporary, path);
  };
  return {
    read: (): EnvironmentHookRecord | null => {
      if (!existsSync(recordPath)) return null;
      const record = recordSchema.parse(
        JSON.parse(readFileSync(recordPath, "utf8")),
      );
      if (record.operationId !== operationId)
        throw new Error("Environment hook identity mismatch");
      return record;
    },
    write: (record: EnvironmentHookRecord): void => write(recordPath, record),
    cancelled: (): boolean => existsSync(cancellationPath),
    cancel: (): void =>
      write(cancellationPath, { operationId, cancelledAt: Date.now() }),
  };
}

export function environmentHookProcessStart(pid: number): string | null {
  try {
    return (
      execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || null
    );
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 1)
      return null;
    throw error;
  }
}

export async function terminateEnvironmentHookProcess(
  record: EnvironmentHookRecord,
): Promise<void> {
  const pid = record.pid;
  if (pid === null) return;
  const start = environmentHookProcessStart(pid);
  if (start !== null && start !== record.processStartedAt) return;
  const alive = (): boolean => {
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH")
        return false;
      throw error;
    }
  };
  if (!alive()) return;
  process.kill(-pid, "SIGKILL");
  const deadline = Date.now() + 4000;
  while (alive()) {
    if (Date.now() >= deadline)
      throw new Error("Environment hook process termination is still pending");
    await delay(25);
  }
}
