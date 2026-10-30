import { describe, expect, it } from "vitest";
import { recordTelemetryEventRequestSchema } from "../src/api/system.js";

const agent = { step: "agent", resource_type: "agent", resource_id: "codex" };
const plugin = {
  step: "plugins",
  resource_type: "plugin",
  resource_id: "browser-automation",
};
const project = {
  step: "projects",
  resource_type: "project",
  resource_id: "project_discovery",
};
const imported = {
  ...project,
  resource_id: "project_import",
  selected_count: 3,
  succeeded_count: 0,
};
function parse(properties: object) {
  return recordTelemetryEventRequestSchema.safeParse({
    name: "onboarding_operation",
    properties: { surface: "onboarding", entry: "first_run", ...properties },
  });
}

describe("onboarding operation telemetry boundary", () => {
  it.each([
    [agent, "install", "command_exit"],
    [agent, "update", "command_exit"],
    [agent, "sign_in", "request"],
    [project, "scan", "request"],
    [imported, "import", "request"],
    [plugin, "install", "job_failed"],
    [plugin, "enable", "request"],
  ])("validates %j %s outcome semantics", (resource, operation, category) => {
    for (const entry of ["first_run", "replay"]) {
      for (const outcome of ["started", "succeeded"]) {
        expect(
          parse({
            ...resource,
            entry,
            operation,
            outcome,
            error_category: null,
            ...(operation === "import"
              ? { succeeded_count: outcome === "succeeded" ? 3 : 0 }
              : {}),
          }).success,
        ).toBe(true);
      }
    }
    for (const error_category of [
      null,
      "request",
      "command_exit",
      "job_failed",
      "unknown",
    ]) {
      expect(
        parse({ ...resource, operation, outcome: "failed", error_category })
          .success,
      ).toBe(error_category === category);
    }
    expect(
      parse({
        ...resource,
        operation,
        outcome: "unknown",
        error_category: "unknown",
      }).success,
    ).toBe(true);
    expect(
      parse({
        ...resource,
        operation,
        outcome: "partial",
        error_category: "request",
        ...(operation === "import" ? { succeeded_count: 1 } : {}),
      }).success,
    ).toBe(operation === "import");
    expect(
      parse({
        ...resource,
        operation,
        outcome: "cancelled",
        error_category: null,
      }).success,
    ).toBe(
      operation === "import" ||
        operation === "sign_in" ||
        (resource.step === "plugins" && operation === "install"),
    );
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
          ...imported,
          operation: "import",
          outcome,
          selected_count,
          succeeded_count,
          error_category,
        }).success,
      ).toBe(false);
    },
  );

  it("keeps provider identities and rejects mismatched resource types and private context", () => {
    const valid = {
      ...agent,
      operation: "install",
      outcome: "succeeded",
      error_category: null,
    };
    for (const resource_id of ["codex", "claude-code"]) {
      const result = parse({ ...valid, resource_id });
      expect(result.success && result.data.properties).toMatchObject({
        resource_id,
      });
    }
    for (const extra of [
      { step: "projects" },
      { resource_type: "plugin" },
      { resource_id: "/private/path" },
      { error: "raw error" },
      { prompt: "private prompt" },
      { operation: "scan" },
      { outcome: "queued" },
      { entry: "unknown" },
      { error_category: "request" },
    ]) {
      expect(parse({ ...valid, ...extra }).success).toBe(false);
    }
    expect(
      parse({ ...agent, operation: "install", outcome: "started" }).success,
    ).toBe(false);
  });
});
