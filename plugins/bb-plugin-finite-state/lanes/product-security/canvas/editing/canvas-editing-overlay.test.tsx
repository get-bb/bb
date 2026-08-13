import { createHash } from "node:crypto";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginContext } from "../../../../lib/context.js";
import { listTara } from "../../register.js";
import { parseArchitectureEntity } from "./schema.js";
import { serializeCanvasEntity } from "./writer.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
const PROJECT = "project-overlay";
const VERSION = "@project";
const GENERATION = "generation-overlay";

afterEach(async () => {
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
});

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function seedBase(
  context: ReturnType<typeof createPluginContext>,
  name = "Accepted gateway",
): void {
  const db = context.db();
  db.prepare(
    `INSERT INTO pull_generation
       (project_id, project_version_id, generation_id, status,
        requested_kinds_json, started_at, completed_at, accepted_at)
     VALUES (?, ?, ?, 'accepted', '["component"]', ?, ?, ?)`,
  ).run(
    PROJECT,
    VERSION,
    GENERATION,
    "2026-08-13T12:00:00.000Z",
    "2026-08-13T12:00:01.000Z",
    "2026-08-13T12:00:01.000Z",
  );
  db.prepare(
    `INSERT INTO sync_state
       (project_id, project_version_id, entity_kind, accepted_generation_id,
        base_revision, last_pull, error)
     VALUES (?, ?, 'component', ?, 1, ?, NULL)`,
  ).run(PROJECT, VERSION, GENERATION, "2026-08-13T12:00:01.000Z");
  const payload = JSON.stringify({ slug: "gateway", name });
  db.prepare(
    `INSERT INTO base_snapshot
       (project_id, project_version_id, entity_kind, generation_id,
        entity_key, remote_id, payload, content_hash, pulled_at)
     VALUES (?, ?, 'component', ?, 'encoded-gateway', 'remote-gateway', ?, ?, ?)`,
  ).run(
    PROJECT,
    VERSION,
    GENERATION,
    payload,
    hash(payload),
    "2026-08-13T12:00:01.000Z",
  );
}

function seedAdditionalBase(
  context: ReturnType<typeof createPluginContext>,
): void {
  const payload = JSON.stringify({ slug: "sensor", name: "Accepted sensor" });
  context
    .db()
    .prepare(
      `INSERT INTO base_snapshot
       (project_id, project_version_id, entity_kind, generation_id,
        entity_key, remote_id, payload, content_hash, pulled_at)
     VALUES (?, ?, 'component', ?, 'encoded-sensor', 'remote-sensor', ?, ?, ?)`,
    )
    .run(
      PROJECT,
      VERSION,
      GENERATION,
      payload,
      hash(payload),
      "2026-08-13T12:00:01.000Z",
    );
}

function input() {
  return {
    projectId: PROJECT,
    projectVersionId: null,
    pageSize: 50,
    continuation: null,
    kind: "component" as const,
    filters: {},
  };
}

describe("WP-35 taraList working overlay", () => {
  it("loads hand-authored working YAML without an accepted base or editor marker", async () => {
    const working = serializeCanvasEntity(
      parseArchitectureEntity("component", {
        slug: "hand-authored",
        name: "Hand-authored component",
        component_type: "software",
        criticality: "medium",
        interfaces: [],
        technologies: [],
        is_entry_point: false,
        stores_data: false,
      }),
    );
    const host = createFakePluginHost({
      pluginId: "finite-state-overlay-no-marker",
      sdk: {
        projects: {
          get: () => ({
            sources: [
              { hostId: "host-1", path: "/workspace", isDefault: true },
            ],
          }),
        },
        files: {
          list: () => ({
            files: [{ name: "hand-authored.yaml", path: "hand-authored.yaml" }],
            truncated: false,
          }),
          read: () => ({
            content: working,
            contentEncoding: "utf8" as const,
            sha256: hash(working),
          }),
        },
      },
    });
    hosts.push(host);
    const context = createPluginContext(host.bb);

    const page = await listTara(host.bb, context.db(), input());

    expect(page.items).toEqual([
      expect.objectContaining({
        key: "hand-authored",
        label: "Hand-authored component",
      }),
    ]);
    expect(page.cache).toMatchObject({
      state: "empty",
      acceptedGenerationId: null,
    });
  });

  it("lets strictly validated working YAML win over the accepted base", async () => {
    const working = serializeCanvasEntity(
      parseArchitectureEntity("component", {
        slug: "gateway",
        name: "Authored gateway",
        component_type: "software",
        criticality: "high",
        interfaces: [],
        technologies: [],
        is_entry_point: true,
        stores_data: false,
      }),
    );
    const host = createFakePluginHost({
      pluginId: "finite-state-overlay-wins",
      sdk: {
        projects: {
          get: () => ({
            sources: [
              { hostId: "host-1", path: "/workspace", isDefault: true },
            ],
          }),
        },
        files: {
          list: () => ({
            files: [{ name: "gateway.yaml", path: "gateway.yaml" }],
            truncated: false,
          }),
          read: () => ({
            content: working,
            contentEncoding: "utf8" as const,
            sha256: hash(working),
          }),
        },
      },
    });
    hosts.push(host);
    const context = createPluginContext(host.bb);
    seedBase(context);
    seedAdditionalBase(context);
    const page = await listTara(host.bb, context.db(), input());
    expect(page.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "gateway",
          label: "Authored gateway",
          fields: expect.objectContaining({
            slug: "gateway",
            is_entry_point: true,
          }),
        }),
        expect.objectContaining({ key: "sensor", label: "Accepted sensor" }),
      ]),
    );
  });

  it("keeps the accepted base readable when no working directory exists", async () => {
    const host = createFakePluginHost({
      pluginId: "finite-state-overlay-base",
      sdk: {
        projects: {
          get: () => ({
            sources: [
              { hostId: "host-1", path: "/workspace", isDefault: true },
            ],
          }),
        },
        files: {
          list: () => {
            throw new Error("ENOENT: directory does not exist");
          },
        },
      },
    });
    hosts.push(host);
    const context = createPluginContext(host.bb);
    seedBase(context);
    const page = await listTara(host.bb, context.db(), input());
    expect(page.items).toEqual([
      expect.objectContaining({ key: "gateway", label: "Accepted gateway" }),
    ]);
  });

  it("surfaces invalid working YAML explicitly instead of falling back to base", async () => {
    const host = createFakePluginHost({
      pluginId: "finite-state-overlay-invalid",
      sdk: {
        projects: {
          get: () => ({
            sources: [
              { hostId: "host-1", path: "/workspace", isDefault: true },
            ],
          }),
        },
        files: {
          list: () => ({
            files: [{ name: "gateway.yaml", path: "gateway.yaml" }],
            truncated: false,
          }),
          read: () => ({
            content: "slug: gateway\nverification_status: passed\n",
            contentEncoding: "utf8" as const,
            sha256: "b".repeat(64),
          }),
        },
      },
    });
    hosts.push(host);
    const context = createPluginContext(host.bb);
    seedBase(context);
    await expect(listTara(host.bb, context.db(), input())).rejects.toThrow(
      /INVALID_WORKING_TARA:.*verification_status.*cannot be authored/iu,
    );
  });
});
