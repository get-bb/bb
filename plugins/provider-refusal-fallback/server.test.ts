import { describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { classifyRefusalFallback } from "./src/recovery.js";
import {
  alternativeModels,
  autoChoiceKey,
  RefusalFallbackService,
} from "./src/service.js";

type Events = Parameters<typeof classifyRefusalFallback>[0]["events"];
type Models = Parameters<typeof alternativeModels>[0];

const THREAD_ID = "thr_1";
const TURN_ID = "turn_1";
const REQUEST_ID = "req_1";
const ENVIRONMENT_ID = "env_1";
const PROVIDER_ID = "claude-code";

function model(id: string, displayName: string) {
  return {
    id,
    model: id,
    displayName,
    description: "",
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    isDefault: false,
  };
}

const CATALOG = [
  model("claude-opus-5[1m]", "Opus 5 (1M)"),
  model("claude-opus-4-8[1m]", "Opus 4.8 (1M)"),
  model("claude-opus-4-7[1m]", "Opus 4.7 (1M)"),
  model("claude-sonnet-5", "Sonnet 5"),
] as unknown as Models;

function turnScope(turnId = TURN_ID) {
  return { kind: "turn", turnId } as const;
}

function requested(seq: number, modelId: string, requestId = REQUEST_ID) {
  return {
    seq,
    type: "client/turn/requested",
    threadId: THREAD_ID,
    scope: { kind: "thread" },
    data: {
      requestId,
      execution: {
        model: modelId,
        permissionMode: "auto",
        reasoningLevel: "high",
        serviceTier: "default",
      },
    },
  };
}

function accepted(seq: number, turnId = TURN_ID, requestId = REQUEST_ID) {
  return {
    seq,
    type: "turn/input/accepted",
    threadId: THREAD_ID,
    scope: turnScope(turnId),
    data: { clientRequestId: requestId },
  };
}

function policyError(seq: number, detail: string, turnId = TURN_ID) {
  return {
    seq,
    type: "provider/error",
    threadId: THREAD_ID,
    scope: turnScope(turnId),
    data: {
      message: "Provider error",
      detail,
      errorInfo: {
        category: "policy",
        providerCode: "model_refusal_no_fallback",
        httpStatusCode: null,
      },
    },
  };
}

function completed(
  seq: number,
  status: "completed" | "failed",
  turnId = TURN_ID,
) {
  return {
    seq,
    type: "turn/completed",
    threadId: THREAD_ID,
    scope: turnScope(turnId),
    data: { status },
  };
}

function refusedTurn(
  modelId: string,
  turnId = TURN_ID,
  requestId = REQUEST_ID,
) {
  const base = turnId === TURN_ID ? 0 : 10;
  return [
    requested(base + 1, modelId, requestId),
    accepted(base + 2, turnId, requestId),
    policyError(base + 3, "safeguards flagged this message", turnId),
    completed(base + 4, "completed", turnId),
  ];
}

function events(rows: unknown[]): Events {
  return rows as Events;
}

describe("classifyRefusalFallback", () => {
  it("returns the refused model and detail for a finished refused turn", () => {
    const inspection = classifyRefusalFallback({
      environmentId: "env_1",
      providerId: "claude-code",
      events: events([
        requested(1, "claude-opus-5[1m]"),
        accepted(2),
        policyError(3, "safeguards flagged this message"),
        completed(4, "completed"),
      ]),
    });

    expect(inspection.reason).toBe("eligible");
    expect(inspection.candidate).toEqual({
      detail: "safeguards flagged this message",
      refusedModel: "claude-opus-5[1m]",
      turnId: TURN_ID,
    });
  });

  it("ignores a turn whose provider error is not a policy refusal", () => {
    const rateLimited = {
      seq: 3,
      type: "provider/error",
      threadId: THREAD_ID,
      scope: turnScope(),
      data: {
        message: "Provider error",
        errorInfo: {
          category: "rate-limit",
          providerCode: "rate_limit",
          httpStatusCode: 429,
        },
      },
    };

    const inspection = classifyRefusalFallback({
      environmentId: "env_1",
      providerId: "claude-code",
      events: events([
        requested(1, "claude-opus-5[1m]"),
        accepted(2),
        rateLimited,
        completed(4, "failed"),
      ]),
    });

    expect(inspection.candidate).toBeNull();
    expect(inspection.reason).toBe("no-refusal");
  });

  it("does not offer a fallback while the refused turn is still running", () => {
    const inspection = classifyRefusalFallback({
      environmentId: "env_1",
      providerId: "claude-code",
      events: events([
        requested(1, "claude-opus-5[1m]"),
        accepted(2),
        policyError(3, "refused"),
      ]),
    });

    expect(inspection.candidate).toBeNull();
    expect(inspection.reason).toBe("turn-not-finished");
  });

  it("does not offer a fallback once the user stopped the thread", () => {
    const interrupted = {
      seq: 5,
      type: "system/thread/interrupted",
      threadId: THREAD_ID,
      scope: { kind: "thread" },
      data: { reason: "manual-stop" },
    };

    const inspection = classifyRefusalFallback({
      environmentId: "env_1",
      providerId: "claude-code",
      events: events([
        requested(1, "claude-opus-5[1m]"),
        accepted(2),
        policyError(3, "refused"),
        completed(4, "completed"),
        interrupted,
      ]),
    });

    expect(inspection.candidate).toBeNull();
    expect(inspection.reason).toBe("superseded");
  });

  it("reports the environment as unavailable rather than offering a fallback", () => {
    const inspection = classifyRefusalFallback({
      environmentId: null,
      providerId: "claude-code",
      events: events([
        requested(1, "claude-opus-5[1m]"),
        accepted(2),
        policyError(3, "refused"),
        completed(4, "completed"),
      ]),
    });

    expect(inspection.candidate).toBeNull();
    expect(inspection.reason).toBe("environment-unavailable");
  });
});

describe("alternativeModels", () => {
  it("offers the catalog entries below the refused model", () => {
    expect(
      alternativeModels(CATALOG, "claude-opus-5[1m]").map(
        (entry) => entry.displayName,
      ),
    ).toEqual(["Opus 4.8 (1M)", "Opus 4.7 (1M)", "Sonnet 5"]);
  });

  it("runs out of alternatives at the bottom of the catalog so retries terminate", () => {
    expect(alternativeModels(CATALOG, "claude-sonnet-5")).toEqual([]);
  });

  it("offers the whole catalog when the refused model is no longer listed", () => {
    expect(alternativeModels(CATALOG, "claude-opus-4-6[1m]")).toHaveLength(3);
  });
});

describe("autoChoiceKey", () => {
  it("scopes the remembered choice to one provider", () => {
    expect(autoChoiceKey("claude-code")).toBe("auto:claude-code");
    expect(autoChoiceKey("codex")).toBe("auto:codex");
  });
});

function createHost(rows: unknown[]) {
  let events = rows;
  const host = createFakePluginHost({
    pluginId: "provider-refusal-fallback",
    sdk: {
      threads: {
        get: async ({ threadId }) =>
          makeThreadResponse({
            id: threadId,
            environmentId: ENVIRONMENT_ID,
            providerId: PROVIDER_ID,
            status: "idle",
          }),
        events: {
          list: async ({ afterSeq, limit, order, types }) => {
            const after = afterSeq === undefined ? 0 : Number(afterSeq);
            const wanted = types === undefined ? null : new Set<string>(types);
            const matching = (events as { seq: number; type: string }[]).filter(
              (row) =>
                row.seq > after && (wanted === null || wanted.has(row.type)),
            );
            matching.sort((left, right) =>
              order === "desc" ? right.seq - left.seq : left.seq - right.seq,
            );
            return matching.slice(
              0,
              limit === undefined ? undefined : Number(limit),
            );
          },
        },
        update: async () => ({ ok: true }),
        send: async () => ({ ok: true }),
      },
      providers: {
        models: async () => ({
          providers: [],
          permissionCeiling: "auto",
          models: CATALOG,
          selectedOnlyModels: [],
          modelLoadError: null,
        }),
      },
    },
  });
  return {
    host,
    setEvents(next: unknown[]) {
      events = next;
    },
  };
}

async function nextInteraction(host: ReturnType<typeof createHost>["host"]) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const pending = host.harness.pendingInteractions[0];
    if (pending !== undefined) return pending;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("no interaction was requested");
}

