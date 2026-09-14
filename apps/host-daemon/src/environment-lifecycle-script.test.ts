import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ENV_SETUP_SCRIPT_NAME,
  DEFAULT_ENV_TEARDOWN_SCRIPT_NAME,
} from "@bb/domain";
import {
  buildLifecycleScriptCommand,
  runSetupScript,
  runTeardownScript,
} from "./environment-lifecycle-script.js";

const directories: string[] = [];
async function workspace(
  kind: "setup" | "teardown",
  script: string,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "bb-core-hooks-"));
  directories.push(directory);
  await writeFile(join(directory, `.bb-env-${kind}.sh`), script);
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("core environment scripts", () => {
  it.each(["setup", "teardown"] as const)(
    "supplies stdin EOF so %s continues to completion",
    async (kind) => {
      if (process.platform === "win32") {
        return;
      }
      const workspacePath = await workspace(
        kind,
        'cat >/dev/null\nprintf complete > marker\nprintf "\\342"\nsleep 0.05\nprintf "\\234\\223\\n"\nprintf "done\\n" >&2\n',
      );
      const output: string[] = [];
      const run = kind === "setup" ? runSetupScript : runTeardownScript;
      const result = await run({
        workspacePath,
        timeoutMs: 1000,
        env: { PATH: "/usr/bin:/bin" },
        onProgress: (entry) => output.push(entry.text),
      });
      expect(result).toEqual({ ran: true });
      expect(await readFile(join(workspacePath, "marker"), "utf8")).toBe(
        "complete",
      );
      expect(output).toContain("✓");
      expect(output).toContain("done");
    },
  );

  it("runs in the environment directory and streams stdout and stderr", async () => {
    if (process.platform === "win32") {
      return;
    }
    const workspacePath = await workspace(
      "setup",
      "pwd > marker\nprintf 'first\\rsecond\\n'\necho stderr >&2\n",
    );
    const output: string[] = [];
    await runSetupScript({
      workspacePath,
      timeoutMs: 5000,
      onProgress: (entry) => output.push(entry.text),
    });
    expect((await readFile(join(workspacePath, "marker"), "utf8")).trim()).toBe(
      await realpath(workspacePath),
    );
    expect(output).toContain("second");
    expect(output).toContain("stderr");
    expect(output).toContain("Running .bb-env-setup.sh");
  });

  it("surfaces output before setup failure", async () => {
    if (process.platform === "win32") {
      return;
    }
    const workspacePath = await workspace(
      "setup",
      "echo failed-details >&2\nexit 7\n",
    );
    const output: string[] = [];
    await expect(
      runSetupScript({
        workspacePath,
        timeoutMs: 5000,
        onProgress: (entry) => output.push(entry.text),
      }),
    ).rejects.toThrow("exit code 7");
    expect(output).toContain("failed-details");
  });

  it.each(["setup", "teardown"] as const)(
    "enforces the %s timeout",
    async (kind) => {
      if (process.platform === "win32") {
        return;
      }
      const workspacePath = await workspace(
        kind,
        "echo before-timeout\nsleep 120\n",
      );
      const output: string[] = [];
      const run = kind === "setup" ? runSetupScript : runTeardownScript;
      const result = run({
        workspacePath,
        timeoutMs: 100,
        onProgress: (entry) => output.push(entry.text),
      });
      if (kind === "setup")
        await expect(result).rejects.toThrow("timed out after 100ms");
      else {
        await expect(result).resolves.toEqual({ ran: true });
        expect(output.join("\n")).toContain("timed out after 100ms");
      }
    },
  );

  it("reports teardown failure without rejecting removal", async () => {
    if (process.platform === "win32") {
      return;
    }
    const workspacePath = await workspace(
      "teardown",
      "echo teardown-details\nexit 9\n",
    );
    const output: string[] = [];
    await expect(
      runTeardownScript({
        workspacePath,
        timeoutMs: 5000,
        onProgress: (entry) => output.push(entry.text),
      }),
    ).resolves.toEqual({ ran: true });
    expect(output.join("\n")).toContain("exit code 9");
    expect(output).toContain("teardown-details");
  });

  it("cancels a running setup before returning to cleanup", async () => {
    if (process.platform === "win32") {
      return;
    }
    const workspacePath = await workspace("setup", "echo started\nsleep 120\n");
    const controller = new AbortController();
    await expect(
      runSetupScript({
        workspacePath,
        timeoutMs: 5000,
        signal: controller.signal,
        onProgress: (entry) => {
          if (entry.text === "started") controller.abort();
        },
      }),
    ).rejects.toThrow("cancelled");
  });

  it("builds a PowerShell command for Windows lifecycle scripts", () => {
    expect(
      buildLifecycleScriptCommand({
        kind: "setup",
        scriptName: ".bb-env-setup.ps1",
        platform: "win32",
        scriptPath: "C:\\repo\\.bb-env-setup.ps1",
      }),
    ).toMatchObject({
      command: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        "C:\\repo\\.bb-env-setup.ps1",
      ],
      text: "powershell.exe -NoProfile -ExecutionPolicy Bypass -File .bb-env-setup.ps1",
    });
  });

  it("warns when only the POSIX setup hook exists on Windows", async () => {
    const workspacePath = await workspace("setup", "echo ignored\n");
    const output: string[] = [];
    const result = await runSetupScript({
      workspacePath,
      timeoutMs: 900000,
      platform: "win32",
      onProgress: (entry) => output.push(`${entry.type}:${entry.text}`),
    });
    expect(result).toEqual({ ran: false });
    expect(output).toContain(
      `output:${DEFAULT_ENV_SETUP_SCRIPT_NAME} is ignored on Windows; use .bb-env-setup.ps1 instead`,
    );
  });

  it("warns when only the POSIX teardown hook exists on Windows", async () => {
    const workspacePath = await workspace("teardown", "echo ignored\n");
    const output: string[] = [];
    const result = await runTeardownScript({
      workspacePath,
      timeoutMs: 900000,
      platform: "win32",
      onProgress: (entry) => output.push(`${entry.type}:${entry.text}`),
    });
    expect(result).toEqual({ ran: false });
    expect(output).toContain(
      `output:${DEFAULT_ENV_TEARDOWN_SCRIPT_NAME} is ignored on Windows; use .bb-env-teardown.ps1 instead`,
    );
  });

  it("skips absent scripts", async () => {
    const workspacePath = await workspace("setup", "exit 0\n");
    await expect(
      runTeardownScript({ workspacePath, timeoutMs: 5000 }),
    ).resolves.toEqual({ ran: false });
  });
});
