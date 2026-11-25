import { createHostId, getHost, hosts } from "@bb/db";
import { createDeferredPromise } from "@bb/test-helpers";
import { afterEach, expect, it, vi } from "vitest";
import { setPluginMachineProviderBridge } from "../../src/services/plugins/plugin-machine-provider-registry.js";
import { runStartupRecoverySweep } from "../../src/services/system/periodic-sweeps.js";
import { installMachineProvider } from "../helpers/machine-provider.js";
import { withTestHarness } from "../helpers/test-app.js";

afterEach(() => {
  setPluginMachineProviderBridge(undefined);
  vi.useRealTimers();
});

it("finishes startup recovery while a persisted machine is still being created", async () => {
  await withTestHarness(async (harness) => {
    const started = createDeferredPromise<void>();
    const release = createDeferredPromise<void>();
    installMachineProvider({
      create: async () => {
        started.resolve();
        await release.promise;
        return { status: "created", name: "Recovered machine", resource: {} };
      },
    });
    const hostId = createHostId();
    harness.db
      .insert(hosts)
      .values({
        id: hostId,
        name: "Pending machine",
        type: "persistent",
        machineProviderId: "test-machine",
        machineOperationId: "test-machine-plugin:startup",
        launchKey: "startup-recovery",
        inputs: null,
        attempt: 1,
        phase: "creating",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();
    vi.useFakeTimers();
    let recovered = false;
    const recovery = runStartupRecoverySweep(harness.deps).then(() => {
      recovered = true;
    });
    try {
      await vi.advanceTimersByTimeAsync(1_000);
      await started.promise;
      expect(
        recovered,
        "startup must not wait for machine setup to finish",
      ).toBe(true);
      expect(getHost(harness.db, hostId)?.phase).toBe("creating");
    } finally {
      release.resolve();
      await vi.advanceTimersByTimeAsync(0);
      await recovery;
      vi.useRealTimers();
    }
    await expect.poll(() => getHost(harness.db, hostId)?.phase).toBe("active");
  });
});
