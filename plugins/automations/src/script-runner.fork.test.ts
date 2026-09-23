import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { automationScriptDir } from "./script-files.js";
import { executeStoredScript, mapScriptResultToRun } from "./script-runner.js";
import {
  bbProbeCandidates,
  bbProbeCommand,
  isPosixShellEntry,
} from "./script-runner.fork.js";

describe("bbProbeCandidates", () => {
  it("leaves candidates untouched off Windows", () => {
    expect(bbProbeCandidates(["/usr/bin/bb", "/opt/bb"], "linux")).toEqual([
      "/usr/bin/bb",
      "/opt/bb",
    ]);
  });

  it("tries the bb.cmd launcher before the bare candidate on Windows", () => {
    expect(bbProbeCandidates(["C:\\dist\\bb"], "win32")).toEqual([
      "C:\\dist\\bb.cmd",
      "C:\\dist\\bb",
    ]);
  });
});

describe("bbProbeCommand", () => {
  it("runs candidates directly off Windows", () => {
    expect(
      bbProbeCommand("/usr/bin/bb", ["--version"], "linux", "/node"),
    ).toEqual({
      command: "/usr/bin/bb",
      args: ["--version"],
      shell: false,
    });
  });

  it("runs a Windows .cmd launcher through the shell", () => {
    expect(
      bbProbeCommand("C:\\dist\\bb.cmd", ["--version"], "win32", "C:\\node"),
    ).toEqual({
      command: "C:\\dist\\bb.cmd",
      args: ["--version"],
      shell: true,
    });
  });

  it("runs an extensionless bundle through Node on Windows", () => {
    expect(
      bbProbeCommand("C:\\dist\\bb", ["--version"], "win32", "C:\\node"),
    ).toEqual({
      command: "C:\\node",
      args: ["C:\\dist\\bb", "--version"],
      shell: false,
    });
  });

  it("runs other extensions directly on Windows", () => {
    expect(
      bbProbeCommand("C:\\dist\\bb.exe", ["--version"], "win32", "C:\\node"),
    ).toEqual({
      command: "C:\\dist\\bb.exe",
      args: ["--version"],
      shell: false,
    });
  });
});

describe("bbProbeCommand on real entries", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "bb-auto-probe-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("refuses a dev checkout's POSIX-sh shim", async () => {
    for (const shebang of [
      "#!/bin/sh",
      "#!/usr/bin/env sh",
      "#!/usr/bin/env -S bash",
      "#!/bin/dash",
    ]) {
      const shim = join(tempRoot, "bb");
      await writeFile(
        shim,
        `${shebang}\nSCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\n`,
      );
      expect(isPosixShellEntry(shim), shebang).toBe(true);
      expect(
        bbProbeCommand(shim, ["--version"], "win32", "C:\\node"),
        shebang,
      ).toBeNull();
    }
  });

  it("hosts an installed host's extensionless bundle on Node", async () => {
    const bundle = join(tempRoot, "bb");
    await writeFile(
      bundle,
      '#!/usr/bin/env node\nimport "./bb-chunks/a.js";\n',
    );
    expect(isPosixShellEntry(bundle)).toBe(false);
    expect(bbProbeCommand(bundle, ["--version"], "win32", "C:\\node")).toEqual({
      command: "C:\\node",
      args: [bundle, "--version"],
      shell: false,
    });
  });
});

describe("bb CLI warning placement", () => {
  it("keeps a warning out of the silent-tick decision", () => {
    expect(
      mapScriptResultToRun({
        exitCode: 0,
        output: "",
        stderr: "",
        timedOut: false,
        warning: "[bb] warning: could not locate the bb CLI",
      }),
    ).toMatchObject({ status: "skipped", skipReason: "empty output" });
  });

  it("keeps a warning out of the wakeAgent decision", () => {
    expect(
      mapScriptResultToRun({
        exitCode: 0,
        output: '{"wakeAgent": false}\n',
        stderr: "",
        timedOut: false,
        warning: "[bb] warning: could not locate the bb CLI",
      }),
    ).toMatchObject({ status: "skipped", skipReason: "wakeAgent false" });
  });
});

describe("bb CLI injection into a script run", () => {
  it("injects an absolute CLI on the script's PATH without touching its output", async () => {
    const previousCli = process.env.BB_CLI;
    const previousCliDir = process.env.BB_CLI_DIR;
    const launcherDir = await mkdtemp(join(tmpdir(), "bb-auto-cli-dir-"));
    const pluginDataDir = await mkdtemp(join(tmpdir(), "bb-auto-cli-run-"));
    try {
      const launcher = join(
        launcherDir,
        process.platform === "win32" ? "bb.cmd" : "bb",
      );
      await writeFile(
        launcher,
        process.platform === "win32"
          ? "@echo off\r\necho 9.9.9\r\n"
          : "#!/bin/sh\necho 9.9.9\n",
      );
      if (process.platform !== "win32") await chmod(launcher, 0o755);
      delete process.env.BB_CLI;
      process.env.BB_CLI_DIR = launcherDir;

      const scriptDir = automationScriptDir(pluginDataDir, "auto_cli");
      await mkdir(scriptDir, { recursive: true });
      await writeFile(
        join(scriptDir, "script.mjs"),
        'console.log(`cli=${process.env.BB_CLI ?? ""}`);\n',
      );

      const result = await executeStoredScript({
        pluginDataDir,
        automationId: "auto_cli",
        runId: "run_cli",
        projectId: "proj_test",
        scriptFile: "script.mjs",
        interpreter: "node",
        timeoutMs: 10_000,
        workingDir: scriptDir,
        serverUrl: "http://127.0.0.1:38886",
      });

      expect(result.warning).toBeNull();
      const injected = /^cli=(.+)$/mu.exec(result.output)?.[1] ?? "";
      expect(injected).not.toBe("");
      expect(isAbsolute(injected)).toBe(true);
    } finally {
      if (previousCli === undefined) delete process.env.BB_CLI;
      else process.env.BB_CLI = previousCli;
      if (previousCliDir === undefined) delete process.env.BB_CLI_DIR;
      else process.env.BB_CLI_DIR = previousCliDir;
      await rm(launcherDir, { recursive: true, force: true });
      await rm(pluginDataDir, { recursive: true, force: true });
    }
  });
});

// bb-fork(windows): Git Bash descendants survive `taskkill /T`, so the runner must
// still resolve a timed-out run instead of waiting on the pipe they keep open.
describe.runIf(process.platform === "win32")(
  "Windows timeout with a lingering descendant",
  () => {
    it("resolves a timed-out script whose descendant holds stdout open", async () => {
      const pluginDataDir = await mkdtemp(join(tmpdir(), "bb-fork-timeout-"));
      const scriptDir = automationScriptDir(pluginDataDir, "auto_fork_timeout");
      await mkdir(scriptDir, { recursive: true });
      await writeFile(
        join(scriptDir, "script.sh"),
        "sleep 5 &\nprintf 'started\n'\nwait\n",
      );
      try {
        const result = await executeStoredScript({
          pluginDataDir,
          automationId: "auto_fork_timeout",
          runId: "run_fork_timeout",
          projectId: "proj_test",
          scriptFile: "script.sh",
          interpreter: "bash",
          timeoutMs: 500,
          workingDir: scriptDir,
          serverUrl: "http://127.0.0.1:38886",
        });
        expect(result.timedOut).toBe(true);
      } finally {
        await rm(pluginDataDir, { recursive: true, force: true });
      }
    }, 15_000);
  },
);
