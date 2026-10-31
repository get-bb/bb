import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { experimental_hostToolchain as hostToolchain } from "@get-bb/plugin-sdk/process";
import {
  managedPiInstallCommand,
  managedPiDirectory,
  managedPiEntry,
  managedPiExecutable,
} from "./managed-pi.js";
import { resolvePiProcessLaunch } from "./rpc-child.js";

let home: string;
let packageDir: string;
beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "pi-runtime-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  vi.stubEnv("BB_PI_BRIDGE_COMMAND", "");
  vi.spyOn(hostToolchain, "resolve").mockReturnValue(null);
  packageDir = path.join(
    managedPiDirectory(),
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
  );
  await mkdir(packageDir, { recursive: true });
  await writeFile(managedPiExecutable(), "launcher");
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(home, { recursive: true, force: true });
});

it("uses the manifest executable and bb runtime without a node or pi on PATH", async () => {
  const entry = path.join(packageDir, "new-cli.js");
  await writeFile(entry, "");
  await writeFile(
    path.join(packageDir, "package.json"),
    JSON.stringify({ bin: { pi: "new-cli.js" } }),
  );
  expect(resolvePiProcessLaunch(process.env)).toEqual({
    command: hostToolchain.node(),
    args: [entry],
  });
  expect(
    resolvePiProcessLaunch({
      ...process.env,
      BB_PI_BRIDGE_COMMAND: "custom-pi",
      BB_PI_BRIDGE_ARGS: '["custom"]',
    }),
  ).toEqual({ command: "custom-pi", args: ["custom"] });
});

it("rejects missing and escaped manifest executables", async () => {
  await writeFile(
    path.join(packageDir, "package.json"),
    JSON.stringify({ bin: { pi: "missing.js" } }),
  );
  expect(managedPiEntry()).toBeNull();
  await writeFile(path.join(packageDir, "..", "outside.js"), "");
  await writeFile(
    path.join(packageDir, "package.json"),
    JSON.stringify({ bin: { pi: "../outside.js" } }),
  );
  expect(managedPiEntry()).toBeNull();
});

it.skipIf(process.platform === "win32")(
  "runs the serialized installer and an AppImage launcher without leaking its sandbox sentinel",
  async () => {
    const runtime = process.execPath;
    const image = path.join(home, "bb's AppImage");
    await writeFile(
      image,
      `#!/bin/sh\ncase " $* " in *" --no-sandbox "*) ;; *) set -- --no-sandbox "$@";; esac\nexec '${runtime.replaceAll("'", "'\\''")}' "$@"\n`,
      { mode: 0o755 },
    );
    const npm = path.join(home, "npm-cli.cjs");
    await writeFile(
      npm,
      `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(path.join(packageDir, "package.json"))},JSON.stringify({bin:{pi:'cli.cjs'}}));fs.writeFileSync(${JSON.stringify(path.join(packageDir, "cli.cjs"))},'console.log(JSON.stringify(process.argv.slice(2)))');`,
    );
    vi.spyOn(hostToolchain, "bundledNpmCli").mockReturnValue(npm);
    vi.stubEnv("APPIMAGE", image);
    vi.stubGlobal("process", {
      ...process,
      platform: "linux",
      versions: { ...process.versions, electron: "fixture" },
    });
    const command = managedPiInstallCommand("@earendil-works/pi-coding-agent");
    await rm(managedPiExecutable());
    await promisify(execFile)(command.command, command.args);
    const result = await promisify(execFile)(
      managedPiExecutable(),
      ["--version", "with spaces"],
      { env: { PATH: "" } },
    );
    expect(JSON.parse(result.stdout)).toEqual(["--version", "with spaces"]);
  },
);
