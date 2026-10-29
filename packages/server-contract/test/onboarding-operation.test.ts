import { describe, expect, it } from "vitest";
import { recordTelemetryEventRequestSchema } from "../src/api/system.js";

function parse(properties: object) {
  return recordTelemetryEventRequestSchema.safeParse({
    name: "onboarding_operation",
    properties: { entry: "first_run", ...properties },
  });
}

const operations = [
  "agent_install",
  "agent_update",
  "project_scan",
  "project_import",
  "plugin_install",
  "plugin_enable",
] as const;

function counts(operation: string, succeeded = 0) {
  return operation === "project_import"
    ? { selected_count: 3, succeeded_count: succeeded }
    : {};
}

describe("onboarding operation telemetry boundary", () => {
  it.each(operations)("accepts bounded %s observations", (operation) => {
    for (const entry of ["first_run", "replay"]) {
      for (const outcome of ["started", "succeeded"]) {
        expect(
          parse({
            entry,
            operation,
            outcome,
            error_category: null,
            ...counts(operation, outcome === "succeeded" ? 3 : 0),
          }).success,
        ).toBe(true);
      }
      for (const error_category of ["request", "unknown"]) {
        expect(
          parse({
            entry,
            operation,
            outcome: "unknown",
            error_category,
            ...counts(operation, 1),
          }).success,
        ).toBe(true);
      }
    }
  });

  it.each([
    ["agent_install", "command_exit"],
    ["agent_update", "command_exit"],
    ["project_scan", "request"],
    ["project_import", "request"],
    ["plugin_install", "job_failed"],
    ["plugin_enable", "request"],
  ])("requires the actual %s failure boundary", (operation, category) => {
    for (const error_category of [
      null,
      "request",
      "command_exit",
      "job_failed",
      "unknown",
    ]) {
      expect(
        parse({
          operation,
          outcome: "failed",
          error_category,
          ...counts(operation),
        }).success,
      ).toBe(error_category === category);
    }
  });

  it("keeps partial and confirmed cancellation specific to supported operations", () => {
    for (const operation of operations) {
      expect(
        parse({
          operation,
          outcome: "partial",
          error_category: "request",
          ...counts(operation, 1),
        }).success,
      ).toBe(operation === "project_import");
      expect(
        parse({
          operation,
          outcome: "cancelled",
          error_category: null,
          ...counts(operation, 1),
        }).success,
      ).toBe(operation === "project_import" || operation === "plugin_install");
    }
  });

  it.each([
    ["started", 3, 1, null],
    ["succeeded", 3, 2, null],
    ["partial", 3, 0, "request"],
    ["partial", 3, 3, "request"],
    ["failed", 3, 1, "request"],
    ["cancelled", 3, 4, null],
    ["unknown", 3, 4, "request"],
    ["started", 0, 0, null],
    ["started", -1, 0, null],
    ["unknown", 3, -1, "unknown"],
    ["started", 1.5, 0, null],
    ["unknown", 3, 1.5, "request"],
  ])(
    "rejects inconsistent import %s counts %s/%s",
    (outcome, selected_count, succeeded_count, error_category) => {
      expect(
        parse({
          operation: "project_import",
          outcome,
          selected_count,
          succeeded_count,
          error_category,
        }).success,
      ).toBe(false);
    },
  );

  it("retains confirmed counts for cancelled or unknown imports", () => {
    for (const succeeded_count of [0, 1, 3]) {
      for (const outcome of ["cancelled", "unknown"]) {
        expect(
          parse({
            operation: "project_import",
            outcome,
            selected_count: 3,
            succeeded_count,
            error_category: outcome === "unknown" ? "request" : null,
          }).success,
        ).toBe(true);
      }
    }
  });

  it("rejects private fields, missing required fields and invented outcomes", () => {
    const valid = {
      operation: "project_scan",
      outcome: "succeeded",
      error_category: null,
    };
    for (const extra of [
      { path: "/private/project" },
      { provider: "codex" },
      { plugin_name: "private" },
      { error: "raw error" },
      { prompt: "private prompt" },
      { attempt_id: "id" },
      { selected_count: 1 },
      { succeeded_count: 1 },
      { entry: "unknown" },
      { operation: "plugin_disable" },
      { outcome: "queued" },
      { error_category: "raw error" },
      { error_category: "request" },
    ])
      expect(parse({ ...valid, ...extra }).success).toBe(false);
    expect(
      parse({ operation: "project_scan", outcome: "started" }).success,
    ).toBe(false);
    expect(
      recordTelemetryEventRequestSchema.safeParse({
        name: "onboarding_operation",
        properties: valid,
      }).success,
    ).toBe(false);
    expect(
      recordTelemetryEventRequestSchema.safeParse({
        name: "onboarding_operation",
        properties: { entry: "first_run", ...valid },
        raw: "private",
      }).success,
    ).toBe(false);
  });
});
