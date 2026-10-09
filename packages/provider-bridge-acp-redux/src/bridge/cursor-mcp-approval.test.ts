import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  approveCursorSessionMcpServer,
  buildCursorMcpApprovalIdentifier,
  revokeCursorSessionMcpServer,
} from "./cursor-mcp-approval.js";
import type { AcpMcpServerConfig } from "./tool-proxy-mcp.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(path);
  return path;
}

function mcpConfig(threadId = "thread-1"): AcpMcpServerConfig {
  return {
    name: "bb-bridge",
    command: "/usr/local/bin/node",
    args: ["/app/bridge.js", "--mcp-stdio"],
    env: [
      { name: "BB_TOKEN", value: "secret" },
      { name: "BB_THREAD", value: threadId },
    ],
  };
}

afterEach(() => {
  for (const path of tempDirs.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("Cursor ACP session MCP approvals", () => {
  it("matches Cursor's approval fingerprint for a normalized stdio server", () => {
    expect(
      buildCursorMcpApprovalIdentifier({
        config: mcpConfig(),
        projectRoot: "/workspace/project",
      }),
    ).toBe("bb-bridge-d4709a3db84ddb48");
  });

  it("does not touch Cursor data for other ACP agents", async () => {
    const cursorDataDir = makeTempDir("bb-cursor-data-");
    const workspace = makeTempDir("bb-cursor-workspace-");

    await expect(
      approveCursorSessionMcpServer({
        agentCommand: "opencode",
        config: mcpConfig(),
        cwd: workspace,
        env: { CURSOR_DATA_DIR: cursorDataDir },
      }),
    ).resolves.toBeUndefined();
    expect(() => readFileSync(join(cursorDataDir, "projects"))).toThrow();
  });

  it("preserves unrelated approvals and removes its session approval on release", async () => {
    const cursorDataDir = makeTempDir("bb-cursor-data-");
    const workspace = makeTempDir("bb-cursor-workspace-");
    const env = { CURSOR_DATA_DIR: cursorDataDir };
    const first = await approveCursorSessionMcpServer({
      agentCommand: "/opt/cursor/cursor-agent",
      config: mcpConfig(),
      cwd: workspace,
      env,
    });
    if (!first) {
      throw new Error("Cursor approval was not installed");
    }
    await revokeCursorSessionMcpServer(first);
    writeFileSync(first.path, '["user-approved-server"]\n', "utf8");

    const approvals = await Promise.all([
      approveCursorSessionMcpServer({
        agentCommand: "cursor-agent",
        config: mcpConfig("thread-a"),
        cwd: workspace,
        env,
      }),
      approveCursorSessionMcpServer({
        agentCommand: "cursor-agent.exe",
        config: mcpConfig("thread-b"),
        cwd: workspace,
        env,
      }),
    ]);
    expect(approvals.every(Boolean)).toBe(true);
    const installed = approvals.flatMap((approval) =>
      approval ? [approval] : [],
    );
    const stored = JSON.parse(readFileSync(first.path, "utf8")) as string[];
    expect(stored[0]).toBe("user-approved-server");
    expect(stored.slice(1).sort()).toEqual(
      installed.map((approval) => approval.approval).sort(),
    );

    await Promise.all(installed.map(revokeCursorSessionMcpServer));
    expect(JSON.parse(readFileSync(first.path, "utf8")) as unknown).toEqual([
      "user-approved-server",
    ]);
    expect(() => readFileSync(`${first.path}.bb-lock`)).toThrow();
  });

  it("does not remove an approval Cursor already had", async () => {
    const cursorDataDir = makeTempDir("bb-cursor-data-");
    const workspace = makeTempDir("bb-cursor-workspace-");
    const env = { CURSOR_DATA_DIR: cursorDataDir };
    const installed = await approveCursorSessionMcpServer({
      agentCommand: "cursor-agent",
      config: mcpConfig(),
      cwd: workspace,
      env,
    });
    if (!installed) {
      throw new Error("Cursor approval was not installed");
    }
    await revokeCursorSessionMcpServer(installed);
    writeFileSync(installed.path, JSON.stringify([installed.approval]), "utf8");

    const existing = await approveCursorSessionMcpServer({
      agentCommand: "cursor-agent",
      config: mcpConfig(),
      cwd: workspace,
      env,
    });
    expect(existing?.installedByBb).toBe(false);
    if (existing) {
      await revokeCursorSessionMcpServer(existing);
    }
    expect(JSON.parse(readFileSync(installed.path, "utf8")) as unknown).toEqual(
      [installed.approval],
    );
  });
});
