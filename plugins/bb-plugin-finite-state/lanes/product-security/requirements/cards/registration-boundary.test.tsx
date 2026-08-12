import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createPluginContext } from "../../../../lib/context.js";
import { registerRequirementsCardsBackend } from "./backend.js";

const cardsDirectory = dirname(fileURLToPath(import.meta.url));

describe("requirements registration boundary", () => {
  it("registers only the frozen requirement RPC methods", async () => {
    const host = createFakePluginHost({ pluginId: "finite-state" });
    registerRequirementsCardsBackend(host.bb, createPluginContext(host.bb));
    expect([...host.harness.registrations.rpcMethods].sort()).toEqual([
      "requirementsGet",
      "requirementsList",
      "requirementsWrite",
    ]);
    await host.harness.lifecycle.dispose();
  });

  it("creates tracked YAML with a null compare-and-swap fence and no upstream call", async () => {
    const host = createFakePluginHost({
      pluginId: "finite-state",
      sdk: {
        projects: {
          get: () => ({
            sources: [{ hostId: "host-1", path: "/workspace", isDefault: true }],
          }),
        },
        files: {
          write: () => ({ outcome: "written", sha256: "b".repeat(64), sizeBytes: 512 }),
        },
      },
    });
    registerRequirementsCardsBackend(host.bb, createPluginContext(host.bb));
    const result = await host.harness.callRpc("requirementsWrite", {
      projectId: "project-1",
      projectVersionId: null,
      requirementId: "REQ-secure-update",
      expectedContentSha256: null,
      fields: {
        schema: "fs-requirement/v1",
        id: "REQ-secure-update",
        req_type: "security",
        priority: "P1",
        status: "draft",
        ears: {
          pattern: "ubiquitous",
          text: "The gateway SHALL reject unsigned firmware",
          parts: { system: "gateway", response: "reject unsigned firmware" },
        },
        source_description: "Protect the update trust boundary.",
        mitigations: [],
        controls: [],
        standards: [],
        verification: [],
      },
    });

    expect(result).toEqual(expect.objectContaining({
      beforeSha256: null,
      afterSha256: "b".repeat(64),
      stableKey: "REQ-secure-update",
    }));
    expect(host.harness.sdk.callsTo("files.write")[0]?.[0]).toEqual(expect.objectContaining({
      path: "/workspace/product-security/requirements/REQ-secure-update.yaml",
      rootPath: "/workspace",
      expectedSha256: null,
      createParents: true,
    }));
    expect(host.harness.inspection.realtimeSignals).toEqual([{
      channel: "requirements:changed",
      payload: { projectId: "project-1", requirementId: "REQ-secure-update" },
    }]);
    expect(host.harness.sdk.calls.map((call) => call.path)).toEqual([
      "projects.get",
      "files.write",
    ]);
    await host.harness.lifecycle.dispose();
  });

  it("treats a missing tracked directory as an empty local set", async () => {
    const host = createFakePluginHost({
      pluginId: "finite-state",
      sdk: {
        projects: {
          get: () => ({
            sources: [{ hostId: "host-1", path: "/workspace", isDefault: true }],
          }),
        },
        files: {
          list: () => { throw new Error("ENOENT: directory does not exist"); },
        },
      },
    });
    registerRequirementsCardsBackend(host.bb, createPluginContext(host.bb));
    await expect(host.harness.callRpc("requirementsList", {
      projectId: "project-1",
      projectVersionId: null,
      pageSize: 50,
      continuation: null,
      filters: {},
    })).resolves.toEqual(expect.objectContaining({
      items: [],
      total: 0,
      next: null,
    }));
    await host.harness.lifecycle.dispose();
  });

  it("keeps Node-only persistence outside the browser import graph", () => {
    const appEntry = readFileSync(resolve(cardsDirectory, "index.tsx"), "utf8");
    const backendEntry = readFileSync(resolve(cardsDirectory, "backend.ts"), "utf8");
    const laneServer = readFileSync(resolve(cardsDirectory, "../../register.ts"), "utf8");
    const laneApp = readFileSync(resolve(cardsDirectory, "../../register.app.tsx"), "utf8");

    expect(laneServer).toContain('from "./requirements/cards/backend.js"');
    expect(laneApp).toContain('from "./requirements/cards/index.js"');
    expect(appEntry).not.toMatch(/\.\/adapter\.js|\.\/backend\.js|\.\/query\.js|node:/u);
    expect(backendEntry).toContain('from "./adapter.js"');
  });
});
