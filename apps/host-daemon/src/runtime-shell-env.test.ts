import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path, { delimiter } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prepareRuntimeShellEnv,
  prepareWorkflowAgentShellEnv,
  resolveLocalBbExecutableDirectory,
} from "./runtime-shell-env.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(directoryPath);
  return directoryPath;
}

interface FakeCliPackageOptions {
  executablePath?: string;
  executable?: boolean;
  writeEntry?: boolean;
}

interface FakeCliPackage {
  cliEntryPath: string;
}

async function withPlatform<T>(
  platform: NodeJS.Platform,
  action: () => Promise<T>,
): Promise<T> {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    process,
    "platform",
  );
  if (!originalDescriptor) {
    throw new Error("Expected process.platform descriptor");
  }

  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });

  try {
    return await action();
  } finally {
    Object.defineProperty(process, "platform", originalDescriptor);
  }
}

async function createFakeCliPackage(
  options: FakeCliPackageOptions = {},
): Promise<FakeCliPackage> {
  const cliPackageRoot = await makeTempDir("bb-cli-package-");
  const executablePath = options.executablePath ?? "./dist/bin/bb";
  const cliEntryPath = path.resolve(cliPackageRoot, executablePath);

  if (options.writeEntry ?? true) {
    await fs.mkdir(path.dirname(cliEntryPath), { recursive: true });
    await fs.writeFile(
      cliEntryPath,
      "#!/usr/bin/env node\nprocess.stdout.write('bb')\n",
      { mode: options.executable ? 0o755 : 0o644 },
    );
    await fs.chmod(cliEntryPath, options.executable ? 0o755 : 0o644);
  }

  return {
    cliEntryPath,
  };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directoryPath) =>
        fs.rm(directoryPath, { recursive: true, force: true }),
      ),
  );
});

describe("resolveLocalBbExecutableDirectory", () => {
  it("returns the built CLI executable directory", async () => {
    const { cliEntryPath } = await createFakeCliPackage({
      executable: true,
    });

    await expect(
      resolveLocalBbExecutableDirectory({
        cliExecutablePath: cliEntryPath,
      }),
    ).resolves.toBe(path.dirname(cliEntryPath));
  });

  it("fails clearly when the built CLI entry is missing", async () => {
    const { cliEntryPath } = await createFakeCliPackage({
      writeEntry: false,
    });

    await expect(
      resolveLocalBbExecutableDirectory({
        cliExecutablePath: cliEntryPath,
      }),
    ).rejects.toThrow(
      `Missing built bb CLI entry at ${cliEntryPath}. Build @bb/cli before starting the host daemon.`,
    );
  });

  it("fails clearly when the built CLI entry is not executable", async () => {
    const { cliEntryPath } = await createFakeCliPackage({
      executable: false,
    });

    await expect(
      resolveLocalBbExecutableDirectory({
        cliExecutablePath: cliEntryPath,
      }),
    ).rejects.toThrow(
      `Resolved bb CLI entry is not executable: ${cliEntryPath}. Build @bb/cli before starting the host daemon.`,
    );
  });

  it("skips the execute-bit check on win32", async () => {
    const { cliEntryPath } = await createFakeCliPackage({
      executable: false,
    });

    await expect(
      withPlatform("win32", () =>
        resolveLocalBbExecutableDirectory({
          cliExecutablePath: cliEntryPath,
        }),
      ),
    ).resolves.toBe(path.dirname(cliEntryPath));
  });
});

describe("prepareRuntimeShellEnv", () => {
  it("prepends the configured bb executable directory to PATH", () => {
    expect(
      prepareRuntimeShellEnv({
        appsRootPath: "/tmp/bb-data/apps",
        bbExecutableDirectory: "/tmp/bb-bin",
        hostDaemonPort: 3002,
        inheritedPath: "/usr/bin",
        serverUrl: "http://127.0.0.1:3334",
      }),
    ).toEqual({
      PATH: `/tmp/bb-bin${delimiter}/usr/bin`,
      BB_APPS_ROOT: "/tmp/bb-data/apps",
      BB_SERVER_URL: "http://127.0.0.1:3334",
      BB_HOST_DAEMON_PORT: "3002",
    });
  });

  it("falls back to process.env.PATH when inheritedPath is omitted", () => {
    vi.stubEnv("PATH", "/usr/local/bin:/usr/bin");

    expect(
      prepareRuntimeShellEnv({
        appsRootPath: "/tmp/bb-data/apps",
        bbExecutableDirectory: "/tmp/bb-bin",
        hostDaemonPort: 3002,
        serverUrl: "http://127.0.0.1:3334",
      }),
    ).toEqual({
      PATH: `/tmp/bb-bin${delimiter}/usr/local/bin:/usr/bin`,
      BB_APPS_ROOT: "/tmp/bb-data/apps",
      BB_SERVER_URL: "http://127.0.0.1:3334",
      BB_HOST_DAEMON_PORT: "3002",
    });
  });

  it("omits the host daemon port when the local API is disabled", () => {
    expect(
      prepareRuntimeShellEnv({
        appsRootPath: "/tmp/bb-data/apps",
        bbExecutableDirectory: "/tmp/bb-bin",
        inheritedPath: "/usr/bin",
        serverUrl: "http://127.0.0.1:3334",
      }),
    ).toEqual({
      PATH: `/tmp/bb-bin${delimiter}/usr/bin`,
      BB_APPS_ROOT: "/tmp/bb-data/apps",
      BB_SERVER_URL: "http://127.0.0.1:3334",
    });
  });
});

