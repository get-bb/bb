import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import {
  availableParallelism,
  cpus,
  freemem,
  loadavg,
  platform,
  totalmem,
} from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = process.cwd();
const output = resolve(".search-profile");
const script = fileURLToPath(import.meta.url);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const json = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
};
const command = (name, args) =>
  execFileSync(name, args, { cwd: root, stdio: "inherit" });

async function seed() {
  const {
    createConnection,
    migrate,
    ensurePersonalProject,
    createThread,
    noopNotifier,
  } = await import(pathToFileURL(resolve("packages/db/src/index.ts")).href);
  const dir = join(output, "fixture");
  await mkdir(dir, { recursive: true });
  const db = createConnection(join(dir, "bb.db"));
  migrate(db);
  ensurePersonalProject(db);
  const insert = db.$client.prepare(
    "INSERT INTO thread_search_segments (id,thread_id,source_kind,source_key,source_seq,text,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
  );
  const threadIds = [];
  db.$client.transaction(() => {
    for (let t = 0; t < 30; t++) {
      const thread = createThread(db, noopNotifier, {
        projectId: "proj_personal",
        providerId: "codex",
        title: `Search fixture ${t}`,
        status: "idle",
      });
      threadIds.push(thread.id);
      db.$client
        .prepare(
          "UPDATE threads SET updated_at = ?, archived_at = ? WHERE id = ?",
        )
        .run(
          1_700_000_000_000 + t,
          t >= 15 ? 1_700_000_000_000 : null,
          thread.id,
        );
      for (let n = 0; n < 1800; n++) {
        insert.run(
          `segment-${t}-${n}`,
          thread.id,
          "user_message",
          `event-${n}`,
          n,
          `search needle workspace component ${t} ${n} `.repeat(32),
          1_700_000_000_000,
          1_700_000_000_000,
        );
      }
    }
  })();
  db.$client.pragma("wal_checkpoint(TRUNCATE)");
  db.$client.close();
  const workspace = join(dir, "workspace");
  await mkdir(workspace, { recursive: true });
  for (let d = 0; d < 100; d++) {
    const path = join(workspace, `package-${String(d).padStart(3, "0")}`);
    await mkdir(path, { recursive: true });
    await Promise.all(
      Array.from({ length: 100 }, (_, f) =>
        writeFile(
          join(path, `search-component-${String(f).padStart(3, "0")}.ts`),
          "export {};\n",
        ),
      ),
    );
  }
  command("git", ["init", "--quiet", workspace]);
  await json(join(output, "fixture-manifest.json"), {
    threads: 30,
    segments: 54000,
    files: 10000,
    directories: 100,
    threadIds,
    databaseSha256: hash(await readFile(join(dir, "bb.db"))),
  });
}

