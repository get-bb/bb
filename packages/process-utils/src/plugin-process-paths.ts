import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Where a daemon-spawned plugin process keeps its files.
 *
 * Two directories, two lifetimes, and the split is the point: `dataDir`
 * survives restarts and upgrades and is the plugin's own corner of the daemon
 * data dir, while `tempDir` belongs to one process and is removed when it
 * exits. Both are scoped by plugin id so one plugin's scratch can never
 * collide with — or be read through — another's.
 *
 * Shared rather than inlined because more than one kind of plugin process
 * needs it, and they do not all live in the daemon: host plugin workers are
 * spawned by the daemon, provider bridges by the agent runtime, and both
 * bootstraps must agree on the layout.
 */

/** Path-safe, reversible, and collision-free for any plugin id. */
export function safePluginSegment(pluginId: string): string {
  return encodeURIComponent(pluginId);
}

/**
 * The plugin's persistent directory under the daemon data dir, created if it
 * does not exist. `kind` separates the process families a plugin can own so
 * its host worker's state and its bridge's state do not share a namespace.
 */
export async function ensurePluginProcessDataDir(args: {
  daemonDataDir: string;
  pluginId: string;
  kind: "host-data" | "bridge-data";
}): Promise<string> {
  const directory = join(
    args.daemonDataDir,
    "plugins",
    safePluginSegment(args.pluginId),
    args.kind,
  );
  await mkdir(directory, { recursive: true });
  return directory;
}

/**
 * A fresh temp directory for one plugin process. The caller removes it when
 * the process exits — nothing here outlives the process that owns it.
 */
export async function createPluginProcessTempDir(args: {
  pluginId: string;
  prefix: string;
}): Promise<string> {
  return mkdtemp(
    join(tmpdir(), `${args.prefix}-${safePluginSegment(args.pluginId)}-`),
  );
}
