import {
  mkdir,
  mkdtemp,
  realpath,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PiRpcChild,
  resolvePiLaunch,
  resolvePiProcessLaunch,
} from "./rpc-child.js";
import { resolvePiNpmShim } from "./windows-pi-launch.js";
import { npmNodeShim } from "./npm-shim.test-support.js";

const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(
  bin: unknown = { pi: "dist/cli.cjs" },
  layout: "global" | "local" = "global",
) {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "bb pi launch-")),
  );
  directories.push(root);
  const nodeModules = path.join(root, "node_modules");
  const pkg = path.join(nodeModules, "@earendil-works", "pi-coding-agent");
  const shimDirectory =
    layout === "local" ? path.join(nodeModules, ".bin") : root;
  await mkdir(path.join(pkg, "dist"), { recursive: true });
  await mkdir(shimDirectory, { recursive: true });
  const cli = path.join(pkg, "dist", "cli.cjs");
  await writeFile(cli, "");
  await writeFile(path.join(pkg, "package.json"), JSON.stringify({ bin }));
  const shim = path.join(shimDirectory, "pi.cmd");
  const cliPath =
    layout === "local"
      ? "..\\@earendil-works\\pi-coding-agent\\dist\\cli.cjs"
      : "node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.cjs";
  await writeFile(shim, npmNodeShim(cliPath));
  await writeFile(path.join(shimDirectory, "pi"), "#!/bin/sh\nexit 1\n");
  return { root, pkg, cli, shim, shimDirectory };
}

