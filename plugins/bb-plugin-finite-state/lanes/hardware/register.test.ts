import { createHash } from "node:crypto";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginContext } from "../../lib/context.js";
import { registerHardware } from "./register.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
afterEach(async () => Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose())));

function file(content: string) {
  return {
    content,
    contentEncoding: "utf8" as const,
    sha256: createHash("sha256").update(content).digest("hex"),
    sizeBytes: Buffer.byteLength(content),
  };
}

describe("hardware registration", () => {
  it("uses the default project source, returns cursor pages, and reports absent KiCad", async () => {
    const schematic = `(kicad_sch (version 20231120) (generator_version \"8.0.4\"))\n`;
    const files = new Map([
      ["/workspace/default/a/a.kicad_sch", file(schematic)],
      ["/workspace/default/b/b.kicad_sch", file(schematic)],
      ["/workspace/default/b/b.kicad_pcb", file("(kicad_pcb (version 20231120))\n")],
    ]);
    const host = createFakePluginHost({
      pluginId: `finite-state-hardware-${Math.random()}`,
      sdk: {
        projects: { get: async () => ({
          id: "project", kind: "standard", name: "Project", gitRemoteUrl: null,
          createdAt: 1, updatedAt: 1,
          sources: [
            { id: "other", projectId: "project", type: "local_path", hostId: "host", path: "/workspace/other", isDefault: false, createdAt: 1, updatedAt: 1 },
            { id: "default", projectId: "project", type: "local_path", hostId: "host", path: "/workspace/default", isDefault: true, createdAt: 1, updatedAt: 1 },
          ],
        }) },
        files: {
          listPaths: async (input) => {
            expect(input.path).toBe("/workspace/default");
            return { paths: [
              { kind: "file" as const, path: "a/a.kicad_pro", name: "a.kicad_pro", score: 1, positions: [] },
              { kind: "file" as const, path: "b/b.kicad_pro", name: "b.kicad_pro", score: 1, positions: [] },
            ], truncated: false };
          },
          read: async (input) => {
            expect(input.rootPath).toBe("/workspace/default");
            const found = files.get(input.path);
            if (!found) throw new Error("ENOENT");
            return found;
          },
        },
      },
    });
    hosts.push(host);
    const ctx = createPluginContext(host.bb);
    ctx.service("hardware.kicad-capability", async () => ({ installed: false, cliPath: null, version: null, supported: false }));
    registerHardware(host.bb, ctx);
    await vi.waitFor(() => expect(host.harness.needsConfigurationMessages).toHaveLength(1));

    const first = await host.harness.behavior.callRpc("hardwareProjectsList", {
      projectId: "project", projectVersionId: null, pageSize: 1, cursor: null,
    });
    expect(first).toMatchObject({ total: 2, items: [{ projectKey: "a/a.kicad_pro" }] });
    const firstCursor = Reflect.get(Object(first), "cursor");
    expect(firstCursor).toEqual(expect.any(String));
    const second = await host.harness.behavior.callRpc("hardwareProjectsList", {
      projectId: "project", projectVersionId: null, pageSize: 1, cursor: firstCursor,
    });
    expect(second).toMatchObject({ total: 2, cursor: null, items: [{ projectKey: "b/b.kicad_pro" }] });

    const status = await host.harness.behavior.callRpc("hardwareArtifactsStatus", {
      projectId: "project", projectVersionId: null, projectKey: "b/b.kicad_pro",
    });
    expect(status).toMatchObject({
      projectKey: "b/b.kicad_pro",
      capability: { installed: false, supported: false },
      artifacts: [],
    });
    const job = await host.harness.behavior.callRpc("hardwareExtractStart", {
      projectId: "project", projectVersionId: null, projectKey: "b/b.kicad_pro",
    });
    const jobId = Reflect.get(Object(job), "jobId");
    await expect(host.harness.behavior.callRpc("hardwareExtractStatus", {
      projectId: "another-project", projectVersionId: null, jobId,
    })).rejects.toThrow(/HW_EXTRACT_JOB_NOT_FOUND/u);
    const service = host.harness.runService("hardware-extraction");
    service.controller.abort();
    await service.done;
    expect(host.harness.registrations.agentTools).toHaveLength(0);
    expect(host.harness.registrations.cli).toBeNull();
  });

  it("truthfully rejects a project without a source", async () => {
    const host = createFakePluginHost({
      pluginId: `finite-state-hardware-empty-${Math.random()}`,
      sdk: { projects: { get: async () => ({ id: "project", kind: "standard", name: "Project", gitRemoteUrl: null, createdAt: 1, updatedAt: 1, sources: [] }) } },
    });
    hosts.push(host);
    const ctx = createPluginContext(host.bb);
    ctx.service("hardware.kicad-capability", async () => ({ installed: false, cliPath: null, version: null, supported: false }));
    registerHardware(host.bb, ctx);
    await expect(host.harness.behavior.callRpc("hardwareProjectsList", {
      projectId: "project", projectVersionId: null, pageSize: 50, cursor: null,
    })).rejects.toThrow(/HW_PROJECT_SOURCE_UNAVAILABLE/u);
    expect(host.harness.needsConfigurationMessages.some((message) => message.includes("workspace source"))).toBe(true);
  });
});
