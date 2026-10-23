import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { win32 } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { HostToolchain } from "../src/host-toolchain.js";

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn: vi.fn(),
}));
vi.mock("node:path", async (original) => {
  const module = await original<typeof import("node:path")>();
  return { ...module, ...module.win32 };
});

const platform = Object.getOwnPropertyDescriptor(process, "platform");

function registryChild(status: number, stdout: string): ChildProcess {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    kill: () => true,
  });
  setImmediate(() => {
    child.stdout.end(stdout);
    child.stdout.once("end", () => child.emit("close", status));
  });
  return child as unknown as ChildProcess;
}
afterEach(() => {
  if (platform) Object.defineProperty(process, "platform", platform);
  vi.resetAllMocks();
});

it("expands Windows registry PATH after collecting variables and removes duplicate aliases", async () => {
  Object.defineProperty(process, "platform", {
    value: "win32",
    configurable: true,
  });
  vi.mocked(spawn)
    .mockImplementationOnce(() =>
      registryChild(
        0,
        "    Path    REG_EXPAND_SZ    %SystemRoot%\\system32;C:\\Node\\;%JAVA_HOME%\\bin\r\n    JAVA_HOME    REG_SZ    C:\\Java\r\n",
      ),
    )
    .mockImplementationOnce(() =>
      registryChild(
        0,
        "    Path    REG_EXPAND_SZ    c:\\node;%TOOLS%\\bin\r\n    TOOLS    REG_EXPAND_SZ    %USERPROFILE%\\tools\r\n",
      ),
    );
  const env = {
    Path: "C:\\Windows\\system32;C:\\launcher",
    SystemRoot: "C:\\Windows",
    USERPROFILE: "C:\\Users\\me",
  };
  const toolchain = new HostToolchain(env, "C:\\missing-node.exe");
  await toolchain.refresh();
  const discovered = toolchain.environment();
  expect(discovered.Path).toBeUndefined();
  expect(discovered.PATH?.split(";").slice(0, 5)).toEqual([
    "C:\\Windows\\system32",
    "C:\\Node\\",
    "C:\\Java\\bin",
    "C:\\Users\\me\\tools\\bin",
    "C:\\launcher",
  ]);
  expect(vi.mocked(spawn).mock.calls[0]?.[0]).toBe(
    win32.join("C:\\Windows", "System32", "reg.exe"),
  );
});

it("retains a successful Windows PATH when registry discovery fails", async () => {
  Object.defineProperty(process, "platform", {
    value: "win32",
    configurable: true,
  });
  vi.mocked(spawn)
    .mockImplementationOnce(() =>
      registryChild(0, "    Path    REG_SZ    C:\\fresh-tools\r\n"),
    )
    .mockImplementation(() => registryChild(1, ""));
  const toolchain = new HostToolchain(
    { Path: "C:\\launcher" },
    "C:\\missing-node.exe",
  );
  await toolchain.refresh();
  await toolchain.refresh();
  expect(toolchain.environment().PATH?.split(";").slice(0, 2)).toEqual([
    "C:\\fresh-tools",
    "C:\\launcher",
  ]);
});
