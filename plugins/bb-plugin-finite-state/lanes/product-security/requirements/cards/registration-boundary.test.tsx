import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createPluginContext } from "../../../../lib/context.js";
import { registerRequirementsCardsBackend } from "./backend.js";
import { requirementSemanticSha256, serializeRequirement } from "./adapter.js";
import type { RequirementYamlV1 } from "./schema.js";
import { reqIdKey } from "../../../../lib/sync/registry.js";
import { rpcContract } from "../../../../shared/contract.js";

const cardsDirectory = dirname(fileURLToPath(import.meta.url));

function localRequirement(id: string): RequirementYamlV1 {
  return {
    schema: "fs-requirement/v1",
    id,
    req_type: "security",
    priority: "P1",
    status: "draft",
    ears: {
      pattern: "ubiquitous",
      text: "The gateway SHALL reject unsigned firmware",
      parts: { system: "gateway", response: "reject unsigned firmware" },
    },
    source_description: "Protect the update trust boundary.",
    mitigations: [], controls: [], standards: [], verification: [],
  };
}

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

  it("resolves host-listed relative paths beneath the requirements directory", async () => {
    const host = createFakePluginHost({
      pluginId: "finite-state",
      sdk: {
        projects: {
          get: () => ({
            sources: [{ hostId: "host-1", path: "/workspace", isDefault: true }],
          }),
        },
        files: {
          list: () => ({
            files: [{ name: "REQ-valid.yaml", path: "REQ-valid.yaml" }],
            truncated: false,
          }),
          read: () => ({
            content: serializeRequirement(localRequirement("REQ-valid")),
            contentEncoding: "utf8" as const,
            sha256: "a".repeat(64),
          }),
        },
      },
    });
    registerRequirementsCardsBackend(host.bb, createPluginContext(host.bb));
    const result = rpcContract.requirementsList.output.parse(
      await host.harness.callRpc("requirementsList", {
        projectId: "project-1",
        projectVersionId: null,
        pageSize: 50,
        continuation: null,
        filters: {},
      }),
    );
    expect(result.items.map((item) => item.key)).toEqual(["REQ-valid"]);
    expect(host.harness.sdk.callsTo("files.read")[0]?.[0]).toEqual(expect.objectContaining({
      path: "/workspace/product-security/requirements/REQ-valid.yaml",
      rootPath: "/workspace",
    }));
    await host.harness.lifecycle.dispose();
  });

  it("isolates malformed and nested YAML with file-and-line diagnostics", async () => {
    const host = createFakePluginHost({
      pluginId: "finite-state",
      sdk: {
        projects: { get: () => ({ sources: [{ hostId: "host-1", path: "/workspace", isDefault: true }] }) },
        files: {
          list: () => ({
            files: [
              { name: "REQ-valid.yaml", path: "/workspace/product-security/requirements/REQ-valid.yaml" },
              { name: "REQ-bad.yaml", path: "/workspace/product-security/requirements/REQ-bad.yaml" },
              { name: "REQ-nested.yaml", path: "/workspace/product-security/requirements/nested/REQ-nested.yaml" },
            ],
            truncated: false,
          }),
          read: ({ path }: { path: string }) => ({
            content: path.endsWith("REQ-valid.yaml") ? serializeRequirement(localRequirement("REQ-valid")) : "schema: [\n",
            contentEncoding: "utf8" as const,
            sha256: "a".repeat(64),
          }),
        },
      },
    });
    registerRequirementsCardsBackend(host.bb, createPluginContext(host.bb));
    const result = rpcContract.requirementsList.output.parse(await host.harness.callRpc("requirementsList", {
      projectId: "project-1", projectVersionId: null, pageSize: 50, continuation: null, filters: {},
    }));
    expect(result.items.map((item) => item.key)).toEqual(["REQ-valid"]);
    expect(result.cache.message).toContain("product-security/requirements/nested/REQ-nested.yaml:1 NESTED_REQUIREMENT_FILE");
    expect(result.cache.message).toContain("And 1 more invalid requirement file.");
    await host.harness.lifecycle.dispose();
  });

  it.each([4, 5, 8])(
    "keeps valid cards when %i invalid files exceed the diagnostic transport budget",
    async (invalidCount) => {
      const invalidFiles = Array.from({ length: invalidCount }, (_, index) => {
        const name = `REQ-bad-${String(index).padStart(2, "0")}.yaml`;
        return { name, path: `/workspace/product-security/requirements/${name}` };
      });
      const host = createFakePluginHost({
        pluginId: "finite-state",
        sdk: {
          projects: {
            get: () => ({
              sources: [{ hostId: "host-1", path: "/workspace", isDefault: true }],
            }),
          },
          files: {
            list: () => ({
              files: [
                ...invalidFiles,
                {
                  name: "REQ-valid.yaml",
                  path: "/workspace/product-security/requirements/REQ-valid.yaml",
                },
              ],
              truncated: false,
            }),
            read: ({ path }: { path: string }) => ({
              content: path.endsWith("REQ-valid.yaml")
                ? serializeRequirement(localRequirement("REQ-valid"))
                : "schema: [\n",
              contentEncoding: "utf8" as const,
              sha256: "a".repeat(64),
            }),
          },
        },
      });
      registerRequirementsCardsBackend(host.bb, createPluginContext(host.bb));
      const result = rpcContract.requirementsList.output.parse(
        await host.harness.callRpc("requirementsList", {
          projectId: "project-1",
          projectVersionId: null,
          pageSize: 50,
          continuation: null,
          filters: {},
        }),
      );
      expect(result.items.map((item) => item.key)).toEqual(["REQ-valid"]);
      expect(result.cache.message).toContain(
        "product-security/requirements/REQ-bad-00.yaml:2 YAML_PARSE",
      );
      expect(result.cache.message).toContain(`And ${invalidCount - 1} more invalid requirement files.`);
      expect(result.cache.message?.length).toBeLessThanOrEqual(500);
      await host.harness.lifecycle.dispose();
    },
  );

  it.each(["REQ-api-key-rotation", "REQ-authorization-boundary"])(
    "sanitizes credential-shaped diagnostic ids without losing valid cards: %s",
    async (invalidId) => {
      const host = createFakePluginHost({
        pluginId: "finite-state",
        sdk: {
          projects: {
            get: () => ({
              sources: [{ hostId: "host-1", path: "/workspace", isDefault: true }],
            }),
          },
          files: {
            list: () => ({
              files: [
                {
                  name: `${invalidId}.yaml`,
                  path: `/workspace/product-security/requirements/${invalidId}.yaml`,
                },
                {
                  name: "REQ-valid.yaml",
                  path: "/workspace/product-security/requirements/REQ-valid.yaml",
                },
              ],
              truncated: false,
            }),
            read: ({ path }: { path: string }) => ({
              content: path.endsWith("REQ-valid.yaml")
                ? serializeRequirement(localRequirement("REQ-valid"))
                : "schema: [\n",
              contentEncoding: "utf8" as const,
              sha256: "a".repeat(64),
            }),
          },
        },
      });
      registerRequirementsCardsBackend(host.bb, createPluginContext(host.bb));
      const result = rpcContract.requirementsList.output.parse(
        await host.harness.callRpc("requirementsList", {
          projectId: "project-1",
          projectVersionId: null,
          pageSize: 50,
          continuation: null,
          filters: {},
        }),
      );
      expect(result.items.map((item) => item.key)).toEqual(["REQ-valid"]);
      expect(result.cache.message).toContain(
        "product-security/requirements/REQ-[redacted]",
      );
      expect(result.cache.message).toContain("YAML_PARSE");
      expect(result.cache.message).not.toMatch(
        /(?:authorization|bearer\s|api[_-]?key|token=|https?:\/\/[^\s]*[?@])/iu,
      );
      expect(result.cache.message?.length).toBeLessThanOrEqual(500);
      await host.harness.lifecycle.dispose();
    },
  );

  it("resolves the project source once and reuses the 5,000-file snapshot across pages", async () => {
    const files = Array.from({ length: 5_000 }, (_, index) => {
      const name = `REQ-${String(index).padStart(4, "0")}.yaml`;
      return { name, path: `/workspace/product-security/requirements/${name}` };
    });
    const host = createFakePluginHost({
      pluginId: "finite-state",
      sdk: {
        projects: { get: () => ({ sources: [{ hostId: "host-1", path: "/workspace", isDefault: true }] }) },
        files: {
          list: () => ({ files, truncated: false }),
          read: ({ path }: { path: string }) => {
            const id = path.split("/").at(-1)!.replace(/\.yaml$/u, "");
            return { content: serializeRequirement(localRequirement(id)), contentEncoding: "utf8" as const, sha256: "a".repeat(64) };
          },
        },
      },
    });
    registerRequirementsCardsBackend(host.bb, createPluginContext(host.bb));
    const first = rpcContract.requirementsList.output.parse(await host.harness.callRpc("requirementsList", {
      projectId: "project-1", projectVersionId: null, pageSize: 100, continuation: null, filters: {},
    }));
    await host.harness.callRpc("requirementsList", {
      projectId: "project-1", projectVersionId: null, pageSize: 100, continuation: first.next, filters: {},
    });
    expect(host.harness.sdk.callsTo("projects.get")).toHaveLength(1);
    expect(host.harness.sdk.callsTo("files.list")).toHaveLength(1);
    expect(host.harness.sdk.callsTo("files.read")).toHaveLength(5_000);
    await host.harness.lifecycle.dispose();
  }, 30_000);

  it("merges local YAML over cached requirements and uses the accepted version for stale overlays", async () => {
    const cachedLocal = localRequirement("REQ-local");
    const editedLocal = {
      ...cachedLocal,
      source_description: "Locally revised trust boundary.",
    };
    const cachedOnly = localRequirement("REQ-cached");
    const host = createFakePluginHost({
      pluginId: "finite-state",
      sdk: {
        projects: { get: () => ({ sources: [{ hostId: "host-1", path: "/workspace", isDefault: true }] }) },
        files: {
          list: () => ({ files: [{ name: "REQ-local.yaml", path: "/workspace/product-security/requirements/REQ-local.yaml" }], truncated: false }),
          read: () => ({ content: serializeRequirement(editedLocal), contentEncoding: "utf8" as const, sha256: "d".repeat(64) }),
        },
      },
    });
    const context = createPluginContext(host.bb);
    const db = context.db();
    db.prepare(`INSERT INTO pull_generation
      (project_id, project_version_id, generation_id, status, requested_kinds_json, started_at, completed_at, accepted_at)
      VALUES (?, ?, ?, 'accepted', '["requirement"]', ?, ?, ?)`)
      .run("project-1", "version-7", "generation-7", "2026-08-12T12:00:00Z", "2026-08-12T12:00:00Z", "2026-08-12T12:00:00Z");
    db.prepare(`INSERT INTO sync_state
      (project_id, project_version_id, entity_kind, accepted_generation_id, base_revision, last_pull)
      VALUES (?, ?, 'requirement', ?, 1, ?)`)
      .run("project-1", "version-7", "generation-7", "2026-08-12T12:00:00Z");
    const insertSnapshot = db.prepare(`INSERT INTO base_snapshot
      (project_id, project_version_id, entity_kind, generation_id, entity_key, payload, content_hash, pulled_at)
      VALUES (?, ?, 'requirement', ?, ?, ?, ?, ?)`);
    for (const requirement of [cachedLocal, cachedOnly]) {
      insertSnapshot.run("project-1", "version-7", "generation-7", reqIdKey({ reqId: requirement.id }), JSON.stringify(requirement), requirementSemanticSha256(requirement), "2026-08-12T12:00:00Z");
    }
    db.prepare(`INSERT INTO verification_results
      (project_id, project_version_id, generation_id, result_id, requirement_key, tier, status, fs_version_id, is_latest, raw, pulled_at)
      VALUES (?, ?, ?, ?, ?, 'static', 'verified', 'version-6', 1, '{}', ?)`)
      .run("project-1", "version-7", "generation-7", "result-1", reqIdKey({ reqId: "REQ-local" }), "2026-08-12T12:00:00Z");
    registerRequirementsCardsBackend(host.bb, context);
    const result = rpcContract.requirementsList.output.parse(await host.harness.callRpc("requirementsList", {
      projectId: "project-1", projectVersionId: null, pageSize: 50, continuation: null, filters: {},
    }));
    expect(result.items.map((item) => item.key).sort()).toEqual(["REQ-cached", "REQ-local"]);
    expect(result.items.every((item) => item.projectVersionId === "version-7")).toBe(true);
    const local = result.items.find((item) => item.key === "REQ-local");
    expect(local?.fields).toEqual(expect.objectContaining({ stale: true, local: true, sourceSha256: "d".repeat(64) }));
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
