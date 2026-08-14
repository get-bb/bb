import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createFakePluginHost,
  makeThreadResponse,
} from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginContext } from "../../../../lib/context.js";
import {
  ASSURANCE_STUDIO_MAX_PAGE_SIZE,
  AssuranceStudioClient,
} from "../../../../lib/remote/assurance-studio/client.js";
import { PlatformClient } from "../../../../lib/remote/platform/client.js";
import type {
  AsEntity,
  AsEntityKind,
  Json,
  RemoteServices,
} from "../../../../lib/remote/types.js";
import {
  bindWorkspacePlatformProject,
  selectAssuranceStudioProjectBinding,
} from "../../../../lib/store/project-scope.js";
import { registerMockAssuranceStudio } from "../../../../test/mock-remote/assurance-studio/register.js";
import { registerPlatformHandlers } from "../../../../test/mock-remote/platform/register.js";
import { createMockPlatformState } from "../../../../test/mock-remote/platform/state.js";
import {
  createMockRemote,
  type MockRemoteHarness,
} from "../../../../test/mock-remote/server.js";
import { registerSync } from "../../../sync/register.js";
import { BaseSnapshotStore } from "../../../sync/store/base-snapshot.js";
import { IdMapStore } from "../../../sync/store/id-map.js";
import { registerProductSecurity } from "../../register.js";
import {
  projectRemoteEntity,
  type AdapterSlugResolver,
  type TaraRemoteFieldRead,
} from "./adapters.js";
import {
  ASSURANCE_STUDIO_ASSET_TYPES,
  ASSURANCE_STUDIO_COMPONENT_TYPES,
  ASSURANCE_STUDIO_TRUST_LEVEL_SCORES,
} from "./schema.js";

const FIXTURE_ROOT = fileURLToPath(
  new URL("../../../../test/mock-remote/fixtures", import.meta.url),
);
const API_KEY = "fs166-as-key";
const PLATFORM_TOKEN = "fs166-platform-token";
const PROJECT_ID = "project-4a752600a07a";
const VERSION_ID = "pv-a481df87dadf";
const TARA_KINDS = [
  "component",
  "zone",
  "asset",
  "dataflow",
  "threat",
] as const;

const expectedCounts = {
  component: 12,
  zone: 3,
  asset: 4,
  dataflow: 11,
  threat: 16,
} as const;

const corruptionFields = {
  component: "name",
  zone: "name",
  asset: "name",
  dataflow: "source_component_id",
  threat: "stride_categories",
} as const;

let harness: MockRemoteHarness | null = null;
let host: ReturnType<typeof createFakePluginHost> | null = null;
let worktreeRoot: string | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
  await host?.harness.lifecycle.dispose();
  host = null;
  if (worktreeRoot) await rm(worktreeRoot, { recursive: true, force: true });
  worktreeRoot = null;
});

function collectionKind(pathname: string): (typeof TARA_KINDS)[number] | null {
  const segment = pathname.split("/").at(-1);
  if (segment === "components") return "component";
  if (segment === "zones") return "zone";
  if (segment === "assets") return "asset";
  if (segment === "data-flows") return "dataflow";
  if (segment === "threats") return "threat";
  return null;
}

function collectionRows(
  body: unknown,
  kind: (typeof TARA_KINDS)[number],
): Array<Record<string, Json>> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return [];
  }
  const data = Reflect.get(body, "data");
  const rows = Array.isArray(data)
    ? data
    : typeof data === "object" && data !== null
      ? Reflect.get(
          data,
          {
            asset: "assets",
            component: "components",
            dataflow: "data_flows",
            threat: "threats",
            zone: "zones",
          }[kind],
        )
      : null;
  return Array.isArray(rows)
    ? rows.filter(
        (row): row is Record<string, Json> =>
          typeof row === "object" && row !== null && !Array.isArray(row),
      )
    : [];
}

