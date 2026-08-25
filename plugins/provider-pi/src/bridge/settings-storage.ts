import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { z } from "zod";
import { resolvePiAgentDir } from "../native-roots.js";

/**
 * Pi's global settings file, read and written as a file: the bridge runs
 * without pi's SDK in RPC mode, and pi itself reads the same JSON on its
 * next start. Only the keys the bridge owns are interpreted; everything
 * else in the file is carried through untouched.
 *
 * Project `.pi/settings.json` is deliberately not read: pi applies it only
 * for a trusted project (its trust prompt or `trust.json`), a decision the
 * bridge cannot see, and a repository must not be able to steer the picker.
 */

const piSettingsSchema = z
  .object({ enabledModels: z.array(z.string()).optional() })
  .passthrough();

export type PiSettings = z.infer<typeof piSettingsSchema>;

export function resolvePiGlobalSettingsPath(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return join(resolvePiAgentDir({ homeDir: homedir(), env }), "settings.json");
}

function loadError(path: string, error: unknown): Error {
  return new Error(
    `Failed to load Pi settings at ${path}: ${error instanceof Error ? error.message : String(error)}`,
  );
}

/** The parsed file, an empty object when it is absent; throws when unreadable. */
export function readPiSettingsFile(path: string): PiSettings {
  if (!existsSync(path)) {
    return {};
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw loadError(path, error);
  }
  try {
    return piSettingsSchema.parse(JSON.parse(raw));
  } catch (error) {
    throw loadError(path, error);
  }
}

/**
 * The file pi actually reads: `settings.json` is commonly a symlink into a
 * dotfiles checkout, and a rename over the link would replace the link with
 * a plain file. The real path is where the temp file lands and the rename
 * happens, so the write goes through the link as pi's own does.
 */
function resolveWritePath(path: string): string {
  return existsSync(path) ? realpathSync(path) : path;
}

/**
 * Rewrite the settings file through `update`, atomically and under pi's
 * own lock: the new content lands in a sibling temp file renamed over the
 * original, so a reader (pi starting up) sees the old file or the new one,
 * never a torn write; and pi serializes its writes with the same
 * proper-lockfile lock on this path, so neither side loses the other's
 * update. A new file is private to the user; an existing one keeps its mode.
 */
export function updatePiSettingsFile(
  path: string,
  update: (current: PiSettings) => PiSettings,
): PiSettings {
  mkdirSync(dirname(path), { recursive: true });
  const target = resolveWritePath(path);
  const directory = dirname(target);
  const exists = existsSync(target);
  // pi's FileSettingsStorage: `lockSync(path, { realpath: false })` on the
  // settings path itself; the lock file sits beside it.
  const release = lockfile.lockSync(path, { realpath: false });
  let temporaryPath: string | null = null;
  try {
    const next = update(readPiSettingsFile(target));
    temporaryPath = join(directory, `.settings-${process.pid}-${randomUUID()}.tmp`);
    writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    if (exists) chmodSync(temporaryPath, statSync(target).mode);
    renameSync(temporaryPath, target);
    temporaryPath = null;
    return next;
  } finally {
    if (temporaryPath !== null) rmSync(temporaryPath, { force: true });
    release();
  }
}

/**
 * The global `enabledModels` patterns, or undefined when the file does not
 * set them. A file pi cannot load either is reported on stderr and read as
 * empty, the way pi itself keeps running on a broken settings file: a
 * listing must not fail because of it (a write still refuses it).
 */
export function readPiEnabledModelPatterns(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] | undefined {
  const path = resolvePiGlobalSettingsPath(env);
  try {
    return readPiSettingsFile(path).enabledModels;
  } catch (error) {
    process.stderr.write(`pi bridge: ${error instanceof Error ? error.message : String(error)}\n`);
    return undefined;
  }
}
