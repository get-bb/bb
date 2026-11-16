import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { withoutBridgeRuntimeEnv } from "@bb/provider-bridge-protocol/bridge-kit";
import {
  createAcpAgentConnection,
  requestAcpInitialize,
  type AcpAgentConnection,
} from "../../../packages/provider-bridge-acp/src/bridge/agent-connection.js";
import {
  acpSessionNewResultSchema,
  acpConfigStateResultSchema,
} from "../../../packages/provider-bridge-acp/src/wire.js";
import {
  decodeAvailableCommands,
  isJsonObject,
} from "../../../packages/provider-bridge-acp/src/session/decode.js";
import type { AcpAvailableCommand } from "../../../packages/provider-bridge-acp/src/session/session-types.js";

const promptResultSchema = z
  .object({
    stopReason: z.string(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

async function waitFor<T>(
  read: () => T | undefined,
  description: string,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out: ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe.sequential("real Grok commands and skills", () => {
  it("discovers native commands and invokes a synthetic project skill with continuity", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "bb-real-grok-commands-"));
    const skillDir = join(workspaceDir, ".grok", "skills", "bb-probe");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: bb-probe",
        "description: Return a synthetic marker and the supplied arguments.",
        "---",
        "When the user invokes this skill, reply with PROJECT_SKILL followed by the exact arguments supplied with the invocation. Do not use tools.",
        "",
      ].join("\n"),
    );
    const commandUpdates: AcpAvailableCommand[][] = [];
    const agentText: string[] = [];
    const connection: AcpAgentConnection = createAcpAgentConnection({
      command: "grok",
      args: ["agent", "--no-leader", "stdio"],
      cwd: workspaceDir,
      env: withoutBridgeRuntimeEnv(process.env),
      recordThreadId: null,
      onResponse: () => {},
      onNotification: (_method, params) => {
        if (!isJsonObject(params) || !isJsonObject(params["update"])) return;
        const update = params["update"];
        if (update["sessionUpdate"] === "available_commands_update") {
          const commands = decodeAvailableCommands(update["availableCommands"]);
          if (commands !== null) commandUpdates.push(commands);
        }
        if (
          update["sessionUpdate"] === "agent_message_chunk" &&
          isJsonObject(update["content"]) &&
          typeof update["content"]["text"] === "string"
        ) {
          agentText.push(update["content"]["text"]);
        }
      },
      onRequest: (_method, _params, responder) => {
        responder.error(-32601, "No client requests expected");
      },
      onExit: () => {},
    });
    const prompt = async (sessionId: string, text: string) =>
      connection.request({
        method: "session/prompt",
        params: { sessionId, prompt: [{ type: "text", text }] },
        resultSchema: promptResultSchema,
        timeoutMs: 180_000,
      });
    try {
      const agent = await requestAcpInitialize(connection, {
        parameterizedModelPicker: false,
        fsAccess: false,
        elicitation: true,
      });
      const methodIds = agent.authMethods.map((method) => method.id);
      const methodId =
        process.env.XAI_API_KEY && methodIds.includes("xai.api_key")
          ? "xai.api_key"
          : methodIds.includes("cached_token")
            ? "cached_token"
            : undefined;
      expect(methodId).toBeDefined();
      await connection.request({
        method: "authenticate",
        params: { methodId, _meta: { headless: true } },
        resultSchema: z.unknown(),
        timeoutMs: 60_000,
      });
      const session = await connection.request({
        method: "session/new",
        params: { cwd: workspaceDir, mcpServers: [] },
        resultSchema: acpSessionNewResultSchema,
        timeoutMs: 60_000,
      });
      const initialCommands = await waitFor(
        () => commandUpdates.at(-1),
        "initial command list",
      );
      console.info("Real Grok commands", JSON.stringify(initialCommands));
      expect(initialCommands.map((command) => command.name)).toContain(
        "compact",
      );
      console.info(
        "Real Grok project command advertised",
        initialCommands.some((command) => command.name === "bb-probe"),
      );

      const skill = await prompt(session.sessionId, "/bb-probe 😀 مراجعة");
      expect(skill._meta?.["sessionId"]).toBe(session.sessionId);
      if (!agentText.join("").includes("PROJECT_SKILL")) {
        await prompt(
          session.sessionId,
          "Read .grok/skills/bb-probe/SKILL.md and follow it exactly. Reply with exactly PROJECT_SKILL 😀 مراجعة.",
        );
      }
      expect(agentText.join("")).toContain("PROJECT_SKILL");
      expect(agentText.join("")).toContain("😀 مراجعة");

      const beforeUnknown = agentText.length;
      const unknown = await prompt(session.sessionId, "/bb-definitely-unknown");
      expect(unknown._meta?.["sessionId"]).toBe(session.sessionId);
      const unknownText = agentText.slice(beforeUnknown).join("");
      console.info(
        "Real Grok unknown command",
        JSON.stringify({
          stopReason: unknown.stopReason,
          text: unknownText,
        }),
      );
      expect(unknownText).toContain("/bb-definitely-unknown");
      expect(unknownText.toLowerCase()).toContain("not a ");
      expect(unknownText.toLowerCase()).toMatch(/skill|command/);

      await connection.request({
        method: "session/load",
        params: {
          sessionId: session.sessionId,
          cwd: workspaceDir,
          mcpServers: [],
        },
        resultSchema: acpConfigStateResultSchema,
        timeoutMs: 60_000,
      });
      await waitFor(
        () => commandUpdates.length > 1,
        "command list after resume",
      );
      const resumedCommands = commandUpdates.at(-1) ?? [];
      expect(resumedCommands.map((command) => command.name)).toContain(
        "bb-probe",
      );
      for (const command of initialCommands) {
        expect(resumedCommands).toContainEqual(command);
      }
      const continuity = await prompt(
        session.sessionId,
        "Reply with exactly COMMAND_CONTINUITY.",
      );
      expect(continuity._meta?.["sessionId"]).toBe(session.sessionId);
      expect(agentText.join("")).toContain("COMMAND_CONTINUITY");
      console.info(
        "Real Grok commands and skills passed",
        JSON.stringify({ commandUpdates: commandUpdates.length }),
      );
    } finally {
      try {
        await connection.kill();
      } catch {}
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  }, 300_000);
});
