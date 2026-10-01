import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  computerUseTurnEndedJob,
  computerUseTurnFromNotification,
  resolveCodexNativeExecutable,
} from "./computer-use-turn-end.js";

function mcpToolCallStarted(server: string): Record<string, unknown> {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    startedAtMs: 1,
    item: {
      type: "mcpToolCall",
      id: "call-1",
      server,
      tool: "js",
      status: "inProgress",
      arguments: { code: "await cua.getApp('Calculator')" },
    },
  };
}

describe("computerUseTurnFromNotification", () => {
  it.each(["cua_repl", "computer-use"])(
    "marks the turn when a %s tool call starts",
    (server) => {
      expect(
        computerUseTurnFromNotification(
          "item/started",
          mcpToolCallStarted(server),
        ),
      ).toEqual({ codexThreadId: "thread-1", turnId: "turn-1" });
    },
  );

  it("ignores other MCP servers and other lifecycle methods", () => {
    expect(
      computerUseTurnFromNotification(
        "item/started",
        mcpToolCallStarted("groundcover"),
      ),
    ).toBeNull();
    expect(
      computerUseTurnFromNotification(
        "item/completed",
        mcpToolCallStarted("cua_repl"),
      ),
    ).toBeNull();
  });
});

describe("computerUseTurnEndedJob", () => {
  it("runs the Sky client under an unsandboxed native Codex with the turn identity", () => {
    expect(
      computerUseTurnEndedJob(
        {
          codexHome: "/home/u/.codex",
          codexThreadId: "thread-1",
          turnId: "turn-1",
          cwd: "/work",
        },
        "/opt/homebrew/Caskroom/codex/0.159.2/codex-aarch64-apple-darwin",
      ),
    ).toEqual({
      label: "dev.bb.codex-computer-use-turn-ended.turn-1",
      argv: [
        "/opt/homebrew/Caskroom/codex/0.159.2/codex-aarch64-apple-darwin",
        "sandbox",
        "-c",
        'sandbox_mode="danger-full-access"',
        "--",
        "/home/u/.codex/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient",
        "turn-ended",
        '{"type":"agent-turn-complete","thread-id":"thread-1","turn-id":"turn-1","cwd":"/work","input-messages":[],"last-assistant-message":null}',
      ],
    });
  });
});

describe("resolveCodexNativeExecutable", () => {
  let root: string | null = null;

  afterEach(() => {
    if (root !== null) rmSync(root, { recursive: true, force: true });
    root = null;
  });

  function writeExecutable(
    filePath: string,
    contents: Buffer | string,
  ): string {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, contents);
    chmodSync(filePath, 0o755);
    return filePath;
  }

  const machO = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]);

  it("returns a native Codex binary as is", async () => {
    const dir = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "codex-native-")),
    );
    root = dir;
    const binary = writeExecutable(path.join(dir, "codex"), machO);
    await expect(resolveCodexNativeExecutable(binary)).resolves.toBe(binary);
  });

  it("follows the npm launcher to its vendored native binary", async () => {
    const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "codex-npm-")));
    root = dir;
    const launcher = writeExecutable(
      path.join(dir, "node_modules", "@openai", "codex", "bin", "codex.js"),
      "#!/usr/bin/env node\n",
    );
    const vendored = writeExecutable(
      path.join(
        dir,
        "node_modules",
        "@openai",
        "codex-darwin-arm64",
        "vendor",
        "aarch64-apple-darwin",
        "codex",
        "codex",
      ),
      machO,
    );
    writeFileSync(
      path.join(
        dir,
        "node_modules",
        "@openai",
        "codex-darwin-arm64",
        "package.json",
      ),
      '{"name":"@openai/codex-darwin-arm64"}',
    );
    await expect(resolveCodexNativeExecutable(launcher, "arm64")).resolves.toBe(
      vendored,
    );
  });

  it("returns null for a launcher without a native binary", async () => {
    const dir = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "codex-script-")),
    );
    root = dir;
    const script = writeExecutable(
      path.join(dir, "bin", "codex"),
      "#!/bin/sh\n",
    );
    await expect(
      resolveCodexNativeExecutable(script, "arm64"),
    ).resolves.toBeNull();
  });
});
