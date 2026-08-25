import { describe, expect, it, vi } from "vitest";
import { createLifecycleDedupers } from "../../../src/lifecycle-dedupers.js";
import { publishProviderModelsChanged } from "../../../src/services/system/provider-model-cache.js";

const empty = { models: [], selectedOnlyModels: [] };

describe("provider model cache invalidation", () => {
  it("drops the named host's settled catalogs, keeps the others, and notifies picker clients", async () => {
    const { providerModelList } = createLifecycleDedupers();
    const hostOneKey = JSON.stringify(["host-1", "session-1", { providerId: "pi" }]);
    const hostTwoKey = JSON.stringify(["host-2", "session-2", { providerId: "pi" }]);
    const firstProbe = vi.fn(async () => empty);
    await providerModelList.run(hostOneKey, firstProbe);
    await providerModelList.run(hostOneKey, firstProbe);
    await providerModelList.run(hostTwoKey, firstProbe);
    expect(firstProbe).toHaveBeenCalledTimes(2);
    const notifySystem = vi.fn();

    publishProviderModelsChanged({ providerModelList, notifySystem, hostId: "host-1" });

    const secondProbe = vi.fn(async () => empty);
    await providerModelList.run(hostOneKey, secondProbe);
    await providerModelList.run(hostTwoKey, secondProbe);
    // host-1 was refetched; host-2's catalog was still good.
    expect(secondProbe).toHaveBeenCalledOnce();
    expect(notifySystem).toHaveBeenCalledWith(["provider-models-changed"]);
  });
});
