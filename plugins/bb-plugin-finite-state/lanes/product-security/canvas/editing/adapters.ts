import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AsEntity,
  AssuranceStudioClient,
  Json,
} from "../../../../lib/remote/types.js";
import { ENTITIES } from "../../../../lib/sync/registry.js";
import {
  type EntityAdapter,
  type ServerEntity,
  type SyncScope,
  type WorkingEntity,
} from "../../../sync/engine/adapter.js";
import { createSerializer } from "../../../sync/serialize/serializer.js";
import {
  architectureEntityPayload,
  criticalitySchema,
  type ArchitectureYamlEntity,
  type CanvasEntityKind,
} from "./schema.js";
import { parseCanvasEntity, canvasEntityFile } from "./writer.js";

export interface AdapterSlugResolver {
  remoteToSlug(
    scope: SyncScope,
    kind: CanvasEntityKind | "mitigation",
    remoteId: string,
  ): string | null;
  slugToRemote(
    scope: SyncScope,
    kind: CanvasEntityKind | "mitigation",
    slug: string,
  ): string | null;
}

function optional<T extends Json>(
  field: string,
  value: T | undefined,
): Record<string, Json> {
  return value === undefined ? {} : { [field]: value };
}

function commonFields(entity: ArchitectureYamlEntity): Record<string, Json> {
  return {
    slug: entity.slug,
    name: entity.name,
    ...optional("description", entity.description),
  };
}

function requireRemote(
  resolver: AdapterSlugResolver,
  scope: SyncScope,
  kind: CanvasEntityKind | "mitigation",
  slug: string,
): string {
  const remoteId = resolver.slugToRemote(scope, kind, slug);
  if (!remoteId) {
    throw new Error(
      `UNRESOLVED_SLUG: ${kind} “${slug}” has no accepted id_map binding.`,
    );
  }
  return remoteId;
}

export function projectCreateFields(
  entity: ArchitectureYamlEntity,
  scope: SyncScope,
  resolver: AdapterSlugResolver,
): Record<string, Json> {
  const common = commonFields(entity);
  switch (entity.kind) {
    case "component":
      return {
        ...common,
        component_type: entity.component_type,
        criticality: entity.criticality,
        ...optional(
          "zone_id",
          entity.zone
            ? requireRemote(resolver, scope, "zone", entity.zone)
            : undefined,
        ),
        interfaces: entity.interfaces,
        technologies: entity.technologies,
        is_entry_point: entity.is_entry_point,
        stores_data: entity.stores_data,
      };
    case "zone":
      return {
        ...common,
        trust_level: entity.trust_level,
        ...optional(
          "parent_zone_id",
          entity.zone
            ? requireRemote(resolver, scope, "zone", entity.zone)
            : undefined,
        ),
      };
    case "asset":
      return {
        ...common,
        asset_type: entity.asset_type,
        // Assurance Studio POST names this value business_value.
        business_value: entity.criticality,
        ...optional(
          "zone_id",
          entity.zone
            ? requireRemote(resolver, scope, "zone", entity.zone)
            : undefined,
        ),
        ...optional("data_classification", entity.data_classification),
      };
    case "dataflow":
      return {
        ...common,
        // POST and PATCH intentionally use different upstream field names.
        source_component_id: requireRemote(
          resolver,
          scope,
          "component",
          entity.from,
        ),
        target_component_id: requireRemote(
          resolver,
          scope,
          "component",
          entity.to,
        ),
        ...optional("protocol", entity.protocol),
        data_types: entity.data_types,
        is_encrypted: entity.encrypted,
        is_authenticated: entity.authenticated,
        is_bidirectional: entity.bidirectional,
      };
    case "threat":
      return {
        ...common,
        category: entity.category,
        threat_source: entity.threat_source,
        severity: entity.severity,
        affected_component_ids: entity.affected_components.map((slug) =>
          requireRemote(resolver, scope, "component", slug),
        ),
        affected_asset_ids: entity.affected_assets.map((slug) =>
          requireRemote(resolver, scope, "asset", slug),
        ),
        affected_dataflow_ids: entity.dataflows.map((slug) =>
          requireRemote(resolver, scope, "dataflow", slug),
        ),
        mitigation_ids: entity.mitigations.map((slug) =>
          requireRemote(resolver, scope, "mitigation", slug),
        ),
        assumptions: entity.assumptions,
      };
  }
}

