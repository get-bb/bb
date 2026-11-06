import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertScriptProcessTreeStopped,
  buildLifecycleScriptCommand,
  LifecycleScriptTerminationUnverifiedError,
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
      const workspacePath = await workspace(
        kind,
        'cat >/dev/null\nprintf complete > marker\nprintf "\\342"\nsleep 0.05\nprintf "\\234\\223\\n"\nprintf "done\\n" >&2\n',
      );
      const output: string[] = [];
      const run = kind === "setup" ? runSetupScript : runTeardownScript;
      const result = await run({
        workspacePath,
        timeoutMs: 1000,
        env:
          process.platform === "win32"
            ? process.env
            : { PATH: "/usr/bin:/bin" },
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
    const workspacePath = await workspace(
      "setup",
      "{ pwd -W 2>/dev/null || pwd; } > marker\nprintf 'first\\rsecond\\n'\necho stderr >&2\n",
    );
    const output: string[] = [];
    await runSetupScript({
      workspacePath,
      timeoutMs: 5000,
      onProgress: (entry) => output.push(entry.text),
    });
    expect(
      (await readFile(join(workspacePath, "marker"), "utf8"))
        .trim()
        .replaceAll("/", sep),
    ).toBe(await realpath(workspacePath));
    expect(output).toContain("second");
    expect(output).toContain("stderr");
    expect(output).toContain("Running .bb-env-setup.sh");
  });

  it("surfaces output before setup failure", async () => {
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

  it.runIf(process.platform === "win32")(
    "stops the programs Git Bash started when a Windows hook is cancelled",
    async () => {
      const workspacePath = await workspace(
        "setup",
        [
          "sleep 120 &",
          "sleeper=$!",
          'node -e "setTimeout(() => {}, 120000)" &',
          "native=$!",
          "sleep 1",
          'read -r sleeper_winpid <"/proc/$sleeper/winpid"',
          'read -r native_winpid <"/proc/$native/winpid"',
          'echo "pids $sleeper_winpid $native_winpid"',
          "wait",
          "",
        ].join("\n"),
      );
      const controller = new AbortController();
      let pids: number[] = [];
      await expect(
        runSetupScript({
          workspacePath,
          timeoutMs: 15_000,
          signal: controller.signal,
          onProgress: (entry) => {
            if (!entry.text.startsWith("pids ")) return;
            pids = entry.text.split(" ").slice(1).map(Number);
            controller.abort();
          },
        }),
      ).rejects.toThrow("cancelled");
      expect(pids).toHaveLength(2);
      const alive = pids.filter((pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      });
      expect(alive).toEqual([]);
    },
    20_000,
  );

  it("accepts a stopped script only when its whole process tree is confirmed gone", async () => {
    await expect(
      assertScriptProcessTreeStopped(undefined, ".bb-env-setup.sh"),
    ).resolves.toBeUndefined();
    await expect(
      assertScriptProcessTreeStopped(
        Promise.resolve({ treeTermination: "confirmed" }),
        ".bb-env-setup.sh",
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertScriptProcessTreeStopped(
        Promise.resolve({ treeTermination: "unverified" }),
        ".bb-env-setup.sh",
      ),
    ).rejects.toBeInstanceOf(LifecycleScriptTerminationUnverifiedError);
    await expect(
      assertScriptProcessTreeStopped(
        Promise.reject(new Error("Process did not exit after termination")),
        ".bb-env-teardown.sh",
      ),
    ).rejects.toThrow(
      ".bb-env-teardown.sh was stopped, but bb could not confirm that all of its processes exited",
    );
  });

  it("runs hooks on Windows with the bash that Git installs", () => {
    expect(
      buildLifecycleScriptCommand({
        kind: "setup",
        scriptName: ".bb-env-setup.sh",
        platform: "win32",
        scriptPath: "C:\\src\\repo\\.bb-env-setup.sh",
        windowsBashPath: "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
      }),
    ).toEqual({
      command: "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
      args: ["C:\\src\\repo\\.bb-env-setup.sh"],
      text: "bash .bb-env-setup.sh",
      pathPrefix: ["C:\\Program Files\\Git\\usr\\bin"],
    });
  });

  it("names Git for Windows when no bash is available", () => {
    expect(() =>
      buildLifecycleScriptCommand({
        kind: "teardown",
        scriptName: ".bb-env-teardown.sh",
        platform: "win32",
        scriptPath: "C:\\src\\repo\\.bb-env-teardown.sh",
        windowsBashPath: null,
      }),
    ).toThrow(".bb-env-teardown.sh needs Git for Windows");
  });

  it("skips absent scripts", async () => {
    const workspacePath = await workspace("setup", "exit 0\n");
    await expect(
      runTeardownScript({ workspacePath, timeoutMs: 5000 }),
    ).resolves.toEqual({ ran: false });
  });
});
