import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const hostModule = new URL("../fake-plugin-host.ts", import.meta.url).href;
const storageModule = new URL("../fake-storage-dir.ts", import.meta.url).href;

interface ChildRun {
  lines: string[];
  code: number | null;
  stderr: string;
  tmp: string;
}

const tempDirs: string[] = [];
const HOST_DIR_PREFIX = "bb-fake-plugin-host-";

function leftoverHostDirs(tmp: string): string[] {
  return readdirSync(tmp).filter((name) => name.startsWith(HOST_DIR_PREFIX));
}

const canLockDirs = process.platform !== "win32" && process.getuid?.() !== 0;

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    for (const root of leftoverHostDirs(dir)) {
      for (const host of readdirSync(join(dir, root))) {
        chmodSync(join(dir, root, host), 0o700);
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

function runChild(body: string): Promise<ChildRun> {
  const tmp = mkdtempSync(join(tmpdir(), "bb-fake-storage-dir-test-"));
  tempDirs.push(tmp);
  const script = `
    import { chmodSync, readdirSync } from "node:fs";
    import { tmpdir } from "node:os";
    import { join } from "node:path";
    const HOST_DIR_PREFIX = ${JSON.stringify(HOST_DIR_PREFIX)};
    const hostModule = ${JSON.stringify(hostModule)};
    const storageModule = ${JSON.stringify(storageModule)};
    const { createFakePluginHost } = await import(hostModule);
    const roots = () =>
      readdirSync(tmpdir()).filter((name) => name.startsWith(HOST_DIR_PREFIX));
    const hostDirs = () =>
      roots().flatMap((root) =>
        readdirSync(join(tmpdir(), root)).map((host) => join(tmpdir(), root, host)),
      );
    const count = () => console.log("count:" + roots().length);
    ${body}
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--conditions=source",
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        script,
      ],
      {
        env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({
        lines: stdout.split("\n").filter((line) => line.length > 0),
        code,
        stderr,
        tmp,
      });
    });
  });
}

describe("fake plugin host storage directory", { timeout: 30_000 }, () => {
  it("is created only when the plugin opens a database, and removed when the process exits", async () => {
    const run = await runChild(`
      createFakePluginHost();
      count();
      createFakePluginHost().bb.storage.database();
      count();
    `);
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual(["count:0", "count:1"]);
    expect(run.code).toBe(0);
    expect(leftoverHostDirs(run.tmp)).toEqual([]);
  });

  it("keeps every host dir under one per-process root, and dispose() removes its own", async () => {
    const run = await runChild(`
      const first = createFakePluginHost();
      const second = createFakePluginHost();
      first.bb.storage.database();
      second.bb.storage.database();
      console.log("roots:" + roots().length + " hosts:" + hostDirs().length);
      console.log("pid-root:" + roots()[0].startsWith(HOST_DIR_PREFIX + process.pid + "-"));
      await first.harness.dispose();
      console.log("roots:" + roots().length + " hosts:" + hostDirs().length);
    `);
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual([
      "roots:1 hosts:2",
      "pid-root:true",
      "roots:1 hosts:1",
    ]);
    expect(run.code).toBe(0);
    expect(leftoverHostDirs(run.tmp)).toEqual([]);
  });

  it("puts experimental_directory() in the host dir and removes it with the host", async () => {
    const run = await runChild(`
      const { existsSync, writeFileSync } = await import("node:fs");
      const host = createFakePluginHost();
      const files = host.bb.storage.experimental_directory();
      writeFileSync(join(files, "note.txt"), "x");
      host.bb.storage.database();
      console.log("roots:" + roots().length + " hosts:" + hostDirs().length);
      console.log("under-host:" + (files === join(hostDirs()[0], "files")));
      await host.harness.dispose();
      console.log("files:" + existsSync(files) + " roots:" + roots().length);
    `);
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual([
      "roots:1 hosts:1",
      "under-host:true",
      "files:false roots:0",
    ]);
    expect(run.code).toBe(0);
    expect(leftoverHostDirs(run.tmp)).toEqual([]);
  });

  it("removes the root when its last host is disposed, and adds one exit listener per process", async () => {
    const run = await runChild(`
      const exitListeners = process.listenerCount("exit");
      for (let cycle = 0; cycle < 3; cycle += 1) {
        const first = createFakePluginHost();
        const second = createFakePluginHost();
        first.bb.storage.database();
        second.bb.storage.database();
        await first.harness.dispose();
        console.log("roots:" + roots().length + " hosts:" + hostDirs().length);
        await second.harness.dispose();
        console.log("roots:" + roots().length);
      }
      console.log("exit-listeners:" + (process.listenerCount("exit") - exitListeners));
    `);
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual([
      "roots:1 hosts:1",
      "roots:0",
      "roots:1 hosts:1",
      "roots:0",
      "roots:1 hosts:1",
      "roots:0",
      "exit-listeners:1",
    ]);
    expect(run.code).toBe(0);
    expect(leftoverHostDirs(run.tmp)).toEqual([]);
  });

  it("is removed when the process calls process.exit() with hosts never disposed", async () => {
    const run = await runChild(`
      createFakePluginHost().bb.storage.database();
      createFakePluginHost().bb.storage.database();
      count();
      process.exit(3);
    `);
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual(["count:1"]);
    expect(run.code).toBe(3);
    expect(leftoverHostDirs(run.tmp)).toEqual([]);
  });

  it("leaves the process's signal handling untouched", async () => {
    const run = await runChild(`
      const signals = ["SIGTERM", "SIGINT", "SIGHUP"];
      const listeners = () =>
        signals.map((signal) => process.listenerCount(signal)).join(",");
      const before = listeners();
      createFakePluginHost().bb.storage.database();
      console.log("before:" + before + " after:" + listeners());
    `);
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual(["before:0,0,0 after:0,0,0"]);
    expect(run.code).toBe(0);
  });

  it("shares one root between separately loaded copies of the module", async () => {
    const run = await runChild(`
      const first = await import(storageModule);
      const second = await import(storageModule + "?copy=2");
      console.log("separate-copies:" + (first.createFakeStorageDir !== second.createFakeStorageDir));
      first.createFakeStorageDir().openDatabase();
      second.createFakeStorageDir().openDatabase();
      console.log("roots:" + roots().length + " hosts:" + hostDirs().length);
    `);
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual(["separate-copies:true", "roots:1 hosts:2"]);
    expect(run.code).toBe(0);
    expect(leftoverHostDirs(run.tmp)).toEqual([]);
  });

  it.skipIf(!canLockDirs)(
    "retries a host dir at exit when dispose() could not remove it",
    async () => {
      const run = await runChild(`
        const host = createFakePluginHost();
        host.bb.storage.database();
        const [locked] = hostDirs();
        chmodSync(locked, 0o500);
        try {
          await host.harness.dispose();
          console.log("disposed");
        } catch (error) {
          console.log("dispose-failed:" + error.code);
        }
        chmodSync(locked, 0o700);
        console.log("hosts:" + hostDirs().length);
      `);
      expect(run.stderr).toBe("");
      expect(run.lines).toEqual(["dispose-failed:EACCES", "hosts:1"]);
      expect(run.code).toBe(0);
      expect(leftoverHostDirs(run.tmp)).toEqual([]);
    },
  );

  it.skipIf(!canLockDirs)(
    "retries the original root at exit when TMPDIR is relative and the cwd changed",
    async () => {
      const run = await runChild(`
        const { mkdirSync, writeFileSync, existsSync } = await import("node:fs");
        const original = join(tmpdir(), "original");
        const other = join(tmpdir(), "other");
        mkdirSync(join(original, "t"), { recursive: true });
        mkdirSync(join(other, "t"), { recursive: true });
        process.chdir(original);
        for (const key of ["TMPDIR", "TEMP", "TMP"]) process.env[key] = "t";
        const host = createFakePluginHost();
        host.bb.storage.database();
        const [root] = readdirSync("t");
        const [hostDir] = readdirSync(join("t", root));
        const locked = join(original, "t", root, hostDir);
        chmodSync(locked, 0o500);
        try {
          await host.harness.dispose();
        } catch (error) {
          console.log("dispose-failed:" + error.code);
        }
        chmodSync(locked, 0o700);
        const decoy = join(other, "t", root, hostDir);
        mkdirSync(decoy, { recursive: true });
        writeFileSync(join(decoy, "keep"), "");
        process.chdir(other);
        process.on("exit", () => {
          console.log("original-root:" + existsSync(join(original, "t", root)));
          console.log("decoy:" + existsSync(join(decoy, "keep")));
        });
      `);
      expect(run.stderr).toBe("");
      expect(run.lines).toEqual([
        "dispose-failed:EACCES",
        "original-root:false",
        "decoy:true",
      ]);
      expect(run.code).toBe(0);
    },
  );

  it.skipIf(!canLockDirs)(
    "still removes the other hosts when one host dir cannot be removed",
    async () => {
      const run = await runChild(`
        createFakePluginHost().bb.storage.database();
        const [locked] = hostDirs();
        createFakePluginHost().bb.storage.database();
        chmodSync(locked, 0o500);
        console.log("hosts:" + hostDirs().length);
        console.log("locked:" + locked);
      `);
      expect(run.stderr).toBe("");
      expect(run.lines[0]).toBe("hosts:2");
      expect(run.code).toBe(0);
      const locked = run.lines[1]?.slice("locked:".length);
      const [root] = leftoverHostDirs(run.tmp);
      expect(root).toBeDefined();
      expect(
        readdirSync(join(run.tmp, root!)).map((host) =>
          join(run.tmp, root!, host),
        ),
      ).toEqual([locked]);
    },
  );
});