export function projectPatchFields(
  entity: ArchitectureYamlEntity,
  scope: SyncScope,
  resolver: AdapterSlugResolver,
): Record<string, Json> {
  if (entity.kind === "asset") {
    const projected = projectCreateFields(entity, scope, resolver);
    const { business_value: _businessValue, ...rest } = projected;
    return { ...rest, criticality: entity.criticality };
  }
  if (entity.kind === "dataflow") {
    const common = commonFields(entity);
    return {
      ...common,
      from_component: requireRemote(resolver, scope, "component", entity.from),
      to_component: requireRemote(resolver, scope, "component", entity.to),
      ...optional("protocol", entity.protocol),
      data_types: entity.data_types,
      encrypted: entity.encrypted,
      authenticated: entity.authenticated,
      bidirectional: entity.bidirectional,
    };
  }
  return projectCreateFields(entity, scope, resolver);
}

function stringField(
  fields: Record<string, Json>,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const value = fields[name];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}

function requiredStringField(
  kind: CanvasEntityKind,
  fields: Record<string, Json>,
  ...names: string[]
): string {
  const value = stringField(fields, ...names);
  if (value) return value;
  throw new Error(
    `REMOTE_FIELD_MISSING: ${kind} payload lacks ${names.join("/")}.`,
  );
}

function isJson(value: unknown): value is Json {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJson(item));
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((item) => isJson(item))
  );
}

function requiredBooleanField(
  kind: CanvasEntityKind,
  fields: Record<string, Json>,
  ...names: string[]
): boolean {
  for (const name of names) {
    const value = fields[name];
    if (typeof value === "boolean") return value;
  }
  throw new Error(
    `REMOTE_FIELD_MISSING: ${kind} payload lacks ${names.join("/")}.`,
  );
}

function requiredStringList(
  kind: CanvasEntityKind,
  fields: Record<string, Json>,
  ...names: string[]
): string[] {
  for (const name of names) {
    const value = fields[name];
    if (
      Array.isArray(value) &&
      value.every((item) => typeof item === "string")
    ) {
      return value;
    }
  }
  throw new Error(
    `REMOTE_FIELD_MISSING: ${kind} payload lacks ${names.join("/")}.`,
  );
}

function requiredList(
  kind: CanvasEntityKind,
  fields: Record<string, Json>,
  name: string,
): Json[] {
  const value = fields[name];
  if (Array.isArray(value)) return value;
  throw new Error(`REMOTE_FIELD_MISSING: ${kind} payload lacks ${name}.`);
}

function remoteReference(
  fields: Record<string, Json>,
  resolver: AdapterSlugResolver,
  scope: SyncScope,
  kind: CanvasEntityKind | "mitigation",
  ...names: string[]
): string | undefined {
  const value = stringField(fields, ...names);
  if (!value) return undefined;
  const mapped = resolver.remoteToSlug(scope, kind, value);
  if (mapped) return mapped;
  throw new Error(
    `UNRESOLVED_REMOTE_ID: ${kind} identifier “${value}” is absent from id_map.`,
  );
}

function remoteReferenceList(
  fields: Record<string, Json>,
  resolver: AdapterSlugResolver,
  scope: SyncScope,
  kind: CanvasEntityKind | "mitigation",
  ...names: string[]
): string[] {
  let references: string[] | null = null;
  for (const name of names) {
    const value = fields[name];
    if (
      Array.isArray(value) &&
      value.every((item) => typeof item === "string")
    ) {
      references = value;
      break;
    }
  }
  if (!references) {
    throw new Error(
      `REMOTE_FIELD_MISSING: ${kind} reference list lacks ${names.join("/")}.`,
    );
  }
  return references.map((value) => {
    const mapped = resolver.remoteToSlug(scope, kind, value);
    if (mapped) return mapped;
    throw new Error(
      `UNRESOLVED_REMOTE_ID: ${kind} identifier “${value}” is absent from id_map.`,
    );
  });
}

