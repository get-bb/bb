import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  RemoteError,
  type AsEntity,
  type AssuranceStudioClient,
  type Json,
} from "../../../../lib/remote/types.js";
import { ASSURANCE_STUDIO_MAX_PAGE_SIZE } from "../../../../lib/remote/assurance-studio/client.js";
import { ENTITIES } from "../../../../lib/sync/registry.js";
import {
  type EntityAdapter,
  type ServerEntity,
  type SyncScope,
  type WorkingEntity,
} from "../../../sync/engine/adapter.js";
import { createSerializer } from "../../../sync/serialize/serializer.js";
import {
  assetEntitySchema,
  architectureEntityPayload,
  componentEntitySchema,
  dataflowEntitySchema,
  threatEntitySchema,
  type ArchitectureYamlEntity,
  type CanvasEntityKind,
  zoneEntitySchema,
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

const REMOTE_FIELDS = {
  common: {
    name: ["name", "title", "label"],
    description: ["description", "summary"],
  },
  component: {
    componentType: ["component_type", "componentType", "type"],
    criticality: ["criticality"],
    zone: ["zone_id", "zone"],
    interfaces: ["interfaces"],
    technologies: ["technologies"],
    entryPoint: ["is_entry_point", "isEntryPoint"],
    storesData: ["stores_data", "storesData", "is_data_store", "isDataStore"],
  },
  zone: {
    trustLevel: ["trust_level", "trustLevel"],
    parent: ["parent_zone_id", "parent_zone", "zone"],
  },
  asset: {
    criticality: ["criticality"],
    assetType: ["asset_type", "assetType", "type"],
    zone: ["zone_id", "zone"],
    dataClassification: ["data_classification"],
  },
  dataflow: {
    source: ["source_component_id", "from_component", "from"],
    target: ["target_component_id", "to_component", "to"],
    protocol: ["protocol"],
    dataTypes: ["data_types", "dataTypes"],
    encrypted: ["is_encrypted", "encrypted"],
    authenticated: ["is_authenticated", "authenticated"],
  },
  threat: {
    category: ["category", "stride_category", "stride_categories"],
    threatSource: ["threat_source", "threatSource"],
    severity: ["severity"],
    components: ["affected_component_ids", "affected_components"],
    assets: ["asset_ids", "affected_asset_ids", "affected_assets"],
    dataflows: ["affected_dataflow_ids", "affected_dataflows"],
    mitigations: ["mitigation_ids", "mitigations", "linked_mitigations"],
    assumptions: ["preconditions", "assumptions"],
  },
} as const;

export interface TaraRemoteFieldRead {
  kind: CanvasEntityKind;
  field: string;
  aliases: readonly string[];
  requirement: "required" | "optional";
}

export type TaraRemoteFieldReadObserver = (read: TaraRemoteFieldRead) => void;

// The authored YAML schemas stay strict. These boundary-only variants preserve
// absence for fields that the vendored AS response schemas do not require.
const remoteVocabularyStringSchema = z.string().trim().min(1).max(200);
const remoteVocabularyScalarSchema = z.union([
  remoteVocabularyStringSchema,
  z.number().int().safe(),
]);
const remoteComponentEntitySchema = componentEntitySchema
  .partial({
    component_type: true,
    criticality: true,
  })
  .extend({
    component_type: remoteVocabularyStringSchema.optional(),
  });
const remoteZoneEntitySchema = zoneEntitySchema
  .partial({ trust_level: true })
  .extend({ trust_level: remoteVocabularyScalarSchema.optional() });
const remoteAssetEntitySchema = assetEntitySchema
  .partial({
    asset_type: true,
    criticality: true,
  })
  .extend({
    asset_type: remoteVocabularyStringSchema.optional(),
    criticality: remoteVocabularyStringSchema.optional(),
    data_classification: remoteVocabularyStringSchema.optional(),
  });
const remoteThreatEntitySchema = threatEntitySchema
  .partial({ severity: true })
  .extend({
    severity: remoteVocabularyStringSchema.optional(),
  });

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

function referenceIds(value: Json): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      ids.push(item);
      continue;
    }
    if (
      typeof item === "object" &&
      item !== null &&
      !Array.isArray(item) &&
      typeof item["id"] === "string"
    ) {
      ids.push(item["id"]);
      continue;
    }
    return null;
  }
  return ids;
}

