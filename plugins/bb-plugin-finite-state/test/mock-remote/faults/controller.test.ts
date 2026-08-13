import { describe, expect, it } from "vitest";

import { createFaultController } from "./controller.js";
import {
  AS_COMPONENT_UPDATE_ROUTE,
  PLATFORM_BULK_VEX_ROUTE,
  PLATFORM_FIRMWARE_BYTES_ROUTE,
} from "./scenarios.js";

describe("fault controller contract", () => {
  it("fails installation for unknown scenarios, services, routes, fields, and ignored options", () => {
    const controller = createFaultController();
    const invalid = [
      { name: "unknown", service: "platform", routeIds: [PLATFORM_BULK_VEX_ROUTE] },
      { name: "mid-push-reset", service: "unknown", routeIds: [PLATFORM_BULK_VEX_ROUTE] },
      { name: "mid-push-reset", service: "platform", routeIds: ["platform:GET:/unknown"] },
      { name: "mid-push-reset", service: "platform", routeIds: [PLATFORM_FIRMWARE_BYTES_ROUTE] },
      { name: "mid-push-reset", service: "platform", routeIds: [PLATFORM_BULK_VEX_ROUTE], typo: 1 },
      { name: "as-stale-tara-state", service: "assurance-studio", routeIds: [AS_COMPONENT_UPDATE_ROUTE], times: 1 },
      { name: "platform-vex-partial-failure", service: "platform", routeIds: [PLATFORM_BULK_VEX_ROUTE] },
      { name: "as-key-strip", service: "assurance-studio", routeIds: [AS_COMPONENT_UPDATE_ROUTE] },
    ];
    for (const spec of invalid) {
      expect(() => controller.install(spec as never)).toThrow(/Invalid mock fault scenario/u);
    }
  });

  it("keeps instance and service counters isolated and returns immutable log values", () => {
    const left = createFaultController();
    const right = createFaultController();
    for (const controller of [left, right]) {
      controller.install({
        name: "rate-limit-then-success",
        service: "platform",
        routeIds: [PLATFORM_BULK_VEX_ROUTE],
        times: 1,
      });
    }
    left.install({
      name: "rate-limit-then-success",
      service: "assurance-studio",
      routeIds: [AS_COMPONENT_UPDATE_ROUTE],
      times: 1,
    });

    const request = new Request("http://mock.invalid", { headers: { "X-Request-ID": "request-1" } });
    const platform = left.select("platform", PLATFORM_BULK_VEX_ROUTE, request);
    const assuranceStudio = left.select("assurance-studio", AS_COMPONENT_UPDATE_ROUTE, request);
    const otherInstance = right.select("platform", PLATFORM_BULK_VEX_ROUTE, request);
    expect(platform && platform !== "unknown" ? platform.attempt : null).toBe(1);
    expect(assuranceStudio && assuranceStudio !== "unknown" ? assuranceStudio.attempt : null).toBe(1);
    expect(otherInstance && otherInstance !== "unknown" ? otherInstance.attempt : null).toBe(1);
    if (platform !== null && platform !== "unknown") left.record(platform, "test-effect");
    const log = left.log();
    expect(log).toEqual([{
      scenario: "rate-limit-then-success",
      service: "platform",
      requestId: "request-1",
      routeId: PLATFORM_BULK_VEX_ROUTE,
      attempt: 1,
      effect: "test-effect",
    }]);
    (log[0] as { effect: string }).effect = "changed-copy";
    expect(left.log()[0]?.effect).toBe("test-effect");

    left.clear("platform");
    expect(left.log()).toEqual([]);
    expect(left.select("platform", PLATFORM_BULK_VEX_ROUTE, request)).toBeNull();
    expect(left.select("assurance-studio", AS_COMPONENT_UPDATE_ROUTE, request)).not.toBeNull();
  });
});
