import { describe, expect, it } from "vitest";
import {
  WORKFLOW_CALL_CACHE_VERSION,
  canonicalizeJson,
  computeWorkflowCallCacheKey,
  reusableSuccessfulResult,
  type WorkflowCallCacheInput,
  type WorkflowCallResultStatus,
} from "./cache.js";
import { parseAgentOptions } from "./validation.js";

function cacheInput(): WorkflowCallCacheInput {
  return {
    version: WORKFLOW_CALL_CACHE_VERSION,
    previousCacheKey: null,
    prompt: "Review the implementation",
    selection: {
      providerId: "codex",
      model: "gpt-5.6-sol",
      reasoningLevel: "medium",
      permissionMode: "workspace-write",
    },
    outputSchema: {
      type: "object",
      properties: { approved: { type: "boolean" } },
      required: ["approved"],
    },
    executionSemantics: {
      workerPromptVersion: "worker-prompt-v1",
      resultProtocolVersion: "structured-result-v1",
      maxRepairAttempts: 2,
    },
  };
}

describe("workflow call cache identity", () => {
  it("is deterministic and independent of recursive object key order", () => {
    const first = cacheInput();
    const second: WorkflowCallCacheInput = {
      executionSemantics: {
        maxRepairAttempts: 2,
        resultProtocolVersion: "structured-result-v1",
        workerPromptVersion: "worker-prompt-v1",
      },
      outputSchema: {
        required: ["approved"],
        properties: { approved: { type: "boolean" } },
        type: "object",
      },
      selection: {
        permissionMode: "workspace-write",
        reasoningLevel: "medium",
        model: "gpt-5.6-sol",
        providerId: "codex",
      },
      prompt: "Review the implementation",
      previousCacheKey: null,
      version: WORKFLOW_CALL_CACHE_VERSION,
    };

    expect(computeWorkflowCallCacheKey(first)).toBe(
      computeWorkflowCallCacheKey(second),
    );
    expect(computeWorkflowCallCacheKey(first)).toBe(
      "fc85e9c97707a4d3479bfc43f24eda8726527cab65df4af4f450737bf3cfdf15",
    );
  });

  it.each([
    [
      "prompt",
      (input: WorkflowCallCacheInput) => ({ ...input, prompt: "Changed" }),
    ],
    [
      "provider",
      (input: WorkflowCallCacheInput) => ({
        ...input,
        selection: { ...input.selection, providerId: "claude-code" },
      }),
    ],
    [
      "model",
      (input: WorkflowCallCacheInput) => ({
        ...input,
        selection: { ...input.selection, model: "gpt-5.7" },
      }),
    ],
    [
      "reasoning",
      (input: WorkflowCallCacheInput) => ({
        ...input,
        selection: { ...input.selection, reasoningLevel: "high" },
      }),
    ],
    [
      "permission",
      (input: WorkflowCallCacheInput) => ({
        ...input,
        selection: { ...input.selection, permissionMode: "readonly" },
      }),
    ],
    [
      "schema",
      (input: WorkflowCallCacheInput) => ({
        ...input,
        outputSchema: { type: "string" },
      }),
    ],
    [
      "worker prompt protocol",
      (input: WorkflowCallCacheInput) => ({
        ...input,
        executionSemantics: {
          ...input.executionSemantics,
          workerPromptVersion: "worker-prompt-v2",
        },
      }),
    ],
    [
      "result protocol",
      (input: WorkflowCallCacheInput) => ({
        ...input,
        executionSemantics: {
          ...input.executionSemantics,
          resultProtocolVersion: "structured-result-v2",
        },
      }),
    ],
    [
      "repair limit",
      (input: WorkflowCallCacheInput) => ({
        ...input,
        executionSemantics: {
          ...input.executionSemantics,
          maxRepairAttempts: 3,
        },
      }),
    ],
  ])("invalidates when %s changes", (_field, change) => {
    const original = cacheInput();
    expect(computeWorkflowCallCacheKey(change(original))).not.toBe(
      computeWorkflowCallCacheKey(original),
    );
  });

  it("chains each identity to the previous successful prefix key", () => {
    const first = computeWorkflowCallCacheKey(cacheInput());
    const next = { ...cacheInput(), previousCacheKey: first };
    const otherPrefix = { ...next, previousCacheKey: "a-different-prefix" };

    expect(computeWorkflowCallCacheKey(next)).not.toBe(first);
    expect(computeWorkflowCallCacheKey(otherPrefix)).not.toBe(
      computeWorkflowCallCacheKey(next),
    );
  });

  it("ignores display-only title, label, and phase properties", () => {
    const input = cacheInput();
    const decorated = {
      ...input,
      title: "Visible worker title",
      label: "Map branch 1",
      phase: "Review",
    };

    expect(computeWorkflowCallCacheKey(decorated)).toBe(
      computeWorkflowCallCacheKey(input),
    );
  });

  it("uses native schema through canonical outputSchema identity", () => {
    const native = parseAgentOptions({
      schema: {
        required: ["approved"],
        properties: { approved: { type: "boolean" } },
        type: "object",
      },
      label: "Native label",
      phase: "Review",
    });
    const compatible = parseAgentOptions({
      outputSchema: {
        type: "object",
        properties: { approved: { type: "boolean" } },
        required: ["approved"],
      },
      title: "Compatible title",
      phase: "Different display phase",
    });
    const changed = parseAgentOptions({ schema: { type: "string" } });
    const keyFor = (outputSchema: WorkflowCallCacheInput["outputSchema"]) =>
      computeWorkflowCallCacheKey({ ...cacheInput(), outputSchema });

    expect(keyFor(native.outputSchema)).toBe(keyFor(compatible.outputSchema));
    expect(keyFor(changed.outputSchema)).not.toBe(keyFor(native.outputSchema));
  });
});