class RemoteFieldReader {
  constructor(
    private readonly kind: CanvasEntityKind,
    private readonly fields: Readonly<Record<string, Json>>,
    private readonly scope: SyncScope,
    private readonly resolver: AdapterSlugResolver,
    private readonly observe?: TaraRemoteFieldReadObserver,
  ) {}

  private record(
    field: string,
    aliases: readonly string[],
    requirement: TaraRemoteFieldRead["requirement"],
  ): void {
    this.observe?.({
      kind: this.kind,
      field,
      aliases: [...aliases],
      requirement,
    });
  }

  private missing(aliases: readonly string[]): never {
    throw new Error(
      `REMOTE_FIELD_MISSING: ${this.kind} payload lacks ${aliases.join("/")}.`,
    );
  }

  private findString(aliases: readonly string[]): string | undefined {
    for (const alias of aliases) {
      const value = this.fields[alias];
      if (typeof value === "string" && value.trim().length > 0) return value;
    }
    return undefined;
  }

  requiredString(field: string, aliases: readonly string[]): string {
    this.record(field, aliases, "required");
    return this.findString(aliases) ?? this.missing(aliases);
  }

  optionalString(
    field: string,
    aliases: readonly string[],
  ): string | undefined {
    this.record(field, aliases, "optional");
    return this.findString(aliases);
  }

  optionalVocabularyScalar(
    field: string,
    aliases: readonly string[],
  ): string | number | undefined {
    this.record(field, aliases, "optional");
    for (const alias of aliases) {
      const value = this.fields[alias];
      if (typeof value === "string" && value.trim().length > 0) return value;
      if (typeof value === "number" && Number.isSafeInteger(value)) {
        return value;
      }
    }
    return undefined;
  }

  requiredSingleString(field: string, aliases: readonly string[]): string {
    this.record(field, aliases, "required");
    const scalar = this.findString(aliases);
    if (scalar) return scalar;
    for (const alias of aliases) {
      const value = this.fields[alias];
      if (
        Array.isArray(value) &&
        value.every((item) => typeof item === "string")
      ) {
        if (value.length === 1 && value[0]!.trim().length > 0) return value[0]!;
        if (value.length > 1) {
          throw new Error(
            `REMOTE_FIELD_UNSUPPORTED: ${this.kind} payload has ${value.length} ${alias} values; authored YAML supports one category.`,
          );
        }
      }
    }
    return this.missing(aliases);
  }

  optionalBoolean(
    field: string,
    aliases: readonly string[],
  ): boolean | undefined {
    this.record(field, aliases, "optional");
    for (const alias of aliases) {
      const value = this.fields[alias];
      if (typeof value === "boolean") return value;
    }
    return undefined;
  }

  optionalStringList(
    field: string,
    aliases: readonly string[],
  ): string[] | undefined {
    this.record(field, aliases, "optional");
    for (const alias of aliases) {
      const value = this.fields[alias];
      if (
        Array.isArray(value) &&
        value.every((item) => typeof item === "string")
      ) {
        return value;
      }
    }
    return undefined;
  }

  private resolve(
    targetKind: CanvasEntityKind | "mitigation",
    remoteId: string,
  ): string {
    return (
      this.resolver.remoteToSlug(this.scope, targetKind, remoteId) ??
      derivedRemoteSlug(targetKind, remoteId)
    );
  }

  optionalReference(
    field: string,
    targetKind: CanvasEntityKind | "mitigation",
    aliases: readonly string[],
  ): string | undefined {
    this.record(field, aliases, "optional");
    const remoteId = this.findString(aliases);
    return remoteId ? this.resolve(targetKind, remoteId) : undefined;
  }

  requiredReference(
    field: string,
    targetKind: CanvasEntityKind | "mitigation",
    aliases: readonly string[],
  ): string {
    this.record(field, aliases, "required");
    const remoteId = this.findString(aliases);
    return remoteId
      ? this.resolve(targetKind, remoteId)
      : this.missing(aliases);
  }

  private findReferenceList(aliases: readonly string[]): string[] | undefined {
    for (const alias of aliases) {
      const value = this.fields[alias];
      if (value === undefined) continue;
      const ids = referenceIds(value);
      if (ids !== null) return ids;
    }
    return undefined;
  }

  optionalReferenceList(
    field: string,
    targetKind: CanvasEntityKind | "mitigation",
    aliases: readonly string[],
  ): string[] | undefined {
    this.record(field, aliases, "optional");
    return this.findReferenceList(aliases)?.map((remoteId) =>
      this.resolve(targetKind, remoteId),
    );
  }

