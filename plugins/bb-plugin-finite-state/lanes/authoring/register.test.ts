import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginContext } from "../../lib/context.js";
import plugin from "../../server.js";
import { RPC_WIRE_METHODS } from "../../shared/contract.js";
import type { KicadCapability } from "../hardware/extract/driver.js";
import { registerHardware } from "../hardware/register.js";
import { buildLogPath, buildLogRoot } from "./build/logs.js";
import { createBuildRun, getBuildRun, listBuildRuns } from "./build/runs-store.js";
import { registerAuthoring } from "./register.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
});

describe("authoring registration", () => {
  it("narrows probe history to zero, wires local-auth logs, and recovers queued rows", async () => {
    const host = createFakePluginHost({ pluginId: `fs-authoring-register-${crypto.randomUUID()}` });
    hosts.push(host);
    const ctx = createPluginContext(host.bb);
    const db = ctx.db();
    const logPath = await buildLogPath(db, "build-queued");
    await writeFile(logPath, "prior evidence\n", "utf8");
    await createBuildRun({ db, publish: () => undefined }, {
      projectId: "project-a",
      projectVersionId: "version-a",
      runId: "build-queued",
      kind: "build",
      target: null,
      toolchain: "fixture",
      artifact: null,
      digest: null,
      logPath,
      startedAt: "2026-08-13T12:00:00.000Z",
    });

    const registration = registerAuthoring(host.bb, ctx, {
      toolchains: {
        path: await buildLogRoot(db),
        probes: [
          {
            id: "fixture-missing-compiler",
            binary: "fixture-missing-compiler",
            versionArgs: ["--version"],
            unlocks: "build",
            parse: () => null,
          },
          {
            id: "fixture-missing-west",
            binary: "fixture-missing-west",
            versionArgs: ["--version"],
            unlocks: "zephyr-workspace",
            parse: () => null,
          },
        ],
        probeTimeoutMs: 50,
      },
    });
    const service = host.harness.behavior.runService("authoring-build-supervisor");
    await registration.ready;

    expect(host.harness.inspection.registrations.httpRoutes).toContainEqual(
      expect.objectContaining({
        method: "GET",
        path: "/authoring/build/log",
        auth: "local",
      }),
    );
    expect(logPath.startsWith(`${await buildLogRoot(db)}/`)).toBe(true);

    const probes = listBuildRuns(db, {
      projectId: "project-a",
      projectVersionId: "version-a",
      pageSize: 50,
      cursor: null,
      kinds: ["probe"],
      statuses: [],
    });
    expect(probes).toEqual({ items: [], total: 0, cursor: null });

    expect(
      getBuildRun(
        db,
        { projectId: "project-a", projectVersionId: "version-a" },
        "build-queued",
      )?.status,
    ).toBe("failed");
    expect(await readFile(logPath, "utf8")).toContain(
      "orphaned: plugin restarted while the job was queued",
    );

    const response = await host.harness.behavior.fetchHttp(
      "GET",
      "/authoring/build/log?projectId=project-a&projectVersionId=version-a&runId=build-queued",
      { headers: { Range: "bytes=0-4" } },
    );
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("prior");

    expect(host.harness.inspection.needsConfigurationMessages).toEqual([
      expect.stringContaining(
        "build missing fixture-missing-compiler; zephyr-workspace missing fixture-missing-west",
      ),
    ]);
    service.controller.abort();
    await service.done;
  });

  it("completes real full-lane registration without duplicate frozen RPC methods", async () => {
    const host = createFakePluginHost({ pluginId: `finite-state-full-${crypto.randomUUID()}` });
    hosts.push(host);

    await expect(plugin(host.bb)).resolves.toBeUndefined();

    const registeredMethods = host.harness.inspection.registrations.rpcMethods;
    for (const wireMethod of Object.values(RPC_WIRE_METHODS)) {
      expect(
        registeredMethods.filter((registered) => registered === wireMethod).length,
        `${wireMethod} must not have duplicate production handlers`,
      ).toBeLessThanOrEqual(1);
    }
    expect(
      registeredMethods.filter(
        (registered) => registered === RPC_WIRE_METHODS["benchDev.runs.list"],
      ),
    ).toHaveLength(1);
  });

  it("ignores an absent-KiCad capability result that resolves after disposal", async () => {
    let resolveCapability: ((value: KicadCapability) => void) | undefined;
    const host = createFakePluginHost({ pluginId: `finite-state-disposed-${crypto.randomUUID()}` });
    hosts.push(host);
    const ctx = createPluginContext(host.bb);
    ctx.service(
      "hardware.kicad-capability",
      () =>
        new Promise<KicadCapability>((resolve) => {
          resolveCapability = resolve;
        }),
    );
    const needsConfiguration = vi.spyOn(host.bb.status, "needsConfiguration");
    const unhandledRejections: unknown[] = [];
    const recordUnhandled = (reason: unknown): void => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", recordUnhandled);

    try {
      registerHardware(host.bb, ctx);
      expect(resolveCapability).toBeDefined();

      await host.harness.lifecycle.dispose();
      resolveCapability?.({
        installed: false,
        cliPath: null,
        version: null,
        supported: false,
      });
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(needsConfiguration).not.toHaveBeenCalled();
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", recordUnhandled);
    }
  });
});
