import { describe, expect, it } from "vitest";
import { classifyRefusalFallback } from "./src/recovery.js";
import { alternativeModels, autoChoiceKey } from "./src/service.js";

type Events = Parameters<typeof classifyRefusalFallback>[0]["events"];
type Models = Parameters<typeof alternativeModels>[0];

const THREAD_ID = "thr_1";
const TURN_ID = "turn_1";
const REQUEST_ID = "req_1";

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

function turnScope() {
  return { kind: "turn", turnId: TURN_ID } as const;
}

function requested(seq: number, modelId: string) {
  return {
    seq,
    type: "client/turn/requested",
    threadId: THREAD_ID,
    scope: { kind: "thread" },
    data: {
      requestId: REQUEST_ID,
      execution: {
        model: modelId,
        permissionMode: "auto",
        reasoningLevel: "high",
        serviceTier: "default",
      },
    },
  };
}

function accepted(seq: number) {
  return {
    seq,
    type: "turn/input/accepted",
    threadId: THREAD_ID,
    scope: turnScope(),
    data: { clientRequestId: REQUEST_ID },
  };
}

function policyError(seq: number, detail: string) {
  return {
    seq,
    type: "provider/error",
    threadId: THREAD_ID,
    scope: turnScope(),
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

function completed(seq: number, status: "completed" | "failed") {
  return {
    seq,
    type: "turn/completed",
    threadId: THREAD_ID,
    scope: turnScope(),
    data: { status },
  };
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