function start(entry, env, label, profile) {
  const log = createWriteStream(join(output, "logs", `${label}.log`));
  const args = profile
    ? ["--cpu-prof", `--cpu-prof-dir=${join(output, "profiles", label)}`]
    : [];
  const child = spawn(process.execPath, [...args, entry], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  const exited = new Promise((done) =>
    child.once("exit", (code, signal) => done({ code, signal })),
  );
  return { child, exited, log };
}

async function stop(process) {
  if (process.child.exitCode === null) process.child.kill("SIGINT");
  const result = await Promise.race([
    process.exited,
    sleep(15000).then(() => null),
  ]);
  if (result === null) {
    process.child.kill("SIGKILL");
    await process.exited;
    throw new Error("Profiled process did not stop cleanly");
  }
  process.log.end();
}

async function request(url, body) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(60000),
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${response.status} ${url}: ${text.slice(0, 1000)}`);
  return JSON.parse(text);
}

async function ready(server, url) {
  for (let n = 0; n < 600; n++) {
    if (server.child.exitCode !== null)
      throw new Error(`Server exited: ${server.child.exitCode}`);
    try {
      await request(`${url}/health`);
      return;
    } catch {}
    await sleep(100);
  }
  throw new Error("Server readiness timed out");
}

function resultProjection(value) {
  return Object.fromEntries(
    ["active", "archived"].map((group) => [
      group,
      {
        total: value[group].total,
        results: value[group].results.map((result) => ({
          id: result.thread.id,
          matches: result.matches,
        })),
      },
    ]),
  );
}

async function searchSample(url, query) {
  const start = performance.now();
  const search = request(
    `${url}/api/v1/threads/search?${new URLSearchParams({ query, limitPerGroup: "20" })}`,
  ).then((body) => ({
    ms: performance.now() - start,
    body: resultProjection(body),
  }));
  await sleep(15);
  const healthStart = performance.now();
  const health = request(`${url}/health`).then(
    () => performance.now() - healthStart,
  );
  const [result, healthMs] = await Promise.all([search, health]);
  return {
    query,
    searchMs: result.ms,
    healthMs,
    resultSha256: hash(JSON.stringify(result.body)),
    result: result.body,
  };
}

async function measure(label, revision, round, profile = false) {
  const name = `${label}-${round}${profile ? "-profile" : ""}`;
  const build = join(output, "builds", label);
  const samples = [];
  const coldCount = profile ? 1 : 5;
  for (let cold = 0; cold < coldCount; cold++) {
    const run = `${name}-${cold}`;
    const data = join(output, "runtime", run);
    await mkdir(data, { recursive: true });
    await cp(join(output, "fixture", "bb.db"), join(data, "bb.db"));
    await mkdir(join(output, "profiles", run), { recursive: true });
    const url = "http://127.0.0.1:29871";
    const env = {
      BB_DATA_DIR: data,
      BB_SERVER_PORT: "29871",
      BB_SERVER_URL: url,
      BB_APP_URL: url,
      BB_SERVER_BIND_HOST: "127.0.0.1",
      BB_TELEMETRY: "false",
      BB_LOG_LEVEL: "warn",
      BB_APP_UPDATE_MODE: "source",
    };
    const startTime = performance.now();
    const server = start(
      join(build, "server/dist/index.js"),
      env,
      run,
      profile,
    );
    let daemon;
    try {
      await ready(server, url);
      const startupMs = performance.now() - startTime;
      samples.push({
        kind: "cold-search",
        startupMs,
        ...(await searchSample(url, "search")),
      });
      if (cold > 0) continue;
      for (let i = 0; i < (profile ? 8 : 20); i++) {
        samples.push({
          kind: "warm-search",
          ...(await searchSample(
            url,
            ["search", "needle", "workspace component"][i % 3],
          )),
        });
      }
      const enrollment = await request(`${url}/internal/hosts/enroll-key`, {});
      const daemonData = join(data, "daemon");
      await mkdir(join(output, "profiles", `${run}-daemon`), {
        recursive: true,
      });
      daemon = start(
        join(build, "host-daemon/dist/daemon-bundle.mjs"),
        {
          ...env,
          BB_DATA_DIR: daemonData,
          BB_HOST_DAEMON_PORT: "29872",
          BB_CLI_DIR: join(build, "host-daemon/dist"),
          BB_BRIDGE_DIR: join(build, "host-daemon/dist"),
          BB_HOST_ID: enrollment.hostId,
          BB_HOST_ENROLL_KEY: enrollment.enrollKey,
          BB_HOST_NAME: "Search profiling fixture",
          BB_HOST_DAEMON_AUTO_UPDATE: "false",
        },
        `${run}-daemon`,
        profile,
      );
      for (let i = 0; i < 300; i++) {
        const hosts = await request(`${url}/api/v1/hosts`);
        if (
          hosts.some(
            (host) =>
              host.id === enrollment.hostId && host.status === "connected",
          )
        )
          break;
        if (daemon.child.exitCode !== null)
          throw new Error("Fixture daemon exited before connecting");
        if (i === 299) throw new Error("Fixture daemon did not connect");
        await sleep(100);
      }
      for (let burst = 0; burst < (profile ? 5 : 10); burst++) {
        await sleep(2100);
        for (const [index, query] of [
          "se",
          "sea",
          "sear",
          "searc",
          "search",
        ].entries()) {
          const began = performance.now();
          const body = await request(`${url}/api/v1/files/paths`, {
            hostId: enrollment.hostId,
            path: join(output, "fixture/workspace"),
            query,
            limit: 16,
            includeFiles: true,
            includeDirectories: true,
            includeHidden: false,
          });
          samples.push({
            kind: index === 0 ? "cold-files" : "warm-files",
            burst,
            query,
            ms: performance.now() - began,
            resultSha256: hash(JSON.stringify(body)),
          });
          await sleep(80);
        }
      }
      const installed = await request(`${url}/api/v1/plugins/install`, {
        source: join(output, "mention-plugin"),
      });
      const pluginId = installed.plugin.id;
      for (let i = 0; i < (profile ? 3 : 10); i++) {
        const query = `arrival-${i}`;
        const began = performance.now();
        const base = `${url}/api/v1/plugins/mentions/search?${new URLSearchParams({ q: query, trigger: "#" })}`;
        if (label === "before") {
          const body = await request(base);
          samples.push({
            kind: "mentions",
            query,
            firstMs: performance.now() - began,
            allMs: performance.now() - began,
            resultSha256: hash(JSON.stringify(body.groups)),
          });
        } else {
          let firstMs;
          const groups = await Promise.all(
            ["fast", "slow"].map(async (providerId) => {
              const body = await request(
                `${base}&${new URLSearchParams({ pluginId, providerId })}`,
              );
              firstMs ??= performance.now() - began;
              return body.groups;
            }),
          );
          samples.push({
            kind: "mentions",
            query,
            firstMs,
            allMs: performance.now() - began,
            resultSha256: hash(JSON.stringify(groups.flat())),
          });
        }
      }
    } finally {
      await json(join(output, "results", `${name}.json`), {
        label,
        revision,
        round,
        profile,
        samples,
      });
      if (daemon) await stop(daemon);
      await stop(server);
      await rm(data, { recursive: true, force: true });
    }
  }
  await json(join(output, "results", `${name}.json`), {
    label,
    revision,
    round,
    profile,
    samples,
  });
}

async function compare(baseArg, headArg) {
  const commit = (ref) =>
    execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
      encoding: "utf8",
    }).trim();
  const revisions = { before: commit(baseArg), after: commit(headArg) };
  for (const folder of [
    "logs",
    "profiles",
    "results",
    "builds",
    "runtime",
    "mention-plugin",
  ]) {
    await mkdir(join(output, folder), { recursive: true });
  }
  await json(join(output, "mention-plugin/package.json"), {
    name: "search-profile-mentions",
    version: "1.0.0",
    bb: { name: "Search profiling", server: "./server.js" },
  });
  await writeFile(
    join(output, "mention-plugin/server.js"),
    `export default function(bb) {
    for (const [id, delay] of [["fast", 20], ["slow", 1600]]) bb.ui.registerMentionProvider({
      id, label: id, triggers: ["#"],
      async search(ctx) { await new Promise(r => setTimeout(r, delay)); return [{ id: ctx.query, title: ctx.query + " " + id }]; },
      async resolve(id) { return { context: id }; }
    });
  }\n`,
  );
  const manifest = {
    revisions,
    node: process.version,
    platform: platform(),
    cpus: cpus().map((cpu) => cpu.model),
    parallelism: availableParallelism(),
    totalMemory: totalmem(),
    freeMemory: freemem(),
    loadAverage: loadavg(),
    startedAt: new Date().toISOString(),
    order: ["before", "after", "after", "before"],
    timing:
      "Unprofiled; cold means fresh process and SQLite connection, OS page cache is not flushed",
    mentions:
      "Real endpoint requests using each revision's frontend request topology; excludes DOM rendering and debounce",
    files:
      "Real HTTP route and enrolled packaged daemon against 10,000 files; 2.1 s between bursts, 80 ms between queries",
    artifacts: {},
  };
  for (const [label, revision] of Object.entries(revisions)) {
    command("git", ["checkout", "--detach", revision]);
    command("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"]);
    if (label === "before")
      command(process.execPath, [
        "--conditions=source",
        "--import",
        "tsx",
        script,
        "seed",
      ]);
    command("pnpm", [
      "exec",
      "turbo",
      "run",
      "build",
      "--filter=bb-app",
      "--concurrency=4",
      "--output-logs=errors-only",
    ]);
    const source = resolve("packages/bb-app");
    const target = join(output, "builds", label);
    await mkdir(target, { recursive: true });
    for (const name of [
      "package.json",
      "dist",
      "server",
      "host-daemon",
      "app",
    ]) {
      await cp(join(source, name), join(target, name), { recursive: true });
    }
    await symlink(
      join(source, "node_modules"),
      join(target, "node_modules"),
      "dir",
    );
    command("tar", [
      "-czf",
      join(output, `${label}-runtime.tgz`),
      "--exclude=node_modules",
      "-C",
      target,
      ".",
    ]);
    manifest.artifacts[label] = {
      lockfileSha256: hash(await readFile("pnpm-lock.yaml")),
      runtimeSha256: hash(await readFile(join(output, `${label}-runtime.tgz`))),
    };
  }
  manifest.fixture = JSON.parse(
    await readFile(join(output, "fixture-manifest.json"), "utf8"),
  );
  command("tar", [
    "-czf",
    join(output, "fixture.tgz"),
    "-C",
    output,
    "fixture",
    "mention-plugin",
  ]);
  manifest.fixture.archiveSha256 = hash(
    await readFile(join(output, "fixture.tgz")),
  );
  await json(join(output, "manifest.json"), manifest);
  for (const [round, label] of manifest.order.entries())
    await measure(label, revisions[label], round);
  for (const label of ["before", "after"])
    await measure(label, revisions[label], "cpu", true);
  await summarize();
  const profiles = [];
  for (const directory of await readdir(join(output, "profiles"))) {
    for (const file of await readdir(join(output, "profiles", directory))) {
      if (!file.endsWith(".cpuprofile")) continue;
      const profile = JSON.parse(
        await readFile(join(output, "profiles", directory, file), "utf8"),
      );
      const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
      const costs = new Map();
      for (const [index, sample] of profile.samples.entries()) {
        const frame = nodes.get(sample).callFrame;
        const key = `${frame.functionName} ${frame.url}:${frame.lineNumber + 1}`;
        costs.set(
          key,
          (costs.get(key) ?? 0) + profile.timeDeltas[index] / 1000,
        );
      }
      profiles.push({
        file: `${directory}/${file}`,
        durationMs: (profile.endTime - profile.startTime) / 1000,
        hottest: [...costs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
      });
    }
  }
  await json(join(output, "results/cpu-summary.json"), profiles);
  command("git", ["checkout", "--detach", revisions.after]);
}

async function summarize() {
  const runs = await Promise.all(
    (await readdir(join(output, "results")))
      .filter((name) => name.endsWith(".json"))
      .map(async (name) =>
        JSON.parse(await readFile(join(output, "results", name), "utf8")),
      ),
  );
  const percentile = (values, p) =>
    [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
  const rows = [
    "| Measurement | Before p50 / p95 (ms) | After p50 / p95 (ms) | n per revision |",
    "| --- | --- | --- | --- |",
  ];
  for (const [kind, field] of [
    ["cold-search", "startupMs"],
    ["cold-search", "searchMs"],
    ["warm-search", "searchMs"],
    ["warm-search", "healthMs"],
    ["cold-files", "ms"],
    ["warm-files", "ms"],
    ["mentions", "firstMs"],
    ["mentions", "allMs"],
  ]) {
    const values = ["before", "after"].map((label) =>
      runs
        .filter((run) => run.label === label && !run.profile)
        .flatMap((run) => run.samples)
        .filter((sample) => sample.kind === kind)
        .map((sample) => sample[field]),
    );
    rows.push(
      `| ${kind} ${field} | ${values.map((v) => `${percentile(v, 0.5).toFixed(1)} / ${percentile(v, 0.95).toFixed(1)}`).join(" | ")} | ${values[0].length} / ${values[1].length} |`,
    );
  }
  const hashes = new Map();
  for (const run of runs)
    for (const sample of run.samples) {
      const key = `${sample.kind.replace("cold-", "").replace("warm-", "")}:${sample.query}`;
      const existing = hashes.get(key);
      if (existing && existing !== sample.resultSha256)
        throw new Error(`Result mismatch: ${key}`);
      hashes.set(key, sample.resultSha256);
    }
  await writeFile(
    join(output, "summary.md"),
    `${rows.join("\n")}\n\nAll comparable result hashes matched. CPU-profile runs are excluded from timings.\n`,
  );
}

const [mode, ...args] = process.argv.slice(2);
if (mode === "seed") await seed();
else if (mode === "compare" && args.length === 2) await compare(...args);
else if (mode === "summarize") await summarize();
else
  throw new Error(
    "Usage: search-profile.mjs compare <base-commit> <head-commit>",
  );
