import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, onTestFinished } from "vitest";
import { affectedPluginForks } from "../../../scripts/lib/ci-plugin-forks.mjs";
import {
  cacheCleanupPlan,
  listActionsCaches,
} from "../../../scripts/lib/actions-cache.mjs";

it("isolates failed cache restores while preserving healthy caches through a real frozen install", ({
  skip,
}) => {
  skip(
    process.platform === "win32",
    "this fixture invokes pnpm through its POSIX executable",
  );
  const root = mkdtempSync(join(tmpdir(), "bb-ci-cache-fallback-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, "package.json"),
    '{"name":"cache-fixture","private":true}',
  );
  const env = {
    ...process.env,
    npm_config_store_dir: join(root, "store"),
    GITHUB_STEP_SUMMARY: join(root, "summary.md"),
    GITHUB_ENV: join(root, "github-env"),
    RUNNER_TEMP: root,
  };
  const options = {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 30_000,
    stdio: "pipe",
  };
  execFileSync("pnpm", ["install", "--lockfile-only"], options);
  const store = execFileSync(
    "pnpm",
    ["store", "path", "--silent"],
    options,
  ).trim();
  mkdirSync(store, { recursive: true });
  mkdirSync(join(root, ".turbo/cache"), { recursive: true });
  const sentinels = [
    join(store, "partial"),
    join(root, ".turbo/cache/partial"),
  ];
  for (const file of sentinels) writeFileSync(file, "partial restore");
  const script = fileURLToPath(
    new URL(
      "../../../.github/actions/setup-workspace/install-dependencies.sh",
      import.meta.url,
    ),
  );
  execFileSync("bash", [script], {
    ...options,
    env: {
      ...env,
      PNPM_CACHE_RESTORE_OUTCOME: "success",
      TURBO_CACHE_RESTORE_OUTCOME: "success",
    },
  });
  expect(sentinels.map(existsSync)).toEqual([true, true]);
  execFileSync("bash", [script], {
    ...options,
    env: {
      ...env,
      PNPM_CACHE_RESTORE_OUTCOME: "failure",
      TURBO_CACHE_RESTORE_OUTCOME: "success",
    },
  });
  expect(sentinels.map(existsSync)).toEqual([true, true]);
  const fallback = Object.fromEntries(
    readFileSync(env.GITHUB_ENV, "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
  expect(fallback.npm_config_store_dir).not.toBe(env.npm_config_store_dir);
  expect(fallback.TURBO_CACHE_DIR).toBeUndefined();
  expect(existsSync(fallback.npm_config_store_dir)).toBe(true);
  const nextStore = execFileSync("pnpm", ["store", "path", "--silent"], {
    ...options,
    env: { ...env, ...fallback },
  }).trim();
  expect(nextStore.startsWith(fallback.npm_config_store_dir)).toBe(true);
  execFileSync("bash", [script], {
    ...options,
    env: {
      ...env,
      PNPM_CACHE_RESTORE_OUTCOME: "success",
      TURBO_CACHE_RESTORE_OUTCOME: "failure",
    },
  });
  expect(sentinels.map(existsSync)).toEqual([true, false]);
  expect(
    execFileSync("pnpm", ["store", "path", "--silent"], options).trim(),
  ).toBe(store);
}, 30_000);

it("checks both sides of plugin renames and falls back to full coverage for shared or unavailable changes", () => {
  const root = mkdtempSync(join(tmpdir(), "bb-ci-selection-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const write = (path, value) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), value);
  };
  git("init", "--quiet");
  git("config", "user.name", "CI test");
  git("config", "user.email", "ci@example.com");
  git("config", "commit.gpgsign", "false");
  const commit = () => {
    git("add", ".");
    git("commit", "--quiet", "-m", "fixture");
    return git("rev-parse", "HEAD");
  };
  const plugins = ["plugins/alpha", "plugins/beta", "plugins/gamma"];
  write("plugins/alpha/file.ts", "export const value = 1;");
  write("plugins/beta/keep.ts", "export const keep = true;");
  const base = commit();
  expect(affectedPluginForks(root, base, plugins)).toEqual([]);
  git("mv", "plugins/alpha/file.ts", "plugins/beta/renamed.ts");
  commit();
  expect(affectedPluginForks(root, base, plugins)).toEqual([
    "plugins/alpha",
    "plugins/beta",
  ]);
  write("packages/plugin-sdk/source.ts", "export const shared = true;");
  commit();
  expect(affectedPluginForks(root, base, plugins)).toEqual(plugins);
  expect(affectedPluginForks(root, "0".repeat(40), plugins)).toEqual(plugins);
  expect(affectedPluginForks(root, undefined, plugins)).toEqual(plugins);
});

it("partitions fork checks without losing plugins and rejects invalid shards", () => {
  const script = fileURLToPath(
    new URL("../../../scripts/check-plugin-forks.mjs", import.meta.url),
  );
  const list = (...args) =>
    JSON.parse(
      execFileSync(process.execPath, [script, "--list", ...args], {
        encoding: "utf8",
      }),
    );
  const plugins = list();
  for (const count of [1, 3, plugins.length + 1]) {
    const shards = Array.from({ length: count }, (_, index) =>
      list(`--shard=${index + 1}/${count}`),
    );
    const combined = shards.flat();
    expect(combined.toSorted()).toEqual(plugins.toSorted());
    expect(new Set(combined).size).toBe(combined.length);
    expect(
      Math.max(...shards.map((shard) => shard.length)) -
        Math.min(...shards.map((shard) => shard.length)),
    ).toBeLessThanOrEqual(1);
  }
  const selected = plugins.slice(0, 2);
  expect(list(...selected, "--shard=1/3")).toEqual([selected[0]]);
  expect(list(...selected, "--shard=2/3")).toEqual([selected[1]]);
  expect(list(...selected, "--shard=3/3")).toEqual([]);
  for (const shard of [
    "0/3",
    "4/3",
    "1/0",
    "1.5/3",
    "1/3junk",
    "1/9007199254740992",
  ]) {
    const result = spawnSync(
      process.execPath,
      [script, "--list", `--shard=${shard}`],
      { encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--shard requires an index/count");
  }
  const invalidPlugin = spawnSync(
    process.execPath,
    [script, "--list", "plugins/not-forkable", "--shard=2/3"],
    { encoding: "utf8" },
  );
  expect(invalidPlugin.status).not.toBe(0);
  expect(invalidPlugin.stderr).toContain(
    "is not listed in scripts/forkable-plugins.json",
  );
}, 30_000);

it("retires only old unused pnpm caches while protecting current, recent, open-PR, and unrelated caches", () => {
  const now = Date.parse("2026-09-29T00:00:00Z");
  const currentHash = "a".repeat(64);
  const cache = (
    id,
    {
      age = 8,
      idle = age,
      ref = "refs/heads/main",
      hash = String(id).padStart(64, "0"),
      family = "node-cache-Linux-x64-pnpm",
    } = {},
  ) => ({
    id,
    key: `${family}-${hash}`,
    ref,
    size_in_bytes: 1024,
    created_at: new Date(now - age * 86_400_000).toISOString(),
    last_accessed_at: new Date(now - idle * 86_400_000).toISOString(),
  });
  const entries = [
    cache(1, { age: 4 }),
    cache(2, { age: 5 }),
    cache(3),
    cache(4, { hash: currentHash }),
    cache(5, { idle: 0.1 }),
    cache(6, { ref: "refs/pull/10/merge" }),
    cache(7, { ref: "refs/pull/11/merge" }),
    cache(8, { ref: "refs/pull/11/merge", age: 0.1 }),
    cache(9, { family: "Linux-node-22.x-turbo" }),
    cache(10, { ref: "refs/heads/release" }),
    cache(11, { family: "node-cache-macOS-arm64-pnpm" }),
  ];
  expect(
    cacheCleanupPlan(entries, {
      currentHash,
      defaultRef: "refs/heads/main",
      closedRefs: new Set(["refs/pull/11/merge"]),
      now,
    }).map((entry) => entry.id),
  ).toEqual([3, 7]);
});

it("reads every cache inventory page and refuses malformed inventories before planning deletion", async () => {
  const entries = Array.from({ length: 101 }, (_, index) => ({
    id: index + 1,
    key: `cache-${index}`,
    ref: "refs/heads/main",
    size_in_bytes: 1024,
    created_at: "2026-09-20T00:00:00Z",
    last_accessed_at: "2026-09-20T00:00:00Z",
  }));
  const api = async (path) => ({
    actions_caches: entries.slice(
      (Number(new URL(path, "https://example.com").searchParams.get("page")) -
        1) *
        100,
      Number(new URL(path, "https://example.com").searchParams.get("page")) *
        100,
    ),
  });
  expect(await listActionsCaches(api)).toHaveLength(101);
  await expect(
    listActionsCaches(async () => ({
      actions_caches: [{ ...entries[0], last_accessed_at: "invalid" }],
    })),
  ).rejects.toThrow("Invalid Actions cache entry");
});

it("drops Turbo cache entries the job's run summaries do not name, and keeps everything when there is no summary", () => {
  const root = mkdtempSync(join(tmpdir(), "bb-turbo-prune-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const cache = join(root, "cache");
  const runs = join(root, "runs");
  mkdirSync(cache);
  mkdirSync(runs);
  const writeEntry = (hash) => {
    writeFileSync(join(cache, `${hash}.tar.zst`), "archive");
    writeFileSync(join(cache, `${hash}-meta.json`), "{}");
  };
  const entryFiles = (hash) =>
    [`${hash}.tar.zst`, `${hash}-meta.json`].map((name) =>
      existsSync(join(cache, name)),
    );
  const prune = (...args) =>
    execFileSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../../../scripts/prune-turbo-cache.mjs", import.meta.url),
        ),
        "--dir",
        cache,
        ...args,
      ],
      { encoding: "utf8" },
    );
  for (const hash of ["aaaa1111", "bbbb2222", "cccc3333"]) writeEntry(hash);

  prune("--keep-run-summaries", runs);
  expect(["aaaa1111", "bbbb2222", "cccc3333"].flatMap(entryFiles)).toEqual(
    Array.from({ length: 6 }, () => true),
  );

  writeFileSync(
    join(runs, "first.json"),
    JSON.stringify({ tasks: [{ hash: "aaaa1111" }] }),
  );
  writeFileSync(
    join(runs, "second.json"),
    JSON.stringify({ tasks: [{ hash: "cccc3333" }, { hash: "dddd4444" }] }),
  );
  expect(prune("--keep-run-summaries", runs)).toContain(
    "removed 1 entries this job did not use",
  );
  expect(entryFiles("aaaa1111")).toEqual([true, true]);
  expect(entryFiles("bbbb2222")).toEqual([false, false]);
  expect(entryFiles("cccc3333")).toEqual([true, true]);
});
