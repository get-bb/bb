import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DynamicTool } from "@bb/domain";
import {
  cleanup,
  createTestRuntime,
  getAgentText,
  getEventsForThread,
  newThreadId,
  resolveRuntimeOptions,
  waitForThreadTurnCompletedCount,
} from "./test/runtime-integration-harness.js";
import { promptTextInput } from "./test/prompt-input.js";

const providers = (
  process.env.SESSION_CONFIG_PROVIDERS ?? "claude-code,codex"
).split(",");

function probeTool(name: string, word: string): DynamicTool {
  return {
    name,
    description: `Returns the word ${word}. Always call this tool when asked to use it.`,
    inputSchema: { type: "object", properties: {} },
  };
}

const ALPHA = probeTool("bb_probe_alpha", "ALPHA");
const BETA = probeTool("bb_probe_beta", "BETA");

for (const providerId of providers) {
  describe(`${providerId} provider`, () => {
    it("reaches a running thread with tools added between turns", async () => {
      const ctx = createTestRuntime(providerId, {
        onToolCall: async (request) => ({
          contentItems: [
            { type: "inputText" as const, text: `RESULT_${request.tool}` },
          ],
          success: true,
        }),
      });
      try {
        const threadId = newThreadId();
        const options = await resolveRuntimeOptions({
          ctx,
          providerId,
          preset: "full",
        });
        await ctx.runtime.startThread({
          environmentId: "env-1",
          threadId,
          projectId: "test-project",
          providerId,
          options,
          dynamicTools: [ALPHA],
        });
        await ctx.runtime.runTurn({
          clientRequestId: "creq_sessncfga2",
          threadId,
          input: [promptTextInput({ text: "Reply with the single word OK." })],
          options,
        });
        await waitForThreadTurnCompletedCount({
          ctx,
          threadId,
          count: 1,
          label: "first turn",
          timeoutMs: 90_000,
        });

        await ctx.runtime.runTurn({
          clientRequestId: "creq_sessncfgb2",
          threadId,
          input: [
            promptTextInput({
              text: "Call the bb_probe_beta tool right now, then reply with what it returned. If you have no tool with that name, reply NO_SUCH_TOOL.",
            }),
          ],
          options,
          dynamicTools: [ALPHA, BETA],
        });
        await waitForThreadTurnCompletedCount({
          ctx,
          threadId,
          count: 2,
          label: "second turn",
          timeoutMs: 120_000,
        });

        const calledBeta = ctx.toolCalls.some(
          (call) => call.threadId === threadId && call.tool === BETA.name,
        );
        const fixedWarnings = ctx.events.filter(
          (event) =>
            event.type === "provider/warning" &&
            event.category === "config" &&
            event.threadId === threadId,
        );
        console.info(
          `${providerId}: called beta=${calledBeta}, fixed-tool warnings=${fixedWarnings.length}, agent: ${getAgentText(getEventsForThread(ctx.events, threadId))}`,
        );
        if (providerId === "codex") {
          expect(calledBeta).toBe(false);
          expect(fixedWarnings).toHaveLength(1);
        } else {
          expect(calledBeta).toBe(true);
          expect(fixedWarnings).toHaveLength(0);
        }
      } finally {
        await ctx.runtime.shutdown();
        cleanup(ctx);
      }
    }, 300_000);
  });
}

const MCP_ENV_PROBE = `
const { appendFileSync } = require("node:fs");
appendFileSync(process.env.PROBE_OUT, JSON.stringify({ BB_THREAD_ID: process.env.BB_THREAD_ID ?? null, CODEX_HOME: process.env.CODEX_HOME ?? null }) + "\\n");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\\n")) >= 0) {
    const message = JSON.parse(buffer.slice(0, index));
    buffer = buffer.slice(index + 1);
    if (message.id === undefined) continue;
    const result = message.method === "initialize"
      ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "env-probe", version: "1" } }
      : message.method === "tools/list" ? { tools: [] } : {};
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
  }
});
`;

