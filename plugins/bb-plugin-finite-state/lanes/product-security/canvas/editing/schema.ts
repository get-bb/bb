import { z } from "zod";
import type { JsonValue } from "../../../../shared/contract.js";

export const canvasJsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(canvasJsonValueSchema),
    z.record(z.string(), canvasJsonValueSchema),
  ]),
);

export const ARCHITECTURE_KINDS = [
  "component",
  "zone",
  "asset",
  "dataflow",
] as const;
export const CANVAS_ENTITY_KINDS = [...ARCHITECTURE_KINDS, "threat"] as const;
export const canvasEntityKindSchema = z.enum(CANVAS_ENTITY_KINDS);

export type ArchitectureKind = (typeof ARCHITECTURE_KINDS)[number];
export type CanvasEntityKind = (typeof CANVAS_ENTITY_KINDS)[number];

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const stableSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(SLUG, "Use lowercase letters, numbers, and single hyphens.")
  .refine(
    (value) => !UUID.test(value),
    "Server UUIDs cannot be authored as slugs.",
  );

const nameSchema = z.string().trim().min(1).max(500);
const descriptionSchema = z.string().trim().min(1).max(20_000);
const referenceListSchema = z.array(stableSlugSchema).max(2_000).default([]);
const stringListSchema = z
  .array(z.string().trim().min(1).max(500))
  .max(500)
  .default([]);

export const ASSURANCE_STUDIO_CRITICALITIES = [
  "low",
  "medium",
  "high",
  "critical",
] as const;
export const criticalitySchema = z.enum(ASSURANCE_STUDIO_CRITICALITIES);
// Known authored values: the vendored ComponentType enum plus the connected
// FS-207 capture documented in assurance-studio-tara-vocabulary-live-2026-08-14.md.
export const ASSURANCE_STUDIO_COMPONENT_TYPES = [
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
  // Connected FS-207 capture; absent from the older vendored OpenAPI enum.
  "external_service",
  "medical_device",
] as const;

export const componentTypeSchema = z.enum(ASSURANCE_STUDIO_COMPONENT_TYPES);
// Connected AS capture: docs/Implementation/api-reference/
// assurance-studio-tara-vocabulary-live-2026-08-14.md.
export const ASSURANCE_STUDIO_ASSET_TYPES = [
  "function",
  "integrity",
  "identity",
  "software",
  "data",
  "availability",
  "hardware",
  "communication",
  "service",
] as const;
export const assetTypeSchema = z.enum(ASSURANCE_STUDIO_ASSET_TYPES);
// Connected AS capture: docs/Implementation/api-reference/
// assurance-studio-tara-vocabulary-live-2026-08-14.md. The observed set is
// an authoring floor; remote projection remains bounded-open.
export const ASSURANCE_STUDIO_DATA_CLASSIFICATIONS = [
  "public",
  "internal",
  "confidential",
  "restricted",
  "phi",
  "pii",
] as const;
export const dataClassificationSchema = z.enum(
  ASSURANCE_STUDIO_DATA_CLASSIFICATIONS,
);
export const RETIRED_AUTHORED_COMPONENT_TYPES = ["ecu", "hsm", "tee"] as const;
export const retiredAuthoredComponentTypeSchema = z.enum(
  RETIRED_AUTHORED_COMPONENT_TYPES,
);
export const strideCategorySchema = z.enum([
  "spoofing",
  "tampering",
  "repudiation",
  "information_disclosure",
  "denial_of_service",
  "elevation_of_privilege",
]);
export const threatSourceSchema = z.enum([
  "manual",
  "stride_analysis",
  "imported",
  "library",
]);

// The vendored API documents the four string values, while the FS-207 live
// corpus returns integer trust scores 1-10. Both sets are known authoring
// floors; remote projection remains bounded-open for future wire values.
export const ASSURANCE_STUDIO_TRUST_LEVEL_NAMES = [
  "untrusted",
  "semi_trusted",
  "trusted",
  "highly_trusted",
] as const;
export const ASSURANCE_STUDIO_TRUST_LEVEL_SCORES = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
] as const;
export const trustLevelSchema = z.union([
  z.enum(ASSURANCE_STUDIO_TRUST_LEVEL_NAMES),
  z.number().int().min(1).max(10),
]);

const architectureInterfaceSchema = z
  .object({
    name: nameSchema,
    protocol: z.string().trim().min(1).max(200).optional(),
    port: z.number().int().min(0).max(65_535).optional(),
    direction: z.enum(["inbound", "outbound", "bidirectional"]).optional(),
  })
  .strict();

export const componentEntitySchema = z
  .object({
    kind: z.literal("component"),
    slug: stableSlugSchema,
    name: nameSchema,
    description: descriptionSchema.optional(),
    component_type: componentTypeSchema,
    criticality: criticalitySchema,
    zone: stableSlugSchema.optional(),
    interfaces: z.array(architectureInterfaceSchema).max(500).default([]),
    technologies: stringListSchema,
    is_entry_point: z.boolean().default(false),
    stores_data: z.boolean().default(false),
  })
  .strict();

