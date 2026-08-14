import { createHash } from "node:crypto";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginContext } from "../../../../lib/context.js";
import { ENTITIES } from "../../../../lib/sync/registry.js";
import { cacheStateSchema, rpcContract } from "../../../../shared/contract.js";
import { registerProductSecurity } from "../../register.js";
import { registerCanvasEditingBackend } from "./backend.js";
import {
  architectureEntityPayload,
  canvasEditingLoadOutputSchema,
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
  vi.restoreAllMocks();
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
});

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function component(
  slug: string,
  componentType = "software",
): ArchitectureYamlEntity {
  return parseArchitectureEntity("component", {
    slug,
    name: slug,
    component_type: componentType,
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

async function registeredComponentPage(
  files: ReadonlyMap<string, string>,
  options: { syncError?: string } = {},
) {
  const host = createFakePluginHost({
    pluginId: "finite-state-component-diagnostics",
    sdk: {
      projects: {
        get: ({ projectId }) => ({
          id: projectId,
          sources: [{ hostId: "host-1", path: "/workspace", isDefault: true }],
        }),
      },
      files: {
        list: ({ path }) => ({
          files: [...files.keys()]
            .filter((candidate) => candidate.startsWith(`${path}/`))
            .map((candidate) => ({
              path: candidate,
              name: candidate.slice(candidate.lastIndexOf("/") + 1),
            })),
          truncated: false,
        }),
        read: ({ path }) => {
          const content = files.get(path);
          if (content === undefined) {
            throw Object.assign(new Error(`ENOENT: ${path}`), {
              code: "ENOENT",
            });
          }
          return {
            content,
            contentEncoding: "utf8" as const,
            sha256: hash(content),
          };
        },
      },
    },
  });
  hosts.push(host);
  const context = createPluginContext(host.bb);
  seedAccepted(context, [component("accepted-controller")]);
  if (options.syncError) {
    context
      .db()
      .prepare(
        `UPDATE sync_state
            SET error = ?
          WHERE project_id = ? AND project_version_id = ?
            AND entity_kind = 'component'`,
      )
      .run(options.syncError, PROJECT, VERSION);
  }
  registerProductSecurity(host.bb, context);
  return rpcContract.taraList.output.parse(
    await host.harness.callRpc("taraList", {
      projectId: PROJECT,
      projectVersionId: null,
      kind: "component",
      filters: {},
      pageSize: 50,
      continuation: null,
    }),
  );
}

describe("WP-35 read-classified editing RPCs", () => {
  it("surfaces five unsupported component types distinctly from retired and malformed authored files", async () => {
    const directory = "/workspace/product-security/architecture/components";
    const files = new Map<string, string>();
    for (let index = 1; index <= 5; index += 1) {
      const slug = `unknown-${index}`;
      files.set(
        `${directory}/${slug}.yaml`,
        serializeCanvasEntity(component(slug, "hardware")).replace(
          "component_type: hardware",
          `component_type: mystery_${index}`,
        ),
      );
    }
    files.set(
      `${directory}/retired-controller.yaml`,
      serializeCanvasEntity(
        component("retired-controller", "hardware"),
      ).replace("component_type: hardware", "component_type: ecu"),
    );
    files.set(
      `${directory}/malformed-controller.yaml`,
      `${serializeCanvasEntity(component("malformed-controller"))}verification_status: passed\n`,
    );
    const page = await registeredComponentPage(files);

    expect(page.items.map((item) => item.key)).toEqual(["accepted-controller"]);
    expect(page.cache).toMatchObject({ state: "stale" });
    expect(page.cache.message).toMatch(
      /Unsupported component type.*mystery_1.*authored file.*unknown-1\.yaml.*mystery_2.*unknown-2\.yaml.*\+3 more diagnostics/iu,
    );
    expect(page.cache.message).toMatch(
      /Retired component type.*ecu.*requires migration in authored file.*retired-controller\.yaml/iu,
    );
    expect(page.cache.message).toMatch(
      /Invalid working YAML quarantined at.*malformed-controller\.yaml/iu,
    );
  });

  it("keeps credential-shaped authored types and filenames inside the registered taraList contract", async () => {
    const directory = "/workspace/product-security/architecture/components";
    const cases = [
      ["unknown-1.yaml", "api_key"],
      ["unknown-2.yaml", "apikey"],
      ["unknown-3.yaml", "api-key-vault"],
      ["unknown-4.yaml", "authorization_service"],
      ["api-key-manager.yaml", "quantum_widget"],
      ["unknown-5.yaml", "http://wiki/types see options@team"],
      ["unknown-6.yaml", "http://wiki/types see options?team"],
    ] as const;
    const files = new Map(
      cases.map(([name, value], index) => [
        `${directory}/${name}`,
        serializeCanvasEntity(
          component(`unknown-${index + 1}`, "hardware"),
        ).replace(
          "component_type: hardware",
          `component_type: ${JSON.stringify(value)}`,
        ),
      ]),
    );

    const page = await registeredComponentPage(files);

    expect(page.items.map((item) => item.key)).toEqual(["accepted-controller"]);
    expect(page.cache).toMatchObject({ state: "stale" });
    expect(page.cache.message).toContain("Unsupported component type");
    expect(page.cache.message).toContain("[redacted]");
    expect(page.cache.message).toContain("manager.yaml");
    expect(page.cache.message).not.toMatch(
      /(?:authorization|bearer\s|api[_-]?key|token=|https?:\/\/[^\s]*[?@])/iu,
    );
    expect(page.cache.message?.length).toBeLessThanOrEqual(500);
  });

  it.each([
    "http://wiki/types see options@team",
    "http://wiki/types see options?team",
  ])(
    "keeps the canvas readable when compaction rejoins a credentialed URL: %s",
    async (componentType) => {
      const directory = "/workspace/product-security/architecture/components";
      const page = await registeredComponentPage(
        new Map([
          [
            `${directory}/unknown-url-probe.yaml`,
            serializeCanvasEntity(
              component("unknown-url-probe", "hardware"),
            ).replace(
              "component_type: hardware",
              `component_type: ${JSON.stringify(componentType)}`,
            ),
          ],
        ]),
      );

      expect(page.items.map((item) => item.key)).toEqual([
        "accepted-controller",
      ]);
      expect(page.cache.message).toContain("Unsupported component type");
      expect(page.cache.message).toContain("[redacted]");
      expect(
        cacheStateSchema.shape.message.safeParse(page.cache.message).success,
      ).toBe(true);
    },
  );

  it("binds cache-detail sanitizing and fallback behavior to the taraList output contract", async () => {
    const messageSchema = cacheStateSchema.shape.message;
    const unsafeContractResult = messageSchema.safeParse(
      "authorization_service",
    );
    expect(unsafeContractResult.success).toBe(false);
    expect(messageSchema.safeParse("credential_service").success).toBe(true);

    const directory = "/workspace/product-security/architecture/components";
    const alignedPage = await registeredComponentPage(
      new Map([
        [
          `${directory}/accepted-by-contract.yaml`,
          serializeCanvasEntity(
            component("accepted-by-contract", "hardware"),
          ).replace(
            "component_type: hardware",
            "component_type: credential_service",
          ),
        ],
        [
          `${directory}/rejected-by-contract.yaml`,
          serializeCanvasEntity(
            component("rejected-by-contract", "hardware"),
          ).replace(
            "component_type: hardware",
            "component_type: authorization_service",
          ),
        ],
      ]),
    );
    expect(alignedPage.cache.message).toContain("credential_service");
    expect(alignedPage.cache.message).toContain("[redacted]");
    expect(messageSchema.safeParse(alignedPage.cache.message).success).toBe(
      true,
    );

    vi.spyOn(messageSchema, "safeParse").mockReturnValueOnce(
      unsafeContractResult,
    );
    const page = await registeredComponentPage(
      new Map([
        [
          `${directory}/unknown-contract-probe.yaml`,
          serializeCanvasEntity(
            component("unknown-contract-probe", "hardware"),
          ).replace(
            "component_type: hardware",
            "component_type: mystery_contract_probe",
          ),
        ],
      ]),
    );

    expect(page.items.map((item) => item.key)).toEqual(["accepted-controller"]);
    expect(page.cache.message).toBe("Unsupported component types: 1.");
    expect(messageSchema.safeParse(page.cache.message).success).toBe(true);
  });

  it("preserves every diagnostic class and remainder count under the 500-character budget", async () => {
    const directory = "/workspace/product-security/architecture/components";
    const long = "component-with-a-realistically-long-authored-name-";
    const files = new Map<string, string>();
    for (let index = 1; index <= 2; index += 1) {
      const unsupported = `${long}unsupported-${index}-${"u".repeat(45)}`;
      files.set(
        `${directory}/${unsupported}.yaml`,
        serializeCanvasEntity(component(unsupported, "hardware")).replace(
          "component_type: hardware",
          `component_type: mystery_${index}`,
        ),
      );
      const retired = `${long}retired-${index}-${"r".repeat(45)}`;
      files.set(
        `${directory}/${retired}.yaml`,
        serializeCanvasEntity(component(retired, "hardware")).replace(
          "component_type: hardware",
          "component_type: ecu",
        ),
      );
      const malformed = `${long}malformed-${index}-${"m".repeat(45)}`;
      files.set(
        `${directory}/${malformed}.yaml`,
        `${serializeCanvasEntity(component(malformed))}verification_status: passed\n`,
      );
    }

    const page = await registeredComponentPage(files, {
      syncError:
        "A prior refresh failed after receiving an oversized diagnostic.",
    });

    expect(page.items.map((item) => item.key)).toEqual(["accepted-controller"]);
    expect(page.cache.message).toContain(
      "The last product-security refresh failed; showing accepted cache.",
    );
    expect(page.cache.message).toContain("Unsupported component type");
    expect(page.cache.message).toContain("Retired component type");
    expect(page.cache.message).toContain("Invalid working YAML quarantined");
    expect(page.cache.message).toMatch(
      /Unsupported component type.*authored file component-with[^.]*u{4,}\.yaml/iu,
    );
    expect(page.cache.message).toMatch(
      /Retired component type.*authored file component-with[^.]*r{4,}\.yaml/iu,
    );
    expect(page.cache.message).toMatch(
      /Invalid working YAML quarantined at component-with[^.]*m{4,}\.yaml/iu,
    );
    expect(page.cache.message?.match(/\+1 more diagnostic\./gu)).toHaveLength(
      3,
    );
    expect(page.cache.message?.length).toBeLessThanOrEqual(500);
  });

  it("authors a new component while a retired component is quarantined with an advisory", async () => {
    const legacy = component("legacy-controller", "hardware");
    const legacyContent = serializeCanvasEntity(legacy).replace(
      "component_type: hardware",
      "component_type: ecu",
    );
    const legacyPath =
      "/workspace/product-security/architecture/components/legacy-controller.yaml";
    const createdPath =
      "/workspace/product-security/architecture/components/new-firmware.yaml";
    const files = new Map([[legacyPath, legacyContent]]);
    const host = createFakePluginHost({
      pluginId: "finite-state-editing-quarantined-component",
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
          list: ({ path }) => ({
            files: [...files.keys()]
              .filter((candidate) => candidate.startsWith(`${path}/`))
              .map((candidate) => ({
                path: candidate,
                name: candidate.slice(candidate.lastIndexOf("/") + 1),
              })),
            truncated: false,
          }),
          read: ({ path }) => {
            const content = files.get(path);
            if (content === undefined) {
              throw Object.assign(new Error(`ENOENT: ${path}`), {
                code: "ENOENT",
              });
            }
            return {
              content,
              contentEncoding: "utf8" as const,
              sha256: hash(content),
            };
          },
          write: ({ path, content, expectedSha256 }) => {
            const current = files.get(path);
            const currentSha256 = current === undefined ? null : hash(current);
            if (currentSha256 !== expectedSha256) {
              return { outcome: "conflict" as const, currentSha256 };
            }
            files.set(path, content);
            return {
              outcome: "written" as const,
              sha256: hash(content),
              sizeBytes: content.length,
            };
          },
        },
      },
    });
    hosts.push(host);
    const context = createPluginContext(host.bb);
    registerProductSecurity(host.bb, context);

    const created = rpcContract.taraCommandApply.output.parse(
      await host.harness.callRpc("taraCommandApply", {
        projectId: PROJECT,
        projectVersionId: null,
        operation: "create",
        kind: "component",
        fields: architectureEntityPayload(
          component("new-firmware", "firmware"),
        ),
        expectedContentSha256: null,
      }),
    );

    expect(created).toMatchObject({
      stableKey: "new-firmware",
      beforeSha256: null,
    });
    expect(files.get(createdPath)).toContain("component_type: firmware");
    expect(files.get(legacyPath)).toBe(legacyContent);

    const page = rpcContract.taraList.output.parse(
      await host.harness.callRpc("taraList", {
        projectId: PROJECT,
        projectVersionId: null,
        kind: "component",
        filters: {},
        pageSize: 50,
        continuation: null,
      }),
    );
    expect(page).toMatchObject({
      items: [expect.objectContaining({ key: "new-firmware" })],
      total: 1,
      cache: {
        state: "stale",
        message: expect.stringMatching(
          /Retired component type.*ecu.*requires migration.*legacy-controller\.yaml/iu,
        ),
      },
    });
  });

  it("returns a typed migration advisory for a retired authored component type", async () => {
    const current = component("legacy-controller", "hardware");
    const content = serializeCanvasEntity(current).replace(
      "component_type: hardware",
      "component_type: ecu",
    );
    const file =
      "/workspace/product-security/architecture/components/legacy-controller.yaml";
    const host = createFakePluginHost({
      pluginId: "finite-state-editing-retired-component-type",
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
          read: ({ path }) => {
            if (path !== file) {
              throw Object.assign(new Error(`ENOENT: ${path}`), {
                code: "ENOENT",
              });
            }
            return {
              content,
              contentEncoding: "utf8" as const,
              sha256: hash(content),
            };
          },
        },
      },
    });
    hosts.push(host);
    const context = createPluginContext(host.bb);
    registerCanvasEditingBackend(host.bb, context);

    const loaded = canvasEditingLoadOutputSchema.parse(
      await host.harness.callRpc("canvasEditingLoad", {
        projectId: PROJECT,
        projectVersionId: null,
        kind: "component",
        slug: "legacy-controller",
      }),
    );

    expect(loaded).toMatchObject({
      state: "migration_required",
      sha256: hash(content),
      fields: { component_type: "ecu" },
      advisory: {
        code: "RETIRED_COMPONENT_TYPE",
        field: "component_type",
        value: "ecu",
      },
    });
    if (loaded.state !== "migration_required") {
      throw new Error("expected a component-type migration advisory");
    }
    expect(loaded.advisory.allowedValues).toEqual([
      "firmware",
      "software",
      "hardware",
      "network",
      "cloud_service",
      "mobile_app",
      "web_app",
      "database",
      "api",
      "sensor",
      "actuator",
      "communication",
      "other",
    ]);
    expect(() => parseArchitectureEntity("component", loaded.fields)).toThrow();
  });

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

  it("edits a pulled firmware component through the registered RPC path and preserves its YAML type", async () => {
    const files = new Map<string, string>();
    const host = createFakePluginHost({
      pluginId: "finite-state-editing-firmware",
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
          list: ({ path }) => ({
            files: [...files.keys()]
              .filter((candidate) => candidate.startsWith(`${path}/`))
              .map((path) => ({
                path,
                name: path.slice(path.lastIndexOf("/") + 1),
              })),
            truncated: false,
          }),
          read: ({ path }) => {
            const content = files.get(path);
            if (content === undefined) {
              throw Object.assign(new Error(`ENOENT: ${path}`), {
                code: "ENOENT",
              });
            }
            return {
              content,
              contentEncoding: "utf8" as const,
              sha256: hash(content),
            };
          },
          write: ({ path, content, expectedSha256 }) => {
            const current = files.get(path);
            const currentSha256 = current === undefined ? null : hash(current);
            if (currentSha256 !== expectedSha256) {
              return { outcome: "conflict" as const, currentSha256 };
            }
            files.set(path, content);
            return {
              outcome: "written" as const,
              sha256: hash(content),
              sizeBytes: content.length,
            };
          },
        },
      },
    });
    hosts.push(host);
    const context = createPluginContext(host.bb);
    const pulled = component("gateway-firmware", "firmware");
    seedAccepted(context, [pulled]);
    registerCanvasEditingBackend(host.bb, context);

    const loaded = canvasEditingLoadOutputSchema.parse(
      await host.harness.callRpc("canvasEditingLoad", {
        projectId: PROJECT,
        projectVersionId: null,
        kind: "component",
        slug: pulled.slug,
      }),
    );
    expect(loaded).toMatchObject({
      state: "ready",
      fields: { component_type: "firmware" },
    });
    if (loaded.state !== "ready") throw new Error("expected accepted entity");

    await host.harness.callRpc("taraCommandApply", {
      projectId: PROJECT,
      projectVersionId: null,
      operation: "update",
      kind: "component",
      stableKey: pulled.slug,
      fields: { name: "Edited firmware gateway" },
      expectedContentSha256: loaded.sha256,
    });

    const edited = canvasEditingLoadOutputSchema.parse(
      await host.harness.callRpc("canvasEditingLoad", {
        projectId: PROJECT,
        projectVersionId: null,
        kind: "component",
        slug: pulled.slug,
      }),
    );
    expect(edited).toMatchObject({
      state: "ready",
      fields: {
        name: "Edited firmware gateway",
        component_type: "firmware",
      },
    });
    const authored = files.get(
      "/workspace/product-security/architecture/components/gateway-firmware.yaml",
    );
    expect(authored).toContain("component_type: firmware");
    expect(
      parseArchitectureEntity(
        "component",
        edited.state === "ready" ? edited.fields : {},
      ),
    ).toMatchObject({ component_type: "firmware" });
  });
});
