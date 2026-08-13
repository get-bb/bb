import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginContext } from "../../../lib/context.js";
import { PlatformClient } from "../../../lib/remote/platform/client.js";
import { openManifest } from "../cache/manifest.js";
import { createFirmwareCacheService } from "../register.js";
import { createFaultController } from "../../../test/mock-remote/faults/controller.js";
import { withFaultMiddleware } from "../../../test/mock-remote/faults/middleware.js";
import {
  PLATFORM_FIRMWARE_BYTES_ROUTE,
  PLATFORM_FIRMWARE_RANGE_ROUTE,
} from "../../../test/mock-remote/faults/scenarios.js";
import { registerMockPlatformFirmware, MOCK_PLATFORM_ADMIN_PERMISSION } from "../../../test/mock-remote/platform/firmware.js";
import { createMockRemote, type MockRemoteHarness } from "../../../test/mock-remote/server.js";
import { ADMIN_BYTES_RECOVERY } from "./admin-gate.js";
import { materializeFromApi, type ApiFirmwareDeps } from "./fallback.js";

const roots: string[] = [];
const harnesses: MockRemoteHarness[] = [];
const fixtureRoot = fileURLToPath(new URL("../../../test/mock-remote/fixtures", import.meta.url));

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("API firmware admin gate", () => {
  it("records the verified 403 once, preserves metadata, and directs recovery to local unpack", async () => {
    const controller = createFaultController();
    controller.install({
      name: "platform-firmware-bytes-forbidden",
      service: "platform",
      routeIds: [PLATFORM_FIRMWARE_BYTES_ROUTE, PLATFORM_FIRMWARE_RANGE_ROUTE],
    });
    const harness = createMockRemote({
      platformToken: "token",
      assuranceStudioKey: "as-key",
      fixtureRoot,
      register(service, registry) {
        if (service === "platform") {
          registerMockPlatformFirmware(withFaultMiddleware(service, registry, controller), fixtureRoot);
        }
      },
    });
    harnesses.push(harness);
    let byteCalls = 0;
    const client = new PlatformClient({
      baseUrl: "https://platform.invalid",
      token: "token",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const headers = new Headers(request.headers);
        headers.set("X-Mock-Permissions", MOCK_PLATFORM_ADMIN_PERMISSION);
        headers.set("X-FS-Mock-Scenario", "platform-firmware-bytes-forbidden");
        if (new URL(request.url).pathname.endsWith("/file")) byteCalls += 1;
        return harness.platform.fetch(new Request(request, { headers }));
      },
    });

    const root = await mkdtemp(join(tmpdir(), "fs-api-admin-"));
    roots.push(root);
    execFileSync("git", ["init", "--quiet", root]);
    await writeFile(join(root, ".gitignore"), ".fs-firmware/\n", "utf8");
    const host = createFakePluginHost({ pluginId: "finite-state" });
    const ctx = createPluginContext(host.bb);
    const scope = {
      worktreeRoot: await realpath(root),
      projectId: "project-1",
      projectVersionId: "pv-a481df87dadf",
      generationId: "generation-1",
    };
    ctx.db().prepare(`INSERT INTO pull_generation (
      project_id, project_version_id, generation_id, status, requested_kinds_json, started_at
    ) VALUES (?, ?, ?, 'accepted', '[]', ?)`).run(
      scope.projectId,
      scope.projectVersionId,
      scope.generationId,
      new Date(0).toISOString(),
    );
    const deps: ApiFirmwareDeps = {
      platform: client,
      scope,
      cache: createFirmwareCacheService(ctx),
      now: () => new Date(0),
    };

    try {
      await materializeFromApi(deps, { pvId: scope.projectVersionId, mode: "metadata" }, new AbortController().signal);
      await expect(materializeFromApi(deps, {
        pvId: scope.projectVersionId,
        mode: "files",
        paths: ["/empty.dat"],
      }, new AbortController().signal)).rejects.toMatchObject({
        code: "FIRMWARE_ADMIN_BYTES_REQUIRED",
        message: ADMIN_BYTES_RECOVERY,
      });
      expect(byteCalls).toBe(1);
      expect(controller.log()).toHaveLength(1);
      const manifest = openManifest(scope.worktreeRoot, scope.projectVersionId);
      expect(manifest.readMeta()).toMatchObject({ adminBytesOk: false, fullyMaterialized: false });
      expect(manifest.getNode("/empty.dat")).toMatchObject({ kind: "file", materialized: false });
      expect(manifest.listNodes().length).toBeGreaterThan(0);
      expect(manifest.readMeta()?.unpackErrors).toContain(ADMIN_BYTES_RECOVERY);
      manifest.close();
    } finally {
      client.close();
    }
  });
});