export const retiredAuthoredComponentEntitySchema = componentEntitySchema
  .extend({
    component_type: retiredAuthoredComponentTypeSchema,
  })
  .strict();

export const zoneEntitySchema = z
  .object({
    kind: z.literal("zone"),
    slug: stableSlugSchema,
    name: nameSchema,
    description: descriptionSchema.optional(),
    trust_level: trustLevelSchema,
    zone: stableSlugSchema.optional(),
  })
  .strict();

export const assetEntitySchema = z
  .object({
    kind: z.literal("asset"),
    slug: stableSlugSchema,
    name: nameSchema,
    description: descriptionSchema.optional(),
    asset_type: assetTypeSchema,
    criticality: criticalitySchema,
    zone: stableSlugSchema.optional(),
    data_classification: dataClassificationSchema.optional(),
  })
  .strict();

export const dataflowEntitySchema = z
  .object({
    kind: z.literal("dataflow"),
    slug: stableSlugSchema,
    name: nameSchema,
    description: descriptionSchema.optional(),
    from: stableSlugSchema,
    to: stableSlugSchema,
    protocol: z.string().trim().min(1).max(200).optional(),
    data_types: stringListSchema,
    encrypted: z.boolean().default(false),
    authenticated: z.boolean().default(false),
    bidirectional: z.boolean().default(false),
  })
  .strict()
  .refine((entity) => entity.from !== entity.to, {
    message: "A dataflow must connect two different architecture entities.",
    path: ["to"],
  });

export const threatEntitySchema = z
  .object({
    kind: z.literal("threat"),
    slug: stableSlugSchema,
    name: nameSchema,
    description: descriptionSchema.optional(),
    category: strideCategorySchema,
    threat_source: threatSourceSchema,
    severity: criticalitySchema,
    affected_components: referenceListSchema,
    affected_assets: referenceListSchema,
    dataflows: referenceListSchema,
    mitigations: referenceListSchema,
    assumptions: stringListSchema,
  })
  .strict();

export const architectureYamlEntitySchema = z.discriminatedUnion("kind", [
  componentEntitySchema,
  zoneEntitySchema,
  assetEntitySchema,
  dataflowEntitySchema,
  threatEntitySchema,
]);

export type ComponentYamlEntity = z.output<typeof componentEntitySchema>;
export type RetiredAuthoredComponentYamlEntity = z.output<
  typeof retiredAuthoredComponentEntitySchema
>;
export type ZoneYamlEntity = z.output<typeof zoneEntitySchema>;
export type AssetYamlEntity = z.output<typeof assetEntitySchema>;
export type DataflowYamlEntity = z.output<typeof dataflowEntitySchema>;
export type ThreatYamlEntity = z.output<typeof threatEntitySchema>;
export type ArchitectureYamlEntity = z.output<
  typeof architectureYamlEntitySchema
>;

// Accepted cache rows are an external read model, not authoring documents.
// Pull adapters may omit authoring-only fields or retain remote-only fields;
// deletion analysis only needs stable identity and reference-bearing fields.
const acceptedEntityIdentityFields = {
  slug: stableSlugSchema,
  name: nameSchema.optional(),
} as const;
const acceptedComponentEntitySchema = z.object({
  kind: z.literal("component"),
  ...acceptedEntityIdentityFields,
  zone: stableSlugSchema.optional(),
});
const acceptedZoneEntitySchema = z.object({
  kind: z.literal("zone"),
  ...acceptedEntityIdentityFields,
  zone: stableSlugSchema.optional(),
});
const acceptedAssetEntitySchema = z.object({
  kind: z.literal("asset"),
  ...acceptedEntityIdentityFields,
  zone: stableSlugSchema.optional(),
});
const acceptedDataflowEntitySchema = z.object({
  kind: z.literal("dataflow"),
  ...acceptedEntityIdentityFields,
  from: stableSlugSchema.optional(),
  to: stableSlugSchema.optional(),
});
const acceptedThreatEntitySchema = z.object({
  kind: z.literal("threat"),
  ...acceptedEntityIdentityFields,
  affected_components: referenceListSchema.optional(),
  affected_assets: referenceListSchema.optional(),
  dataflows: referenceListSchema.optional(),
  mitigations: referenceListSchema.optional(),
});

export type CanvasReadableEntity =
  | z.output<typeof acceptedComponentEntitySchema>
  | z.output<typeof acceptedZoneEntitySchema>
  | z.output<typeof acceptedAssetEntitySchema>
  | z.output<typeof acceptedDataflowEntitySchema>
  | z.output<typeof acceptedThreatEntitySchema>;

