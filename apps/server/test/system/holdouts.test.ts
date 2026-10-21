import { getAppSettings } from "@bb/db";
import { describe, expect, it, vi } from "vitest";
import { withTestHarness } from "../helpers/test-app.js";
import { readJson } from "../helpers/json.js";

const path = "/api/v1/system/holdouts/app_aa_check/exposure";

describe("holdout interfaces", () => {
  it("lists persisted assignments and rejects unregistered keys and app-submitted exposure telemetry", async () => {
    await withTestHarness(async (harness) => {
      expect(
        await readJson(await harness.app.request("/api/v1/system/holdouts")),
      ).toEqual({ assignments: harness.deps.holdouts.list() });
      expect(
        (
          await harness.app.request(
            "/api/v1/system/holdouts/unknown/exposure",
            { method: "POST" },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await harness.app.request("/api/v1/system/telemetry/events", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: "experiment_exposed",
              properties: { experiment_id: "app_aa_check", variant: "test" },
            }),
          })
        ).status,
      ).toBe(400);
    });
  });

  it("exposes before setup completion and records once across clients", async () => {
    await withTestHarness(async (harness) => {
      const capture = vi.fn();
      harness.deps.telemetry = { capture, setEnabled: vi.fn() };
      const expose = async () =>
        readJson(await harness.app.request(path, { method: "POST" }));
      expect(getAppSettings(harness.db).onboardingCompletedAt).toBeNull();
      const results = await Promise.all(Array.from({ length: 8 }, expose));
      expect(
        results.filter(
          (result) =>
            JSON.stringify(result) === JSON.stringify({ exposed: true }),
        ),
      ).toHaveLength(1);
      expect(capture).toHaveBeenCalledTimes(1);
      expect(capture).toHaveBeenCalledWith({
        name: "experiment_exposed",
        properties: {
          experiment_id: "app_aa_check",
          variant: harness.deps.holdouts.arm("app_aa_check"),
        },
      });
    });
  });
});
