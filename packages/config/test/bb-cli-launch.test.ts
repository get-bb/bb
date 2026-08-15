import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bbCliLaunchSpec,
  bbCliLaunchSpecFromPath,
  isNodeExecutablePath,
  spawnArgv,
} from "../src/bb-cli-launch.js";

describe("bbCliLaunchSpec", () => {
  it("points Node at the JS bundle on win32", () => {
    const spec = bbCliLaunchSpec("/tmp/bb-bin", "win32");
    expect(spec.jsEntryPath.replaceAll("\\", "/")).toMatch(/\/bb$/);
    expect(spec.jsEntryPath.endsWith(".cmd")).toBe(false);
    expect(spec.shellPath.replaceAll("\\", "/")).toMatch(/\/bb\.cmd$/);
  });

  it("uses the same path for shell and JS on posix", () => {
    const spec = bbCliLaunchSpec("/tmp/bb-bin", "linux");
    expect(spec.jsEntryPath).toBe(join("/tmp/bb-bin", "bb"));
    expect(spec.shellPath).toBe(spec.jsEntryPath);
  });
});

describe("spawnArgv", () => {
  it("spawns process.execPath plus the JS entry", () => {
    const spec = bbCliLaunchSpec("/tmp/bb-bin", "win32");
    const argv = spawnArgv(spec, ["--version"]);
    expect(argv.command).toBe(process.execPath);
    expect(argv.args[0]).toBe(spec.jsEntryPath);
    expect(argv.args[1]).toBe("--version");
  });
});

describe("bbCliLaunchSpecFromPath", () => {
  it("treats a .cmd as the shell sibling of bb", () => {
    const spec = bbCliLaunchSpecFromPath(join("C:\\bb", "bb.cmd"), "win32");
    expect(spec.jsEntryPath.replaceAll("\\", "/")).toMatch(/\/bb$/);
    expect(spec.shellPath.replaceAll("\\", "/")).toMatch(/\/bb\.cmd$/);
  });
});

describe("isNodeExecutablePath", () => {
  it("recognizes node.exe", () => {
    expect(isNodeExecutablePath("C:\\Program Files\\nodejs\\node.exe")).toBe(
      true,
    );
    expect(isNodeExecutablePath("/usr/bin/node")).toBe(true);
    expect(isNodeExecutablePath(join("/tmp/bb-bin", "bb.cmd"))).toBe(false);
  });
});
