import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProviderInstallationInProgressError,
  streamProviderInstallation,
  type ProviderInstallationProcess,
  type ProviderInstallationProcessSpawner,
} from "./provider-installation.js";

function fakeProcess(): Omit<
  ProviderInstallationProcess,
  "stdout" | "stderr"
> & {
  stdout: PassThrough;
  stderr: PassThrough;
  close(exitCode: number): void;
} {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let closeListener: ((exitCode: number | null, signal: null) => void) | null =
    null;
  return {
    stdout,
    stderr,
    kill: vi.fn(() => true),
    onError: vi.fn(),
    onClose(listener) {
      closeListener = listener;
    },
    close(exitCode) {
      stdout.end();
      stderr.end();
      closeListener?.(exitCode, null);
    },
  };
}

async function readEvents(stream: ReadableStream<Uint8Array>) {
  const text = await new Response(stream).text();
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("streamProviderInstallation", () => {
  it("executes the provider plan and streams process output", async () => {
    const process = fakeProcess();
    const spawner: ProviderInstallationProcessSpawner = {
      spawn: vi.fn(() => process),
    };
    const stream = streamProviderInstallation({
      providerId: "example-provider",
      plan: {
        command: "example",
        args: ["upgrade"],
        displayCommand: "example upgrade",
      },
      processSpawner: spawner,
    });
    process.stdout.write("working\n");
    process.close(0);

    await expect(readEvents(stream)).resolves.toEqual([
      {
        type: "started",
        provider: "example-provider",
        command: "example upgrade",
      },
      {
        type: "output",
        provider: "example-provider",
        stream: "stdout",
        text: "working\n",
      },
      {
        type: "completed",
        provider: "example-provider",
        exitCode: 0,
        signal: null,
        success: true,
      },
    ]);
    expect(spawner.spawn).toHaveBeenCalledWith({
      command: "example",
      args: ["upgrade"],
    });
  });

  it("allows only one installation process at a time", async () => {
    const firstProcess = fakeProcess();
    const first = streamProviderInstallation({
      providerId: "first",
      plan: { command: "one", args: [], displayCommand: "one" },
      processSpawner: { spawn: () => firstProcess },
    });
    expect(() =>
      streamProviderInstallation({
        providerId: "second",
        plan: { command: "two", args: [], displayCommand: "two" },
        processSpawner: { spawn: () => fakeProcess() },
      }),
    ).toThrow(ProviderInstallationInProgressError);
    firstProcess.close(0);
    await readEvents(first);

    const secondProcess = fakeProcess();
    const second = streamProviderInstallation({
      providerId: "second",
      plan: { command: "two", args: [], displayCommand: "two" },
      processSpawner: { spawn: () => secondProcess },
    });
    secondProcess.close(0);
    await readEvents(second);
  });
});

describe("streamProviderInstallation with node-pty", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  async function scratchBin(): Promise<{ root: string; binDir: string }> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bb-provider-cli-"));
    tempDirs.push(root);
    const binDir = path.join(root, "Program Files", "Example CLI");
    await fs.mkdir(binDir, { recursive: true });
    return { root, binDir };
  }

  function envWithPath(
    binDir: string,
    extra: NodeJS.ProcessEnv = {},
  ): NodeJS.ProcessEnv {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => key.toUpperCase() !== "PATH",
      ),
    );
    return {
      ...env,
      ...extra,
      PATH: [binDir, process.env.PATH ?? process.env.Path ?? ""].join(
        path.delimiter,
      ),
    };
  }

  async function runPlan(env: NodeJS.ProcessEnv, command = "example-cli") {
    const events = await readEvents(
      streamProviderInstallation({
        providerId: "example-provider",
        plan: {
          command,
          args: ["update"],
          displayCommand: `${command} update`,
        },
        env,
      }),
    );
    const output = events
      .filter((event) => event.type === "output")
      .map((event) => event.text)
      .join("")
      .replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, "");
    return { events, output };
  }

  it.runIf(process.platform !== "win32")(
    "launches a bare command found on PATH",
    async () => {
      const { binDir } = await scratchBin();
      await fs.writeFile(
        path.join(binDir, "example-cli"),
        '#!/bin/sh\necho "example-cli $*"\n',
        { mode: 0o755 },
      );

      const { events, output } = await runPlan(envWithPath(binDir));

      expect(output).toContain("example-cli update");
      expect(events.at(-1)).toMatchObject({ type: "completed", success: true });
    },
  );

  it.runIf(process.platform === "win32")(
    "launches a .cmd shim instead of the extensionless npm shim",
    async () => {
      const { binDir } = await scratchBin();
      await fs.writeFile(
        path.join(binDir, "example-cli"),
        '#!/bin/sh\nexec node "$basedir/cli.js" "$@"\n',
      );
      await fs.writeFile(
        path.join(binDir, "example-cli.cmd"),
        "@echo off\r\necho example-cli-cmd %*\r\n",
      );

      const { events, output } = await runPlan(envWithPath(binDir));

      expect(output).toContain('example-cli-cmd "update"');
      expect(events.at(-1)).toMatchObject({ type: "completed", success: true });
    },
  );

  it.runIf(process.platform === "win32")(
    "launches a native .exe found on PATH",
    async () => {
      const { root, binDir } = await scratchBin();
      await fs.copyFile(process.execPath, path.join(binDir, "example-cli.exe"));
      const preload = path.join(root, "preload.cjs");
      await fs.writeFile(
        preload,
        'console.log(`example-cli-exe ${require("node:path").basename(process.argv[1])}`);\nprocess.exit(0);\n',
      );

      const { events, output } = await runPlan(
        envWithPath(binDir, {
          NODE_OPTIONS: `--require "${preload.replaceAll("\\", "/")}"`,
        }),
      );

      expect(output).toContain("example-cli-exe update");
      expect(events.at(-1)).toMatchObject({ type: "completed", success: true });
    },
  );

  it("reports a command missing from PATH", async () => {
    const { binDir } = await scratchBin();

    const { events } = await runPlan(envWithPath(binDir), "missing-cli");

    expect(events.at(-1)).toEqual({
      type: "error",
      provider: "example-provider",
      message: "Command not found: missing-cli",
    });
  });
});
