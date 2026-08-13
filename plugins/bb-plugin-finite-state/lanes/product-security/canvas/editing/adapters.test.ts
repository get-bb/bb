import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";

import { createPluginContext } from "../../../../lib/context.js";
import {
  ASSURANCE_STUDIO_MAX_PAGE_SIZE,
  AssuranceStudioClient,
} from "../../../../lib/remote/assurance-studio/client.js";
import type {
  AsEntity,
  AsEntityKind,
  Json,
} from "../../../../lib/remote/types.js";
import {
  registerMockAssuranceStudio,
} from "../../../../test/mock-remote/assurance-studio/register.js";
import {
  createMockRemote,
  type MockRemoteHarness,
} from "../../../../test/mock-remote/server.js";
import { pull } from "../../../sync/engine/pull.js";
import { BaseSnapshotStore } from "../../../sync/store/base-snapshot.js";
import type { AdapterSlugResolver } from "./adapters.js";
import { createCanvasEntityAdapters } from "./adapters.js";

const FIXTURE_ROOT = fileURLToPath(
  new URL("../../../../test/mock-remote/fixtures", import.meta.url),
);
const API_KEY = "fs153-as-key";
const PROJECT_ID = "project-4a752600a07a";
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

let harness: MockRemoteHarness | null = null;
let host: ReturnType<typeof createFakePluginHost> | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
  await host?.harness.lifecycle.dispose();
  host = null;
});

