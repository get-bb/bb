import { describe, expect, it } from "vitest";
import { mapProviderMaintenanceRequests } from "./provider-maintenance-concurrency.js";

describe("mapProviderMaintenanceRequests", () => {
  it("limits a large provider roster to three concurrent requests", async () => {
    let active = 0;
    let maximumActive = 0;
    const providers = Array.from(
      { length: 20 },
      (_, index) => `provider-${index}`,
    );

    const result = await mapProviderMaintenanceRequests(
      providers,
      async (provider) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return `${provider}:ready`;
      },
    );

    expect(maximumActive).toBe(3);
    expect(result).toEqual(providers.map((provider) => `${provider}:ready`));
  });
});
