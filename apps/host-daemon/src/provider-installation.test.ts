import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
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