function stringField(entity: AsEntity, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = entity.fields[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function canvasFields(
  kind: (typeof TARA_KINDS)[number],
  entity: AsEntity,
): Record<string, Json> {
  const common = { name: stringField(entity, "name", "title") ?? entity.id };
  switch (kind) {
    case "component": {
      const zoneId = stringField(entity, "zoneId");
      return {
        ...common,
        component_type: "software",
        criticality: "high",
        interfaces: [{ name: "mock-wire" }],
        technologies: ["typescript"],
        is_entry_point: true,
        stores_data: false,
        ...(zoneId === undefined ? {} : { zone_id: zoneId }),
      };
    }
    case "zone":
      return { ...common, trust_level: "semi_trusted" };
    case "asset":
      return {
        ...common,
        asset_type: "credential",
        criticality: "critical",
        data_classification: "confidential",
      };
    case "dataflow":
      return {
        ...common,
        source_component_id: stringField(entity, "sourceId") ?? "as-component-01",
        target_component_id: stringField(entity, "targetId") ?? "as-component-02",
        protocol: stringField(entity, "protocol") ?? "MQTT",
        data_types: ["telemetry"],
        is_encrypted: true,
        is_authenticated: true,
        is_bidirectional: false,
      };
    case "threat": {
      const componentId = stringField(entity, "componentId");
      const assetId = stringField(entity, "assetId");
      return {
        ...common,
        category: stringField(entity, "stride") ?? "spoofing",
        threat_source: "stride_analysis",
        severity: "high",
        affected_component_ids: componentId === undefined ? [] : [componentId],
        affected_asset_ids: assetId === undefined ? [] : [assetId],
        affected_dataflow_ids: [],
        mitigation_ids: [],
        assumptions: ["mock assumption"],
      };
    }
  }
}

async function listAll(
  client: AssuranceStudioClient,
  kind: AsEntityKind,
): Promise<AsEntity[]> {
  const entities: AsEntity[] = [];
  for await (const page of client.listEntities(kind, {
    projectId: PROJECT_ID,
    page: { pageSize: 50 },
  })) entities.push(...page.items);
  return entities;
}

describe("canvas remote adapters", () => {
  it("pulls all five TARA kinds through the real AS client within its page cap", async () => {
    const requestedPageSizes: number[] = [];
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
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.method === "GET") {
          const pageSize = new URL(request.url).searchParams.get("limit");
          if (pageSize !== null) requestedPageSizes.push(Number(pageSize));
        }
        return harness!.assuranceStudio.fetch(request);
      },
    });

    // The seeded records intentionally exercise fixture-specific aliases. Fill
    // the remaining required AS semantics over the real client, but never add
    // slug: this is the wire contract whose regression FS-155 repairs.
    const seededFieldsByName = new Map<string, Record<string, Json>>();
    for (const kind of TARA_KINDS) {
      for (const entity of await listAll(client, kind)) {
        const seededName = stringField(entity, "name", "title");
        if (seededName !== undefined) {
          seededFieldsByName.set(seededName, entity.fields);
        }
        await client.updateEntity(kind, {
          projectId: PROJECT_ID,
          id: entity.id,
          fields: canvasFields(kind, entity),
          force: true,
        });
      }
    }

    requestedPageSizes.length = 0;
    const resolver: AdapterSlugResolver = {
      remoteToSlug: () => null,
      slugToRemote: () => null,
    };
    const scope = { projectId: PROJECT_ID, projectVersionId: null };
    const adapters = createCanvasEntityAdapters(client, resolver);
    host = createFakePluginHost({ pluginId: "finite-state-fs153-adapter-pull" });
    const db = createPluginContext(host.bb).db();
    const report = await pull({
      db,
      adapters,
      worktreeRoot: null,
      createGenerationId: () => "generation-fs153",
      now: () => new Date("2026-08-13T18:00:00.000Z"),
    }, scope, [...TARA_KINDS]);

    expect(report.kinds).toEqual(Object.fromEntries(
      TARA_KINDS.map((kind) => [kind, {
        fetched: expectedCounts[kind],
        baseRows: expectedCounts[kind],
      }]),
    ));
    const snapshots = new BaseSnapshotStore(db);
    const acceptedByName = new Map<string, Record<string, unknown>>();
    for (const kind of TARA_KINDS) {
      const accepted = snapshots.listAccepted(PROJECT_ID, "@project", kind);
      expect(accepted).toHaveLength(expectedCounts[kind]);
      for (const row of accepted) {
        expect(row.payload).toMatchObject({
          slug: expect.stringMatching(new RegExp(`^${kind}-[0-9a-f]{20}$`, "u")),
        });
        const name = row.payload["name"];
        if (typeof name === "string") acceptedByName.set(name, row.payload);
      }
    }
    const componentSlug = acceptedByName.get("Architecture node 1")?.["slug"];
    const nextComponentSlug = acceptedByName.get("Architecture node 2")?.["slug"];
    const zoneSlug = acceptedByName.get("Untrusted")?.["slug"];
    const assetSlug = acceptedByName.get("Protected asset 1")?.["slug"];
    expect(acceptedByName.get("Architecture node 1")).toMatchObject({
      name: "Architecture node 1",
      zone: zoneSlug,
    });
    expect(acceptedByName.get("Untrusted")).toMatchObject({
      name: "Untrusted",
    });
    expect(acceptedByName.get("Protected asset 1")).toMatchObject({
      name: "Protected asset 1",
    });
    expect(acceptedByName.get("Dataflow 1")).toMatchObject({
      name: "Dataflow 1",
      from: componentSlug,
      to: nextComponentSlug,
      protocol: seededFieldsByName.get("Dataflow 1")?.["protocol"],
      data_types: ["telemetry"],
      encrypted: true,
      authenticated: true,
      bidirectional: false,
    });
    expect(acceptedByName.get("Threat 1")).toMatchObject({
      name: "Threat 1",
      category: seededFieldsByName.get("Threat 1")?.["stride"],
      affected_components: [componentSlug],
      affected_assets: [assetSlug],
    });
    expect(requestedPageSizes).toEqual(
      TARA_KINDS.map(() => ASSURANCE_STUDIO_MAX_PAGE_SIZE),
    );
    expect(requestedPageSizes.every(
      (pageSize) => pageSize <= ASSURANCE_STUDIO_MAX_PAGE_SIZE,
    )).toBe(true);
  });
});
