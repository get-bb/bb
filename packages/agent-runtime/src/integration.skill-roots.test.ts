/** Provider integration tests for runtime-injected skill roots. */

import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentRuntimeSkillRoot } from "./types.js";
import {
  cleanup,
  createTestRuntime,
  getThreadText,
  newThreadId,
  resolveRuntimeOptions,
  waitForThreadTurnCompleted,
} from "./test/runtime-integration-harness.js";
import { promptTextInput } from "./test/prompt-input.js";

type SkillRootProviderId = "claude-code" | "codex" | "pi";
type DirectorySkillRootProviderId = "codex" | "pi";

const providers: readonly SkillRootProviderId[] = ["codex", "claude-code", "pi"];
const skillName = "bb-runtime-skill-integration";

interface CreateSkillMarkdownArgs {
  token: string;
}

interface CreateProviderSkillRootArgs {
  providerId: SkillRootProviderId;
  token: string;
  workspacePath: string;
}

interface CreateDirectorySkillRootArgs {
  providerId: DirectorySkillRootProviderId;
  token: string;
  workspacePath: string;
}

interface WriteSkillFileArgs {
  skillDir: string;
  token: string;
}

function createSkillMarkdown(args: CreateSkillMarkdownArgs): string {
  return [
    "---",
    `name: ${skillName}`,
    "description: Use when asked for the BB runtime dynamic skill integration token.",
    "---",
    "",
    "# BB Runtime Skill Integration",
    "",
    "When asked for the runtime skill integration token, reply with exactly:",
    args.token,
    "",
  ].join("\n");
}

function writeSkillFile(args: WriteSkillFileArgs): void {
  mkdirSync(args.skillDir, { recursive: true });
  writeFileSync(
    join(args.skillDir, "SKILL.md"),
    createSkillMarkdown({ token: args.token }),
    "utf8",
  );
}

function createClaudeSkillPlugin(
  args: CreateProviderSkillRootArgs,
): AgentRuntimeSkillRoot {
  const pluginDir = join(args.workspacePath, "claude-runtime-skill-plugin");
  const manifestDir = join(pluginDir, ".claude-plugin");
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(
    join(manifestDir, "plugin.json"),
    JSON.stringify(
      {
        $schema: "https://anthropic.com/claude-code/plugin.schema.json",
        name: skillName,
        version: "0.1.0",
        description: "BB runtime dynamic skill integration test plugin.",
        author: {
          name: "BB Integration Tests",
          email: "bb@example.com",
        },
        skills: ["./"],
      },
      null,
      2,
    ),
    "utf8",
  );
  writeSkillFile({ skillDir: pluginDir, token: args.token });
  return {
    id: skillName,
    providerId: "claude-code",
    localPluginPath: pluginDir,
  };
}

function createDirectorySkillRoot(
  args: CreateDirectorySkillRootArgs,
): AgentRuntimeSkillRoot {
  const rootPath = join(args.workspacePath, `${args.providerId}-skill-roots`);
  writeSkillFile({ skillDir: join(rootPath, skillName), token: args.token });
  return {
    id: skillName,
    providerId: args.providerId,
    skillDirectoryRootPath: rootPath,
  };
}

function createProviderSkillRoot(
  args: CreateProviderSkillRootArgs,
): AgentRuntimeSkillRoot {
  switch (args.providerId) {
    case "claude-code":
      return createClaudeSkillPlugin(args);
    case "codex":
      return createDirectorySkillRoot({
        providerId: "codex",
        token: args.token,
        workspacePath: args.workspacePath,
      });
    case "pi":
      return createDirectorySkillRoot({
        providerId: "pi",
        token: args.token,
        workspacePath: args.workspacePath,
      });
  }
}

for (const providerId of providers) {
  describe.concurrent(`${providerId} provider skill roots`, () => {
    it("uses a runtime-injected skill root", async () => {
      const workspacePath = mkdtempSync(
        join(tmpdir(), `bb-integ-skill-${providerId}-`),
      );
      const token = `BB_SKILL_TOKEN_${randomUUID()
        .replaceAll("-", "")
        .toUpperCase()}`;
      const skillRoot = createProviderSkillRoot({
        providerId,
        token,
        workspacePath,
      });
      const ctx = createTestRuntime(providerId, {
        skillRoots: [skillRoot],
        workspacePath,
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
          instructions:
            "When asked for a runtime skill integration token, use the named skill and return the token from that skill.",
        });

        await ctx.runtime.runTurn({
          threadId,
          clientRequestId: "creq_23456789ab",
          options,
          input: [
            promptTextInput({
              text:
                `Use the available skill named ${skillName}. ` +
                "Reply with exactly the runtime skill integration token from that skill and nothing else.",
            }),
          ],
        });

        await waitForThreadTurnCompleted({
          ctx,
          threadId,
          timeoutMs: 75_000,
          label: "skill-root turn/completed",
        });

        expect(getThreadText(ctx.events, threadId)).toContain(token);
      } finally {
        await ctx.runtime.shutdown();
        cleanup(ctx);
        rmSync(workspacePath, { recursive: true, force: true });
      }
    }, 80_000);
  });
}