  requiredReferenceList(
    field: string,
    targetKind: CanvasEntityKind | "mitigation",
    aliases: readonly string[],
  ): string[] {
    this.record(field, aliases, "required");
    const remoteIds = this.findReferenceList(aliases) ?? this.missing(aliases);
    return remoteIds.map((remoteId) => this.resolve(targetKind, remoteId));
  }
}

function derivedRemoteSlug(
  kind: CanvasEntityKind | "mitigation",
  remoteId: string,
): string {
  // Fresh pulls must resolve a referenced remote ID before its entity may have
  // been fetched, so the fallback must be derivable from the ID alone. Including
  // a name would make the result order-dependent and can break cross-kind links.
  const identity = createHash("sha256")
    .update(remoteId)
    .digest("hex")
    .slice(0, 20);
  return `${kind}-${identity}`;
}

function remotePayload(
  kind: CanvasEntityKind,
  remoteId: string,
  remote: RemoteFieldReader,
  scope: SyncScope,
  resolver: AdapterSlugResolver,
): Record<string, unknown> {
  const slug =
    resolver.remoteToSlug(scope, kind, remoteId) ??
    derivedRemoteSlug(kind, remoteId);
  const name = remote.requiredString("name", REMOTE_FIELDS.common.name);
  const description = remote.optionalString(
    "description",
    REMOTE_FIELDS.common.description,
  );
  const common = { slug, name, ...optional("description", description) };
  switch (kind) {
    case "component":
      return {
        ...common,
        ...optional(
          "component_type",
          remote.optionalString(
            "component_type",
            REMOTE_FIELDS.component.componentType,
          ),
        ),
        ...optional(
          "criticality",
          remote.optionalString(
            "criticality",
            REMOTE_FIELDS.component.criticality,
          ),
        ),
        ...optional(
          "zone",
          remote.optionalReference(
            "zone",
            "zone",
            REMOTE_FIELDS.component.zone,
          ),
        ),
        // AS returns interface labels; authored YAML wraps each label in its
        // richer local interface object without inventing protocol metadata.
        ...optional(
          "interfaces",
          remote
            .optionalStringList(
              "interfaces",
              REMOTE_FIELDS.component.interfaces,
            )
            ?.map((interfaceName) => ({ name: interfaceName })),
        ),
        ...optional(
          "technologies",
          remote.optionalStringList(
            "technologies",
            REMOTE_FIELDS.component.technologies,
          ),
        ),
        ...optional(
          "is_entry_point",
          remote.optionalBoolean(
            "is_entry_point",
            REMOTE_FIELDS.component.entryPoint,
          ),
        ),
        ...optional(
          "stores_data",
          remote.optionalBoolean(
            "stores_data",
            REMOTE_FIELDS.component.storesData,
          ),
        ),
      };
    case "zone":
      return {
        ...common,
        ...optional(
          "trust_level",
          remote.optionalVocabularyScalar(
            "trust_level",
            REMOTE_FIELDS.zone.trustLevel,
          ),
        ),
        ...optional(
          "zone",
          remote.optionalReference("zone", "zone", REMOTE_FIELDS.zone.parent),
        ),
      };
    case "asset": {
      return {
        ...common,
        ...optional(
          "criticality",
          remote.optionalString("criticality", REMOTE_FIELDS.asset.criticality),
        ),
        ...optional(
          "asset_type",
          remote.optionalString("asset_type", REMOTE_FIELDS.asset.assetType),
        ),
        ...optional(
          "zone",
          remote.optionalReference("zone", "zone", REMOTE_FIELDS.asset.zone),
        ),
        ...optional(
          "data_classification",
          remote.optionalString(
            "data_classification",
            REMOTE_FIELDS.asset.dataClassification,
          ),
        ),
      };
    }
    case "dataflow":
      return {
        ...common,
        from: remote.requiredReference(
          "from",
          "component",
          REMOTE_FIELDS.dataflow.source,
        ),
        to: remote.requiredReference(
          "to",
          "component",
          REMOTE_FIELDS.dataflow.target,
        ),
        ...optional(
          "protocol",
          remote.optionalString("protocol", REMOTE_FIELDS.dataflow.protocol),
        ),
        ...optional(
          "data_types",
          remote.optionalStringList(
            "data_types",
            REMOTE_FIELDS.dataflow.dataTypes,
          ),
        ),
        ...optional(
          "encrypted",
          remote.optionalBoolean("encrypted", REMOTE_FIELDS.dataflow.encrypted),
        ),
        ...optional(
          "authenticated",
          remote.optionalBoolean(
            "authenticated",
            REMOTE_FIELDS.dataflow.authenticated,
          ),
        ),
      };
    case "threat":
      return {
        ...common,
        category: remote.requiredSingleString(
          "category",
          REMOTE_FIELDS.threat.category,
        ),
        threat_source: remote.requiredString(
          "threat_source",
          REMOTE_FIELDS.threat.threatSource,
        ),
        // AS's Threat response has no threat severity field. Keep it absent
        // instead of fabricating one from the semantically different risk_level.
        ...optional(
          "severity",
          remote.optionalString("severity", REMOTE_FIELDS.threat.severity),
        ),
        ...optional(
          "affected_components",
          remote.optionalReferenceList(
            "affected_components",
            "component",
            REMOTE_FIELDS.threat.components,
          ),
        ),
        affected_assets: remote.requiredReferenceList(
          "affected_assets",
          "asset",
          REMOTE_FIELDS.threat.assets,
        ),
        // AS does not return a threat-to-dataflow relation. Omission preserves
        // that unknown state instead of asserting an empty remote relation.
        ...optional(
          "dataflows",
          remote.optionalReferenceList(
            "dataflows",
            "dataflow",
            REMOTE_FIELDS.threat.dataflows,
          ),
        ),
        mitigations: remote.requiredReferenceList(
          "mitigations",
          "mitigation",
          REMOTE_FIELDS.threat.mitigations,
        ),
        ...optional(
          "assumptions",
          remote.optionalStringList(
            "assumptions",
            REMOTE_FIELDS.threat.assumptions,
          ),
        ),
      };
  }
}

