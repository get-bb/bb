import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appSettingsValues, type DbConnection } from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import { createOnboardingContextService } from "../../src/services/system/onboarding-context.js";
import type { TelemetryEvent } from "../../src/services/system/telemetry.js";

let db: DbConnection;
let events: TelemetryEvent[];
let enabled: boolean;
const deps = () => ({
  db,
  telemetry: {
    isEnabled: () => enabled,
    setEnabled: (value: boolean) => {
      enabled = value;
    },
    capture: (event: TelemetryEvent) => {
      if (enabled) events.push(event);
    },
  },
});
const request = { source: "first_run", stage: "agent" } as const;
const definition = {
  key: "agent_setup",
  revision: "fixture_v1",
  stage: "agent",
  eligible: () => true,
} as const;
beforeEach(() => {
  db = createMigratedConnection();
  events = [];
  enabled = true;
});
afterEach(() => db.$client.close());

describe("reviewed onboarding context", () => {
  it("has no active production definition and never invents an eligibility rule", () => {
    expect(createOnboardingContextService(deps()).context(request)).toEqual({
      design_revision: "baseline",
      recommendation_revision: "baseline",
      assignment: null,
    });
    expect(
      createOnboardingContextService(deps(), [
        { ...definition, eligible: null },
      ]).context(request).assignment,
    ).toBeNull();
    expect(
      createOnboardingContextService(deps(), [
        { ...definition, eligible: () => false },
      ]).context(request).assignment,
    ).toBeNull();
    expect(events).toEqual([]);
    expect(
      db
        .select()
        .from(appSettingsValues)
        .all()
        .filter((row) => row.key.startsWith("onboarding-assignment:")),
    ).toEqual([]);
  });
  it("allocates before returning context, keeps one arm across service restarts and rejects forged exposure", () => {
    const service = createOnboardingContextService(deps(), [definition]);
    const first = service.context(request);
    expect(first.assignment).not.toBeNull();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: "onboarding_comparison",
      properties: {
        ...first.assignment,
        phase: "assigned",
        stage: null,
        width_class: null,
        height_class: null,
      },
    });
    expect(
      createOnboardingContextService(deps(), [definition]).context(request),
    ).toEqual(first);
    expect(events).toHaveLength(1);
    expect(
      createOnboardingContextService(deps(), [
        { ...definition, eligible: () => false },
      ]).context(request),
    ).toEqual(first);
    if (first.assignment === null)
      throw new Error("Expected fixture allocation");
    expect(service.acceptsDisplay(first.assignment, "agent")).toBe(true);
    expect(
      service.acceptsDisplay(
        {
          ...first.assignment,
          variant:
            first.assignment.variant === "control" ? "candidate" : "control",
        },
        "agent",
      ),
    ).toBe(false);
    expect(service.acceptsDisplay(first.assignment, "projects")).toBe(false);
    expect(
      createOnboardingContextService(deps()).acceptsDisplay(
        first.assignment,
        "agent",
      ),
    ).toBe(false);
  });
  it("does not replay an opted-out assignment and requires a new revision for a new allocation", () => {
    enabled = false;
    const first = createOnboardingContextService(deps(), [definition]).context(
      request,
    );
    enabled = true;
    expect(
      createOnboardingContextService(deps(), [definition]).context(request),
    ).toEqual(first);
    expect(events).toEqual([]);
    createOnboardingContextService(deps(), [
      { ...definition, revision: "fixture_v2" },
    ]).context(request);
    expect(events).toHaveLength(1);
  });
  it("keeps corrupt persisted assignments unknown without rerandomizing", () => {
    db.insert(appSettingsValues)
      .values({
        key: "onboarding-assignment:agent_setup:fixture_v1",
        value: "malformed",
        updatedAt: 0,
      })
      .run();
    expect(() =>
      createOnboardingContextService(deps(), [definition]).context(request),
    ).toThrow("Stored onboarding assignment is unavailable");
    expect(events).toEqual([]);
  });
});
