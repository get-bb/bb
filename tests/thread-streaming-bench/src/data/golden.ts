import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { createConnection } from "@bb/db";
import { z } from "zod";
import { startBackend, type BackendPaths } from "../backend/backend.js";
import { waitUntil } from "../backend/api.js";

const BENCH_PROVIDER_ID = "bench-stream";
const BENCH_MODEL = "bench-stream-model";

interface GoldenSpec {
  historyProfiles: { name: string; toolsPerTurn: number; turns: number }[];
  seedEvents: number;
  seedThreads: number;
}

const GOLDEN_SPEC: GoldenSpec = {
  historyProfiles: [
    { name: "large", toolsPerTurn: 3, turns: 150 },
    { name: "small", toolsPerTurn: 3, turns: 8 },
    { name: "xlarge", toolsPerTurn: 4, turns: 600 },
  ],
  seedEvents: 400_000,
  seedThreads: 1_200,
};

const manifestSchema = z.object({
  hash: z.string(),
  projectId: z.string(),
  threads: z.record(z.string(), z.string()),
});

export interface Golden {
  manifest: z.infer<typeof manifestSchema>;
  paths: BackendPaths;
  root: string;
}

function hashFiles(root: string, dirs: string[]): string {
  const hash = createHash("sha256");
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      if (entry === "node_modules" || entry === "dist") {
        continue;
      }
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        visit(full);
        continue;
      }
      hash.update(relative(root, full));
      hash.update(readFileSync(full));
    }
  };
  for (const dir of dirs) {
    visit(join(root, dir));
  }
  return hash.digest("hex");
}

function goldenHash(repoRoot: string): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(GOLDEN_SPEC));
  hash.update(hashFiles(repoRoot, ["tests/bench-stream-provider/src", "packages/db/drizzle"]));
  hash.update(readFileSync(join(repoRoot, "packages/scripts/src/lib/seed-perf-fixture.ts")));
  return hash.digest("hex").slice(0, 16);
}

function goldenPaths(root: string): BackendPaths {
  return {
    daemonDataDir: join(root, "daemon-data"),
    logsDir: join(root, "logs"),
    serverDataDir: join(root, "server-data"),
  };
}

function createGitRepo(repoDir: string): void {
  mkdirSync(repoDir, { recursive: true });
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: repoDir, stdio: "ignore" });
  git(["init", "--initial-branch", "main"]);
  git(["config", "user.email", "bench@example.com"]);
  git(["config", "user.name", "BB Bench"]);
  writeFileSync(join(repoDir, "README.md"), "# Bench project\n");
  git(["add", "."]);
  git(["commit", "-m", "Initial commit"]);
}

function seedLargeDatabase(repoRoot: string, serverDataDir: string, logsDir: string): void {
  mkdirSync(serverDataDir, { recursive: true });
  const result = spawnSync(
    process.execPath,
    [
      "--conditions=source",
      "--import",
      "tsx",
      "packages/scripts/src/commands/seed-perf-db.ts",
      "--data-dir",
      serverDataDir,
      "--events",
      String(GOLDEN_SPEC.seedEvents),
      "--threads",
      String(GOLDEN_SPEC.seedThreads),
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "development" },
    },
  );
  writeFileSync(join(logsDir, "seed.log"), `${result.stdout}\n${result.stderr}`);
  if (result.status !== 0) {
    throw new Error(`seed:perf failed (exit ${result.status}); see ${join(logsDir, "seed.log")}`);
  }
}

function checkpointDatabase(serverDataDir: string): void {
  const db = createConnection(join(serverDataDir, "bb.db"));
  try {
    db.$client.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    db.$client.close();
  }
}

interface PrepareGoldenArgs {
  cacheDir: string;
  log: (message: string) => void;
  repoRoot: string;
}

export async function prepareGolden(args: PrepareGoldenArgs): Promise<Golden> {
  const hash = goldenHash(args.repoRoot);
  const root = join(args.cacheDir, `golden-${hash}`);
  const manifestPath = join(root, "manifest.json");
  const paths = goldenPaths(root);
  if (existsSync(manifestPath)) {
    const manifest = manifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
    args.log(`reusing golden data ${root}`);
    return { manifest, paths, root };
  }
  rmSync(root, { force: true, recursive: true });
  mkdirSync(paths.logsDir, { recursive: true });
  args.log(`seeding ${GOLDEN_SPEC.seedThreads} threads / ${GOLDEN_SPEC.seedEvents} events into ${paths.serverDataDir}`);
  seedLargeDatabase(args.repoRoot, paths.serverDataDir, paths.logsDir);
  const repoPath = join(root, "repo");
  createGitRepo(repoPath);
  const backend = await startBackend({
    paths,
    repoRoot: args.repoRoot,
  });
  try {
    args.log(`golden backend up at ${backend.serverUrl}`);
    await backend.api.installPlugin(join(args.repoRoot, "tests/bench-stream-provider"));
    await waitUntil(
      async () => {
        const response = await fetch(`${backend.serverUrl}/api/v1/system/providers`);
        return response.ok && (await response.text()).includes(`"${BENCH_PROVIDER_ID}"`) ? true : null;
      },
      "bench provider registration",
      120_000,
    );
    const projectId = await backend.api.createProject({
      hostId: backend.hostId,
      name: "Streaming bench",
      path: repoPath,
    });
    const threads: Record<string, string> = {};
    const spawned: { profile: GoldenSpec["historyProfiles"][number]; seedBase: number; threadId: string }[] = [];
    for (const [profileIndex, profile] of GOLDEN_SPEC.historyProfiles.entries()) {
      const seedBase = (profileIndex + 1) * 10_000;
      const threadId = await backend.api.spawnThread({
        hostId: backend.hostId,
        model: BENCH_MODEL,
        projectId,
        prompt: `bench_history seed=${seedBase} tools=${profile.toolsPerTurn}`,
        providerId: BENCH_PROVIDER_ID,
        title: `Streaming bench (${profile.name} history)`,
      });
      await backend.api.waitForThreadStatus(threadId, "idle", 120_000);
      spawned.push({ profile, seedBase, threadId });
    }
    await Promise.all(
      spawned.map(async ({ profile, seedBase, threadId }) => {
        for (let turn = 1; turn < profile.turns; turn += 1) {
          await backend.api.runTurn(
            threadId,
            `bench_history seed=${seedBase + turn} tools=${profile.toolsPerTurn}`,
            120_000,
          );
          if (turn % 25 === 0) {
            args.log(`history ${profile.name}: ${turn}/${profile.turns} turns`);
          }
        }
        threads[profile.name] = threadId;
      }),
    );
    const manifest = { hash, projectId, threads };
    await backend.stop();
    checkpointDatabase(paths.serverDataDir);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    args.log(`golden data ready ${root}`);
    return { manifest, paths, root };
  } catch (error) {
    await backend.stop();
    throw error;
  }
}

export function copyGolden(golden: Golden, runRoot: string): BackendPaths {
  rmSync(runRoot, { force: true, recursive: true });
  const paths = goldenPaths(runRoot);
  cpSync(golden.paths.serverDataDir, paths.serverDataDir, { recursive: true });
  cpSync(golden.paths.daemonDataDir, paths.daemonDataDir, { recursive: true });
  mkdirSync(paths.logsDir, { recursive: true });
  return paths;
}