describe("canonical JSON", () => {
  it("emits a stable canonical representation", () => {
    expect(canonicalizeJson({ z: -0, a: [true, null, "x"] })).toBe(
      '{"a":[true,null,"x"],"z":0}',
    );
  });

  it.each([NaN, Infinity, -Infinity])(
    "rejects non-finite number %s",
    (value) => {
      expect(() => canonicalizeJson(value)).toThrow("non-finite");
    },
  );

  it("rejects cycles", () => {
    const value: { self?: object } = {};
    value.self = value;
    expect(() => canonicalizeJson(value)).toThrow("cycle");
  });

  it("rejects sparse arrays and non-index array properties", () => {
    const sparse = new Array<number>(2);
    sparse[1] = 1;
    const decorated = [1];
    Object.defineProperty(decorated, "label", {
      enumerable: true,
      value: "hostile",
    });

    expect(() => canonicalizeJson(sparse)).toThrow("sparse array");
    expect(() => canonicalizeJson(decorated)).toThrow("non-index");
  });

  it("rejects accessors without invoking them", () => {
    let invoked = false;
    const value = Object.defineProperty({}, "answer", {
      enumerable: true,
      get() {
        invoked = true;
        return 42;
      },
    });

    expect(() => canonicalizeJson(value)).toThrow("data property");
    expect(invoked).toBe(false);
  });

  it("rejects symbols as values or property keys", () => {
    expect(() => canonicalizeJson(Symbol("value"))).toThrow("symbol");
    expect(() => canonicalizeJson({ [Symbol("key")]: 1 })).toThrow(
      "symbol property",
    );
  });

  it("rejects exotic prototypes and forbidden prototype keys", () => {
    expect(() => canonicalizeJson(new Date(0))).toThrow("plain objects");
    for (const key of ["__proto__", "constructor", "prototype"]) {
      const value = Object.create(null);
      Object.defineProperty(value, key, { enumerable: true, value: 1 });
      expect(() => canonicalizeJson(value)).toThrow("forbidden key");
    }
  });

  it("rejects non-enumerable data properties", () => {
    const value = Object.defineProperty({}, "hidden", { value: true });
    expect(() => canonicalizeJson(value)).toThrow("enumerable");
  });
});

describe("workflow call result reuse", () => {
  it("reuses only successful non-null results", () => {
    expect(
      reusableSuccessfulResult({ status: "succeeded", result: { ok: true } }),
    ).toEqual({ reusable: true, result: { ok: true } });

    const nonReusableStatuses: WorkflowCallResultStatus[] = [
      "queued",
      "running",
      "failed",
      "cancelled",
      "incomplete",
    ];
    for (const status of nonReusableStatuses) {
      expect(reusableSuccessfulResult({ status, result: "stale" })).toEqual({
        reusable: false,
      });
    }
    expect(
      reusableSuccessfulResult({ status: "succeeded", result: null }),
    ).toEqual({ reusable: false });
    expect(reusableSuccessfulResult(null)).toEqual({ reusable: false });
  });
});
