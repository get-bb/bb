import { defineRpcContract } from "@bb/plugin-sdk";
import { z } from "zod";

export const MAX_LINKS_PER_FAMILY = 2_000;
export const MAX_CANVAS_LAYOUT_NODES = 10_000;
export const MAX_CANVAS_LAYOUT_EDGES = 50_000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTROL_OR_SEPARATOR_PATTERN = /[\u0000-\u001f\u007f\\/]/u;

export const stableSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine((value) => !CONTROL_OR_SEPARATOR_PATTERN.test(value), {
    message: "stable slugs must not contain control characters or path separators",
  })
  .refine((value) => !UUID_PATTERN.test(value), {
    message: "layout and link keys must be stable slugs, not UUIDs",
  });

const timestampSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const relativeFirmwarePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .refine(
    (value) => {
      const normalized = value.replace(/^\/+/, "");
      return (
        normalized.length > 0 &&
        !value.startsWith("~") &&
        !value.includes("\\") &&
        !normalized.split("/").includes("..")
      );
    },
    { message: "firmware paths must stay within the materialized rootfs" },
  )
  .transform((value) => value.replace(/^\/+/, ""));

const purlSchema = z
  .string()
  .trim()
  .min(5)
  .max(2_048)
  .startsWith("pkg:");

export const linkProvenanceSchema = z
  .object({
    source: z.string().trim().min(1).max(1_024),
    at: timestampSchema.optional(),
  })
  .strict();

const mappedTargetSchema = z
  .object({
    target: z.string().trim().min(1).max(2_048),
    label: z.string().trim().min(1).max(500).optional(),
    provenance: linkProvenanceSchema.optional(),
  })
  .strict();

const firmwareMappedTargetSchema = mappedTargetSchema.extend({
  target: relativeFirmwarePathSchema,
});

const sbomMappedTargetSchema = mappedTargetSchema.extend({
  target: purlSchema,
});

export const sbomLinksDocumentSchema = z
  .object({
    schema: z.literal("fs-sbom-links/v1"),
    links: z.record(stableSlugSchema, z.array(sbomMappedTargetSchema).max(100)),
  })
  .strict()
  .refine(
    (value) =>
      Object.values(value.links).reduce(
        (total, entries) => total + entries.length,
        0,
      ) <= MAX_LINKS_PER_FAMILY,
    { message: `SBOM mappings may contain at most ${MAX_LINKS_PER_FAMILY} links` },
  );

export const firmwareLinksDocumentSchema = z
  .object({
    schema: z.literal("fs-firmware-links/v1"),
    links: z.record(
      stableSlugSchema,
      z.array(firmwareMappedTargetSchema).max(1_000),
    ),
  })
  .strict()
  .refine(
    (value) =>
      Object.values(value.links).reduce(
        (total, entries) => total + entries.length,
        0,
      ) <= MAX_LINKS_PER_FAMILY,
    { message: `firmware mappings may contain at most ${MAX_LINKS_PER_FAMILY} links` },
  );

export type SbomLinksDocument = z.output<typeof sbomLinksDocumentSchema>;
export type FirmwareLinksDocument = z.output<
  typeof firmwareLinksDocumentSchema
>;

export const canvasLayoutNodeSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    collapsed: z.boolean().optional(),
  })
  .strict();

const candidateLayoutNodesSchema = z
  .record(
    stableSlugSchema,
    z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        collapsed: z.boolean().optional(),
      })
      .strict(),
  )
  .refine((nodes) => Object.keys(nodes).length <= MAX_CANVAS_LAYOUT_NODES, {
    message: `canvas layouts may contain at most ${MAX_CANVAS_LAYOUT_NODES} nodes`,
  });

const persistedLayoutNodesSchema = z
  .record(stableSlugSchema, canvasLayoutNodeSchema)
  .refine((nodes) => Object.keys(nodes).length <= MAX_CANVAS_LAYOUT_NODES, {
    message: `canvas layouts may contain at most ${MAX_CANVAS_LAYOUT_NODES} nodes`,
  });

export const canvasLayoutCandidateSchema = z
  .object({
    schema: z.literal("fs-canvas-layout/v1"),
    project: z.string().trim().min(1).max(512),
    nodes: candidateLayoutNodesSchema,
  })
  .strict();

export const canvasLayoutV1Schema = z
  .object({
    schema: z.literal("fs-canvas-layout/v1"),
    project: z.string().trim().min(1).max(512),
    nodes: persistedLayoutNodesSchema,
  })
  .strict();

export interface CanvasLayoutV1 {
  schema: "fs-canvas-layout/v1";
  project: string;
  nodes: Record<
    string,
    { x: number; y: number; collapsed?: boolean }
  >;
}