describe("RefusalFallbackService", () => {
  it("offers the next model down, switches on accept, and continues the turn", async () => {
    const { host } = createHost(refusedTurn("claude-opus-5[1m]"));
    const service = new RefusalFallbackService(host.bb);

    const outcome = service.reconcile(THREAD_ID);
    const interaction = await nextInteraction(host);

    expect(interaction.title).toBe("Opus 5 (1M) refused this message");
    expect(interaction.payload).toMatchObject({
      refusedModelLabel: "Opus 5 (1M)",
      detail: "safeguards flagged this message",
      options: [
        { model: "claude-opus-4-8[1m]", label: "Opus 4.8 (1M)" },
        { model: "claude-opus-4-7[1m]", label: "Opus 4.7 (1M)" },
        { model: "claude-sonnet-5", label: "Sonnet 5" },
      ],
    });

    host.harness.submitInteraction(interaction.id, {
      model: "claude-opus-4-8[1m]",
      remember: false,
    });

    expect(await outcome).toBe("switched");
    expect(host.harness.sdk.callsTo("threads.update")).toEqual([
      [{ threadId: THREAD_ID, model: "claude-opus-4-8[1m]" }],
    ]);
    expect(host.harness.sdk.callsTo("threads.send")).toHaveLength(1);
    expect(await service.autoChoice(PROVIDER_ID)).toBeUndefined();
  });

  it("skips the prompt on the next refusal once the user opts out of it", async () => {
    const harness = createHost(refusedTurn("claude-opus-5[1m]"));
    const service = new RefusalFallbackService(harness.host.bb);

    const first = service.reconcile(THREAD_ID);
    const interaction = await nextInteraction(harness.host);
    harness.host.harness.submitInteraction(interaction.id, {
      model: "claude-opus-4-8[1m]",
      remember: true,
    });
    expect(await first).toBe("switched");
    expect(await service.autoChoice(PROVIDER_ID)).toEqual({
      model: "claude-opus-4-8[1m]",
    });

    harness.setEvents(refusedTurn("claude-opus-5[1m]", "turn_2", "req_2"));
    expect(await service.reconcile(THREAD_ID)).toBe("switched");

    expect(harness.host.harness.pendingInteractions).toHaveLength(0);
    expect(harness.host.harness.sdk.callsTo("threads.update")).toHaveLength(2);
  });

  it("leaves the thread on the refused model when the user declines", async () => {
    const { host } = createHost(refusedTurn("claude-opus-5[1m]"));
    const service = new RefusalFallbackService(host.bb);

    const outcome = service.reconcile(THREAD_ID);
    const interaction = await nextInteraction(host);
    host.harness.submitInteraction(interaction.id, {
      model: null,
      remember: false,
    });

    expect(await outcome).toBe("declined");
    expect(host.harness.sdk.callsTo("threads.update")).toEqual([]);
    expect(host.harness.sdk.callsTo("threads.send")).toEqual([]);
  });

  it("does not prompt when the refused model is already the last alternative", async () => {
    const { host } = createHost(refusedTurn("claude-sonnet-5"));
    const service = new RefusalFallbackService(host.bb);

    expect(await service.reconcile(THREAD_ID)).toBe("no-alternative");
    expect(host.harness.pendingInteractions).toHaveLength(0);
    expect(host.harness.sdk.callsTo("threads.send")).toEqual([]);
  });

  it("does not act twice on the same refused turn", async () => {
    const { host } = createHost(refusedTurn("claude-opus-5[1m]"));
    const service = new RefusalFallbackService(host.bb);

    const outcome = service.reconcile(THREAD_ID);
    const interaction = await nextInteraction(host);
    host.harness.submitInteraction(interaction.id, {
      model: "claude-opus-4-8[1m]",
      remember: false,
    });
    await outcome;

    expect(await service.reconcile(THREAD_ID)).toBe("already-handled");
    expect(host.harness.sdk.callsTo("threads.send")).toHaveLength(1);
  });
});