function canonicalRemotePayload(
  kind: CanvasEntityKind,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const candidate = { kind, ...payload };
  try {
    switch (kind) {
      case "component": {
        const { kind: _kind, ...fields } =
          remoteComponentEntitySchema.parse(candidate);
        return fields;
      }
      case "zone": {
        const { kind: _kind, ...fields } =
          remoteZoneEntitySchema.parse(candidate);
        return fields;
      }
      case "asset": {
        const { kind: _kind, ...fields } =
          remoteAssetEntitySchema.parse(candidate);
        return fields;
      }
      case "dataflow": {
        const { kind: _kind, ...fields } =
          dataflowEntitySchema.parse(candidate);
        return fields;
      }
      case "threat": {
        const { kind: _kind, ...fields } =
          remoteThreatEntitySchema.parse(candidate);
        return fields;
      }
    }
  } catch (error: unknown) {
    if (!(error instanceof z.ZodError)) throw error;
    const issue = error.issues[0];
    const field = issue?.path.map(String).join(".") || "payload";
    let value: unknown = candidate;
    for (const segment of issue?.path ?? []) {
      if (typeof value !== "object" || value === null) {
        value = undefined;
        break;
      }
      if (!Object.hasOwn(value, segment)) {
        value = undefined;
        break;
      }
      value = Reflect.get(value, segment);
    }
    const rendered = JSON.stringify(value) ?? String(value);
    throw new RemoteError(
      `Assurance Studio ${kind}.${field} rejected value ${rendered.slice(0, 200)}: ${issue?.message ?? "invalid remote data"}`,
      {
        service: "assurance-studio",
        code: "AS_INVALID_RESPONSE",
        status: null,
        retryable: false,
        retryAfterMs: null,
        details: { kind, field, value: rendered.slice(0, 200) },
      },
    );
  }
}

export function projectRemoteEntity(
  kind: CanvasEntityKind,
  remote: AsEntity,
  scope: SyncScope,
  resolver: AdapterSlugResolver,
  observe?: TaraRemoteFieldReadObserver,
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
  const payload = canonicalRemotePayload(
    kind,
    remotePayload(
      kind,
      remote.id,
      new RemoteFieldReader(kind, fields, scope, resolver, observe),
      scope,
      resolver,
    ),
  );
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
        page: { pageSize: ASSURANCE_STUDIO_MAX_PAGE_SIZE },
      })) {
        pageNumber += 1;
        onProgress({
          page: pageNumber,
          of:
            page.total === null
              ? null
              : Math.ceil(page.total / ASSURANCE_STUDIO_MAX_PAGE_SIZE),
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
