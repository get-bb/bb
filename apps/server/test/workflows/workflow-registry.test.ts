import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.js";
import { validateWorkflowScriptSource } from "../../src/services/workflows/workflow-registry.js";

const VALID_SOURCE = `export const meta = {
  name: "valid-flow",
  description: "A valid workflow",
  phases: [{ title: "Research" }],
};

const result = await agent("Research the topic");
log(String(result));
`;

function expectValidationFailure(source: string): ApiError {
  try {
    validateWorkflowScriptSource(source);
  } catch (error) {
    if (error instanceof ApiError) {
      expect(error.status).toBe(422);
      expect(error.body.code).toBe("workflow_validation_failed");
      return error;
    }
    throw error;
  }
  throw new Error("expected validation to fail");
}

describe("validateWorkflowScriptSource", () => {
  it("accepts a valid workflow and snapshots name/content/hash", () => {
    const script = validateWorkflowScriptSource(VALID_SOURCE);
    expect(script.name).toBe("valid-flow");
    expect(script.meta.description).toBe("A valid workflow");
    expect(script.content).toBe(VALID_SOURCE);
    expect(script.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a meta containing an IIFE structurally, without executing it", () => {
    // The IIFE writes to globalThis if it ever evaluates — the canary proves
    // structural rejection (exit criterion j: rejected 422 without executing).
    const canaryKey = "__wf_meta_canary__";
    const globalRecord = globalThis as Record<string, unknown>;
    delete globalRecord[canaryKey];
    expectValidationFailure(`export const meta = {
  name: (() => { globalThis.${canaryKey} = true; return "evil"; })(),
  description: "computed",
};
await agent("x");
`);
    expect(globalRecord[canaryKey]).toBeUndefined();
  });

  it("rejects computed/template meta values and missing meta", () => {
    expectValidationFailure(`export const meta = { name: \`a\${"b"}\`, description: "d" };
await agent("x");
`);
    expectValidationFailure(`const meta = { name: "no-export", description: "d" };
await agent("x");
`);
  });

  it("rejects determinism-lint findings with the finding details", () => {
    const error = expectValidationFailure(`export const meta = {
  name: "nondeterministic",
  description: "uses wall-clock time",
};

const startedAt = Date.now();
log(String(startedAt));
`);
    expect(JSON.stringify(error.body.details)).toContain("Date.now");
  });
});

// The vm-isolation invariant (exit criterion k) lives in its single canonical
// home: tests/integration/fake/workflows/vm-isolation.test.ts.