export const crossSurfaceLinkKindSchema = z.enum([
  "sbom",
  "firmware",
  "requirement",
  "verification",
]);
export type CrossSurfaceLinkKind = z.output<
  typeof crossSurfaceLinkKindSchema
>;

export const crossSurfaceLinkSchema = z
  .object({
    kind: crossSurfaceLinkKindSchema,
    sourceSlug: stableSlugSchema,
    target: z.string().max(2_048),
    label: z.string().trim().min(1).max(500),
    ready: z.boolean(),
    reason: z
      .enum(["not_pulled", "not_mapped", "unavailable"])
      .optional(),
    provenance: linkProvenanceSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.ready && (value.target.length === 0 || value.reason)) {
      context.addIssue({
        code: "custom",
        message: "ready links require a target and cannot carry a reason",
      });
    }
    if (!value.ready && !value.reason) {
      context.addIssue({
        code: "custom",
        message: "unready links require a reason",
      });
    }
  });

export interface CrossSurfaceLink {
  kind: "sbom" | "firmware" | "requirement" | "verification";
  sourceSlug: string;
  target: string;
  label: string;
  ready: boolean;
  reason?: "not_pulled" | "not_mapped" | "unavailable";
  provenance?: { source: string; at?: string };
}

export const linkFamilyReadinessSchema = z
  .object({
    kind: crossSurfaceLinkKindSchema,
    state: z.enum(["ready", "not_pulled", "not_mapped", "unavailable"]),
    message: z.string().trim().min(1).max(500).optional(),
    provenance: linkProvenanceSchema.optional(),
  })
  .strict();

export type LinkFamilyReadiness = z.output<
  typeof linkFamilyReadinessSchema
>;

export const resolvedCrossSurfaceLinksSchema = z
  .object({
    sourceSlug: stableSlugSchema,
    links: z.array(crossSurfaceLinkSchema).max(2_000),
    readiness: z.array(linkFamilyReadinessSchema).length(4),
  })
  .strict();

export type ResolvedCrossSurfaceLinks = z.output<
  typeof resolvedCrossSurfaceLinksSchema
>;

const linkFamilyResultSchema = z
  .object({
    sourceSlug: stableSlugSchema,
    links: z.array(crossSurfaceLinkSchema).max(MAX_LINKS_PER_FAMILY),
    readiness: linkFamilyReadinessSchema,
  })
  .strict();

const discoveredNodeSchema = z
  .object({
    slug: stableSlugSchema,
    width: z.number().finite().positive().max(10_000),
    height: z.number().finite().positive().max(10_000),
    collapsed: z.boolean().optional(),
  })
  .strict();

const discoveredEdgeSchema = z
  .object({ source: stableSlugSchema, target: stableSlugSchema })
  .strict();

const projectScopeFields = {
  projectId: z.string().trim().min(1).max(512),
  projectVersionId: z.string().trim().min(1).max(512).nullable(),
} as const;

const familyInputSchema = z
  .object({ ...projectScopeFields, sourceSlug: stableSlugSchema })
  .strict();

const canvasLayoutLoadResultSchema = z
  .object({
    layout: canvasLayoutV1Schema,
    file: z.literal("product-security/layout/canvas.json"),
    sha256: sha256Schema.nullable(),
    needsSave: z.boolean(),
    orphanSlugs: z.array(stableSlugSchema).max(MAX_CANVAS_LAYOUT_NODES),
  })
  .strict();

const canvasLayoutSaveResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("saved"),
      file: z.literal("product-security/layout/canvas.json"),
      sha256: sha256Schema,
      changed: z.boolean(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("conflict"),
      file: z.literal("product-security/layout/canvas.json"),
      currentSha256: sha256Schema.nullable(),
    })
    .strict(),
]);

export const canvasLinksRpcContract = defineRpcContract({
  canvasSbomLinks: {
    input: familyInputSchema,
    output: linkFamilyResultSchema,
  },
  canvasFirmwareLinks: {
    input: familyInputSchema,
    output: linkFamilyResultSchema,
  },
  canvasRequirementLinks: {
    input: familyInputSchema,
    output: linkFamilyResultSchema,
  },
  canvasVerificationLinks: {
    input: familyInputSchema,
    output: linkFamilyResultSchema,
  },
  canvasLayoutLoad: {
    input: z
      .object({
        ...projectScopeFields,
        nodes: z.array(discoveredNodeSchema).max(MAX_CANVAS_LAYOUT_NODES),
        edges: z.array(discoveredEdgeSchema).max(MAX_CANVAS_LAYOUT_EDGES),
      })
      .strict(),
    output: canvasLayoutLoadResultSchema,
  },
  canvasLayoutSave: {
    input: z
      .object({
        ...projectScopeFields,
        layout: canvasLayoutV1Schema,
        expectedSha256: sha256Schema.nullable(),
      })
      .strict(),
    output: canvasLayoutSaveResultSchema,
  },
});
