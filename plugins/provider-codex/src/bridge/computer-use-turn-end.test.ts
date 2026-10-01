import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  computerUseTurnEndedCommand,
  computerUseTurnFromNotification,
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

describe("computerUseTurnEndedCommand", () => {
  let codexHome: string | null = null;

  afterEach(() => {
    if (codexHome !== null) rmSync(codexHome, { recursive: true, force: true });
    codexHome = null;
  });

  function installSkyClient(): string {
    codexHome = mkdtempSync(path.join(os.tmpdir(), "codex-home-"));
    const clientApp = path.join(
      codexHome,
      "computer-use",
      "Codex Computer Use.app",
      "Contents",
      "SharedSupport",
      "SkyComputerUseClient.app",
    );
    mkdirSync(clientApp, { recursive: true });
    return clientApp;
  }

  it("launches the Sky client through LaunchServices with the turn identity", () => {
    const clientApp = installSkyClient();
    const launch = computerUseTurnEndedCommand(
      {
        codexHome: codexHome!,
        codexThreadId: "thread-1",
        turnId: "turn-1",
        cwd: "/work",
      },
      "darwin",
    );
    expect(launch).toEqual({
      command: "/usr/bin/open",
      args: [
        "-n",
        "-g",
        "-a",
        clientApp,
        "--args",
        "turn-ended",
        '{"type":"agent-turn-complete","thread-id":"thread-1","turn-id":"turn-1","cwd":"/work","input-messages":[],"last-assistant-message":null}',
      ],
    });
  });

  it("does nothing when Computer Use is not installed or the host is not macOS", () => {
    installSkyClient();
    const turnEnd = {
      codexHome: codexHome!,
      codexThreadId: "thread-1",
      turnId: "turn-1",
      cwd: "/work",
    };
    expect(computerUseTurnEndedCommand(turnEnd, "linux")).toBeNull();
    expect(
      computerUseTurnEndedCommand(
        { ...turnEnd, codexHome: path.join(codexHome!, "missing") },
        "darwin",
      ),
    ).toBeNull();
  });
});
