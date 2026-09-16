import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createFakePluginHost,
  type FakePluginHost,
  makePluginAgentConfigurationContext,
} from "@get-bb/plugin-sdk/testing";
import plugin, { TOOL_NAME } from "./server.js";
import {
  DISMISSED_MESSAGE,
  NO_ANSWERS_MESSAGE,
  QUESTION_POSTED_MESSAGE,
  TOO_FEW_OPTIONS_MESSAGE,
} from "./tool-definition.js";
import {
  ASK_USER_QUESTION_RENDERER_ID,
  toolInputSchema,
  type InteractionPayload,
  type ToolResult,
} from "./contracts.js";

function createHost(options: { status?: string } = {}): FakePluginHost {
  const host = createFakePluginHost({
    pluginId: "ask-user-question",
    sdk: {
      threads: {
        get: (_args: unknown) =>
          Promise.resolve({ status: options.status ?? "active" }),
        send: (_args: unknown) => Promise.resolve({}),
      },
    },
  });
  plugin(host.bb as unknown as Parameters<typeof plugin>[0]);
  return host;
}

interface SentMessage {
  input: { text: string }[];
  mode: string;
  threadId: string;
}

function sentMessages(host: FakePluginHost): SentMessage[] {
  return host.harness.sdk
    .callsTo("threads.send")
    .map(([args]) => args as SentMessage);
}

async function ask(host: FakePluginHost, signal?: AbortSignal) {
  const result = await host.harness.callAgentTool(
    TOOL_NAME,
    { questions },
    signal ? { signal } : undefined,
  );
  await vi.waitFor(() =>
    expect(host.harness.pendingInteractions).toHaveLength(1),
  );
  return { pending: host.harness.pendingInteractions[0]!, result };
}

function configurationContext(
  providerId: string,
  supportsNativeUserQuestion = false,
) {
  return makePluginAgentConfigurationContext({
    provider: {
      id: providerId,
      capabilities: { supportsNativeUserQuestion },
    },
  });
}

const questions = [
  {
    question: "Which database should we use?",
    header: "Database",
    multiSelect: false,
    options: [
      {
        label: "Postgres (Recommended)",
        description: "Relational, needs a server.",
        preview: "CREATE TABLE users (id uuid primary key);",
      },
      { label: "SQLite", description: "Embedded, zero setup." },
    ],
  },
];

async function resultText(
  result: Awaited<ReturnType<FakePluginHost["harness"]["callAgentTool"]>>,
): Promise<string> {
  if (typeof result === "string") return result;
  const [part] = result.content;
  if (part?.type !== "text") throw new Error("expected a text result");
  return part.text;
}