async function corruptRequiredField(
  request: Request,
  response: Response,
): Promise<Response> {
  const kind =
    request.method === "GET"
      ? collectionKind(new URL(request.url).pathname)
      : null;
  if (kind === null || !response.ok) return response;
  const body: unknown = await response.json();
  for (const item of collectionRows(body, kind)) {
    delete item[corruptionFields[kind]];
  }
  return Response.json(body, { status: response.status });
}

async function replaceRemoteField(
  request: Request,
  response: Response,
  kind: (typeof TARA_KINDS)[number],
  field: string,
  value: Json,
): Promise<Response> {
  const requestKind =
    request.method === "GET"
      ? collectionKind(new URL(request.url).pathname)
      : null;
  if (requestKind !== kind || !response.ok) return response;
  const body: unknown = await response.json();
  for (const item of collectionRows(body, kind)) item[field] = value;
  return Response.json(body, { status: response.status });
}

async function listAll(
  client: AssuranceStudioClient,
  kind: AsEntityKind,
): Promise<AsEntity[]> {
  const entities: AsEntity[] = [];
  for await (const page of client.listEntities(kind, {
    projectId: PROJECT_ID,
    page: { pageSize: 50 },
  }))
    entities.push(...page.items);
  return entities;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const derivedResolver: AdapterSlugResolver = {
  remoteToSlug: () => null,
  slugToRemote: () => null,
};

describe("canvas real-wire adapter contract", () => {
  it("publishes each default-pull kind atomically from committed fixtures without identity drift", async () => {
    let corrupt = false;
    let futureTrustLevel = false;
    const requestedPageSizes: number[] = [];
    const platformState = createMockPlatformState(FIXTURE_ROOT);
    harness = createMockRemote({
      platformToken: PLATFORM_TOKEN,
      assuranceStudioKey: API_KEY,
      fixtureRoot: FIXTURE_ROOT,
      register(service, registry) {
        if (service === "platform") {
          registerPlatformHandlers(registry, platformState);
        } else {
          registerMockAssuranceStudio(registry, FIXTURE_ROOT);
        }
      },
    });
    const assuranceStudio = new AssuranceStudioClient({
      baseUrl: "http://assurance-studio.mock",
      apiKey: API_KEY,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (
          request.method === "GET" &&
          collectionKind(new URL(request.url).pathname)
        ) {
          const pageSize = new URL(request.url).searchParams.get("limit");
          if (pageSize !== null) requestedPageSizes.push(Number(pageSize));
        }
        const response = await harness!.assuranceStudio.fetch(request);
        if (corrupt) return corruptRequiredField(request, response);
        return futureTrustLevel
          ? replaceRemoteField(
              request,
              response,
              "zone",
              "trust_level",
              "tenant_future_trust",
            )
          : response;
      },
    });
    const platform = new PlatformClient({
      baseUrl: "http://platform.mock",
      token: PLATFORM_TOKEN,
      fetch: harness.platform.fetch,
    });
    host = createFakePluginHost({
      pluginId: "finite-state-fs166-registered-pull",
    });
    const context = createPluginContext(host.bb);
    const services: RemoteServices = {
      platform,
      assuranceStudio,
      forgeCompute: null,
    };
    context.service<RemoteServices>("remote-services", () => services);
    context.service("firmware.cli", () => ({
      run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    }));
    context.service("bench.cli", () => ({
      run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    }));
    registerSync(host.bb, context);
    registerProductSecurity(host.bb, context);
    bindWorkspacePlatformProject(context.db(), "bb-project-fs166", PROJECT_ID);
    selectAssuranceStudioProjectBinding(
      context.db(),
      "bb-project-fs166",
      PROJECT_ID,
      PROJECT_ID,
    );

    worktreeRoot = await mkdtemp(join(tmpdir(), "fs166-registered-pull-"));
    host.harness.sdk.stub("threads.get", async () =>
      makeThreadResponse({
        id: "thread-fs166",
        projectId: "bb-project-fs166",
        environmentId: "environment-fs166",
      }),
    );
    host.harness.sdk.stub("environments.get", async () => ({
      id: "environment-fs166",
      projectId: "bb-project-fs166",
      path: worktreeRoot!,
    }));

    const runDefaultPull = () =>
      host!.harness.behavior.runCli(
        [
          "finite-state",
          "pull",
          "--project",
          PROJECT_ID,
          "--version",
          VERSION_ID,
          "--json",
        ],
        {
          cwd: "/untrusted-cwd",
          threadId: "thread-fs166",
          projectId: "bb-project-fs166",
        },
      );

    const first = await runDefaultPull();
    expect(first).toMatchObject({ exitCode: 0, stderr: "" });
    const firstReport = JSON.parse(first.stdout) as {
      kinds: Record<
        string,
        {
          status: "published" | "failed";
          generationId: string | null;
          fetched: number;
          baseRows: number;
          quarantined: number;
        }
      >;
    };
    expect(firstReport.kinds).toMatchObject({
      vexDecision: {
        status: "published",
        fetched: 308,
        baseRows: 308,
        quarantined: 0,
      },
      ...Object.fromEntries(
        TARA_KINDS.map((kind) => [
          kind,
          {
            status: "published",
            fetched: expectedCounts[kind],
            baseRows: expectedCounts[kind],
            quarantined: 0,
          },
        ]),
      ),
    });
    expect(requestedPageSizes).toEqual(
      TARA_KINDS.map(() => ASSURANCE_STUDIO_MAX_PAGE_SIZE),
    );

    const snapshots = new BaseSnapshotStore(context.db());
    const acceptedByName = new Map<string, Record<string, unknown>>();
    for (const kind of TARA_KINDS) {
      const accepted = snapshots.listAccepted(PROJECT_ID, VERSION_ID, kind);
      expect(accepted).toHaveLength(expectedCounts[kind]);
      for (const row of accepted) {
        expect(row.payload).toMatchObject({
          slug: expect.stringMatching(
            new RegExp(`^${kind}-[0-9a-f]{20}$`, "u"),
          ),
        });
        const name = row.payload["name"];
        if (typeof name === "string") acceptedByName.set(name, row.payload);
      }
    }
    const componentSlug = acceptedByName.get("Architecture node 1")?.["slug"];
    const nextComponentSlug = acceptedByName.get("Architecture node 2")?.[
      "slug"
    ];
    const zoneSlug = acceptedByName.get("Untrusted")?.["slug"];
    const assetSlug = acceptedByName.get("Protected asset 1")?.["slug"];
    expect(acceptedByName.get("Architecture node 1")).toMatchObject({
      component_type: "firmware",
      criticality: "low",
      zone: zoneSlug,
      interfaces: [{ name: "ethernet" }],
      technologies: ["linux"],
      is_entry_point: true,
      stores_data: true,
    });
    expect(acceptedByName.get("Untrusted")).toMatchObject({
      trust_level: 1,
    });
    expect(acceptedByName.get("Protected asset 1")).toMatchObject({
      name: "Protected asset 1",
      asset_type: "function",
      criticality: "high",
      data_classification: "pii",
    });
    expect(acceptedByName.get("Dataflow 1")).toMatchObject({
      from: componentSlug,
      to: nextComponentSlug,
      protocol: "MQTT",
      data_types: ["telemetry"],
      encrypted: false,
      authenticated: false,
      bidirectional: false,
    });
    const threat = acceptedByName.get("Threat 1");
    expect(threat).toMatchObject({
      category: "spoofing",
      threat_source: "stride_analysis",
      affected_components: [],
      affected_assets: [assetSlug],
      dataflows: [],
      mitigations: [expect.stringMatching(/^mitigation-[0-9a-f]{20}$/u)],
      assumptions: ["Fixture precondition 1"],
    });
    expect(threat).not.toHaveProperty("severity");

    const idMaps = new IdMapStore(context.db());
    const taraMappings = () =>
      idMaps
        .dumpAccepted(PROJECT_ID, VERSION_ID)
        .filter((entry) => TARA_KINDS.some((kind) => kind === entry.entityKind))
        .map(({ entityKind, entityKey, remoteId }) => ({
          entityKind,
          entityKey,
          remoteId,
        }));
    const firstMappings = taraMappings();
    expect(firstMappings).toHaveLength(
      TARA_KINDS.reduce((total, kind) => total + expectedCounts[kind], 0),
    );

    corrupt = true;
    const failed = await runDefaultPull();
    expect(failed.exitCode).toBe(1);
    expect(failed.stderr).toBe("");
    const failedReport = JSON.parse(failed.stdout) as {
      kinds: Record<
        string,
        {
          status: "published" | "failed";
          generationId: string | null;
          reasons: Array<{ code: string; count: number }>;
        }
      >;
    };
    for (const kind of Object.keys(corruptionFields)) {
      expect(failedReport.kinds[kind]).toMatchObject({
        status: "failed",
        generationId: expect.any(String),
        reasons: [{ code: "REMOTE_FIELD_MISSING", count: 1 }],
      });
    }
    expect(failedReport.kinds.vexDecision).toMatchObject({
      status: "published",
      generationId: expect.any(String),
    });
    const acceptedAfterFailure = context
      .db()
      .prepare(
        `SELECT entity_kind, accepted_generation_id
         FROM sync_state
        WHERE project_id = ? AND project_version_id = ?
          AND entity_kind IN ('asset', 'component', 'dataflow', 'threat', 'zone')
        ORDER BY entity_kind`,
      )
      .all(PROJECT_ID, VERSION_ID) as Array<{
      entity_kind: string;
      accepted_generation_id: string | null;
    }>;
    expect(acceptedAfterFailure).toHaveLength(TARA_KINDS.length);
    expect(
      acceptedAfterFailure.every(
        (row) =>
          row.accepted_generation_id ===
          firstReport.kinds[row.entity_kind]?.generationId,
      ),
    ).toBe(true);
    const failedGenerations = context
      .db()
      .prepare(
        `SELECT requested_kinds_json, status, error FROM pull_generation
          WHERE project_id = ? AND project_version_id = ?
            AND status = 'staging' AND error IS NOT NULL
          ORDER BY requested_kinds_json`,
      )
      .all(PROJECT_ID, VERSION_ID) as Array<{
      requested_kinds_json: string;
      status: string;
      error: string;
    }>;
    expect(failedGenerations).toHaveLength(TARA_KINDS.length);
    for (const kind of TARA_KINDS) {
      expect(failedGenerations).toContainEqual({
        requested_kinds_json: JSON.stringify([kind]),
        status: "staging",
        error: expect.stringContaining(`${kind}: REMOTE_FIELD_MISSING`),
      });
    }

    corrupt = false;
    const recovered = await runDefaultPull();
    expect(recovered.exitCode).toBe(0);
    expect(taraMappings()).toEqual(firstMappings);

    futureTrustLevel = true;
    const openVocabularyStatus = await host.harness.behavior.runCli(
      [
        "finite-state",
        "status",
        "--project",
        PROJECT_ID,
        "--version",
        VERSION_ID,
        "--json",
      ],
      {
        cwd: "/untrusted-cwd",
        threadId: "thread-fs166",
        projectId: "bb-project-fs166",
      },
    );
    expect(openVocabularyStatus).toMatchObject({ exitCode: 0, stderr: "" });
    const openVocabularyReport = JSON.parse(openVocabularyStatus.stdout) as {
      unavailable?: unknown[];
    };
    expect(openVocabularyReport.unavailable ?? []).toEqual([]);
    futureTrustLevel = false;
    expect(host.harness.registrations.rpcMethods).toContain("syncPull");
    expect(
      host.harness.realtimeSignals.some(
        (signal) => signal.channel === "fs-sync-pull",
      ),
    ).toBe(true);

    assuranceStudio.close();
    platform.close();
  });

  it("retains connected and future remote vocabulary values without changing stable keys", () => {
    const scope = { projectId: PROJECT_ID, projectVersionId: VERSION_ID };
    const assetKeys = new Set(
      [...ASSURANCE_STUDIO_ASSET_TYPES, "tenant_future_asset"].map(
        (assetType) => {
          const projected = projectRemoteEntity(
            "asset",
            {
              id: "asset-live-vocabulary",
              projectId: PROJECT_ID,
              kind: "asset",
              reviewVersion: null,
              reviewStatus: null,
              humanEdited: null,
              fields: { name: "Live asset", asset_type: assetType },
            },
            scope,
            derivedResolver,
          );
          expect(projected.payload["fields"]).toMatchObject({
            asset_type: assetType,
          });
          return projected.key;
        },
      ),
    );
    const componentKeys = new Set(
      [...ASSURANCE_STUDIO_COMPONENT_TYPES, "tenant_future_component"].map(
        (componentType) => {
          const projected = projectRemoteEntity(
            "component",
            {
              id: "component-live-vocabulary",
              projectId: PROJECT_ID,
              kind: "component",
              reviewVersion: null,
              reviewStatus: null,
              humanEdited: null,
              fields: {
                name: "Live component",
                component_type: componentType,
              },
            },
            scope,
            derivedResolver,
          );
          expect(projected.payload["fields"]).toMatchObject({
            component_type: componentType,
          });
          return projected.key;
        },
      ),
    );

    expect(assetKeys.size).toBe(1);
    expect(componentKeys.size).toBe(1);

    const zoneKeys = new Set(
      [...ASSURANCE_STUDIO_TRUST_LEVEL_SCORES, "tenant_future_trust"].map(
        (trustLevel) => {
          const projected = projectRemoteEntity(
            "zone",
            {
              id: "zone-live-trust",
              projectId: PROJECT_ID,
              kind: "zone",
              reviewVersion: null,
              reviewStatus: null,
              humanEdited: null,
              fields: { name: "Live zone", trust_level: trustLevel },
            },
            scope,
            derivedResolver,
          );
          expect(projected.payload["fields"]).toMatchObject({
            trust_level: trustLevel,
          });
          return projected.key;
        },
      ),
    );
    expect(zoneKeys.size).toBe(1);

    for (const dataClassification of [
      "phi",
      "pii",
      "tenant_future_classification",
    ]) {
      const projected = projectRemoteEntity(
        "asset",
        {
          id: "asset-live-classification",
          projectId: PROJECT_ID,
          kind: "asset",
          reviewVersion: null,
          reviewStatus: null,
          humanEdited: null,
          fields: {
            name: "Classified asset",
            data_classification: dataClassification,
          },
        },
        scope,
        derivedResolver,
      );
      expect(projected.payload["fields"]).toMatchObject({
        data_classification: dataClassification,
      });
    }

    const nullClassification = projectRemoteEntity(
      "asset",
      {
        id: "asset-null-classification",
        projectId: PROJECT_ID,
        kind: "asset",
        reviewVersion: null,
        reviewStatus: null,
        humanEdited: null,
        fields: { name: "Unclassified asset", data_classification: null },
      },
      scope,
      derivedResolver,
    );
    expect(nullClassification.payload["fields"]).not.toHaveProperty(
      "data_classification",
    );

    const futureAssetCriticality = projectRemoteEntity(
      "asset",
      {
        id: "asset-live-criticality",
        projectId: PROJECT_ID,
        kind: "asset",
        reviewVersion: null,
        reviewStatus: null,
        humanEdited: null,
        fields: {
          name: "Future criticality asset",
          criticality: "tenant_future_criticality",
        },
      },
      scope,
      derivedResolver,
    );
    expect(futureAssetCriticality.payload["fields"]).toMatchObject({
      criticality: "tenant_future_criticality",
    });

    const futureSeverity = projectRemoteEntity(
      "threat",
      {
        id: "threat-live-severity",
        projectId: PROJECT_ID,
        kind: "threat",
        reviewVersion: null,
        reviewStatus: null,
        humanEdited: null,
        fields: {
          name: "Future severity threat",
          category: "spoofing",
          threat_source: "manual",
          severity: "tenant_future_severity",
          affected_assets: [],
          mitigation_ids: [],
        },
      },
      scope,
      derivedResolver,
    );
    expect(futureSeverity.payload["fields"]).toMatchObject({
      severity: "tenant_future_severity",
    });
  });

  it("reports the actual value at a nested remote validation path", () => {
    expect(() =>
      projectRemoteEntity(
        "component",
        {
          id: "component-invalid-interface",
          projectId: PROJECT_ID,
          kind: "component",
          reviewVersion: null,
          reviewStatus: null,
          humanEdited: null,
          fields: {
            name: "Invalid interface component",
            interfaces: [""],
          },
        },
        { projectId: PROJECT_ID, projectVersionId: VERSION_ID },
        derivedResolver,
      ),
    ).toThrow(/component\.interfaces\.0\.name rejected value ""/u);
  });

  it("pins and adversarially exercises the field reads emitted by production projection", async () => {
    harness = createMockRemote({
      platformToken: "unused",
      assuranceStudioKey: API_KEY,
      fixtureRoot: FIXTURE_ROOT,
      register(service, registry) {
        if (service === "assurance-studio") {
          registerMockAssuranceStudio(registry, FIXTURE_ROOT);
        }
      },
    });
    const client = new AssuranceStudioClient({
      baseUrl: "http://assurance-studio.mock",
      apiKey: API_KEY,
      fetch: harness.assuranceStudio.fetch,
    });
    const scope = { projectId: PROJECT_ID, projectVersionId: VERSION_ID };
    const signatures: string[] = [];

    for (const kind of TARA_KINDS) {
      const entity = (await listAll(client, kind))[0];
      if (!entity) throw new Error(`Fixture has no ${kind}`);
      const reads: TaraRemoteFieldRead[] = [];
      projectRemoteEntity(kind, entity, scope, derivedResolver, (read) =>
        reads.push(read),
      );
      expect(new Set(reads.map((read) => read.field)).size).toBe(reads.length);
      signatures.push(
        ...reads.map(
          (read) =>
            `${read.kind}.${read.field}:${read.requirement}:${read.aliases.join("|")}`,
        ),
      );

      for (const read of reads) {
        const fields = { ...entity.fields };
        for (const alias of read.aliases) delete fields[alias];
        const project = () =>
          projectRemoteEntity(
            kind,
            { ...entity, fields },
            scope,
            derivedResolver,
          );
        if (read.requirement === "required") {
          expect(
            project,
            `${kind} should reject missing ${read.field}`,
          ).toThrow(
            `REMOTE_FIELD_MISSING: ${kind} payload lacks ${read.aliases.join("/")}.`,
          );
        } else {
          expect(
            project,
            `${kind} should tolerate missing ${read.field}`,
          ).not.toThrow();
        }
      }
    }

    // This is a trace of the reads production projection actually executed,
    // not a second field registry. Adding a read or changing its requiredness
    // changes this trace and fails the contract before a live pull.
    expect(signatures).toEqual([
      "component.name:required:name|title|label",
      "component.description:optional:description|summary",
      "component.component_type:optional:component_type|componentType|type",
      "component.criticality:optional:criticality",
      "component.zone:optional:zone_id|zone",
      "component.interfaces:optional:interfaces",
      "component.technologies:optional:technologies",
      "component.is_entry_point:optional:is_entry_point|isEntryPoint",
      "component.stores_data:optional:stores_data|storesData|is_data_store|isDataStore",
      "zone.name:required:name|title|label",
      "zone.description:optional:description|summary",
      "zone.trust_level:optional:trust_level|trustLevel",
      "zone.zone:optional:parent_zone_id|parent_zone|zone",
      "asset.name:required:name|title|label",
      "asset.description:optional:description|summary",
      "asset.criticality:optional:criticality",
      "asset.asset_type:optional:asset_type|assetType|type",
      "asset.zone:optional:zone_id|zone",
      "asset.data_classification:optional:data_classification",
      "dataflow.name:required:name|title|label",
      "dataflow.description:optional:description|summary",
      "dataflow.from:required:source_component_id|from_component|from",
      "dataflow.to:required:target_component_id|to_component|to",
      "dataflow.protocol:optional:protocol",
      "dataflow.data_types:optional:data_types|dataTypes",
      "dataflow.encrypted:optional:is_encrypted|encrypted",
      "dataflow.authenticated:optional:is_authenticated|authenticated",
      "threat.name:required:name|title|label",
      "threat.description:optional:description|summary",
      "threat.category:required:category|stride_category|stride_categories",
      "threat.threat_source:required:threat_source|threatSource",
      "threat.severity:optional:severity",
      "threat.affected_components:optional:affected_component_ids|affected_components",
      "threat.affected_assets:required:asset_ids|affected_asset_ids|affected_assets",
      "threat.dataflows:optional:affected_dataflow_ids|affected_dataflows",
      "threat.mitigations:required:mitigation_ids|mitigations|linked_mitigations",
      "threat.assumptions:optional:preconditions|assumptions",
    ]);

    const threat = (await listAll(client, "threat"))[0];
    if (!threat) throw new Error("Fixture has no threat");
    expect(() =>
      projectRemoteEntity(
        "threat",
        {
          ...threat,
          fields: {
            ...threat.fields,
            stride_categories: ["spoofing", "tampering"],
          },
        },
        scope,
        derivedResolver,
      ),
    ).toThrow(/REMOTE_FIELD_UNSUPPORTED.*2 stride_categories/iu);

    client.close();
  });

  it("projects AS-minimal responses without inventing optional domain values", async () => {
    harness = createMockRemote({
      platformToken: "unused",
      assuranceStudioKey: API_KEY,
      fixtureRoot: FIXTURE_ROOT,
      register(service, registry) {
        if (service === "assurance-studio") {
          registerMockAssuranceStudio(registry, FIXTURE_ROOT);
        }
      },
    });
    const client = new AssuranceStudioClient({
      baseUrl: "http://assurance-studio.mock",
      apiKey: API_KEY,
      fetch: harness.assuranceStudio.fetch,
    });
    const scope = { projectId: PROJECT_ID, projectVersionId: VERSION_ID };
    const projected = new Map<string, Record<string, unknown>>();

    for (const kind of TARA_KINDS) {
      const entity = (await listAll(client, kind))[0];
      if (!entity) throw new Error(`Fixture has no ${kind}`);
      const reads: TaraRemoteFieldRead[] = [];
      projectRemoteEntity(kind, entity, scope, derivedResolver, (read) => {
        reads.push(read);
      });
      const fields = { ...entity.fields };
      for (const read of reads.filter(
        (candidate) => candidate.requirement === "optional",
      )) {
        for (const alias of read.aliases) delete fields[alias];
      }
      const result = projectRemoteEntity(
        kind,
        { ...entity, fields },
        scope,
        derivedResolver,
      );
      const payloadFields = result.payload["fields"];
      if (!isRecord(payloadFields)) {
        throw new Error(`${kind} projection has no fields object`);
      }
      projected.set(kind, payloadFields);
    }

    expect(projected.get("component")).toMatchObject({
      interfaces: [],
      is_entry_point: false,
      stores_data: false,
      technologies: [],
    });
    expect(projected.get("component")).not.toHaveProperty("component_type");
    expect(projected.get("component")).not.toHaveProperty("criticality");
    expect(projected.get("zone")).not.toHaveProperty("trust_level");
    expect(projected.get("asset")).not.toHaveProperty("asset_type");
    expect(projected.get("asset")).not.toHaveProperty("criticality");
    expect(projected.get("dataflow")).toMatchObject({
      authenticated: false,
      bidirectional: false,
      data_types: [],
      encrypted: false,
    });
    expect(projected.get("threat")).toMatchObject({
      affected_components: [],
      dataflows: [],
      assumptions: [],
    });
    expect(projected.get("threat")).not.toHaveProperty("severity");

    client.close();
  });
});