function remotePayload(
  kind: CanvasEntityKind,
  fields: Record<string, Json>,
  scope: SyncScope,
  resolver: AdapterSlugResolver,
): Record<string, unknown> {
  const slug = stringField(fields, "slug");
  const name = stringField(fields, "name", "title", "label");
  if (!slug || !name)
    throw new Error(`${kind} remote payload lacks slug or name.`);
  const description = stringField(fields, "description", "summary");
  const common = { slug, name, ...optional("description", description) };
  switch (kind) {
    case "component":
      return {
        ...common,
        component_type: requiredStringField(
          kind,
          fields,
          "component_type",
          "componentType",
          "type",
        ),
        criticality: requiredStringField(kind, fields, "criticality"),
        ...optional(
          "zone",
          remoteReference(fields, resolver, scope, "zone", "zone_id", "zone"),
        ),
        interfaces: requiredList(kind, fields, "interfaces"),
        technologies: requiredStringList(kind, fields, "technologies"),
        is_entry_point: requiredBooleanField(
          kind,
          fields,
          "is_entry_point",
          "isEntryPoint",
        ),
        stores_data: requiredBooleanField(
          kind,
          fields,
          "stores_data",
          "storesData",
          "is_data_store",
          "isDataStore",
        ),
      };
    case "zone":
      return {
        ...common,
        trust_level: requiredStringField(
          kind,
          fields,
          "trust_level",
          "trustLevel",
        ),
        ...optional(
          "zone",
          remoteReference(
            fields,
            resolver,
            scope,
            "zone",
            "parent_zone_id",
            "parent_zone",
            "zone",
          ),
        ),
      };
    case "asset": {
      const criticality = requiredStringField(
        kind,
        fields,
        "criticality",
        "business_value",
      );
      criticalitySchema.parse(criticality);
      return {
        ...common,
        asset_type: requiredStringField(
          kind,
          fields,
          "asset_type",
          "assetType",
          "type",
        ),
        criticality,
        ...optional(
          "zone",
          remoteReference(fields, resolver, scope, "zone", "zone_id", "zone"),
        ),
        ...optional(
          "data_classification",
          stringField(fields, "data_classification"),
        ),
      };
    }
    case "dataflow":
      return {
        ...common,
        from: remoteReference(
          fields,
          resolver,
          scope,
          "component",
          "source_component_id",
          "from_component",
          "from",
        ),
        to: remoteReference(
          fields,
          resolver,
          scope,
          "component",
          "target_component_id",
          "to_component",
          "to",
        ),
        ...optional("protocol", stringField(fields, "protocol")),
        data_types: requiredStringList(
          kind,
          fields,
          "data_types",
          "dataTypes",
        ),
        encrypted: requiredBooleanField(
          kind,
          fields,
          "is_encrypted",
          "encrypted",
        ),
        authenticated: requiredBooleanField(
          kind,
          fields,
          "is_authenticated",
          "authenticated",
        ),
        bidirectional: requiredBooleanField(
          kind,
          fields,
          "is_bidirectional",
          "bidirectional",
        ),
      };
    case "threat":
      return {
        ...common,
        category: requiredStringField(
          kind,
          fields,
          "category",
          "stride_category",
        ),
        threat_source: requiredStringField(
          kind,
          fields,
          "threat_source",
          "threatSource",
        ),
        severity: requiredStringField(kind, fields, "severity"),
        affected_components: remoteReferenceList(
          fields,
          resolver,
          scope,
          "component",
          "affected_component_ids",
          "affected_components",
        ),
        affected_assets: remoteReferenceList(
          fields,
          resolver,
          scope,
          "asset",
          "affected_asset_ids",
          "affected_assets",
        ),
        dataflows: remoteReferenceList(
          fields,
          resolver,
          scope,
          "dataflow",
          "affected_dataflow_ids",
          "affected_dataflows",
        ),
        mitigations: remoteReferenceList(
          fields,
          resolver,
          scope,
          "mitigation",
          "mitigation_ids",
          "mitigations",
        ),
        assumptions: requiredStringList(kind, fields, "assumptions"),
      };
  }
}

