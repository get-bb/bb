import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeClientTurnRequestIdNumber } from "@bb/domain";
import { builtinPluginSource } from "../../../src/services/plugins/builtin-registry.js";
import {
  buildExecutionOptions,
  buildThreadStartCommand,
} from "../../../src/services/threads/thread-commands.js";
import { textInput } from "../../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../../helpers/seed.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

describe("ask-user-question builtin plugin", () => {
  let harness: TestAppHarness;
  let requestValue = 1;

  beforeEach(async () => {
    harness = await createTestAppHarness();
    const entry = await harness.pluginService.install(
      builtinPluginSource("ask-user-question"),
      { kind: "root" },
    );
    expect(entry.statusDetail ?? "").toBe("");
    expect(entry.status).toBe("running");
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  async function dynamicToolsFor(args: {
    providerId: string;
    model: string;
    label: string;
  }) {
    const { host } = seedHostSession(harness.deps, {
      id: `host-${args.label}`,
      name: `Host ${args.label}`,
    });
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
      name: args.label,
      path: join(harness.config.dataDir, args.label),
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
      path: join(harness.config.dataDir, args.label),
    });
    const thread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      providerId: args.providerId,
    });
    const execution = await buildExecutionOptions(
      harness.deps,
      { model: args.model },
      { threadId: thread.id },
    );
    const command = await buildThreadStartCommand(harness.deps, {
      environment,
      execution,
      fork: null,
      permissionEscalation: "ask",
      input: textInput("hello"),
      projectId: project.id,
      providerId: args.providerId,
      requestId: encodeClientTurnRequestIdNumber({
        value: (requestValue += 1),
      }),
      syncGeneratedTitle: false,
      thread,
    });
    return command.dynamicTools;
  }

  it("advertises the tool to pi, which has no native questions", async () => {
    const tools = await dynamicToolsFor({
      providerId: "pi",
      model: "anthropic/claude-opus-4-6",
      label: "pi-project",
    });
    const tool = tools.find(
      (candidate) => candidate.name === "AskUserQuestion",
    );

    expect(tool).toBeDefined();
    expect(tool?.description).toContain(
      "Use this tool only when you are blocked on a decision that is genuinely the user's to make",
    );
  });

  it.each([
    { providerId: "codex", model: "gpt-5.6" },
    { providerId: "claude-code", model: "claude-opus-4-6" },
  ])(
    "withholds the tool from $providerId, which asks natively",
    async ({ providerId, model }) => {
      const tools = await dynamicToolsFor({
        providerId,
        model,
        label: `${providerId}-project`,
      });
      expect(tools.map((tool) => tool.name)).not.toContain("AskUserQuestion");
    },
  );
});