describe("provider gating", () => {
  it.each(["claude-code", "some-plugin-provider"])(
    "withholds the tool from %s, which declares it natively",
    async (providerId) => {
      const host = createHost();
      const resolved = await host.harness.resolveAgentConfiguration(
        configurationContext(providerId, true),
      );
      expect(resolved.tools).toEqual([]);
    },
  );

  it.each(["codex", "pi", "acp-cursor"])(
    "registers the tool for %s with the schema generated from its input parser",
    async (providerId) => {
      const host = createHost();
      const resolved = await host.harness.resolveAgentConfiguration(
        configurationContext(providerId),
      );
      expect(resolved.tools).toHaveLength(1);
      const [tool] = resolved.tools;
      expect(tool?.name).toBe(TOOL_NAME);
      expect(tool?.inputSchema).toEqual(
        z.toJSONSchema(toolInputSchema, { io: "input" }),
      );
    },
  );

  it.each(["codex", "pi", "acp-cursor"])(
    "does not prescribe provider-specific plan tools to %s",
    async (providerId) => {
      const host = createHost();
      const resolved = await host.harness.resolveAgentConfiguration(
        configurationContext(providerId),
      );
      expect(resolved.tools).toHaveLength(1);
      expect(resolved.tools[0]?.description).not.toMatch(
        /EnterPlanMode|ExitPlanMode/,
      );
    },
  );

  it("advertises multiSelect as optional and defaults it during execution", async () => {
    const host = createHost();
    const resolved = await host.harness.resolveAgentConfiguration(
      configurationContext("codex"),
    );
    expect(resolved.tools[0]?.inputSchema).toMatchObject({
      additionalProperties: false,
      required: ["questions"],
      properties: {
        questions: {
          minItems: 1,
          maxItems: 4,
          items: {
            additionalProperties: false,
            required: ["question", "header", "options"],
            properties: {
              question: { minLength: 1, description: expect.any(String) },
              header: { minLength: 1, description: expect.any(String) },
              multiSelect: { type: "boolean", default: false },
              options: {
                minItems: 2,
                maxItems: 4,
                items: {
                  additionalProperties: false,
                  required: ["label", "description"],
                  properties: {
                    label: { minLength: 1, description: expect.any(String) },
                    description: {
                      minLength: 1,
                      description: expect.any(String),
                    },
                    preview: {
                      maxLength: 4096,
                      description: expect.any(String),
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    await host.harness.callAgentTool(TOOL_NAME, {
      questions: [{ ...questions[0], multiSelect: undefined }],
    });
    await vi.waitFor(() =>
      expect(host.harness.pendingInteractions).toHaveLength(1),
    );
    const payload = host.harness.pendingInteractions[0]!
      .payload as InteractionPayload;
    expect(payload.questions[0]?.multiSelect).toBe(false);
  });
});

describe("asking a question", () => {
  it.each([
    ["root", { questions, extra: true }],
    [
      "question",
      {
        questions: questions.map((question) => ({ ...question, extra: true })),
      },
    ],
    [
      "option",
      {
        questions: questions.map((question) => ({
          ...question,
          options: question.options.map((option) => ({
            ...option,
            extra: true,
          })),
        })),
      },
    ],
  ])("rejects unknown fields on the %s object", async (_level, input) => {
    const host = createHost();
    await expect(host.harness.callAgentTool(TOOL_NAME, input)).rejects.toThrow(
      'Unrecognized key: "extra"',
    );
    expect(host.harness.pendingInteractions).toHaveLength(0);
  });

  it.each([0, 1])(
    "rejects %i options with guidance to proceed before opening an interaction",
    async (optionCount) => {
      const host = createHost();
      await expect(
        host.harness.callAgentTool(TOOL_NAME, {
          questions: [
            {
              ...questions[0],
              options: questions[0]!.options.slice(0, optionCount),
            },
          ],
        }),
      ).rejects.toThrow(TOO_FEW_OPTIONS_MESSAGE);
      expect(host.harness.pendingInteractions).toHaveLength(0);
    },
  );

  it("posts the question and tells the model to wait for a separate answer", async () => {
    const host = createHost();
    const { pending, result } = await ask(host);

    expect(pending.rendererId).toBe(ASK_USER_QUESTION_RENDERER_ID);
    expect(pending.title).toBe("Database");
    const payload = pending.payload as InteractionPayload;
    expect(payload.questions[0]).toMatchObject({
      id: "q0",
      prompt: "Which database should we use?",
      shortLabel: "Database",
      allowFreeText: true,
    });
    expect(await resultText(result)).toBe(QUESTION_POSTED_MESSAGE);
    expect(sentMessages(host)).toEqual([]);
  });

  it("delivers the answer as turn input, starting a turn if none is running", async () => {
    const host = createHost();
    const { pending } = await ask(host);

    host.harness.submitInteraction(pending.id, {
      answers: { q0: { selected: ["q0o0"], freeText: "with pgbouncer" } },
    });

    await vi.waitFor(() => expect(sentMessages(host)).toHaveLength(1));
    const [message] = sentMessages(host);
    expect(message).toMatchObject({
      mode: "steer-if-active",
      threadId: "thread-test",
    });
    expect(message?.input[0]?.text).toContain(
      "Which database should we use? — Postgres (Recommended); with pgbouncer",
    );
  });

  it("keeps the question open after the tool call that opened it is cancelled", async () => {
    const host = createHost();
    const controller = new AbortController();
    const { pending } = await ask(host, controller.signal);

    controller.abort();
    await vi.waitFor(() =>
      expect(host.harness.pendingInteractions).toHaveLength(1),
    );

    host.harness.submitInteraction(pending.id, {
      answers: { q0: { selected: ["q0o1"] } },
    });
    await vi.waitFor(() => expect(sentMessages(host)).toHaveLength(1));
    expect(sentMessages(host)[0]?.input[0]?.text).toContain("SQLite");
  });

  it("interrupts a running turn when the user dismisses the question", async () => {
    const host = createHost();
    const { pending } = await ask(host);

    host.harness.cancelInteraction(pending.id);

    await vi.waitFor(() => expect(sentMessages(host)).toHaveLength(1));
    expect(sentMessages(host)[0]).toMatchObject({ mode: "steer" });
    expect(sentMessages(host)[0]?.input[0]?.text).toBe(DISMISSED_MESSAGE);
  });

  it("leaves a finished turn alone when the user dismisses the question", async () => {
    const host = createHost({ status: "idle" });
    const { pending } = await ask(host);

    host.harness.cancelInteraction(pending.id);

    await vi.waitFor(() =>
      expect(host.harness.sdk.callsTo("threads.get")).toHaveLength(1),
    );
    expect(sentMessages(host)).toEqual([]);
    expect(
      host.harness.logEntries.filter((entry) => entry.level === "warn"),
    ).toEqual([]);
  });

  it("says nothing when the card is taken away rather than dismissed", async () => {
    const host = createHost();
    const { pending } = await ask(host);

    host.harness.cancelInteraction(pending.id, "thread-stopped");

    await vi.waitFor(() =>
      expect(host.harness.pendingInteractions).toHaveLength(0),
    );
    expect(host.harness.sdk.calls).toEqual([]);
  });

  it("reports an empty submission as a non-answer instead of a blank answer", async () => {
    const host = createHost();
    const { pending } = await ask(host);

    host.harness.submitInteraction(pending.id, {
      answers: { q0: { selected: [] } },
    });

    await vi.waitFor(() => expect(sentMessages(host)).toHaveLength(1));
    expect(sentMessages(host)[0]).toMatchObject({ mode: "steer" });
    expect(sentMessages(host)[0]?.input[0]?.text).toBe(NO_ANSWERS_MESSAGE);
  });

  it("explains the collision when a second question races the first", async () => {
    const host = createFakePluginHost({ pluginId: "ask-user-question" });
    host.bb.ui.requestInput = () =>
      Promise.reject(
        new Error("Thread thr-test is already awaiting user interaction"),
      );
    plugin(host.bb as unknown as Parameters<typeof plugin>[0]);

    const result = await host.harness.callAgentTool(TOOL_NAME, { questions });

    expect(result).toMatchObject({ isError: true });
    const text = await resultText(result);
    expect(text).toContain("already awaiting user interaction");
    expect(text).toContain("Only one prompt can await the user at a time");
    expect(host.harness.sdk.callsTo("threads.send")).toEqual([]);
  });

  it("rejects oversized previews before opening an interaction", async () => {
    const host = createHost();
    const preview = "x".repeat(4096);
    const result = await host.harness.callAgentTool(TOOL_NAME, {
      questions: Array.from({ length: 4 }, (_unused, index) => ({
        question: `Question ${index}?`,
        header: `Q${index}`,
        multiSelect: false,
        options: Array.from({ length: 4 }, (_option, optionIndex) => ({
          label: `Option ${optionIndex}`,
          description: "Detail.",
          preview,
        })),
      })),
    });

    expect(result).toMatchObject({ isError: true });
    expect(await resultText(result)).toContain("too large to display");
    expect(host.harness.pendingInteractions).toHaveLength(0);
  });
});
