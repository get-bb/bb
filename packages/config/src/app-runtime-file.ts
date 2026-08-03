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
export const BB_APP_RUNTIME_FILE_NAME = "bb-app-runtime.json";

export const bbAppRuntimeFileSchema = z.object({
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

export interface WriteBbAppRuntimeFileArgs {
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

export async function clearBbAppRuntimeFile(dataDir: string): Promise<void> {
  await rm(formatBbAppRuntimeFilePath(dataDir), { force: true });
}

/**
 * Substrings that prove a `ps` command line belongs to the launcher this file
 * describes. Node resolves `argv[1]` to an absolute path before the launcher
 * records it, but `ps` reports the command line as it was typed. A launcher
 * started with a relative path therefore never shows the absolute form, so the
 * file name is offered as a second spelling.
 */
export function bbAppRuntimeVerifyTokens(
  runtimeFile: BbAppRuntimeFile,
): string[] {
  return [runtimeFile.entryPath, basename(runtimeFile.entryPath)];
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
