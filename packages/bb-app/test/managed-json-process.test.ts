import { spawn } from "node:child_process";
import { bbAppManagedEnvFileSchema } from "@bb/config/bb-app-managed-config";
import { readFile } from "node:fs/promises";
import { mutateManagedJsonFile } from "../src/managed-json-file.js";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const observer = join(packageRoot, "test/fixtures/managed-json-observer.cjs");
const entry = join(packageRoot, "src/bin/bb-app.ts");
const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), "bb-managed-json-"));
  cleanups.push(() => rmSync(path, { force: true, recursive: true }));
  return path;
}

function start(
  dir: string,
  args: string[],
  controls: { pause?: string; fail?: string } = {},
) {
  const target = join(dir, `${args[0]}.json`);
  const child = spawn(
    process.execPath,
    [
      "--require",
      observer,
      "--conditions=source",
      "--import",
      "tsx",
      entry,
      "--data-dir",
      dir,
      "--server-url",
      "http://127.0.0.1:1",
      ...args,
    ],
    {
      cwd: resolve(packageRoot, "../.."),
      env: {
        PATH: process.env.PATH,
        HOME: dir,
        BB_DATA_DIR: dir,
        BB_SERVER_URL: "http://127.0.0.1:1",
        BB_TEST_TARGET: target,
        BB_TEST_PAUSE: controls.pause,
        BB_TEST_FAIL: controls.fail,
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  if (child.stdout === null || child.stderr === null)
    throw new Error("Missing child output pipes");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data) => {
    stdout += String(data);
  });
  child.stderr.on("data", (data) => {
    stderr += String(data);
  });
  const events: string[] = [];
  child.on("message", (event: unknown) => {
    if (typeof event === "string") events.push(event);
  });
  const done = new Promise<{
    code: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
  }>((resolveDone, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) =>
      resolveDone({ code, signal, stdout, stderr }),
    );
  });
  cleanups.push(async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await done;
  });
  return {
    child,
    done,
    release: () => child.send("continue"),
    async event(...names: string[]): Promise<string> {
      const deadline = performance.now() + 10_000;
      for (;;) {
        const found = events.find((event) => names.includes(event));
        if (found) return found;
        if (
          child.exitCode !== null ||
          child.signalCode !== null ||
          performance.now() >= deadline
        ) {
          throw new Error(
            `Missing ${names.join("/")} (${events.join(",")}): ${stderr}`,
          );
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 10));
      }
    },
  };
}

function seed(dir: string, kind: string, value: object): string {
  const path = join(dir, `${kind}.json`);
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  return path;
}

