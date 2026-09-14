import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  getNonDestroyedHostByLaunchKey,
  listPublicHosts,
  hosts,
  setAppSettings,
} from "@bb/db";
import { defaultAppSettings } from "@bb/domain";
import type { ServerAccessGrant } from "@get-bb/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { getMachineEnrollmentService } from "../../../src/services/machines/machine-services.js";
import { serverAccess } from "../../../src/services/machines/server-access.js";
import { setPluginEnvironmentProviderBridge } from "../../../src/services/plugins/plugin-environment-provider-registry.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

async function installPlugin(harness: TestAppHarness, id: string) {
  const root = join(harness.config.dataDir, `bb-plugin-${id}`);
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: `bb-plugin-${id}`,
      version: "0.1.0",
      type: "module",
      bb: {
        name: id,
        description: "Machine enrollment regression fixture",
        branding: { icon: "Zap" },
        server: "./server.js",
      },
    }),
  );
  await writeFile(
    join(root, "server.js"),
    `export default function(bb) {
    bb.experimental_machines.register({
      id: "${id}-machine", displayName: "Runtime machine",
      description: "Provision a runtime test machine.", icon: "Terminal",

      reconcileCleanup: async () => ({ status: "removed" }),
      create: async () => ({ status: "failed", message: "unused" }),
      remove: async () => ({ status: "removed" })
    });
  }`,
  );
  const installed = await harness.pluginService.installPath(root);
  expect(installed.status).toBe("running");
  const api = harness.pluginService.getApi(id);
  if (!api) throw new Error("Plugin API was not loaded");
  return api;
}

