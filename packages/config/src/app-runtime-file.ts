import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";

/**
 * A running `bb-app start` writes this file into its data directory and removes
 * it on exit. It lets another process on the same machine identify the running
 * bb, describe it to a person, and stop it.
 *
 * The desktop app reads it after a server probe succeeds, so it can offer to
 * quit the other copy instead of attaching to it. A bb that predates this file
 * simply writes nothing; readers must treat a missing file as "unknown", not as
 * "not running".
 */
const BB_APP_RUNTIME_FILE_NAME = "bb-app-runtime.json";

const bbAppRuntimeFileSchema = z.object({
  /** Absolute path of the entry module. Readers verify it against `ps`. */
  entryPath: z.string().min(1),
  /** PID of the launcher process that supervises the server and daemon. */
  pid: z.number().int().positive(),
  /** How the launcher was started, from `BB_APP_SURFACE`. */
  surface: z.string().min(1),
  serverUrl: z.string().min(1),
  startedAt: z.string().min(1),
  version: z.string().min(1),
});

export type BbAppRuntimeFile = z.infer<typeof bbAppRuntimeFileSchema>;

interface WriteBbAppRuntimeFileArgs {
  dataDir: string;
  entryPath: string;
  pid: number;
  serverUrl: string;
  startedAt: string;
  surface: string;
  version: string;
}

export function formatBbAppRuntimeFilePath(dataDir: string): string {
  return join(dataDir, BB_APP_RUNTIME_FILE_NAME);
}

function defaultIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function writeBbAppRuntimeFile(
  args: WriteBbAppRuntimeFileArgs,
): Promise<void> {
  const runtimeFile: BbAppRuntimeFile = {
    entryPath: args.entryPath,
    pid: args.pid,
    serverUrl: args.serverUrl,
    startedAt: args.startedAt,
    surface: args.surface,
    version: args.version,
  };
  await mkdir(args.dataDir, { recursive: true });
  await writeFile(
    formatBbAppRuntimeFilePath(args.dataDir),
    `${JSON.stringify(runtimeFile, null, 2)}\n`,
    "utf8",
  );
}

/**
 * Write the record unless another launcher already owns it. Returns whether
 * this process now owns the record; a caller that does not own it must not
 * remove the file when it exits.
 *
 * Ownership is decided by liveness alone. A record whose process is gone is
 * stale and gets replaced. This is not an exclusive lock: the daemon lock and
 * the server port are what actually prevent two bb instances on one data
 * directory. The check only stops a doomed second start from erasing the record
 * of the bb that is running.
 */
export async function claimBbAppRuntimeFile(
  args: WriteBbAppRuntimeFileArgs & { isRunning?: (pid: number) => boolean },
): Promise<boolean> {
  const isRunning = args.isRunning ?? defaultIsRunning;
  const existing = await readBbAppRuntimeFile(args.dataDir);
  if (
    existing !== null &&
    existing.pid !== args.pid &&
    isRunning(existing.pid)
  ) {
    return false;
  }
  await writeBbAppRuntimeFile(args);
  return true;
}

async function clearBbAppRuntimeFile(dataDir: string): Promise<void> {
  await rm(formatBbAppRuntimeFilePath(dataDir), { force: true });
}

/**
 * Remove the record only while it still names `pid`. A second launcher that
 * overwrote the file must not delete the live launcher's record when it exits,
 * because `bb-app stop` would then be unable to find the bb that is running.
 */
export async function clearOwnBbAppRuntimeFile(args: {
  dataDir: string;
  pid: number;
}): Promise<boolean> {
  const runtimeFile = await readBbAppRuntimeFile(args.dataDir);
  if (runtimeFile === null || runtimeFile.pid !== args.pid) {
    return false;
  }
  await clearBbAppRuntimeFile(args.dataDir);
  return true;
}

/**
 * Spellings of the entry path that a `ps` command line may show. Node resolves
 * `argv[1]` to an absolute path before the launcher records it, but `ps`
 * reports the command line as it was typed, so a launcher started with a
 * relative path never shows the absolute form.
 *
 * These tokens do not establish identity on their own: every bb launcher on the
 * machine shares the same file name. The caller must also compare the recorded
 * start time, which is what separates this launcher from another one and from a
 * recycled PID.
 */
export function bbAppRuntimeVerifyTokens(entryPath: string): string[] {
  return [entryPath, basename(entryPath)];
}

export async function readBbAppRuntimeFile(
  dataDir: string,
): Promise<BbAppRuntimeFile | null> {
  let rawContents: string;
  try {
    rawContents = await readFile(formatBbAppRuntimeFilePath(dataDir), "utf8");
  } catch {
    return null;
  }

  try {
    const parsed = bbAppRuntimeFileSchema.safeParse(JSON.parse(rawContents));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
