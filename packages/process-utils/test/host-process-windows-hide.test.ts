import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const { launches } = vi.hoisted(() => ({
  launches: [] as Array<{ windowsHide: unknown }>,
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const record = (options: { windowsHide?: unknown }) => {
    launches.push({ windowsHide: options.windowsHide });
    return Object.assign(new EventEmitter(), { pid: 1 });
  };
  return {
    ...actual,
    fork: (_module: string, _args: string[], options: object) =>
      record(options),
    spawn: (_command: string, _args: string[], options: object) =>
      record(options),
    execFile: (
      _command: string,
      _args: string[],
      options: object,
      _callback: unknown,
    ) => record(options),
  };
});

const { execHostFileCallback, forkHostProcess, spawnHostProcess } =
  await import("../src/host-process.js");

const helpers = [
  {
    name: "forkHostProcess",
    launch: (options: { windowsHide?: boolean }) =>
      forkHostProcess("worker.js", [], { ...options, execPath: "node" }),
  },
  {
    name: "spawnHostProcess with a shell",
    launch: (options: { windowsHide?: boolean }) =>
      spawnHostProcess("echo", [], { ...options, shell: true }),
  },
  {
    name: "execHostFileCallback",
    launch: (options: { windowsHide?: boolean }) =>
      execHostFileCallback("node", [], options, () => {}),
  },
];

describe.each(helpers)("$name", ({ launch }) => {
  it("hides the Windows console unless the caller opts out", () => {
    launches.length = 0;
    launch({});
    launch({ windowsHide: false });
    expect(launches).toEqual([{ windowsHide: true }, { windowsHide: false }]);
  });
});
