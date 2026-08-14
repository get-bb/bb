import { describe, expect, it } from "vitest";
import {
  bridgeCapabilitiesSchema,
  initializeResultSchema,
  threadEventNotificationSchema,
  threadStopParamsSchema,
  toolCallRequestParamsSchema,
  turnStartParamsSchema,
} from "../src/index.js";

describe("handshake", () => {
  it("reads an older bridge's minimal initialize result as definite absences", () => {
    const parsed = initializeResultSchema.parse({ protocolVersion: 1 });
    expect(parsed.capabilities).toMatchObject({
      sessionRestore: false,
      archiveSync: false,
      nameSync: false,
      goalState: false,
      manualCompaction: false,
      fork: "none",
      approvalRequestPolicy: "runtime",
    });
  });

  it("passes unknown capability fields through for forward compatibility", () => {
    const parsed = bridgeCapabilitiesSchema.parse({
      sessionRestore: true,
      futureCapability: { anything: true },
    });
    expect(parsed.sessionRestore).toBe(true);
    expect(
      (parsed as Record<string, unknown>).futureCapability,
    ).toStrictEqual({ anything: true });
  });
});

describe("thread/event strictness", () => {
  it("rejects a payload whose event is not a valid ThreadEvent", () => {
    const result = threadEventNotificationSchema.safeParse({
      threadId: "thr_1",
      event: { type: "definitely/not/a/thread/event", data: {} },
    });
    expect(result.success).toBe(false);
  });
});

describe("thread/stop", () => {
  it("requires an explicit intent — one verb serving two intents was #1584", () => {
    const withoutIntent = threadStopParamsSchema.safeParse({
      threadId: "thr_1",
      providerThreadId: "p_1",
      activeTurnId: null,
    });
    expect(withoutIntent.success).toBe(false);

    const release = threadStopParamsSchema.parse({
      threadId: "thr_1",
      providerThreadId: "p_1",
      intent: "release",
      activeTurnId: null,
    });
    expect(release.intent).toBe("release");
  });
});

describe("item/tool/call", () => {
  it("rejects an empty-string turn id — null is the only unresolved value", () => {
    const empty = toolCallRequestParamsSchema.safeParse({
      providerThreadId: "p_1",
      turnId: "",
      callId: "c_1",
      tool: "ask_user_question",
      arguments: {},
    });
    expect(empty.success).toBe(false);

    const unresolved = toolCallRequestParamsSchema.parse({
      providerThreadId: "p_1",
      turnId: null,
      callId: "c_1",
      tool: "ask_user_question",
      arguments: {},
    });
    expect(unresolved.turnId).toBeNull();
  });
});

describe("execution options", () => {
  it("carries provider-scoped options opaquely alongside the permission policy", () => {
    const parsed = turnStartParamsSchema.parse({
      threadId: "thr_1",
      providerThreadId: "p_1",
      input: [{ type: "text", text: "hello", mentions: [] }],
      clientRequestId: "creq_abcdefghjk",
      options: {
        model: "claude-opus-5",
        permissionMode: "auto",
        permissionScope: "workspace",
        approvalReviewer: "automatic",
        permissionEscalation: "ask",
        providerOptions: { workflowsEnabled: false },
      },
    });
    expect(parsed.options.providerOptions).toStrictEqual({
      workflowsEnabled: false,
    });
  });
});
