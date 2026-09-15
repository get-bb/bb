import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const SERVER_OWNED_FIXTURE_PATHS: readonly string[] = [
  "bb.db",
  "config.json",
  "env.json",
  "auth-secret",
  "machine-environment-key",
  "AGENTS.md",
  "telemetry-id",
  "attachments/thr_1/image.png",
  "skills/review/SKILL.md",
  "theme/custom.css",
  "plugins/npm/bb-plugin-linear@1.0.0/package.json",
  "plugins/cache/git/abc/index.js",
  "plugins/snapshots/docs/1-a-b/data.db",
  "plugins/docs/data.db",
  "plugins/docs/secrets/token",
  "plugins/automations/scripts/nightly.sh",
  "plugins/automations/marketplace.json",
];

export const HOST_OWNED_FIXTURE_PATHS: readonly string[] = [
  "host-id",
  "auth.json",
  "thread-storage/thr_1/notes.md",
  "worktrees/repo/file.ts",
  "personal-workspaces/ws/file",
  "checkouts/repo/file",
  "runtime/daemon.sock.json",
  "plugin-host-artifacts/docs/bundle.js",
  "install-cache/bb-app.tgz",
  "skills-generated/generated/SKILL.md",
  "logs/server.1.log",
  "npm/lib/node_modules/bb-app/package.json",
  "systemd/bb-host-daemon-test.service",
  "bb.db-wal",
  "bb.db-shm",
  "bb-app-runtime.json",
  "daemon.lock",
  "server-moved.json",
  "server-import.json",
  "last-server-move.json",
  "server-import-backup/config.json",
  "unknown-top-level/file",
  "plugins/docs/host-data/vault/notes.md",
  "plugins/docs/bridge-data/state.json",
  "plugins/docs/logs/plugin.log",
  "plugins/docs/data.db-wal",
  "plugins/docs/data.db-shm",
  "plugins/docs/data.db-journal",
  "plugins/toolchain-node-22/bin/node",
  "plugins/.staging/partial.tgz",
];

export function fixtureBody(relativePath: string): string {
  return relativePath.endsWith(".json") ? "{}" : `body of ${relativePath}`;
}

export async function writeFixtureFile(
  dataDir: string,
  relativePath: string,
  body: string = fixtureBody(relativePath),
): Promise<void> {
  const filePath = path.join(dataDir, ...relativePath.split("/"));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, body);
}