export interface DeletionImpact {
  slug: string;
  referrers: { kind: string; slug: string; effect: string }[];
  allowedActions: ("cascade" | "detach")[];
  restorable: boolean;
}

export function parseArchitectureEntity(
  kind: CanvasEntityKind,
  payload: Record<string, unknown>,
): ArchitectureYamlEntity {
  switch (kind) {
    case "component":
      return componentEntitySchema.parse({ kind, ...payload });
    case "zone":
      return zoneEntitySchema.parse({ kind, ...payload });
    case "asset":
      return assetEntitySchema.parse({ kind, ...payload });
    case "dataflow":
      return dataflowEntitySchema.parse({ kind, ...payload });
    case "threat":
      return threatEntitySchema.parse({ kind, ...payload });
  }
}

export function parseAcceptedArchitectureEntity(
  kind: CanvasEntityKind,
  payload: Record<string, unknown>,
): CanvasReadableEntity {
  switch (kind) {
    case "component":
      return acceptedComponentEntitySchema.parse({ kind, ...payload });
    case "zone":
      return acceptedZoneEntitySchema.parse({ kind, ...payload });
    case "asset":
      return acceptedAssetEntitySchema.parse({ kind, ...payload });
    case "dataflow":
      return acceptedDataflowEntitySchema.parse({ kind, ...payload });
    case "threat":
      return acceptedThreatEntitySchema.parse({ kind, ...payload });
  }
}

export function architectureEntityPayload(
  entity: ArchitectureYamlEntity,
): Record<string, unknown> {
  const { kind: _kind, ...payload } = entity;
  return payload;
}

export interface CanvasReference {
  field: string;
  kind: CanvasEntityKind | "mitigation";
  slug: string;
}

export function entityReferences(
  entity: CanvasReadableEntity,
): readonly CanvasReference[] {
  switch (entity.kind) {
    case "component":
      return entity.zone
        ? [{ field: "zone", kind: "zone", slug: entity.zone }]
        : [];
    case "zone":
      return entity.zone
        ? [{ field: "zone", kind: "zone", slug: entity.zone }]
        : [];
    case "asset":
      return entity.zone
        ? [{ field: "zone", kind: "zone", slug: entity.zone }]
        : [];
    case "dataflow":
      return [
        ...(entity.from
          ? [{ field: "from", kind: "component" as const, slug: entity.from }]
          : []),
        ...(entity.to
          ? [{ field: "to", kind: "component" as const, slug: entity.to }]
          : []),
      ];
    case "threat":
      return [
        ...(entity.affected_components ?? []).map((slug) => ({
          field: "affected_components",
          kind: "component" as const,
          slug,
        })),
        ...(entity.affected_assets ?? []).map((slug) => ({
          field: "affected_assets",
          kind: "asset" as const,
          slug,
        })),
        ...(entity.dataflows ?? []).map((slug) => ({
          field: "dataflows",
          kind: "dataflow" as const,
          slug,
        })),
        ...(entity.mitigations ?? []).map((slug) => ({
          field: "mitigations",
          kind: "mitigation" as const,
          slug,
        })),
      ];
  }
}

const editingScopeFields = {
  projectId: z.string().trim().min(1).max(512),
  projectVersionId: z.string().trim().min(1).max(512).nullable(),
} as const;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const canvasEditingLoadInputSchema = z
  .object({
    ...editingScopeFields,
    kind: z.enum(CANVAS_ENTITY_KINDS),
    slug: stableSlugSchema,
  })
  .strict();

export const canvasEditingLoadOutputSchema = z.discriminatedUnion("state", [
  z
    .object({
      ...editingScopeFields,
      state: z.literal("missing"),
      kind: z.enum(CANVAS_ENTITY_KINDS),
      slug: stableSlugSchema,
      file: z.string().trim().min(1).max(1_024),
    })
    .strict(),
  z
    .object({
      ...editingScopeFields,
      state: z.literal("ready"),
      kind: z.enum(CANVAS_ENTITY_KINDS),
      slug: stableSlugSchema,
      file: z.string().trim().min(1).max(1_024),
      sha256: sha256Schema,
      fields: z.record(z.string(), canvasJsonValueSchema),
    })
    .strict(),
  z
    .object({
      ...editingScopeFields,
      state: z.literal("migration_required"),
      kind: z.literal("component"),
      slug: stableSlugSchema,
      file: z.string().trim().min(1).max(1_024),
      sha256: sha256Schema,
      fields: z.record(z.string(), canvasJsonValueSchema),
      advisory: z
        .object({
          code: z.literal("RETIRED_COMPONENT_TYPE"),
          field: z.literal("component_type"),
          value: retiredAuthoredComponentTypeSchema,
          allowedValues: z
            .array(componentTypeSchema)
            .length(ASSURANCE_STUDIO_COMPONENT_TYPES.length),
          message: z.string().trim().min(1).max(2_000),
        })
        .strict(),
    })
    .strict(),
]);