function read(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function success(writer: ReturnType<typeof start>) {
  const result = await writer.done;
  expect(result, result.stderr).toMatchObject({ code: 0, signal: null });
}

async function compete(
  first: ReturnType<typeof start>,
  second: ReturnType<typeof start>,
) {
  const event = await second.event("blocked", "snapshot");
  if (event === "snapshot") await success(second);
  first.release();
  await Promise.all([success(first), success(second)]);
}

function cleanAndPrivate(dir: string, kind: string) {
  expect(readdirSync(dir).filter((file) => file.endsWith(".tmp"))).toEqual([]);
  expect(statSync(join(dir, `${kind}.json`)).mode & 0o777).toBe(0o600);
  expect(statSync(join(dir, `.${kind}.json.lock`)).mode & 0o777).toBe(0o600);
}

const cases = [
  {
    kind: "env",
    a: "SYNTHETIC_A",
    b: "SYNTHETIC_B",
    va: "synthetic-a",
    vb: "synthetic-b",
  },
  {
    kind: "config",
    a: "BB_LOG_LEVEL",
    b: "BB_APP_URL",
    va: "debug",
    vb: "https://example.test",
  },
];

describe("managed JSON CLI process transactions", () => {
  for (const { kind, a, b, va, vb } of cases) {
    for (const operation of ["set", "unset"]) {
      for (const pausedOperation of ["set", operation].filter(
        (v, i, all) => all.indexOf(v) === i,
      )) {
        it(`${kind} ${operation}/set preserves both mutations with ${pausedOperation} paused`, async () => {
          const dir = directory();
          const extras =
            kind === "config"
              ? {
                  machineCredential: "synthetic-credential",
                  connectMachineId: "synthetic-machine",
                  sharedSkillRoots: {
                    user: ["synthetic/skills"],
                    project: [],
                  },
                  customModels: [
                    { providerId: "future-provider", model: "synthetic" },
                  ],
                  customAcpAgents: [
                    { id: "synthetic", command: "missing-synthetic-command" },
                  ],
                }
              : {};
          const keep =
            kind === "env"
              ? { KEEP: "preserved" }
              : { BB_INFERENCE: "codex/synthetic" };
          const path = seed(dir, kind, {
            ...extras,
            [kind]: { ...keep, ...(operation === "unset" ? { [a]: va } : {}) },
          });
          const change = [
            kind,
            operation,
            a,
            ...(operation === "set" ? [va] : []),
          ];
          const unrelated = [kind, "set", b, vb];
          const first = start(
            dir,
            pausedOperation === "unset" ? change : unrelated,
            { pause: "read" },
          );
          await first.event("paused");
          const second = start(
            dir,
            pausedOperation === "unset" ? unrelated : change,
          );
          await compete(first, second);
          const expectedValues = {
            ...keep,
            ...(operation === "set" ? { [a]: va } : {}),
            [b]: vb,
          };
          expect(read(path)).toMatchObject({ [kind]: expectedValues });
          expect(read(path)).toEqual({ ...extras, [kind]: expectedValues });
          cleanAndPrivate(dir, kind);
        });
      }
    }

    it(`${kind} creates a missing file under competing writers`, async () => {
      const dir = directory();
      await Promise.all([
        success(start(dir, [kind, "set", a, va])),
        success(start(dir, [kind, "set", b, vb])),
      ]);
      expect(read(join(dir, `${kind}.json`))).toEqual({
        [kind]: { [a]: va, [b]: vb },
      });
      cleanAndPrivate(dir, kind);
    });

    for (const stage of ["before-read", "write", "partial-write", "rename"]) {
      it(`${kind} releases the lock and preserves bytes after ${stage} failure`, async () => {
        const dir = directory();
        const path = seed(dir, kind, { [kind]: { [a]: va } });
        const before = readFileSync(path, "utf8");
        const failed = await start(dir, [kind, "set", b, vb], { fail: stage })
          .done;
        expect(failed.code).toBe(1);
        expect(failed.stderr).toContain(`Injected ${stage} failure`);
        expect(readFileSync(path, "utf8")).toBe(before);
        cleanAndPrivate(dir, kind);
        await success(start(dir, [kind, "unset", a]));
        expect(read(path)).toEqual({});
      });
    }

    it(`${kind} validates the document again inside the transaction and releases on parse failure`, async () => {
      const dir = directory();
      const path = seed(dir, kind, { [kind]: { [a]: va } });
      const writer = start(dir, [kind, "set", b, vb], { pause: "before-read" });
      await writer.event("paused");
      writeFileSync(path, "{broken");
      writer.release();
      const result = await writer.done;
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(`Invalid bb-app ${kind} JSON`);
      expect(readFileSync(path, "utf8")).toBe("{broken");
      cleanAndPrivate(dir, kind);
      seed(dir, kind, { [kind]: { [a]: va } });
      await success(start(dir, [kind, "unset", a]));
      expect(read(path)).toEqual({});
    });

    for (const stage of ["read", "after-write", "after-rename"]) {
      it(`${kind} recovers after SIGKILL at ${stage} with two waiting writers`, async () => {
        const dir = directory();
        const path = seed(dir, kind, { [kind]: { [a]: va } });
        const owner = start(dir, [kind, "set", b, vb], { pause: stage });
        await owner.event("paused");
        expect(read(path)).toEqual({
          [kind]: { [a]: va, ...(stage === "after-rename" ? { [b]: vb } : {}) },
        });
        if (stage === "after-write")
          expect(statSync(join(dir, `.${kind}.json.tmp`)).mode & 0o777).toBe(
            0o600,
          );
        const remove = start(dir, [kind, "unset", a]);
        const add = start(dir, [kind, "set", b, vb]);
        await Promise.all([remove.event("blocked"), add.event("blocked")]);
        owner.child.kill("SIGKILL");
        expect((await owner.done).signal).toBe("SIGKILL");
        await Promise.all([success(remove), success(add)]);
        expect(read(path)).toEqual({ [kind]: { [b]: vb } });
        cleanAndPrivate(dir, kind);
      });
    }
  }

  it("same-process contenders preserve the kernel lock seen by other CLI processes", async () => {
    const dir = directory();
    const path = seed(dir, "env", { env: { SYNTHETIC: "keep" } });
    let release!: () => void;
    let acquired!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const ready = new Promise<void>((resolveReady) => {
      acquired = resolveReady;
    });
    const first = mutateManagedJsonFile({
      path,
      read: async () => {
        const contents = bbAppManagedEnvFileSchema.parse(
          JSON.parse(await readFile(path, "utf8")),
        );
        acquired();
        await gate;
        return { env: { ...contents.env, FIRST: "one" } };
      },
      mutate: (current) => current,
    });
    await ready;
    const second = mutateManagedJsonFile({
      path,
      read: async () => {
        const contents = bbAppManagedEnvFileSchema.parse(
          JSON.parse(await readFile(path, "utf8")),
        );
        return { env: { ...contents.env, SECOND: "two" } };
      },
      mutate: (current) => current,
    });
    try {
      const third = start(dir, ["env", "set", "THIRD", "three"]);
      expect(await third.event("blocked", "snapshot")).toBe("blocked");
      release();
      await Promise.all([first, second, success(third)]);
      expect(read(path)).toEqual({
        env: { SYNTHETIC: "keep", FIRST: "one", SECOND: "two", THIRD: "three" },
      });
    } finally {
      release();
      await Promise.allSettled([first, second]);
    }
    cleanAndPrivate(dir, "env");
  });

  it("times out without stealing an old paused writer lock or deleting its temp file", async () => {
    const dir = directory();
    const path = seed(dir, "env", { env: { SYNTHETIC_A: "synthetic" } });
    const owner = start(dir, ["env", "set", "SYNTHETIC_B", "b"], {
      pause: "after-write",
    });
    await owner.event("paused");
    const lockPath = join(dir, ".env.json.lock");
    const lockInode = statSync(lockPath).ino;
    const old = new Date(0);
    utimesSync(lockPath, old, old);
    owner.child.kill("SIGSTOP");
    const contender = start(dir, ["env", "unset", "SYNTHETIC_A"]);
    await contender.event("blocked");
    const result = await contender.done;
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`Timed out waiting to update ${path}`);
    expect(result.stdout).not.toContain("Unset");
    expect(statSync(lockPath).ino).toBe(lockInode);
    expect(existsSync(join(dir, ".env.json.tmp"))).toBe(true);
    expect(read(path)).toEqual({ env: { SYNTHETIC_A: "synthetic" } });
    owner.child.kill("SIGCONT");
    owner.release();
    await success(owner);
    await success(start(dir, ["env", "unset", "SYNTHETIC_A"]));
    expect(read(path)).toEqual({ env: { SYNTHETIC_B: "b" } });
    cleanAndPrivate(dir, "env");
  }, 15_000);

  it("rejects invalid input and malformed documents without rewriting them", async () => {
    const dir = directory();
    const path = seed(dir, "config", { config: { BB_LOG_LEVEL: "info" } });
    for (const value of ["", "invalid-level"]) {
      const result = await start(dir, ["config", "set", "BB_LOG_LEVEL", value])
        .done;
      expect(result.code).toBe(1);
      expect(read(path)).toEqual({ config: { BB_LOG_LEVEL: "info" } });
      expect(existsSync(join(dir, ".config.json.lock"))).toBe(false);
    }
    for (const value of ["{broken", '{"unknown":"synthetic"}']) {
      writeFileSync(path, value);
      const result = await start(dir, ["config", "unset", "BB_LOG_LEVEL"]).done;
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Invalid bb-app config");
      expect(readFileSync(path, "utf8")).toBe(value);
    }
  });

  it("cleans crash leftovers without reusing their permissions or contents", async () => {
    const dir = directory();
    const path = seed(dir, "env", { env: { SYNTHETIC_A: "synthetic" } });
    const temp = join(dir, ".env.json.tmp");
    writeFileSync(temp, '{"env":{"REMOVED_SECRET":"synthetic"}}');
    chmodSync(temp, 0o644);
    await success(start(dir, ["env", "unset", "SYNTHETIC_A"]));
    expect(read(path)).toEqual({});
    cleanAndPrivate(dir, "env");
  });

  for (const remove of [false, true]) {
    it(`client mappings serialize set/${remove ? "remove" : "set"}`, async () => {
      const dir = directory();
      const origin = "https://example.test";
      const path = seed(dir, "client", {
        servers: {
          [origin]: { hosts: { host_a: { sshAuthority: "synthetic-a" } } },
        },
      });
      const first = start(
        dir,
        [
          "client",
          "ssh-target",
          "set",
          origin,
          "synthetic-b",
          "--host-id",
          "host_b",
        ],
        { pause: "read" },
      );
      await first.event("paused");
      const second = start(dir, [
        "client",
        "ssh-target",
        remove ? "remove" : "set",
        origin,
        ...(remove ? [] : ["synthetic-c"]),
        "--host-id",
        "host_a",
      ]);
      await compete(first, second);
      expect(read(path)).toEqual({
        servers: {
          [origin]: {
            hosts: {
              ...(remove ? {} : { host_a: { sshAuthority: "synthetic-c" } }),
              host_b: { sshAuthority: "synthetic-b" },
            },
          },
        },
      });
      cleanAndPrivate(dir, "client");
    });
  }
});