describe("prepareWorkflowAgentShellEnv", () => {
  it("prepends the failing bb shim to the intact inherited PATH and carries no server coordinates", async () => {
    const shimDir = path.join(await makeTempDir("bb-wf-shim-"), "shim");
    // A toolchain directory that also exposes a foreign `bb` (e.g. Babashka):
    // it must stay on PATH — only the leading shim shadows the name.
    const toolchainDir = await makeTempDir("bb-wf-toolchain-");
    await fs.writeFile(path.join(toolchainDir, "bb"), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
    const inheritedPath = [toolchainDir, "/usr/bin"].join(delimiter);

    const env = await prepareWorkflowAgentShellEnv({
      appsRootPath: "/tmp/bb-data/apps",
      shimDirectoryPath: shimDir,
      inheritedPath,
    });

    expect(env).toEqual({
      PATH: `${shimDir}${delimiter}${inheritedPath}`,
      BB_APPS_ROOT: "/tmp/bb-data/apps",
    });
    // Both shim flavors are materialized (POSIX script + Windows bb.cmd).
    await expect(fs.stat(path.join(shimDir, "bb"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(shimDir, "bb.cmd"))).resolves.toBeDefined();
  });

  it("falls back to process.env.PATH when inheritedPath is omitted", async () => {
    const shimDir = path.join(await makeTempDir("bb-wf-shim-"), "shim");
    vi.stubEnv("PATH", "/usr/local/bin:/usr/bin");

    await expect(
      prepareWorkflowAgentShellEnv({
        appsRootPath: "/tmp/bb-data/apps",
        shimDirectoryPath: shimDir,
      }),
    ).resolves.toEqual({
      PATH: `${shimDir}${delimiter}/usr/local/bin:/usr/bin`,
      BB_APPS_ROOT: "/tmp/bb-data/apps",
    });
  });

  it.runIf(process.platform !== "win32")(
    "bb invocations resolve to the shim and fail fast with no side effects",
    async () => {
      // A "real" bb on the inherited PATH that would mint state if it ever ran.
      const realBbDir = await makeTempDir("bb-wf-real-");
      const sideEffectPath = path.join(realBbDir, "side-effect");
      await fs.writeFile(
        path.join(realBbDir, "bb"),
        `#!/bin/sh\ntouch "${sideEffectPath}"\nexit 0\n`,
        { mode: 0o755 },
      );
      const shimDir = path.join(await makeTempDir("bb-wf-shim-"), "shim");
      const env = await prepareWorkflowAgentShellEnv({
        appsRootPath: "/tmp/bb-data/apps",
        shimDirectoryPath: shimDir,
        inheritedPath: [realBbDir, "/usr/bin", "/bin"].join(delimiter),
      });

      // The no-nesting contract: a workflow agent shell running a nested bb
      // command (`bb thread spawn` / `bb workflow run`) fails fast...
      const result = await new Promise<{ code: number; stderr: string }>(
        (resolve) => {
          execFile(
            "/bin/sh",
            ["-c", "bb thread spawn nested-work"],
            { env: { PATH: env.PATH } },
            (error, _stdout, stderr) => {
              resolve({
                code:
                  error && typeof error.code === "number" ? error.code : 0,
                stderr,
              });
            },
          );
        },
      );
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain(
        "not available inside workflow agent sessions",
      );
      // ...and no real bb ever executed, so no thread/workflow-run state could
      // have been created (the row-level DB assertion rides M3's harness).
      await expect(fs.stat(sideEffectPath)).rejects.toThrow();
    },
  );
});
