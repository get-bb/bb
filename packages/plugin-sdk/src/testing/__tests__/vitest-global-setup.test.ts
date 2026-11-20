import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import setup, { experimental_sandboxTempDir } from "../vitest-global-setup.js";

const TEMP_DIR_ENV_KEYS = ["TMPDIR", "TEMP", "TMP"] as const;
const fixtureDir = fileURLToPath(
  new URL("./fixtures/vitest-sandbox/", import.meta.url),
);
const setupModule = fileURLToPath(
  new URL("../vitest-global-setup.ts", import.meta.url),
);
const vitestBin = join(
  dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
  "vitest.mjs",
);

const tempDirs: string[] = [];
const savedEnv = TEMP_DIR_ENV_KEYS.map((key) => [key, process.env[key]]);

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key!];
    else process.env[key!] = value;
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function freshTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "bb-vitest-setup-test-"));
  tempDirs.push(dir);
  return dir;
}

function pointTempEnvAt(dir: string): void {
  for (const key of TEMP_DIR_ENV_KEYS) process.env[key] = dir;
}

function runFixture(
  tmp: string,
  globalSetup: string | null,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [vitestBin, "run", "--root", fixtureDir, "--config", "vitest.config.mjs"],
      {
        cwd: fixtureDir,
        env: {
          ...process.env,
          TMPDIR: tmp,
          TEMP: tmp,
          TMP: tmp,
          BB_FIXTURE_GLOBAL_SETUP: globalSetup ?? "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, output }));
  });
}

describe("experimental_sandboxTempDir", { timeout: 30_000 }, () => {
  it("runs as the module's default Vitest globalSetup", async () => {
    const outer = freshTmp();
    pointTempEnvAt(outer);
    const teardown = setup();
    expect(dirname(process.env.TMPDIR!)).toBe(outer);
    await teardown();
    expect(process.env.TMPDIR).toBe(outer);
    expect(readdirSync(outer)).toEqual([]);
  });

  it("runs beforeRemove with the sandbox path before deleting it", async () => {
    const outer = freshTmp();
    pointTempEnvAt(outer);
    const seen: string[] = [];
    const teardown = experimental_sandboxTempDir({
      beforeRemove: (sandboxPath) => {
        seen.push(sandboxPath);
        expect(readdirSync(outer)).toHaveLength(1);
        expect(process.env.TMPDIR).toBe(outer);
      },
    });
    const sandbox = process.env.TMPDIR;
    await teardown();
    expect(seen).toEqual([sandbox]);
    expect(readdirSync(outer)).toEqual([]);
  });

  it("points every temp dir variable at one sandbox, then restores them and removes it", async () => {
    const outer = freshTmp();
    pointTempEnvAt(outer);
    delete process.env.TMP;

    const teardown = experimental_sandboxTempDir();
    const sandbox = process.env.TMPDIR!;
    expect(dirname(sandbox)).toBe(outer);
    expect(process.env.TEMP).toBe(sandbox);
    expect(process.env.TMP).toBe(sandbox);
    writeFileSync(join(tmpdir(), "left-by-a-test"), "");

    await teardown();
    expect(process.env.TMPDIR).toBe(outer);
    expect(process.env.TEMP).toBe(outer);
    expect(process.env.TMP).toBeUndefined();
    expect(readdirSync(outer)).toEqual([]);
  });

  it("runs every beforeRemove and removes the sandbox when a callback throws", async () => {
    const outer = freshTmp();
    pointTempEnvAt(outer);
    const ran: string[] = [];
    const failure = new Error("sweep failed");
    const first = experimental_sandboxTempDir({
      beforeRemove: () => {
        ran.push("first");
        throw failure;
      },
    });
    const second = experimental_sandboxTempDir({
      beforeRemove: () => {
        ran.push("second");
      },
    });
    await first();
    await expect(second()).rejects.toBe(failure);
    expect(ran).toEqual(["first", "second"]);
    expect(readdirSync(outer)).toEqual([]);
    expect(process.env.TMPDIR).toBe(outer);
  });

  it("reports every teardown failure together", async () => {
    const outer = freshTmp();
    pointTempEnvAt(outer);
    const first = experimental_sandboxTempDir({
      beforeRemove: () => {
        throw new Error("first sweep failed");
      },
    });
    const second = experimental_sandboxTempDir({
      beforeRemove: () => {
        throw new Error("second sweep failed");
      },
    });
    await first();
    const error = await second().then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AggregateError);
    expect(
      (error as AggregateError).errors.map(
        (inner: unknown) => (inner as Error).message,
      ),
    ).toEqual(["first sweep failed", "second sweep failed"]);
    expect(readdirSync(outer)).toEqual([]);
  });

  it("allocates and exports an absolute sandbox when TMPDIR is relative", async () => {
    const cwd = freshTmp();
    const sibling = freshTmp();
    const script = `
      import { existsSync, mkdirSync } from "node:fs";
      import { isAbsolute } from "node:path";
      process.chdir(${JSON.stringify(cwd)});
      mkdirSync("temp");
      const { default: setup } = await import(${JSON.stringify(
        new URL("../vitest-global-setup.ts", import.meta.url).href,
      )});
      const teardown = setup();
      const sandbox = process.env.TMPDIR;
      console.log("absolute:" + isAbsolute(sandbox));
      process.chdir(${JSON.stringify(sibling)});
      await teardown();
      console.log("removed:" + !existsSync(sandbox));
    `;
    const result = await new Promise<{ code: number | null; output: string }>(
      (resolvePromise, reject) => {
        const child = spawn(
          process.execPath,
          ["--import", "tsx", "--input-type=module", "-e", script],
          {
            env: { ...process.env, TMPDIR: "temp", TEMP: "temp", TMP: "temp" },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let output = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          output += chunk;
        });
        child.stderr.on("data", (chunk: string) => {
          output += chunk;
        });
        child.once("error", reject);
        child.once("close", (code) => resolvePromise({ code, output }));
      },
    );
    expect(result.output.trim().split("\n")).toEqual([
      "absolute:true",
      "removed:true",
    ]);
    expect(result.code).toBe(0);
    expect(
      readdirSync(join(cwd, "temp")).filter((name) =>
        name.startsWith("bb-vt-"),
      ),
    ).toEqual([]);
  });

  it("keeps a shared sandbox until the last nested setup tears down", async () => {
    const outer = freshTmp();
    pointTempEnvAt(outer);

    const first = experimental_sandboxTempDir();
    const sandbox = process.env.TMPDIR;
    const second = experimental_sandboxTempDir();
    expect(process.env.TMPDIR).toBe(sandbox);

    await first();
    await first();
    expect(process.env.TMPDIR).toBe(sandbox);
    expect(readdirSync(outer)).toHaveLength(1);

    await second();
    expect(process.env.TMPDIR).toBe(outer);
    expect(readdirSync(outer)).toEqual([]);
  });

  it("removes a fake host root that a Vitest worker leaves when it is stopped", async () => {
    const withoutSetup = freshTmp();
    const control = await runFixture(withoutSetup, null);
    expect(control.code, control.output).toBe(0);
    expect(
      readdirSync(withoutSetup).filter((name) =>
        name.startsWith("bb-fake-plugin-host-"),
      ),
    ).toHaveLength(1);

    const withSetup = freshTmp();
    const sandboxed = await runFixture(withSetup, setupModule);
    expect(sandboxed.code, sandboxed.output).toBe(0);
    expect(readdirSync(withSetup)).toEqual([]);
  }, 60_000);
});
