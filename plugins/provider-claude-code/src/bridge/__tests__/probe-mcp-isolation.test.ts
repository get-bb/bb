import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { existsSyncMock, queryMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  queryMock: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: queryMock }));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: existsSyncMock,
}));

import { readIsolatedClaudeContextUsage } from "../context-usage-probe.js";
import { probeClaudeInitialization } from "../initialization-probe.js";

function probeOptions(): Options {
  const options = queryMock.mock.calls.at(-1)?.[0]?.options;
  if (options === undefined) throw new Error("Expected a Claude SDK query");
  return options;
}

function readContextUsage(): Promise<unknown> {
  return readIsolatedClaudeContextUsage({
    sessionOptions: {
      cwd: "/tmp/probe",
      systemPrompt: "Fixture",
      allowBypassPermissions: false,
    },
    providerSessionId: "session-1",
    dynamicTools: [
      { name: "tool", description: "desc", inputSchema: { type: "object" } },
    ],
    signal: new AbortController().signal,
  });
}

function installManagedMcpConfig(): void {
  existsSyncMock.mockImplementation((path: string) =>
    path.endsWith("managed-mcp.json"),
  );
}

beforeEach(() => {
  existsSyncMock.mockReset();
  existsSyncMock.mockReturnValue(false);
  queryMock.mockReset();
  queryMock.mockReturnValue({
    initializationResult: () => Promise.resolve({ models: [] }),
    mcpServerStatus: () =>
      Promise.resolve([{ name: "bb-bridge", status: "connected" }]),
    getContextUsage: () => Promise.resolve({ totalTokens: 1 }),
    close: vi.fn(),
  });
});

describe("Claude metadata probes", () => {
  it("initialize without loading user, project or plugin MCP servers", async () => {
    await probeClaudeInitialization({ cwd: "/tmp/probe", env: {} });

    expect(probeOptions()).toMatchObject({ strictMcpConfig: true });
    expect(probeOptions().mcpServers).toBeUndefined();
  });

  it("read context usage with only the bb bridge MCP server", async () => {
    await readContextUsage();

    expect(probeOptions()).toMatchObject({ strictMcpConfig: true });
    expect(Object.keys(probeOptions().mcpServers ?? {})).toEqual(["bb-bridge"]);
  });

  it("leave MCP selection to an enterprise managed-mcp.json, which rejects strict MCP config", async () => {
    installManagedMcpConfig();

    await probeClaudeInitialization({ cwd: "/tmp/probe", env: {} });
    expect(probeOptions().strictMcpConfig).toBeUndefined();

    await readContextUsage();
    expect(probeOptions().strictMcpConfig).toBeUndefined();
  });
});
