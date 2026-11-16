import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { withoutBridgeRuntimeEnv } from "@bb/provider-bridge-protocol/bridge-kit";
import {
  createAcpAgentConnection,
  requestAcpInitialize,
} from "../../../packages/provider-bridge-acp/src/bridge/agent-connection.js";
import { decodeGrokCapabilitySnapshot } from "../../../packages/provider-bridge-acp/src/grok-capabilities.js";

it("discovers real Grok capabilities and creates an authenticated ACP session", async () => {
  const workspaceDir = mkdtempSync(
    join(tmpdir(), "bb-real-grok-capabilities-"),
  );
  const cliVersion = execFileSync("grok", ["--version"], {
    encoding: "utf8",
    timeout: 15_000,
  }).trim();
  console.info(`Grok CLI under test: ${cliVersion}`);
  const connection = createAcpAgentConnection({
    command: "grok",
    args: ["agent", "--no-leader", "stdio"],
    cwd: workspaceDir,
    env: withoutBridgeRuntimeEnv(process.env),
    recordThreadId: null,
    onResponse: () => {},
    onNotification: () => {},
    onRequest: (_method, _params, responder) => {
      responder.error(-32601, "The capability probe accepts no agent requests");
    },
    onExit: () => {},
  });

  try {
    const agent = await requestAcpInitialize(connection, {
      parameterizedModelPicker: false,
      fsAccess: false,
    });
    const snapshot = decodeGrokCapabilitySnapshot(agent);
    expect(snapshot.models.length).toBeGreaterThan(0);
    for (const model of snapshot.models) {
      expect(model.modelId.length).toBeGreaterThan(0);
      for (const effort of model.reasoningEfforts) {
        expect(effort.id.length).toBeGreaterThan(0);
      }
    }
    for (const command of snapshot.commands) {
      expect(command.name.length).toBeGreaterThan(0);
    }

    const methodIds = agent.authMethods.map((method) => method.id);
    const methodId =
      process.env.XAI_API_KEY && methodIds.includes("xai.api_key")
        ? "xai.api_key"
        : methodIds.includes("cached_token")
          ? "cached_token"
          : undefined;
    expect(
      methodId,
      `No noninteractive Grok authentication method was advertised (${methodIds.join(", ")})`,
    ).toBeDefined();
    await connection.request({
      method: "authenticate",
      params: { methodId, _meta: { headless: true } },
      resultSchema: z.unknown(),
      timeoutMs: 60_000,
    });
    const session = await connection.request({
      method: "session/new",
      params: { cwd: workspaceDir, mcpServers: [] },
      resultSchema: z.object({ sessionId: z.string().min(1) }).passthrough(),
      timeoutMs: 60_000,
    });
    expect(session.sessionId.length).toBeGreaterThan(0);
    console.info(
      `Grok capability probe: ${snapshot.models.length} models, ${snapshot.commands.length} commands, authenticated session created`,
    );
  } finally {
    await connection.kill();
    rmSync(workspaceDir, { recursive: true, force: true });
  }
}, 90_000);
