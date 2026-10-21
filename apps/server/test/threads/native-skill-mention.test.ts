import { describe, expect, it } from "vitest";
import {
  encodeClientTurnRequestIdNumber,
  flattenPromptInputGroups,
  type PromptInput,
} from "@bb/domain";
import {
  buildExecutionOptions,
  buildThreadStartCommand,
  prepareTurnSubmitCommandPayload,
} from "../../src/services/threads/thread-commands.js";
import { appendAgentOnlyPromptContext } from "../../src/services/threads/deferred-first-turn-context.js";
import {
  EMPTY_WORKSPACE_AGENT_CONTEXT,
  registerHostRpcResponder,
} from "../helpers/host-rpc.js";
import { configuredAcpProvider } from "../helpers/provider-registry.js";
import { skillInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("native skill mention dispatch", () => {
  it.each([
    { entryPoint: "start", resolved: true },
    { entryPoint: "submit", resolved: true },
    { entryPoint: "start", resolved: false },
    { entryPoint: "submit", resolved: false },
  ] as const)(
    "puts native skill context in agent-only $entryPoint input (resolved: $resolved)",
    async ({ entryPoint, resolved }) => {
      const provider = await configuredAcpProvider({
        id: "native-repro",
        displayName: "Native repro",
        command: "native-repro-agent",
        args: [],
      });
      await withTestHarness(
        {
          extraProviders: [
            {
              ...provider,
              declaration: {
                ...provider.declaration,
                experimental_nativeSkillRoots: {
                  user: [".native-repro/skills"],
                  project: [],
                },
              },
            },
          ],
        },
        async (harness) => {
          const { host, session } = seedHostSession(harness.deps, {
            id: "host-native-skill-repro",
          });
          const workspacePath = "/workspace/native-skill-repro";
          const skillPath =
            "/provider-home/.native-repro/skills/audit-fixture/SKILL.md";
          const responder = registerHostRpcResponder(harness, {
            hostId: host.id,
            sessionId: session.id,
            handle: ({ command }) => {
              if (command.type === "host.read_workspace_agent_context") {
                return { ok: true, result: EMPTY_WORKSPACE_AGENT_CONTEXT };
              }
              if (command.type === "host.list_skills") {
                return {
                  ok: true,
                  result: {
                    skills: resolved
                      ? [
                          {
                            id: `skill_${"a".repeat(64)}`,
                            name: "audit-fixture",
                            description: "A native skill fixture",
                            filePath: skillPath,
                            rootKind: "provider-user",
                            linked: false,
                          },
                        ]
                      : [],
                  },
                };
              }
              throw new Error(`Unexpected RPC ${command.type}`);
            },
          });
          try {
            const { project } = seedProjectWithSource(harness.deps, {
              hostId: host.id,
              path: workspacePath,
            });
            const environment = seedEnvironment(harness.deps, {
              hostId: host.id,
              projectId: project.id,
              path: workspacePath,
            });
            const thread = seedThread(harness.deps, {
              projectId: project.id,
              environmentId: environment.id,
              providerId: "acp-native-repro",
            });
            seedThreadRuntimeState(harness.deps, {
              environmentId: environment.id,
              providerThreadId: "provider-native-repro",
              threadId: thread.id,
            });
            const execution = await buildExecutionOptions(
              harness.deps,
              { model: "fixture-model" },
              { threadId: thread.id },
            );
            const input = skillInput("audit-fixture");
            const originalInput = structuredClone(input);
            const command =
              entryPoint === "start"
                ? await buildThreadStartCommand(harness.deps, {
                    environment,
                    execution,
                    fork: null,
                    permissionEscalation: "ask",
                    input,
                    projectId: project.id,
                    providerId: thread.providerId,
                    requestId: encodeClientTurnRequestIdNumber({ value: 5987 }),
                    syncGeneratedTitle: false,
                    thread,
                  })
                : await prepareTurnSubmitCommandPayload(harness.deps, {
                    environment,
                    execution,
                    permissionEscalation: "ask",
                    input,
                    target: { mode: "start" },
                    thread,
                  });
            const context: PromptInput | undefined = command.input.find(
              (item) =>
                item.type === "text" && item.visibility === "agent-only",
            );
            expect(context).toMatchObject({
              type: "text",
              visibility: "agent-only",
              mentions: [],
              text: resolved
                ? expect.stringContaining(skillPath)
                : expect.stringContaining("bb skill list"),
            });
            expect(input).toEqual(originalInput);
          } finally {
            responder.unregister();
          }
        },
      );
    },
  );
});

describe("appendAgentOnlyPromptContext", () => {
  it("appends context to the last input group", () => {
    const first: PromptInput = { type: "text", text: "first", mentions: [] };
    const second: PromptInput = { type: "text", text: "second", mentions: [] };
    const context: PromptInput = {
      type: "text",
      text: "context",
      mentions: [],
      visibility: "agent-only",
    };
    const inputGroups = [[first], [second]];
    const result = appendAgentOnlyPromptContext(
      { input: flattenPromptInputGroups(inputGroups), inputGroups },
      [context],
    );
    expect(result.inputGroups).toEqual([[first], [second, context]]);
    expect(result.input.slice(0, -1)).toEqual(
      flattenPromptInputGroups(inputGroups),
    );
    expect(result.input.at(-1)).toEqual(context);
  });
});
