import { createHostId, getHost, hosts } from "@bb/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sweepMachineLifecycles } from "../../src/services/machines/provider-orchestration.js";
import { setPluginMachineProviderBridge } from "../../src/services/plugins/plugin-machine-provider-registry.js";
import { readJson } from "../helpers/json.js";
import { installMachineProvider } from "../helpers/machine-provider.js";
import { seedPrimaryHost } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

afterEach(() => {
  setPluginMachineProviderBridge(undefined);
});

function insertProviderMachine(harness: TestAppHarness, name: string): string {
  const id = createHostId();
  const now = Date.now();
  harness.db
    .insert(hosts)
    .values({
      id,
      name,
      type: "persistent",
      machineProviderId: "test-machine",
      machineOperationId: `test-machine-plugin:${name}`,
      launchKey: `launch-${name}`,
      inputs: null,
      attempt: 1,
      phase: "creating",
      statusMessage: "Creating Test machine…",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

describe("server machine protections", () => {
  it("refuses to suspend or resume the machine that runs the server", () =>
    withTestHarness(async (harness) => {
      installMachineProvider({
        suspend: async () => ({ resource: { id: "vm" } }),
        resume: async () => ({ resource: { id: "vm" } }),
      });
      const serverMachine = insertProviderMachine(harness, "server-vm");
      seedPrimaryHost(harness.deps, serverMachine);

      for (const action of ["suspend", "resume"]) {
        const response = await harness.app.request(
          `/api/v1/hosts/${serverMachine}/${action}`,
          { method: "POST" },
        );
        expect(response.status).toBe(400);
        expect(await readJson(response)).toMatchObject({
          code: "server_host_lifecycle_refused",
        });
      }
      expect(getHost(harness.db, serverMachine)?.phase).toBe("creating");

      const otherMachine = insertProviderMachine(harness, "worker-vm");
      const other = await harness.app.request(
        `/api/v1/hosts/${otherMachine}/suspend`,
        { method: "POST" },
      );
      expect(other.status).toBe(409);
      expect(await readJson(other)).toMatchObject({
        code: "machine_not_active",
      });
    }));

  it("skips the server machine in machine provider lifecycle sweeps", () =>
    withTestHarness(async (harness) => {
      const create = vi.fn(async ({ key }: { key: string }) => ({
        status: "created" as const,
        name: `Created ${key}`,
        resource: { key },
      }));
      installMachineProvider({ create });
      const serverMachine = insertProviderMachine(harness, "server-vm");
      const otherMachine = insertProviderMachine(harness, "worker-vm");
      seedPrimaryHost(harness.deps, serverMachine);

      await sweepMachineLifecycles(harness.deps);

      expect(create.mock.calls.map(([context]) => context.key)).toEqual([
        "launch-worker-vm",
      ]);
      expect(getHost(harness.db, otherMachine)?.phase).toBe("active");
      expect(getHost(harness.db, serverMachine)?.phase).toBe("creating");
    }));
});
