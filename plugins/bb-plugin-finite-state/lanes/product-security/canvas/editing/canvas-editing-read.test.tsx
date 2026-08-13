import { createHash } from "node:crypto";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginContext } from "../../../../lib/context.js";
import { ENTITIES } from "../../../../lib/sync/registry.js";
import { rpcContract } from "../../../../shared/contract.js";
import { registerCanvasEditingBackend } from "./backend.js";
import {
  architectureEntityPayload,
  parseArchitectureEntity,
  type ArchitectureYamlEntity,
  type CanvasEntityKind,
} from "./schema.js";
import { serializeCanvasEntity } from "./writer.js";

const PROJECT = "project-read-only";
const VERSION = "@project";
const GENERATION = "generation-read-only";
const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
});

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function component(slug: string): ArchitectureYamlEntity {
  return parseArchitectureEntity("component", {
    slug,
    name: slug,
    component_type: "software",
    criticality: "high",
    interfaces: [],
    technologies: [],
    is_entry_point: false,
    stores_data: false,
  });
}

function dataflow(
  slug: string,
  from: string,
  to: string,
): ArchitectureYamlEntity {
  return parseArchitectureEntity("dataflow", {
    slug,
    name: slug,
    from,
    to,
    data_types: ["telemetry"],
    encrypted: true,
    authenticated: true,
    bidirectional: false,
  });
}

function seedAccepted(
  context: ReturnType<typeof createPluginContext>,
  entities: readonly ArchitectureYamlEntity[],
): void {
  const kinds = [...new Set(entities.map((entity) => entity.kind))];
  const db = context.db();
  db.prepare(
    `INSERT INTO pull_generation
       (project_id, project_version_id, generation_id, status,
        requested_kinds_json, started_at, completed_at, accepted_at)
     VALUES (?, ?, ?, 'accepted', ?, ?, ?, ?)`,
  ).run(
    PROJECT,
    VERSION,
    GENERATION,
    JSON.stringify(kinds),
    "2026-08-13T12:00:00.000Z",
    "2026-08-13T12:00:01.000Z",
    "2026-08-13T12:00:01.000Z",
  );
  const insertSync = db.prepare(
    `INSERT INTO sync_state
       (project_id, project_version_id, entity_kind, accepted_generation_id,
        base_revision, last_pull, error)
     VALUES (?, ?, ?, ?, 1, ?, NULL)`,
  );
  const insertSnapshot = db.prepare(
    `INSERT INTO base_snapshot
       (project_id, project_version_id, entity_kind, generation_id,
        entity_key, remote_id, payload, content_hash, pulled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const kind of kinds) {
    insertSync.run(
      PROJECT,
      VERSION,
      kind,
      GENERATION,
      "2026-08-13T12:00:01.000Z",
    );
  }
  for (const entity of entities) {
    const payload = architectureEntityPayload(entity);
    const encoded = JSON.stringify(payload);
    insertSnapshot.run(
      PROJECT,
      VERSION,
      entity.kind,
      GENERATION,
      ENTITIES[entity.kind].key(payload),
      `remote-${entity.slug}`,
      encoded,
      hash(encoded),
      "2026-08-13T12:00:01.000Z",
    );
  }
}

describe("WP-35 read-classified editing RPCs", () => {
  it("loads accepted entities and computes impact without materializing YAML", async () => {
    const writes = vi.fn(() => {
      throw new Error("read-classified RPC attempted a file write");
    });
    const moves = vi.fn(() => {
      throw new Error("read-classified RPC attempted a file move");
    });
    const removes = vi.fn(() => {
      throw new Error("read-classified RPC attempted a file remove");
    });
    const host = createFakePluginHost({
      pluginId: "finite-state-editing-read-only",
      sdk: {
        projects: {
          get: ({ projectId }) => ({
            id: projectId,
            sources: [
              { hostId: "host-1", path: "/workspace", isDefault: true },
            ],
          }),
        },
        files: {
          list: () => ({ files: [], truncated: false }),
          read: ({ path }) => {
            throw Object.assign(new Error(`ENOENT: ${path}`), {
              code: "ENOENT",
            });
          },
          write: writes,
          move: moves,
          remove: removes,
        },
      },
    });
    hosts.push(host);
    const context = createPluginContext(host.bb);
    const gateway = component("gateway");
    seedAccepted(context, [
      gateway,
      component("cloud"),
      dataflow("telemetry", "gateway", "cloud"),
    ]);
    registerCanvasEditingBackend(host.bb, context);

    const loaded = await host.harness.callRpc("canvasEditingLoad", {
      projectId: PROJECT,
      projectVersionId: null,
      kind: "component" as CanvasEntityKind,
      slug: "gateway",
    });
    expect(loaded).toMatchObject({
      state: "ready",
      kind: "component",
      slug: "gateway",
      sha256: hash(serializeCanvasEntity(gateway)),
    });
    const impact = rpcContract.taraDeleteImpact.output.parse(
      await host.harness.callRpc("taraDeleteImpact", {
        projectId: PROJECT,
        projectVersionId: null,
        kind: "component",
        stableKey: "gateway",
      }),
    );
    expect(impact.referrers).toEqual([
      expect.objectContaining({
        kind: "dataflow",
        stableKey: "telemetry",
      }),
    ]);
    expect(writes).not.toHaveBeenCalled();
    expect(moves).not.toHaveBeenCalled();
    expect(removes).not.toHaveBeenCalled();
  });
});