function launch(harness: TestAppHarness, key: string, providerId: string) {
  harness.db
    .insert(hosts)
    .values({
      id: `host_${key}`,
      name: "Runtime machine",
      type: "persistent",
      machineProviderId: providerId,
      machineOperationId: "enrollment-runtime:operation",
      launchKey: key,
      attempt: 1,
      phase: "creating",
      statusMessage: "checkpoint step",
      pendingLog: "checkpoint log",
      resource: { checkpoint: "preserve" },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
}

describe("production machine enrollment wiring", () => {
  it("reads the current core resource across plugins without diagnostic storage", async () => {
    await withTestHarness(async (h) => {
      const api = await installPlugin(h, "resource-reader");
      const hostId = "resource-host";
      h.db
        .insert(hosts)
        .values({
          id: hostId,
          name: "Existing machine",
          type: "persistent",
          machineProviderId: "another-plugin-machine",
          resource: { sandboxId: "sandbox-existing" },
          createdAt: 1,
          updatedAt: 1,
        })
        .run();
      expect(await api.experimental_machines.getResource(hostId)).toEqual({
        sandboxId: "sandbox-existing",
      });
      h.db
        .update(hosts)
        .set({ resource: { sandboxId: null, snapshotImageId: "image-1" } })
        .where(eq(hosts.id, hostId))
        .run();
      expect(await api.experimental_machines.getResource(hostId)).toEqual({
        sandboxId: null,
        snapshotImageId: "image-1",
      });
      h.db
        .update(hosts)
        .set({ resource: null })
        .where(eq(hosts.id, hostId))
        .run();
      expect(await api.experimental_machines.getResource(hostId)).toBeNull();
      expect(
        await api.experimental_machines.getResource("missing-host"),
      ).toBeNull();
    });
  });

  it("reserves the launch host through the loaded plugin and reuses production connection state", async () => {
    await withTestHarness(async (h) => {
      setAppSettings(h.db, {
        ...defaultAppSettings,
        defaultMachineAccess: "direct",
        machineServerUrl: "https://machine.example.test",
      });
      const api = await installPlugin(h, "enrollment-runtime");
      launch(h, "runtime-launch", "enrollment-runtime-machine");
      const enrollments = getMachineEnrollmentService(h.deps).forOwner(
        "enrollment-runtime",
      );
      const enrollment = await enrollments.prepare({
        signal: new AbortController().signal,
        key: "runtime-launch",
      });
      expect(
        getNonDestroyedHostByLaunchKey(h.db, "runtime-launch"),
      ).toMatchObject({
        id: enrollment.hostId,
        resource: { checkpoint: "preserve" },
        pendingLog: "checkpoint log",
      });
      expect(getMachineEnrollmentService(h.deps)).toBe(
        getMachineEnrollmentService(h.deps),
      );
      const reissued = await enrollments.prepare({
        signal: new AbortController().signal,
        key: "runtime-launch",
      });
      expect(reissued).toMatchObject({
        id: enrollment.id,
        hostId: enrollment.hostId,
        state: "pending",
      });
      if (enrollment.state !== "pending" || reissued.state !== "pending")
        throw new Error("Expected pending enrollment");
      expect(reissued.bootstrap.credential).not.toBe(
        enrollment.bootstrap.credential,
      );
      const exec = vi.fn(async ({ stdin }: { stdin?: string }) => {
        if (stdin === undefined) throw new Error("Expected enrollment input");
        const input: unknown = JSON.parse(stdin);
        if (
          typeof input !== "object" ||
          input === null ||
          !("credential" in input) ||
          typeof input.credential !== "string"
        ) {
          throw new Error("Expected enrollment credential");
        }
        expect(
          await h.deps.machineAuth.enrollHost({
            hostId: enrollment.hostId,
            token: input.credential,
          }),
        ).not.toBeNull();
        h.hub.registerDaemon("runtime-session", enrollment.hostId, {
          close() {},
          send() {},
        });
        return { exitCode: 0, stdout: "", stderr: "" };
      });
      await expect(
        api.experimental_machines.bootstrap({
          key: "runtime-launch",
          executor: { exec },
          report: { step() {}, log() {} },
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ hostId: enrollment.hostId });
      expect(exec).toHaveBeenCalledOnce();
      expect(
        await enrollments.prepare({
          signal: new AbortController().signal,
          key: "runtime-launch",
        }),
      ).toEqual({
        id: enrollment.id,
        hostId: enrollment.hostId,
        state: "enrolled",
      });
      await expect(
        enrollments.waitForConnection({
          enrollmentId: enrollment.id,
          timeoutMs: 100,
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ hostId: enrollment.hostId });
      await h.pluginService.setEnabled("enrollment-runtime", false);
      expect(() =>
        api.experimental_machines.bootstrap({
          key: "after-disable",
          executor: { exec },
          report: { step() {}, log() {} },
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow();
    });
  });

  it("rejects foreign launches, checkpoints before failed access, and releases with the original owner key", async () => {
    await withTestHarness(async (h) => {
      const api = await installPlugin(h, "enrollment-runtime");
      await installPlugin(h, "enrollment-other");
      const enrollments = getMachineEnrollmentService(h.deps).forOwner(
        "enrollment-runtime",
      );
      const otherEnrollments = getMachineEnrollmentService(h.deps).forOwner(
        "enrollment-other",
      );
      const release = vi.fn(async () => {});
      const acquire = vi.fn(
        async ({
          hostId,
        }: {
          hostId: string;
        }): Promise<
          ServerAccessGrant | { status: "failed"; message: string }
        > => ({
          id: "runtime-grant",
          serverUrl: "https://machine.example.test",
        }),
      );
      api.experimental_serverAccess.register({
        id: "runtime-access",
        displayName: "Runtime access",
        description: "Reach the server through the runtime test provider.",
        availability: () => ({ status: "available" }),
        acquire,
        release,
      });
      setAppSettings(h.db, {
        ...defaultAppSettings,
        defaultMachineAccess: "runtime-access",
      });
      launch(h, "failure-launch", "enrollment-runtime-machine");
      await expect(
        otherEnrollments.prepare({
          signal: new AbortController().signal,
          key: "failure-launch",
        }),
      ).rejects.toThrow("different plugin");
      acquire.mockResolvedValueOnce({
        status: "failed",
        message: "Cloud device may need dashboard revocation",
      });
      await expect(
        enrollments.prepare({
          signal: new AbortController().signal,
          key: "failure-launch",
        }),
      ).rejects.toThrow();
      const reserved = getNonDestroyedHostByLaunchKey(h.db, "failure-launch");
      expect(reserved?.id).toBeTruthy();
      expect(reserved?.resource).toEqual({ checkpoint: "preserve" });
      expect(
        listPublicHosts(h.db, { includeCreating: true }).find(
          (host) => host.id === reserved?.id,
        )?.statusMessage,
      ).toBe("Cloud device may need dashboard revocation");
      const enrollment = await enrollments.prepare({
        signal: new AbortController().signal,
        key: "failure-launch",
      });
      expect(enrollment.hostId).toBe(reserved?.id);
      expect(
        listPublicHosts(h.db).some((host) => host.id === reserved?.id),
      ).toBe(false);
      await serverAccess.release(h.deps, {
        hostId: enrollment.hostId,
        key: enrollment.hostId,
      });
      expect(release).toHaveBeenCalledWith({
        key: JSON.stringify(["enrollment-runtime", "failure-launch"]),
        grantId: "runtime-grant",
        hostId: enrollment.hostId,
      });
      expect(
        h.db
          .select({ providerId: hosts.serverAccessProviderId })
          .from(hosts)
          .where(eq(hosts.id, enrollment.hostId))
          .get()?.providerId,
      ).toBeNull();
      await expect(
        enrollments.prepare({
          signal: new AbortController().signal,
          key: "standalone",
        }),
      ).rejects.toThrow("host was not found");
    });
  });
});

it("serves a composition's explicit icon instead of the machine provider's icon", async () => {
  await withTestHarness(async (h) => {
    setPluginEnvironmentProviderBridge(h.pluginService.environmentProviders);
    const api = await installPlugin(h, "icon-runtime");
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>';
    await writeFile(
      join(h.config.dataDir, "bb-plugin-icon-runtime", "composition.svg"),
      svg,
    );
    api.experimental_environments.register({
      id: "icon-workspace",
      displayName: "Icon workspace",
      description: "Prepare a workspace for this thread.",
      icon: "Folder",
      create: async () => ({ status: "failed", message: "unused" }),
      remove: async () => ({ status: "removed" }),
    });
    api.experimental_environments.register({
      id: "icon-composition",
      displayName: "Explicit composition",
      description: "Prepare a workspace for this thread.",
      icon: "./composition.svg",
      machineProviderId: "icon-runtime-machine",
      environmentProviderId: "icon-workspace",
    });
    const listing = await h.app.request("/api/v1/system/environment-providers");
    const data = await listing.json();
    const composition = data.providers.find(
      (entry: { id: string }) => entry.id === "icon-composition",
    );
    expect(composition).toMatchObject({
      icon: "./composition.svg",
      logoUrl: expect.stringContaining("environment%3Aicon-composition"),
    });
    const response = await h.app.request(composition.logoUrl);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(svg);
  });
});