export function projectRemoteEntity(
  kind: CanvasEntityKind,
  remote: AsEntity,
  scope: SyncScope,
  resolver: AdapterSlugResolver,
): ServerEntity {
  if (remote.kind !== kind) {
    throw new Error(
      `Assurance Studio returned ${remote.kind} in a ${kind} page.`,
    );
  }
  const semantic = createSerializer(kind).semanticPayload({
    id: remote.id,
    projectId: remote.projectId,
    kind: remote.kind,
    reviewVersion: remote.reviewVersion,
    reviewStatus: remote.reviewStatus,
    humanEdited: remote.humanEdited,
    fields: remote.fields,
  });
  const fields: Record<string, Json> = {};
  for (const [field, value] of Object.entries(semantic)) {
    if (isJson(value)) {
      fields[field] = value;
    }
  }
  const entity = parseCanvasEntity(
    kind,
    createSerializer(kind).toYaml(
      remotePayload(kind, fields, scope, resolver),
      {
        idToSlug() {
          return null;
        },
      },
    ),
    `<remote:${kind}:${remote.id}>`,
  );
  const payload = architectureEntityPayload(entity);
  return {
    key: ENTITIES[kind].key(payload),
    remoteId: remote.id,
    // The sync engine owns the one semanticPayload() call for remote rows.
    // Re-wrap the canonical, id_map-resolved fields in its expected envelope
    // so plan, status, and pull all observe the same authored projection.
    payload: {
      id: remote.id,
      projectId: remote.projectId,
      kind: remote.kind,
      reviewVersion: remote.reviewVersion,
      reviewStatus: remote.reviewStatus,
      humanEdited: remote.humanEdited,
      fields: payload,
    },
  };
}

function isMissingDirectory(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readWorkingKind(
  worktreeRoot: string,
  kind: CanvasEntityKind,
): Promise<WorkingEntity[]> {
  const directory = ENTITIES[kind].dir;
  let entries;
  try {
    entries = await readdir(join(worktreeRoot, directory), {
      withFileTypes: true,
    });
  } catch (error) {
    if (isMissingDirectory(error)) return [];
    throw error;
  }
  const documents: WorkingEntity[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (!/\.ya?ml$/iu.test(entry.name)) continue;
    if (!entry.isFile()) {
      throw new Error(
        `${directory}/${entry.name} must be a regular YAML file.`,
      );
    }
    const file = `${directory}/${entry.name}`;
    const content = await readFile(join(worktreeRoot, file), "utf8");
    const entity = parseCanvasEntity(kind, content, file);
    const expectedFile = canvasEntityFile(kind, entity.slug);
    if (file !== expectedFile) {
      throw new Error(
        `${file} declares slug ${entity.slug}; expected ${expectedFile}.`,
      );
    }
    const payload = architectureEntityPayload(entity);
    documents.push({ key: ENTITIES[kind].key(payload), payload, file });
  }
  return documents;
}

function createAdapter(
  kind: CanvasEntityKind,
  client: AssuranceStudioClient,
  resolver: AdapterSlugResolver,
): EntityAdapter {
  return {
    kind,
    klass: "VERSIONED",
    serializer: createSerializer(kind),
    async *fetchRemote(scope, onProgress) {
      let pageNumber = 0;
      for await (const page of client.listEntities(kind, {
        projectId: scope.projectId,
        page: { pageSize: 1_000 },
      })) {
        pageNumber += 1;
        onProgress({
          page: pageNumber,
          of: page.total === null ? null : Math.ceil(page.total / 1_000),
        });
        yield page.items.map((remote) =>
          projectRemoteEntity(kind, remote, scope, resolver),
        );
      }
    },
    readWorking(worktreeRoot) {
      return readWorkingKind(worktreeRoot, kind);
    },
  };
}

export function createCanvasEntityAdapters(
  client: AssuranceStudioClient,
  resolver: AdapterSlugResolver,
): readonly EntityAdapter[] {
  return (["component", "zone", "asset", "dataflow", "threat"] as const).map(
    (kind) => createAdapter(kind, client, resolver),
  );
}