describe("Windows Pi npm launch", () => {
  it.each([{ pi: "dist/cli.cjs" }, "dist/cli.cjs"])(
    "unwraps bin %j with fallback Node and spaces",
    async (bin) => {
      const { shim, cli } = await fixture(bin);
      expect(resolvePiNpmShim(shim, process.execPath)).toEqual({
        command: process.execPath,
        args: [cli],
      });
    },
  );

  it.each([{ pi: "dist/cli.cjs" }, "dist/cli.cjs"])(
    "unwraps local .bin layout with bin %j",
    async (bin) => {
      const { shim, cli } = await fixture(bin, "local");
      expect(resolvePiNpmShim(shim, process.execPath)).toEqual({
        command: process.execPath,
        args: [cli],
      });
    },
  );

  it("prefers sibling Node", async () => {
    const { root, shim, cli } = await fixture();
    const node = path.join(root, "node.exe");
    await writeFile(node, "");
    expect(resolvePiNpmShim(shim, process.execPath)).toEqual({
      command: node,
      args: [cli],
    });
  });

  it.each(["modern", "legacy"] as const)(
    "accepts the %s npm template and LF line endings",
    async (template) => {
      const { shim, cli, shimDirectory } = await fixture();
      const target = path
        .relative(shimDirectory, cli)
        .split(path.sep)
        .join("\\");
      await writeFile(
        shim,
        npmNodeShim(target, template).replace(/\r\n/g, "\n"),
      );
      expect(resolvePiNpmShim(shim, process.execPath)).toEqual({
        command: process.execPath,
        args: [cli],
      });
    },
  );

  it.each(["set POLICY=required", "node custom-dispatcher.cjs %*"])(
    "preserves a custom pi.cmd with %s beside a valid Pi package",
    async (command) => {
      const { shim } = await fixture();
      const contents = await readFile(shim, "utf8");
      await writeFile(shim, command + "\r\n" + contents);
      expect(resolvePiNpmShim(shim, process.execPath)).toBeNull();
    },
  );

  it("preserves native executables and non-cmd wrappers", async () => {
    const { root } = await fixture();
    for (const name of ["pi.exe", "pi.bat", "pi", "unrelated.cmd"]) {
      expect(
        resolvePiNpmShim(path.join(root, name), process.execPath),
      ).toBeNull();
    }
  });

  it.each([
    {},
    { pi: 42 },
    "",
    "dist/missing.cjs",
    "dist",
    "../../outside.cjs",
  ])("rejects invalid bin %j", async (bin) => {
    const { pkg, shim } = await fixture(bin);
    await writeFile(path.resolve(pkg, "../../outside.cjs"), "");
    expect(resolvePiNpmShim(shim, process.execPath)).toBeNull();
  });

  it.each(["malformed", "missing"])(
    "preserves a shim with %s package metadata",
    async (kind) => {
      const { pkg, shim } = await fixture();
      const manifest = path.join(pkg, "package.json");
      if (kind === "missing") await rm(manifest);
      else await writeFile(manifest, "{");
      expect(resolvePiNpmShim(shim, process.execPath)).toBeNull();
    },
  );

  it("preserves explicit commands, arguments, and argument validation", () => {
    expect(
      resolvePiLaunch({
        BB_PI_BRIDGE_COMMAND: "pi",
        BB_PI_BRIDGE_ARGS: '["--flag","value with spaces"]',
      }),
    ).toEqual({ command: "pi", args: ["--flag", "value with spaces"] });
    expect(resolvePiLaunch({ BB_PI_BRIDGE_COMMAND: "custom-pi" })).toEqual({
      command: "custom-pi",
      args: [],
    });
    expect(() =>
      resolvePiLaunch({ BB_PI_BRIDGE_COMMAND: "pi", BB_PI_BRIDGE_ARGS: "[1]" }),
    ).toThrow("must be a JSON array of strings");
  });

  it("keeps default configuration independent from process resolution", () => {
    expect(resolvePiLaunch({ BB_PI_BRIDGE_ARGS: "invalid" })).toEqual({
      command: "pi",
      args: [],
    });
    expect(() =>
      resolvePiLaunch({
        BB_PI_BRIDGE_COMMAND: "pi",
        BB_PI_BRIDGE_ARGS: "invalid",
      }),
    ).toThrow();
  });

  it.skipIf(process.platform === "win32")(
    "preserves non-Windows process launches",
    () => {
      expect(resolvePiProcessLaunch({})).toEqual({ command: "pi", args: [] });
    },
  );

  it("rejects a bin symlink escaping the package", async () => {
    const { root, pkg, shim } = await fixture({ pi: "dist/escape/cli.cjs" });
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "cli.cjs"), "");
    await symlink(outside, path.join(pkg, "dist", "escape"), "junction");
    expect(resolvePiNpmShim(shim, "node")).toBeNull();
  });

  it.skipIf(process.platform !== "win32")(
    "resolves Path/PATHEXT with cwd precedence",
    async () => {
      const first = await fixture();
      const second = await fixture();
      expect(
        resolvePiProcessLaunch(
          {},
          { Path: second.root, PATHEXT: ".CMD" },
          first.root,
        ),
      ).toEqual({ command: "node", args: [first.cli] });
      const node = path.join(second.root, "node.exe");
      await writeFile(node, "");
      const childEnv = { Path: second.root, PATHEXT: ".EXE;.CMD" };
      expect(
        resolvePiProcessLaunch({ Path: first.root }, childEnv, first.pkg),
      ).toEqual({ command: node, args: [second.cli] });
      expect(
        resolvePiProcessLaunch(
          {
            BB_PI_BRIDGE_COMMAND: first.shim,
            BB_PI_BRIDGE_ARGS: '["--flag","value with spaces"]',
          },
          childEnv,
          first.pkg,
        ),
      ).toEqual({
        command: node,
        args: [first.cli, "--flag", "value with spaces"],
      });
      expect(resolvePiProcessLaunch({}, {}, first.pkg)).toEqual({
        command: "pi",
        args: [],
      });
      await writeFile(path.join(second.root, "unrelated.cmd"), "");
      expect(
        resolvePiProcessLaunch(
          { BB_PI_BRIDGE_COMMAND: "unrelated.cmd" },
          childEnv,
          first.pkg,
        ),
      ).toEqual({ command: "unrelated.cmd", args: [] });
      await writeFile(
        first.shim,
        `${npmNodeShim("node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.cjs").trim()}\r\nset POLICY=required\r\nnode custom-dispatcher.cjs %*\r\n`,
      );
      expect(
        resolvePiProcessLaunch(
          {
            BB_PI_BRIDGE_COMMAND: "pi",
            BB_PI_BRIDGE_ARGS: '["--flag","value with spaces"]',
          },
          { Path: first.root, PATHEXT: ".CMD" },
          first.pkg,
        ),
      ).toEqual({
        command: "pi",
        args: ["--flag", "value with spaces"],
      });
    },
  );

  it.skipIf(process.platform !== "win32").each(["global", "local"] as const)(
    "round-trips RPC and extra pipes through the default real launcher with a %s shim",
    async (layout) => {
      const { pkg, cli, shimDirectory } = await fixture(
        { pi: "dist/cli.cjs" },
        layout,
      );
      await writeFile(
        cli,
        `
const { Socket } = require("node:net");
const { writeSync } = require("node:fs");
const { createInterface } = require("node:readline");
createInterface({ input: process.stdin }).on("line", line => {
  const request = JSON.parse(line);
  process.stdout.write(JSON.stringify({ type: "response", id: request.id, command: request.type, success: true, data: request.payload }) + "\\n");
});
createInterface({ input: new Socket({ fd: 4, readable: true, writable: false }) }).on("line", line => {
  writeSync(3, JSON.stringify({ type: "channel_reply", payload: JSON.parse(line).payload }) + "\\n");
});
`,
      );
      vi.stubEnv("BB_PI_BRIDGE_COMMAND", undefined);
      vi.stubEnv("BB_PI_BRIDGE_ARGS", undefined);
      const env = { ...process.env };
      for (const key of Object.keys(env)) {
        if (["PATH", "PATHEXT"].includes(key.toUpperCase())) delete env[key];
      }
      env.Path = `${shimDirectory}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ""}`;
      env.PATHEXT = ".COM;.EXE;.BAT;.CMD";
      const messages: Record<string, unknown>[] = [];
      const child = new PiRpcChild({
        cwd: pkg,
        env,
        args: [],
        recordThreadId: null,
        onEvent: () => undefined,
        onChannelMessage: (message) => messages.push(message),
        onExit: () => undefined,
      });
      try {
        expect(
          await child.requestOk(
            { type: "echo", payload: "ordinary RPC" },
            5_000,
          ),
        ).toBe("ordinary RPC");
        child.sendChannel({ type: "echo", payload: "extra pipes" });
        await vi.waitFor(
          () =>
            expect(messages).toEqual([
              { type: "channel_reply", payload: "extra pipes" },
            ]),
          { timeout: 5_000 },
        );
      } finally {
        child.kill();
        await child.waitForExit();
      }
    },
    20_000,
  );
});