describe("codex app-server", () => {
  it("launches MCP servers with the thread identity and the project's CODEX_HOME", async () => {
    const codexHome = mkdtempSync(join(tmpdir(), "bb-integ-codex-home-"));
    copyFileSync(
      join(homedir(), ".codex", "auth.json"),
      join(codexHome, "auth.json"),
    );
    const probePath = join(codexHome, "mcp-env-probe.cjs");
    const probeOut = join(codexHome, "mcp-env.jsonl");
    writeFileSync(probePath, MCP_ENV_PROBE);
    writeFileSync(
      join(codexHome, "config.toml"),
      `[mcp_servers.env_probe]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(probePath)}]\nenv_vars = ["BB_THREAD_ID", "CODEX_HOME"]\n[mcp_servers.env_probe.env]\nPROBE_OUT = ${JSON.stringify(probeOut)}\n`,
    );
    const ctx = createTestRuntime("codex");
    try {
      const threadId = newThreadId();
      const options = await resolveRuntimeOptions({
        ctx,
        providerId: "codex",
        preset: "full",
      });
      await ctx.runtime.startThread({
        environmentId: "env-1",
        threadId,
        projectId: "test-project",
        providerId: "codex",
        options,
        contributedEnv: [
          {
            name: "CODEX_HOME",
            value: codexHome,
            source: { core: "project-environment" },
            reason: "integration test",
          },
        ],
      });
      await ctx.runtime.runTurn({
        clientRequestId: "creq_sessncfgc2",
        threadId,
        input: [promptTextInput({ text: "Reply with the single word OK." })],
        options,
      });
      await waitForThreadTurnCompletedCount({
        ctx,
        threadId,
        count: 1,
        label: "first turn",
        timeoutMs: 120_000,
      });
      const launches = existsSync(probeOut)
        ? readFileSync(probeOut, "utf8").trim().split("\n")
        : [];
      expect(launches.map((line) => JSON.parse(line))).toContainEqual({
        BB_THREAD_ID: threadId,
        CODEX_HOME: codexHome,
      });
    } finally {
      await ctx.runtime.shutdown();
      cleanup(ctx);
    }
  }, 300_000);
});

for (const providerId of ["codex", "claude-code"]) {
  describe(`${providerId} skills`, () => {
    it("reaches a running thread with a skill added between turns", async () => {
      const skillsRoot = mkdtempSync(join(tmpdir(), "bb-integ-skills-"));
      const skillDir = join(skillsRoot, "bb-probe-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        "---\nname: bb-probe-skill\ndescription: Answers with the probe code word.\n---\nWhen this skill is used, reply with exactly the code word PERSIMMON-42 and nothing else.\n",
      );
      const ctx = createTestRuntime(providerId);
      try {
        const threadId = newThreadId();
        const options = await resolveRuntimeOptions({
          ctx,
          providerId,
          preset: "full",
        });
        await ctx.runtime.startThread({
          environmentId: "env-1",
          threadId,
          projectId: "test-project",
          providerId,
          options,
        });
        await ctx.runtime.runTurn({
          clientRequestId: "creq_sessncfge2",
          threadId,
          input: [promptTextInput({ text: "Reply with the single word OK." })],
          options,
        });
        await waitForThreadTurnCompletedCount({
          ctx,
          threadId,
          count: 1,
          label: "first turn",
          timeoutMs: 120_000,
        });

        await ctx.runtime.configureSkillRoots([
          {
            id: "probe",
            path: skillsRoot,
            skills: [
              {
                name: "bb-probe-skill",
                description: "Answers with the probe code word.",
              },
            ],
          },
        ]);
        await ctx.runtime.runTurn({
          clientRequestId: "creq_sessncfgf2",
          threadId,
          input: [
            promptTextInput({
              text: "Use the bb-probe-skill skill now and reply exactly as it instructs.",
            }),
          ],
          options,
        });
        await waitForThreadTurnCompletedCount({
          ctx,
          threadId,
          count: 2,
          label: "second turn",
          timeoutMs: 180_000,
        });

        expect(
          getAgentText(getEventsForThread(ctx.events, threadId)),
        ).toContain("PERSIMMON-42");
      } finally {
        await ctx.runtime.shutdown();
        cleanup(ctx);
        rmSync(skillsRoot, { recursive: true, force: true });
      }
    }, 400_000);
  });
}
