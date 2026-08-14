/**
 * FROZEN after WP-03 merges. Changes require an accepted amendment, a
 * CONTRACT_VERSION bump, and a broadcast to every RPC producer and consumer.
 *
 * Product documentation uses dotted logical names. bb.rpc wire names cannot
 * contain dots, so RPC_WIRE_METHODS is the canonical, bijective logical-to-wire
 * mapping. Wire names use deterministic lowerCamelCase.
 */
import { defineRpcContract } from "@bb/plugin-sdk";
import { z } from "zod";

export const CONTRACT_VERSION = 7 as const;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const RPC_WIRE_METHODS = {
  "connections.status": "connectionsStatus",
  "workspace.summary": "workspaceSummary",
  "sync.pull": "syncPull",
  "sync.status": "syncStatus",
  "sync.plan": "syncPlan",
  "sync.conflict.resolve": "syncConflictResolve",
  "sync.push": "syncPush",
  "sync.push.retry": "syncPushRetry",
  "findings.list": "findingsList",
  "findings.get": "findingsGet",
  "findings.activity.list": "findingsActivityList",
  "findings.comments.list": "findingsCommentsList",
  "findings.comments.create": "findingsCommentsCreate",
  "findings.comments.update": "findingsCommentsUpdate",
  "findings.comments.delete": "findingsCommentsDelete",
  "findings.facets": "findingsFacets",
  "triage.run.get": "triageRunGet",
  "triage.decision.write": "triageDecisionWrite",
  "triage.decision.bulkWrite": "triageDecisionBulkWrite",
  "triage.decision.undo": "triageDecisionUndo",
  "triage.policy.preview": "triagePolicyPreview",
  "triage.policy.apply": "triagePolicyApply",
  "triage.vendorVex.preview": "triageVendorVexPreview",
  "triage.vendorVex.apply": "triageVendorVexApply",
  "triage.orphans.prune": "triageOrphansPrune",
  "tara.list": "taraList",
  "tara.get": "taraGet",
  "tara.command.apply": "taraCommandApply",
  "tara.deleteImpact": "taraDeleteImpact",
  "requirements.list": "requirementsList",
  "requirements.get": "requirementsGet",
  "requirements.write": "requirementsWrite",
  "ears.conversion.start": "earsConversionStart",
  "ears.conversion.get": "earsConversionGet",
  "ears.conversion.review": "earsConversionReview",
  "verifications.matrix": "verificationsMatrix",
  "verifications.run.get": "verificationsRunGet",
  "verifications.run.start": "verificationsRunStart",
  "verifications.manualAttestation.record":
    "verificationsManualAttestationRecord",
  "review.transition": "reviewTransition",
  "bom.software.list": "bomSoftwareList",
  "bom.component.get": "bomComponentGet",
  "hbom.review.list": "hbomReviewList",
  "hbom.review.resolve": "hbomReviewResolve",
  "hbom.extraction.apply": "hbomExtractionApply",
  "firmware.mounts.list": "firmwareMountsList",
  "firmware.mount.get": "firmwareMountGet",
  "firmware.tree.list": "firmwareTreeList",
  "firmware.file.get": "firmwareFileGet",
  "firmware.diff": "firmwareDiff",
  "firmware.input.issue": "firmwareInputIssue",
  "firmware.materialize.start": "firmwareMaterializeStart",
  "firmware.materialize.cancel": "firmwareMaterializeCancel",
  "firmware.file.hydrate": "firmwareFileHydrate",
  "bench.runs.list": "benchRunsList",
  "bench.run.get": "benchRunGet",
  "bench.logs.list": "benchLogsList",
  "bench.verdict.get": "benchVerdictGet",
  "bench.run.start": "benchRunStart",
  "bench.hosts.list": "benchHostsList",
  "bench.hosts.joinCode": "benchHostsJoinCode",
  "documents.list": "documentsList",
  "documents.get": "documentsGet",
  "documents.search": "documentsSearch",
  "documents.metadata.update": "documentsMetadataUpdate",
  "documents.extractions.list": "documentsExtractionsList",
  "hardware.projects.list": "hardwareProjectsList",
  "hardware.symbols.list": "hardwareSymbolsList",
  "hardware.nets.list": "hardwareNetsList",
  "hardware.violations.list": "hardwareViolationsList",
  "hardware.sheets.list": "hardwareSheetsList",
  "hardware.part.get": "hardwarePartGet",
  "hardware.artifacts.status": "hardwareArtifactsStatus",
  "hardware.extract.start": "hardwareExtractStart",
  "hardware.extract.status": "hardwareExtractStatus",
  "grounding.sources.list": "groundingSourcesList",
  "grounding.query": "groundingQuery",
  "grounding.coverage.get": "groundingCoverageGet",
  "authoring.citations.list": "authoringCitationsList",
  "authoring.quarantine.list": "authoringQuarantineList",
  "authoring.gate.status": "authoringGateStatus",
  "benchDev.devices.list": "benchDevDevicesList",
  "benchDev.device.claim": "benchDevDeviceClaim",
  "benchDev.device.release": "benchDevDeviceRelease",
  "benchDev.runs.list": "benchDevRunsList",
  "benchDev.serial.session.get": "benchDevSerialSessionGet",
} as const;

export type LogicalRpcMethod = keyof typeof RPC_WIRE_METHODS;
export type RpcMethod = (typeof RPC_WIRE_METHODS)[LogicalRpcMethod];
export type RpcMethodClass = "read" | "local-write" | "action" | "human-only";

/** Security classification is independent of whether an RPC exists. */
export const RPC_METHOD_CLASSIFICATIONS = {
  connectionsStatus: "read",
  workspaceSummary: "read",
  syncPull: "local-write",
  syncStatus: "read",
  syncPlan: "read",
  syncConflictResolve: "human-only",
  syncPush: "human-only",
  syncPushRetry: "human-only",
  findingsList: "read",
  findingsGet: "read",
  findingsActivityList: "read",
  findingsCommentsList: "read",
  findingsCommentsCreate: "human-only",
  findingsCommentsUpdate: "human-only",
  findingsCommentsDelete: "human-only",
  findingsFacets: "read",
  triageRunGet: "read",
  triageDecisionWrite: "local-write",
  triageDecisionBulkWrite: "local-write",
  triageDecisionUndo: "local-write",
  triagePolicyPreview: "read",
  triagePolicyApply: "local-write",
  triageVendorVexPreview: "read",
  triageVendorVexApply: "local-write",
  triageOrphansPrune: "local-write",
  taraList: "read",
  taraGet: "read",
  taraCommandApply: "local-write",
  taraDeleteImpact: "read",
  requirementsList: "read",
  requirementsGet: "read",
  requirementsWrite: "local-write",
  earsConversionStart: "action",
  earsConversionGet: "read",
  earsConversionReview: "local-write",
  verificationsMatrix: "read",
  verificationsRunGet: "read",
  verificationsRunStart: "action",
  verificationsManualAttestationRecord: "human-only",
  reviewTransition: "human-only",
  bomSoftwareList: "read",
  bomComponentGet: "read",
  hbomReviewList: "read",
  hbomReviewResolve: "human-only",
  hbomExtractionApply: "human-only",
  firmwareMountsList: "read",
  firmwareMountGet: "read",
  firmwareTreeList: "read",
  firmwareFileGet: "read",
  firmwareDiff: "read",
  firmwareInputIssue: "action",
  firmwareMaterializeStart: "action",
  firmwareMaterializeCancel: "action",
  firmwareFileHydrate: "action",
  benchRunsList: "read",
  benchRunGet: "read",
  benchLogsList: "read",
  benchVerdictGet: "read",
  benchRunStart: "action",
  benchHostsList: "read",
  benchHostsJoinCode: "action",
  documentsList: "read",
  documentsGet: "read",
  documentsSearch: "read",
  documentsMetadataUpdate: "local-write",
  documentsExtractionsList: "read",
  hardwareProjectsList: "read",
  hardwareSymbolsList: "read",
  hardwareNetsList: "read",
  hardwareViolationsList: "read",
  hardwareSheetsList: "read",
  hardwarePartGet: "read",
  hardwareArtifactsStatus: "read",
  hardwareExtractStart: "action",
  hardwareExtractStatus: "read",
  groundingSourcesList: "read",
  groundingQuery: "read",
  groundingCoverageGet: "read",
  authoringCitationsList: "read",
  authoringQuarantineList: "read",
  authoringGateStatus: "read",
  benchDevDevicesList: "read",
  benchDevDeviceClaim: "local-write",
  benchDevDeviceRelease: "local-write",
  benchDevRunsList: "read",
  benchDevSerialSessionGet: "read",
} as const satisfies Record<RpcMethod, RpcMethodClass>;

export const HUMAN_ONLY_RPC_METHODS = [
  "syncConflictResolve",
  "syncPush",
  "syncPushRetry",
  "findingsCommentsCreate",
  "findingsCommentsUpdate",
  "findingsCommentsDelete",
  "verificationsManualAttestationRecord",
  "reviewTransition",
  "hbomReviewResolve",
  "hbomExtractionApply",
] as const satisfies readonly RpcMethod[];

/** The only server-side actions exposed to agents in v1. */
export const AGENT_ACTION_RPC_METHODS = [
  "verificationsRunStart",
  "firmwareMaterializeStart",
  "benchRunStart",
] as const satisfies readonly RpcMethod[];

/**
 * bb v1 supplies no authenticated human actor to RPC handlers. Accordingly,
 * no route, agent tool, or CLI command may mint this capability. Human-only
 * handlers must return authorization-unavailable until an actor-authenticated,
 * single-use mint exists server-side.
 */
export const HUMAN_APPROVAL_CAPABILITY_POLICY = {
  minting: "unavailable",
  mintSurfaces: [],
  requiredIssuer: "actor-authenticated-server",
  handlerDisposition: "authorization-unavailable",
  singleUse: true,
  bindings: [
    "actor",
    "action",
    "projectId",
    "projectVersionId",
    "planOrSnapshotDigest",
  ],
  rejectedEvidence: [
    "caller-boolean",
    "cli-yes",
    "plugin-token",
    "request-input",
  ],
} as const;

export const humanApprovalCapabilitySchema = z
  .string()
  .min(32)
  .max(4096)
  .brand<"HumanApprovalCapability">();
export type HumanApprovalCapability = z.infer<
  typeof humanApprovalCapabilitySchema
>;

const identifierSchema = z.string().trim().min(1).max(512);
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const timestampSchema = z.string().datetime({ offset: true });
const decimalRevisionSchema = z.string().regex(/^(0|[1-9][0-9]*)$/u);
const safeDetailSchema = z
  .string()
  .max(500)
  .refine(
    (value) =>
      !/(?:authorization|bearer\s|api[_-]?key|token=|https?:\/\/[^\s]*[?@])/iu.test(
        value,
      ),
    "detail must not contain credentials, authorization data, or credentialed URLs",
  );
const relativeArtifactSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("~") &&
      !value.includes("\\") &&
      !value.split("/").includes(".."),
    "must be a normalized relative artifact identifier",
  );

export const projectVersionIdSchema = identifierSchema.refine(
  (value) => value !== "@project",
  "@project is an internal storage sentinel and is not a valid RPC version id",
);
export const projectScopeFields = {
  projectId: identifierSchema,
  projectVersionId: projectVersionIdSchema.nullable(),
} as const;
export const projectScopeSchema = z.object(projectScopeFields).strict();

export const pageRequestFields = {
  pageSize: z.number().int().min(1).max(200).default(50),
  continuation: z.string().min(1).max(4096).nullable().default(null),
} as const;
export const scopedPageRequestSchema = z
  .object({ ...projectScopeFields, ...pageRequestFields })
  .strict();

export const cacheStateSchema = z
  .object({
    state: z.enum(["fresh", "stale", "empty"]),
    asOf: timestampSchema.nullable(),
    message: safeDetailSchema.nullable(),
    acceptedGenerationId: identifierSchema.nullable(),
    baseRevision: z.number().int().nonnegative(),
  })
  .strict();

export const fieldsSchema = z
  .record(z.string().min(1).max(200), jsonValueSchema)
  .superRefine((fields, context) => {
    if (Object.keys(fields).length > 200) {
      context.addIssue({
        code: "custom",
        message: "fields may contain at most 200 entries",
      });
    }
  });
export const filtersSchema = fieldsSchema.default({});

export const entityRefSchema = z
  .object({
    ...projectScopeFields,
    kind: identifierSchema,
    key: identifierSchema,
    label: z.string().min(1).max(1000),
  })
  .strict();
export const entitySummarySchema = z
  .object({
    ...projectScopeFields,
    kind: identifierSchema,
    key: identifierSchema,
    label: z.string().min(1).max(1000),
    fields: fieldsSchema,
  })
  .strict();
export const entityDetailSchema = z
  .object({
    ...projectScopeFields,
    kind: identifierSchema,
    key: identifierSchema,
    label: z.string().min(1).max(1000),
    fields: fieldsSchema,
    links: z.array(entityRefSchema).max(1000),
    cache: cacheStateSchema,
  })
  .strict();

export const pageResultSchema = <Item extends z.ZodType>(item: Item) =>
  z
    .object({
      items: z.array(item),
      total: z.number().int().nonnegative().nullable(),
      next: z.string().min(1).max(4096).nullable(),
      cache: cacheStateSchema,
    })
    .strict();

export const documentLocatorSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("pdf"),
      page: z.number().int().positive(),
      bbox: z
        .tuple([
          z.number().min(0).max(1),
          z.number().min(0).max(1),
          z.number().min(0).max(1),
          z.number().min(0).max(1),
        ])
        .optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (
        value.bbox !== undefined &&
        (value.bbox[2] < value.bbox[0] || value.bbox[3] < value.bbox[1])
      ) {
        context.addIssue({
          code: "custom",
          message: "bbox must not be inverted",
        });
      }
    }),
  z
    .object({
      kind: z.literal("sheet"),
      sheet: z.string().min(1).max(200),
      cell: z.string().regex(/^[A-Z]+[1-9][0-9]*$/u),
    })
    .strict(),
  z
    .object({
      kind: z.literal("text"),
      lineStart: z.number().int().positive(),
      lineEnd: z.number().int().positive(),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.lineEnd < value.lineStart) {
        context.addIssue({
          code: "custom",
          message: "lineEnd must be greater than or equal to lineStart",
        });
      }
    }),
]);
export const documentSourceRefSchema = z
  .object({
    documentSha256: sha256Schema,
    locator: documentLocatorSchema,
  })
  .strict();
export type DocumentLocator = z.infer<typeof documentLocatorSchema>;
export type DocumentSourceRef = z.infer<typeof documentSourceRefSchema>;

export const fieldValueSchema = z
  .object({ present: z.boolean(), value: jsonValueSchema.nullable() })
  .strict();
export const fieldDiffSchema = z
  .object({
    field: identifierSchema,
    base: fieldValueSchema,
    ours: fieldValueSchema,
    theirs: fieldValueSchema,
  })
  .strict();
export const conflictResolutionSchema = z.discriminatedUnion("choice", [
  z.object({ choice: z.literal("take-ours") }).strict(),
  z.object({ choice: z.literal("take-theirs") }).strict(),
  z.object({ choice: z.literal("edited"), value: jsonValueSchema }).strict(),
]);
export const attributionSchema = z
  .object({
    actor: z.string().max(500).nullable(),
    at: timestampSchema.nullable(),
    source: z.string().max(500).nullable(),
  })
  .strict();
export const conflictSchema = z
  .object({
    field: identifierSchema,
    base: fieldValueSchema,
    ours: fieldValueSchema,
    theirs: fieldValueSchema,
    attribution: attributionSchema.nullable(),
    suggestion: z.enum(["take-ours", "take-theirs"]).nullable(),
    resolution: conflictResolutionSchema.nullable(),
  })
  .strict();
export const validationErrorSchema = z
  .object({
    code: identifierSchema,
    message: safeDetailSchema,
    artifactId: relativeArtifactSchema.nullable(),
    line: z.number().int().positive().nullable(),
  })
  .strict();

export const baseGenerationIdsSchema = z.record(
  identifierSchema,
  identifierSchema,
);
export const baseRevisionsSchema = z.record(
  identifierSchema,
  z.number().int().nonnegative(),
);
export const syncPlanFenceSchema = z
  .object({
    planId: identifierSchema,
    planSha256: sha256Schema,
    baseGenerationIds: baseGenerationIdsSchema,
    baseRevisions: baseRevisionsSchema,
    baseStateSha256: sha256Schema,
  })
  .strict();

export const planOperationSchema = z.enum([
  "create",
  "update",
  "delete",
  "noop",
  "conflict",
  "orphan",
]);
export const planItemSchema = z
  .object({
    ...projectScopeFields,
    kind: identifierSchema,
    key: identifierSchema,
    label: z.string().min(1).max(1000),
    operation: planOperationSchema,
    expectedBaseContentHash: sha256Schema.nullable(),
    fields: z.array(fieldDiffSchema).max(1000),
    conflicts: z.array(conflictSchema).max(1000),
    referrers: z.array(entityRefSchema).max(1000),
    error: validationErrorSchema.nullable(),
  })
  .strict();
export const planSummarySchema = z
  .object({
    creates: z.number().int().nonnegative(),
    updates: z.number().int().nonnegative(),
    deletes: z.number().int().nonnegative(),
    noops: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
    orphans: z.number().int().nonnegative(),
  })
  .strict();
export const planSchema = z
  .object({
    ...projectScopeFields,
    ...syncPlanFenceSchema.shape,
    createdAt: timestampSchema,
    staleness: z
      .object({ asOf: timestampSchema, degraded: z.boolean() })
      .strict(),
    items: z.array(planItemSchema),
    summary: planSummarySchema,
    blastRadius: z
      .object({
        requiresHumanReview: z.boolean(),
        changed: z.number().int().nonnegative(),
        deletes: z.number().int().nonnegative(),
        remoteCalls: z.number().int().nonnegative(),
        surfaces: z.array(identifierSchema).max(200),
      })
      .strict(),
    validationErrors: z.array(validationErrorSchema),
    total: z.number().int().nonnegative().nullable(),
    next: z.string().min(1).max(4096).nullable(),
    cache: cacheStateSchema,
  })
  .strict();

export const statusChangeSchema = z
  .object({
    ...projectScopeFields,
    kind: identifierSchema,
    key: identifierSchema,
    fields: z.array(identifierSchema),
    artifactId: relativeArtifactSchema.nullable(),
  })
  .strict();
export const pushItemResultSchema = z
  .object({
    ...projectScopeFields,
    kind: identifierSchema,
    key: identifierSchema,
    expectedBaseContentHash: sha256Schema.nullable(),
    status: z.enum(["applied", "failed", "skipped"]),
    newBaseContentHash: sha256Schema.nullable(),
    error: z
      .object({
        code: identifierSchema,
        message: safeDetailSchema,
        retryable: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const pushReportSchema = z
  .object({
    ...projectScopeFields,
    runId: identifierSchema,
    planId: identifierSchema,
    planSha256: sha256Schema,
    baseGenerationIds: baseGenerationIdsSchema,
    baseRevisions: baseRevisionsSchema,
    baseStateSha256: sha256Schema,
    status: z.enum(["completed", "partial", "failed"]),
    summary: z
      .object({
        total: z.number().int().nonnegative(),
        applied: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative(),
      })
      .strict(),
    items: z.array(pushItemResultSchema),
    total: z.number().int().nonnegative().nullable(),
    next: z.string().min(1).max(4096).nullable(),
    requiresPull: z.boolean(),
    cache: cacheStateSchema,
  })
  .strict();

const serviceConnectionSchema = z
  .object({
    state: z.enum([
      "needs-configuration",
      "disabled",
      "configured",
      "connected",
      "unreachable",
    ]),
    message: safeDetailSchema.nullable(),
    checkedAt: timestampSchema.nullable(),
  })
  .strict();
const connectionsStatusSchema = z
  .object({
    platform: serviceConnectionSchema,
    assuranceStudio: serviceConnectionSchema,
    forgeCompute: serviceConnectionSchema,
  })
  .strict();
const workspaceSummarySchema = z
  .object({
    ...projectScopeFields,
    surfaces: z.array(
      z
        .object({
          id: identifierSchema,
          pending: z.number().int().nonnegative(),
          conflicts: z.number().int().nonnegative(),
          cache: cacheStateSchema,
        })
        .strict(),
    ),
  })
  .strict();
const pullReportSchema = z
  .object({
    ...projectScopeFields,
    generationId: identifierSchema,
    acceptedAt: timestampSchema,
    baseStateSha256: sha256Schema,
    kinds: z.record(
      identifierSchema,
      z
        .object({
          fetched: z.number().int().nonnegative(),
          baseRows: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    workingFastForwarded: z.boolean(),
    divergence: z.array(identifierSchema),
  })
  .strict();
const statusReportSchema = z
  .object({
    ...projectScopeFields,
    acceptedGenerationIds: baseGenerationIdsSchema,
    stagingGenerationIds: baseGenerationIdsSchema,
    baseRevisions: baseRevisionsSchema,
    baseStateSha256: sha256Schema,
    local: z.array(statusChangeSchema),
    upstream: z.array(statusChangeSchema),
    conflicts: z.array(statusChangeSchema),
    orphans: z.array(statusChangeSchema),
    cache: cacheStateSchema,
  })
  .strict();
const facetsSchema = z
  .object({
    ...projectScopeFields,
    severity: z.record(z.string(), z.number().int().nonnegative()),
    triage: z.record(z.string(), z.number().int().nonnegative()),
    total: z.number().int().nonnegative(),
    cache: cacheStateSchema,
  })
  .strict();
const triageRunSchema = z
  .object({
    ...projectScopeFields,
    id: identifierSchema,
    written: z.number().int().nonnegative(),
    held: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
    findingIds: z.array(identifierSchema),
    cache: cacheStateSchema,
  })
  .strict();
const vexStatusSchema = z.enum([
  "EXPLOITABLE",
  "IN_TRIAGE",
  "NOT_AFFECTED",
  "FALSE_POSITIVE",
  "RESOLVED",
  "RESOLVED_WITH_PEDIGREE",
]);
const vexResponseSchema = z.enum([
  "CAN_NOT_FIX",
  "WILL_NOT_FIX",
  "UPDATE",
  "ROLLBACK",
  "WORKAROUND_AVAILABLE",
]);
const vexJustificationSchema = z.enum([
  "CODE_NOT_PRESENT",
  "CODE_NOT_REACHABLE",
  "REQUIRES_CONFIGURATION",
  "REQUIRES_DEPENDENCY",
  "REQUIRES_ENVIRONMENT",
  "PROTECTED_BY_COMPILER",
  "PROTECTED_AT_RUNTIME",
  "PROTECTED_AT_PERIMETER",
  "PROTECTED_BY_MITIGATING_CONTROL",
]);
const triageDecisionFields = {
  stableKey: identifierSchema,
  status: vexStatusSchema,
  response: vexResponseSchema.nullable(),
  justification: vexJustificationSchema.nullable(),
  reason: z.string().max(10_000),
  evidence: z.string().max(20_000),
  pin: z.enum(["exact_version", "any_version"]),
  expectedContentSha256: sha256Schema.nullable(),
} as const;
const triageDecisionSchema = z
  .object({ ...projectScopeFields, ...triageDecisionFields })
  .strict();
const localWriteResultSchema = z
  .object({
    ...projectScopeFields,
    stableKey: identifierSchema,
    beforeSha256: sha256Schema.nullable(),
    afterSha256: sha256Schema.nullable(),
    changedFields: z.array(identifierSchema),
    diffSummary: z.string().max(4000),
  })
  .strict()
  .refine(
    (result) => result.beforeSha256 !== null || result.afterSha256 !== null,
    {
      message: "beforeSha256 and afterSha256 cannot both be null",
      path: ["afterSha256"],
    },
  );
const nonDeletingLocalWriteResultSchema = localWriteResultSchema.transform(
  (result, context) => {
    if (result.afterSha256 === null) {
      context.addIssue({
        code: "custom",
        message: "This local-write surface does not support deletion",
        path: ["afterSha256"],
      });
      return z.NEVER;
    }
    return { ...result, afterSha256: result.afterSha256 };
  },
);
const localBatchResultSchema = z
  .object({
    ...projectScopeFields,
    runId: identifierSchema,
    total: z.number().int().nonnegative(),
    applied: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    results: z.array(
      z
        .object({
          stableKey: identifierSchema,
          success: z.boolean(),
          error: validationErrorSchema.nullable(),
        })
        .strict(),
    ),
  })
  .strict();
const pagedOperationReportSchema = z
  .object({
    ...projectScopeFields,
    runId: identifierSchema,
    items: z.array(entitySummarySchema),
    total: z.number().int().nonnegative().nullable(),
    next: z.string().min(1).max(4096).nullable(),
    written: z.number().int().nonnegative(),
    held: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    cache: cacheStateSchema,
  })
  .strict();
const vendorVexReportSchema = z
  .object({
    ...projectScopeFields,
    importId: identifierSchema,
    format: z.enum(["cyclonedx", "csaf", "openvex"]),
    documentSha256: sha256Schema,
    items: z.array(entitySummarySchema),
    total: z.number().int().nonnegative().nullable(),
    next: z.string().min(1).max(4096).nullable(),
    matched: z.number().int().nonnegative(),
    unmatched: z.number().int().nonnegative(),
    written: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    cache: cacheStateSchema,
  })
  .strict();
const taraKindSchema = z.enum([
  "component",
  "zone",
  "asset",
  "dataflow",
  "threat",
]);
const taraCommandSchema = z.discriminatedUnion("operation", [
  z
    .object({
      ...projectScopeFields,
      operation: z.literal("create"),
      kind: taraKindSchema,
      fields: fieldsSchema,
      expectedContentSha256: z.null(),
    })
    .strict(),
  z
    .object({
      ...projectScopeFields,
      operation: z.literal("update"),
      kind: taraKindSchema,
      stableKey: identifierSchema,
      fields: fieldsSchema,
      expectedContentSha256: sha256Schema,
    })
    .strict(),
  z
    .object({
      ...projectScopeFields,
      operation: z.literal("delete"),
      kind: taraKindSchema,
      stableKey: identifierSchema,
      mode: z.enum(["cascade", "detach"]),
      expectedContentSha256: sha256Schema,
    })
    .strict(),
]);
const deleteImpactSchema = z
  .object({
    ...projectScopeFields,
    stableKey: identifierSchema,
    referrers: z.array(
      z
        .object({
          kind: identifierSchema,
          stableKey: identifierSchema,
          effect: z.string().max(1000),
        })
        .strict(),
    ),
    allowedActions: z.array(z.enum(["cascade", "detach"])),
    restorable: z.boolean(),
  })
  .strict();
const conversionSchema = z
  .object({
    ...projectScopeFields,
    id: identifierSchema,
    threadId: identifierSchema.nullable(),
    snapshotSha256: sha256Schema,
    state: z.enum([
      "preparing",
      "running",
      "validating",
      "awaiting_human",
      "reviewed",
      "discarded",
      "failed",
    ]),
    requirementIds: z.array(identifierSchema),
    errors: z.array(validationErrorSchema),
    cache: cacheStateSchema,
  })
  .strict();
const actionJobSchema = z
  .object({
    ...projectScopeFields,
    id: identifierSchema,
    state: z.enum(["QUEUED", "RUNNING", "COMPLETED", "FAILED", "TIMEOUT"]),
    progress: z.number().min(0).max(1).nullable(),
    message: safeDetailSchema.nullable(),
  })
  .strict();
const attestationRecordSchema = z
  .object({
    ...projectScopeFields,
    id: identifierSchema,
    runId: identifierSchema,
    firmwareSha256: sha256Schema,
    evidenceSha256: sha256Schema,
    verification: z.enum(["valid", "invalid", "unverified"]),
  })
  .strict();
const hbomResolveSchema = z
  .object({
    ...projectScopeFields,
    outcome: z.enum(["written", "conflict"]),
    hbomSha256: sha256Schema.nullable(),
    currentHbomSha256: sha256Schema.nullable(),
    accepted: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
  })
  .strict();
const hbomExtractionSchema = z
  .object({
    ...projectScopeFields,
    hbomSha256: sha256Schema,
    merged: z.number().int().nonnegative(),
    queued: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
    candidatesAdded: z.number().int().nonnegative(),
    rejected: z.array(
      z
        .object({
          index: z.number().int().nonnegative(),
          code: identifierSchema,
          message: safeDetailSchema,
        })
        .strict(),
    ),
    diffSummary: z.string().max(4000),
  })
  .strict();
const firmwareFileSchema = z
  .object({
    ...projectScopeFields,
    firmwarePath: relativeArtifactSchema,
    fileSha256: sha256Schema,
    size: z.number().int().nonnegative().nullable(),
    mediaType: z.string().max(500).nullable(),
    fields: fieldsSchema,
    previewHex: z
      .string()
      .regex(/^[a-fA-F0-9]*$/u)
      .max(512)
      .nullable(),
    previewBytes: z.number().int().min(0).max(256),
    materialized: z.boolean(),
    cache: cacheStateSchema,
  })
  .strict();
const hostSchema = z
  .object({
    id: identifierSchema,
    name: z.string().min(1).max(500),
    status: identifierSchema,
    capabilities: z.array(identifierSchema),
    lastSeenAt: timestampSchema.nullable(),
  })
  .strict();
const benchRunStartedSchema = z
  .object({
    ...projectScopeFields,
    runId: identifierSchema,
    threadId: identifierSchema,
    jobIds: z.array(identifierSchema),
    firmwareSha256: sha256Schema,
    status: z.enum(["queued", "running"]),
  })
  .strict();
const documentSearchHitSchema = z
  .object({
    ...projectScopeFields,
    documentSha256: sha256Schema,
    documentName: z.string().min(1).max(1000),
    field: identifierSchema,
    value: z.string().max(20_000),
    confidence: z.number().min(0).max(1).nullable(),
    sourceRef: documentSourceRefSchema,
    snippet: z.string().max(20_000).nullable(),
    target: entityRefSchema.nullable(),
  })
  .strict();
const findingCommentSchema = z
  .object({
    ...projectScopeFields,
    id: identifierSchema,
    findingId: identifierSchema,
    actorLabel: z.string().max(500).nullable(),
    text: z.string().max(10_000),
    createdAt: timestampSchema,
    updatedAt: timestampSchema.nullable(),
    carriesAcrossVersions: z.literal(false),
  })
  .strict();
const benchLogSchema = z
  .object({
    ...projectScopeFields,
    sequence: z.number().int().nonnegative(),
    at: timestampSchema,
    level: identifierSchema,
    text: z.string().max(20_000),
  })
  .strict();
const verdictSchema = z
  .object({
    ...projectScopeFields,
    id: identifierSchema,
    verdict: z.enum(["green", "amber", "red"]),
    firmwareSha256: sha256Schema,
    required: z.number().int().nonnegative(),
    proven: z.number().int().nonnegative(),
    evidenceIds: z.array(identifierSchema),
    reasons: z.array(z.string().max(2000)),
    cache: cacheStateSchema,
  })
  .strict();

export const verificationMatrixColumnSchema = z.enum([
  "static",
  "emulation",
  "hil",
  "manual",
  "hardware",
]);

const cursorPageRequestFields = {
  pageSize: z.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(4096).nullable().default(null),
} as const;
const cursorPagedScopedInput = (extra: z.ZodRawShape = {}) =>
  z
    .object({ ...projectScopeFields, ...cursorPageRequestFields, ...extra })
    .strict();
const cursorPageResultSchema = <Item extends z.ZodType>(
  item: Item,
  extra: z.ZodRawShape = {},
) =>
  z
    .object({
      items: z.array(item),
      total: z.number().int().nonnegative(),
      cursor: z.string().min(1).max(4096).nullable(),
      ...extra,
    })
    .strict();

const pointSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    angle: z.number().finite().nullable(),
  })
  .strict();
const hardwareProjectSchema = z
  .object({
    ...projectScopeFields,
    projectKey: relativeArtifactSchema,
    name: z.string().min(1).max(1000),
    schPath: relativeArtifactSchema,
    pcbPath: relativeArtifactSchema.nullable(),
    schSha256: sha256Schema,
    pcbSha256: sha256Schema.nullable(),
    kicadVersion: z.string().max(100).nullable(),
    supported: z.boolean(),
    discoveredAt: timestampSchema,
  })
  .strict();
const hardwareSymbolSchema = z
  .object({
    ...projectScopeFields,
    projectKey: relativeArtifactSchema,
    reference: identifierSchema,
    value: z.string().max(2000).nullable(),
    footprint: z.string().max(2000).nullable(),
    mpn: z.string().max(1000).nullable(),
    manufacturer: z.string().max(1000).nullable(),
    units: z
      .array(
        z
          .object({
            unit: z.number().int().positive(),
            sheetPath: relativeArtifactSchema,
            at: pointSchema,
          })
          .strict(),
      )
      .min(1),
    nets: z.array(identifierSchema).max(2000),
  })
  .strict();
const hardwareNetSchema = z
  .object({
    ...projectScopeFields,
    projectKey: relativeArtifactSchema,
    netName: identifierSchema,
    nodes: z
      .array(
        z
          .object({ reference: identifierSchema, pin: identifierSchema })
          .strict(),
      )
      .max(10_000),
  })
  .strict();
const hardwareViolationSchema = z
  .object({
    ...projectScopeFields,
    id: z.number().int().nonnegative(),
    projectKey: relativeArtifactSchema,
    kind: z.enum(["drc", "erc"]),
    severity: z.enum(["error", "warning", "exclusion"]),
    rule: identifierSchema,
    description: z.string().max(20_000).nullable(),
    refs: z
      .object({
        references: z.array(identifierSchema).max(2000),
        nets: z.array(identifierSchema).max(2000),
      })
      .strict(),
    at: z
      .object({ x: z.number().finite(), y: z.number().finite() })
      .strict()
      .nullable(),
    runAt: timestampSchema,
  })
  .strict();
const hardwareSheetSchema = z
  .object({
    ...projectScopeFields,
    projectKey: relativeArtifactSchema,
    sheetPath: relativeArtifactSchema,
    name: z.string().min(1).max(1000),
    parentSheetPath: relativeArtifactSchema.nullable(),
    breadcrumbs: z
      .array(
        z
          .object({
            sheetPath: relativeArtifactSchema,
            name: z.string().min(1).max(1000),
          })
          .strict(),
      )
      .max(100),
    widthMm: z.number().positive().nullable(),
    heightMm: z.number().positive().nullable(),
    symbolCount: z.number().int().nonnegative(),
  })
  .strict();
const hardwarePartSchema = hardwareSymbolSchema.extend({
  hbom: z
    .object({
      partKey: identifierSchema,
      confidence: z.number().min(0).max(1),
    })
    .strict()
    .nullable(),
  openCveCount: z.number().int().nonnegative().nullable(),
});
const hardwareArtifactKindSchema = z.enum([
  "sheet_svg",
  "board_svg",
  "glb",
  "bom",
  "netlist",
  "gerber",
  "drill",
  "drc",
  "erc",
]);
const hardwareArtifactStatusSchema = z
  .object({
    projectKey: relativeArtifactSchema,
    kind: hardwareArtifactKindSchema,
    sheetPath: relativeArtifactSchema.nullable(),
    path: relativeArtifactSchema,
    sourceSha256: sha256Schema,
    cliVersion: z.string().max(100).nullable(),
    generatedAt: timestampSchema,
    fresh: z.boolean(),
  })
  .strict();
const kicadCapabilitySchema = z
  .object({
    installed: z.boolean(),
    cliPath: z.string().max(4096).nullable(),
    version: z.string().max(100).nullable(),
    supported: z.boolean(),
  })
  .strict();
const hardwareExtractJobSchema = z
  .object({
    ...projectScopeFields,
    jobId: identifierSchema,
    projectKey: relativeArtifactSchema,
    state: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
    produced: z.array(hardwareArtifactStatusSchema),
    failures: z.array(
      z
        .object({
          kind: hardwareArtifactKindSchema,
          exitCode: z.number().int().nullable(),
          message: safeDetailSchema,
        })
        .strict(),
    ),
    startedAt: timestampSchema.nullable(),
    finishedAt: timestampSchema.nullable(),
  })
  .strict();

const groundSourceKindSchema = z.enum([
  "reference_manual",
  "datasheet",
  "svd",
  "errata",
  "appnote",
  "sdk",
  "re_corpus",
]);
const groundChunkKindSchema = z.enum([
  "prose",
  "register_table",
  "pin_table",
  "timing",
  "figure",
]);
const groundSourceSchema = z
  .object({
    ...projectScopeFields,
    sourceId: sha256Schema,
    projectKey: relativeArtifactSchema.nullable(),
    kind: groundSourceKindSchema,
    part: z.string().max(1000).nullable(),
    title: z.string().max(2000).nullable(),
    path: relativeArtifactSchema,
    pages: z.number().int().nonnegative().nullable(),
    indexedAt: timestampSchema.nullable(),
    status: z.enum(["pending", "indexing", "ready", "failed"]),
    license: z.string().max(500).nullable(),
    redistributable: z.boolean(),
    citationCount: z.number().int().nonnegative(),
    message: safeDetailSchema.nullable(),
  })
  .strict();
const groundingCoverageSchema = z
  .object({
    catalogPresent: z.boolean(),
    flavour: z.enum(["redistributable", "full"]).nullable(),
    sources: z.number().int().nonnegative(),
    readySources: z.number().int().nonnegative(),
    redistributableSources: z.number().int().nonnegative(),
    licenses: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict();
const groundingHitSchema = z.discriminatedUnion("plane", [
  z
    .object({
      plane: z.literal("catalog"),
      confidence: z.literal(1),
      sourceFile: relativeArtifactSchema,
      device: z.string().max(1000),
      peripheral: z.string().max(1000).nullable(),
      register: z.string().max(1000).nullable(),
      field: z.string().max(1000).nullable(),
      value: jsonValueSchema,
    })
    .strict(),
  z
    .object({
      plane: z.literal("document"),
      confidence: z.number().min(0).max(1),
      sourceId: sha256Schema,
      documentName: z.string().min(1).max(1000),
      page: z.number().int().positive().nullable(),
      anchor: z.string().max(1000).nullable(),
      kind: groundChunkKindSchema,
      snippet: z.string().max(4000),
    })
    .strict(),
]);

const citationFileSummarySchema = z
  .object({
    ...projectScopeFields,
    file: relativeArtifactSchema,
    cited: z.number().int().nonnegative(),
    inferred: z.number().int().nonnegative(),
    quarantined: z.number().int().nonnegative(),
    stale: z.number().int().nonnegative(),
    coverage: z.number().min(0).max(1),
    contentSha256: sha256Schema,
  })
  .strict();
const quarantineItemSchema = z
  .object({
    ...projectScopeFields,
    id: identifierSchema,
    file: relativeArtifactSchema,
    symbol: identifierSchema,
    value: jsonValueSchema,
    note: z.string().max(4000).nullable(),
    status: z.enum(["quarantined", "accepted", "rejected"]),
    contentSha256: sha256Schema,
  })
  .strict();
const authoringGateStatusSchema = z
  .object({
    ...projectScopeFields,
    configured: z.boolean(),
    configSha256: sha256Schema.nullable(),
    trigger: z.enum(["pre_pr", "post_merge"]).nullable(),
    state: z.enum([
      "not_run",
      "running",
      "passed",
      "failed",
      "failed_unconfigured",
    ]),
    ranAt: timestampSchema.nullable(),
    failures: z.array(safeDetailSchema).max(200),
  })
  .strict();

const benchDeviceSchema = z
  .object({
    ...projectScopeFields,
    deviceId: identifierSchema,
    kind: z.enum(["probe", "logic", "power", "scope", "serial"]),
    make: z.string().max(1000).nullable(),
    model: z.string().max(1000).nullable(),
    connection: z.string().max(2000),
    transport: z.enum(["local-usb", "local-net", "bb-host"]),
    claimedBy: identifierSchema.nullable(),
    claimedAt: timestampSchema.nullable(),
    claimScope: z.enum(["machine", "fleet"]),
    lastSeen: timestampSchema,
    stale: z.boolean(),
  })
  .strict();
const benchDeviceClaimSchema = z
  .object({
    ...projectScopeFields,
    device: benchDeviceSchema,
    outcome: z.enum(["claimed", "released", "already_free"]),
  })
  .strict();
const benchDevelopmentRunSchema = z
  .object({
    ...projectScopeFields,
    runId: identifierSchema,
    kind: z.enum(["build", "flash", "probe"]),
    status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
    target: z.string().max(2000).nullable(),
    artifact: relativeArtifactSchema.nullable(),
    digest: sha256Schema.nullable(),
    startedAt: timestampSchema,
    finishedAt: timestampSchema.nullable(),
  })
  .strict();
const serialSessionSchema = z
  .object({
    ...projectScopeFields,
    sessionId: identifierSchema,
    deviceId: identifierSchema,
    state: z.enum(["connected", "reconnecting", "closed", "unconfigured"]),
    baud: z.number().int().positive(),
    latestCursor: z.number().int().nonnegative(),
    droppedLines: z.number().int().nonnegative(),
    openedAt: timestampSchema,
    closedAt: timestampSchema.nullable(),
    message: safeDetailSchema.nullable(),
  })
  .strict();

const planFenceInputFields = {
  planId: identifierSchema,
  expectedPlanSha256: sha256Schema,
  expectedBaseStateSha256: sha256Schema,
} as const;
const humanApprovalInputField = {
  humanApprovalCapability: humanApprovalCapabilitySchema,
} as const;
const pagedScopedInput = (extra: z.ZodRawShape = {}) =>
  z.object({ ...projectScopeFields, ...pageRequestFields, ...extra }).strict();

export const rpcContract = defineRpcContract({
  connectionsStatus: { input: z.null(), output: connectionsStatusSchema },
  workspaceSummary: {
    input: projectScopeSchema,
    output: workspaceSummarySchema,
  },
  syncPull: {
    input: z
      .object({
        ...projectScopeFields,
        workspaceProjectId: identifierSchema,
        kinds: z.array(identifierSchema).max(200).optional(),
      })
      .strict(),
    output: pullReportSchema,
  },
  syncStatus: {
    input: z
      .object({
        ...projectScopeFields,
        kinds: z.array(identifierSchema).max(200).optional(),
      })
      .strict(),
    output: statusReportSchema,
  },
  syncPlan: {
    input: z
      .object({
        ...projectScopeFields,
        ...pageRequestFields,
        kinds: z.array(identifierSchema).max(200).optional(),
      })
      .strict(),
    output: planSchema,
  },
  syncConflictResolve: {
    input: z
      .object({
        ...projectScopeFields,
        ...planFenceInputFields,
        ...pageRequestFields,
        ...humanApprovalInputField,
        kind: identifierSchema,
        key: identifierSchema,
        field: identifierSchema,
        expectedBaseContentHash: sha256Schema.nullable(),
        resolution: conflictResolutionSchema,
      })
      .strict(),
    output: planSchema,
  },
  syncPush: {
    input: z
      .object({
        ...projectScopeFields,
        ...planFenceInputFields,
        ...pageRequestFields,
        ...humanApprovalInputField,
      })
      .strict(),
    output: pushReportSchema,
  },
  syncPushRetry: {
    input: z
      .object({
        ...projectScopeFields,
        ...planFenceInputFields,
        ...pageRequestFields,
        ...humanApprovalInputField,
        runId: identifierSchema,
        keys: z.array(identifierSchema).max(500).optional(),
      })
      .strict(),
    output: pushReportSchema,
  },

  findingsList: {
    input: pagedScopedInput({ filters: filtersSchema }),
    output: pageResultSchema(entitySummarySchema),
  },
  findingsGet: {
    input: z
      .object({ ...projectScopeFields, findingId: identifierSchema })
      .strict(),
    output: entityDetailSchema,
  },
  findingsActivityList: {
    input: pagedScopedInput({ findingId: identifierSchema }),
    output: pageResultSchema(entitySummarySchema),
  },
  findingsCommentsList: {
    input: pagedScopedInput({ findingId: identifierSchema }),
    output: pageResultSchema(findingCommentSchema),
  },
  findingsCommentsCreate: {
    input: z
      .object({
        ...projectScopeFields,
        ...humanApprovalInputField,
        findingId: identifierSchema,
        findingSnapshotSha256: sha256Schema,
        text: z.string().trim().min(1).max(10_000),
      })
      .strict(),
    output: findingCommentSchema,
  },
  findingsCommentsUpdate: {
    input: z
      .object({
        ...projectScopeFields,
        ...humanApprovalInputField,
        findingId: identifierSchema,
        commentId: identifierSchema,
        commentSnapshotSha256: sha256Schema,
        text: z.string().trim().min(1).max(10_000),
      })
      .strict(),
    output: findingCommentSchema,
  },
  findingsCommentsDelete: {
    input: z
      .object({
        ...projectScopeFields,
        ...humanApprovalInputField,
        findingId: identifierSchema,
        commentId: identifierSchema,
        commentSnapshotSha256: sha256Schema,
      })
      .strict(),
    output: z
      .object({ ...projectScopeFields, success: z.literal(true) })
      .strict(),
  },
  findingsFacets: { input: projectScopeSchema, output: facetsSchema },
  triageRunGet: {
    input: z
      .object({ ...projectScopeFields, runId: identifierSchema })
      .strict(),
    output: triageRunSchema,
  },
  triageDecisionWrite: {
    input: triageDecisionSchema,
    output: nonDeletingLocalWriteResultSchema,
  },
  triageDecisionBulkWrite: {
    input: z
      .object({
        ...projectScopeFields,
        decisions: z
          .array(z.object(triageDecisionFields).strict())
          .min(1)
          .max(500),
      })
      .strict(),
    output: localBatchResultSchema,
  },
  triageDecisionUndo: {
    input: z
      .object({
        ...projectScopeFields,
        stableKey: identifierSchema,
        beforeSha256: sha256Schema,
        afterSha256: sha256Schema,
        prior: fieldsSchema,
      })
      .strict(),
    output: nonDeletingLocalWriteResultSchema,
  },
  triagePolicyPreview: {
    input: pagedScopedInput(),
    output: pagedOperationReportSchema,
  },
  triagePolicyApply: {
    input: pagedScopedInput({
      runId: identifierSchema,
      expectedPolicySha256: sha256Schema,
    }),
    output: pagedOperationReportSchema,
  },
  triageVendorVexPreview: {
    input: pagedScopedInput({
      documentSha256: sha256Schema,
      vendor: z.string().min(1).max(500),
    }),
    output: vendorVexReportSchema,
  },
  triageVendorVexApply: {
    input: pagedScopedInput({
      importId: identifierSchema,
      expectedDocumentSha256: sha256Schema,
      overwrite: z.boolean(),
    }),
    output: vendorVexReportSchema,
  },
  triageOrphansPrune: {
    input: z
      .object({
        ...projectScopeFields,
        stableKeys: z.array(identifierSchema).min(1).max(500),
        expectedBaseStateSha256: sha256Schema,
      })
      .strict(),
    output: localBatchResultSchema,
  },

  taraList: {
    input: pagedScopedInput({ kind: taraKindSchema, filters: filtersSchema }),
    output: pageResultSchema(entitySummarySchema),
  },
  taraGet: {
    input: z
      .object({
        ...projectScopeFields,
        kind: taraKindSchema,
        id: identifierSchema,
      })
      .strict(),
    output: entityDetailSchema,
  },
  taraCommandApply: {
    input: taraCommandSchema,
    output: localWriteResultSchema,
  },
  taraDeleteImpact: {
    input: z
      .object({
        ...projectScopeFields,
        kind: taraKindSchema,
        stableKey: identifierSchema,
      })
      .strict(),
    output: deleteImpactSchema,
  },
  requirementsList: {
    input: pagedScopedInput({ filters: filtersSchema }),
    output: pageResultSchema(entitySummarySchema),
  },
  requirementsGet: {
    input: z
      .object({ ...projectScopeFields, requirementId: identifierSchema })
      .strict(),
    output: entityDetailSchema,
  },
  requirementsWrite: {
    input: z
      .object({
        ...projectScopeFields,
        requirementId: identifierSchema,
        fields: fieldsSchema,
        expectedContentSha256: sha256Schema.nullable(),
      })
      .strict(),
    output: nonDeletingLocalWriteResultSchema,
  },
  earsConversionStart: {
    input: z
      .object({
        ...projectScopeFields,
        requirementIds: z.array(identifierSchema).max(500).optional(),
      })
      .strict(),
    output: conversionSchema,
  },
  earsConversionGet: {
    input: z.object({ ...projectScopeFields, id: identifierSchema }).strict(),
    output: conversionSchema,
  },
  earsConversionReview: {
    input: z
      .object({
        ...projectScopeFields,
        id: identifierSchema,
        decision: z.enum(["reviewed", "discarded"]),
        expectedSnapshotSha256: sha256Schema,
      })
      .strict(),
    output: conversionSchema,
  },
  verificationsMatrix: {
    input: pagedScopedInput({ filters: filtersSchema }),
    output: pageResultSchema(entitySummarySchema),
  },
  verificationsRunGet: {
    input: z
      .object({ ...projectScopeFields, runId: identifierSchema })
      .strict(),
    output: entityDetailSchema,
  },
  verificationsRunStart: {
    input: z
      .object({
        ...projectScopeFields,
        requirementId: identifierSchema,
        tier: verificationMatrixColumnSchema.optional(),
        checkId: identifierSchema.optional(),
        parameters: fieldsSchema.default({}),
      })
      .strict(),
    output: actionJobSchema,
  },
  verificationsManualAttestationRecord: {
    input: z
      .object({
        ...projectScopeFields,
        ...humanApprovalInputField,
        runId: identifierSchema,
        evidenceNote: z.string().trim().min(1).max(20_000),
        evidenceSha256: sha256Schema,
        firmwareSha256: sha256Schema,
      })
      .strict(),
    output: attestationRecordSchema,
  },
  reviewTransition: {
    input: z
      .object({
        ...projectScopeFields,
        ...humanApprovalInputField,
        entityKind: identifierSchema,
        entityId: identifierSchema,
        operationId: identifierSchema,
        entitySnapshotSha256: sha256Schema,
        expectedReviewVersion: decimalRevisionSchema,
        action: z.enum(["approve", "reject"]),
      })
      .strict(),
    output: z
      .object({
        ...projectScopeFields,
        entityId: identifierSchema,
        reviewVersion: decimalRevisionSchema,
        state: identifierSchema,
      })
      .strict(),
  },

  bomSoftwareList: {
    input: pagedScopedInput({ filters: filtersSchema }),
    output: pageResultSchema(entitySummarySchema),
  },
  bomComponentGet: {
    input: z
      .object({
        ...projectScopeFields,
        componentId: identifierSchema,
        mode: z.enum(["software", "hardware"]),
      })
      .strict(),
    output: entityDetailSchema,
  },
  hbomReviewList: {
    input: pagedScopedInput({ filters: filtersSchema }),
    output: pageResultSchema(entitySummarySchema),
  },
  hbomReviewResolve: {
    input: z
      .object({
        ...projectScopeFields,
        ...humanApprovalInputField,
        expectedHbomSha256: sha256Schema,
        decisions: z
          .array(
            z.discriminatedUnion("action", [
              z
                .object({
                  id: identifierSchema,
                  action: z.literal("accept"),
                  candidateIndex: z.number().int().nonnegative().optional(),
                })
                .strict(),
              z
                .object({
                  id: identifierSchema,
                  action: z.literal("reject"),
                  candidateIndex: z.number().int().nonnegative().optional(),
                })
                .strict(),
              z
                .object({
                  id: identifierSchema,
                  action: z.literal("edit"),
                  value: jsonValueSchema,
                  note: z.string().max(4000).optional(),
                })
                .strict(),
            ]),
          )
          .min(1)
          .max(500),
      })
      .strict(),
    output: hbomResolveSchema,
  },
  hbomExtractionApply: {
    input: z
      .object({
        ...projectScopeFields,
        ...humanApprovalInputField,
        documentSha256: sha256Schema,
        expectedHbomSha256: sha256Schema,
        proposals: z
          .array(
            z
              .object({
                partKey: identifierSchema,
                field: identifierSchema,
                value: jsonValueSchema,
                sourceRef: documentSourceRefSchema,
                confidence: z.number().min(0).max(1),
              })
              .strict(),
          )
          .min(1)
          .max(500),
        createMissingParts: z.boolean(),
      })
      .strict(),
    output: hbomExtractionSchema,
  },

  firmwareMountsList: {
    input: pagedScopedInput(),
    output: pageResultSchema(entitySummarySchema),
  },
  firmwareMountGet: {
    input: projectScopeSchema,
    output: entityDetailSchema,
  },
  firmwareTreeList: {
    input: pagedScopedInput({ firmwarePath: relativeArtifactSchema }),
    output: pageResultSchema(entitySummarySchema),
  },
  firmwareFileGet: {
    input: z
      .object({
        ...projectScopeFields,
        firmwarePath: relativeArtifactSchema,
        includePreview: z.boolean().default(false),
      })
      .strict(),
    output: firmwareFileSchema,
  },
  firmwareDiff: {
    input: pagedScopedInput({
      fromProjectVersionId: projectVersionIdSchema,
      toProjectVersionId: projectVersionIdSchema,
    }),
    output: pageResultSchema(entitySummarySchema),
  },
  firmwareInputIssue: {
    input: z
      .object({
        projectId: identifierSchema,
        projectVersionId: projectVersionIdSchema,
        environmentId: identifierSchema,
        firmwarePath: relativeArtifactSchema,
      })
      .strict(),
    output: z
      .object({
        projectId: identifierSchema,
        projectVersionId: projectVersionIdSchema,
        inputId: identifierSchema,
        fileName: z.string().min(1).max(500),
        expiresAt: timestampSchema,
      })
      .strict(),
  },
  firmwareMaterializeStart: {
    input: z.discriminatedUnion("source", [
      z
        .object({
          ...projectScopeFields,
          source: z.literal("standalone_unpack"),
          inputId: identifierSchema,
          maxDepth: z.number().int().min(1).max(12).default(12),
        })
        .strict(),
      z
        .object({
          ...projectScopeFields,
          source: z.literal("api"),
          scanId: identifierSchema.optional(),
          mode: z.enum(["metadata", "files"]),
          firmwarePaths: z.array(relativeArtifactSchema).max(100).optional(),
        })
        .strict(),
    ]),
    output: actionJobSchema,
  },
  firmwareMaterializeCancel: {
    input: z
      .object({ ...projectScopeFields, jobId: identifierSchema })
      .strict(),
    output: actionJobSchema,
  },
  firmwareFileHydrate: {
    input: z
      .object({ ...projectScopeFields, firmwarePath: relativeArtifactSchema })
      .strict(),
    output: actionJobSchema,
  },

  benchRunsList: {
    input: pagedScopedInput(),
    output: pageResultSchema(entitySummarySchema),
  },
  benchRunGet: {
    input: z
      .object({ ...projectScopeFields, runId: identifierSchema })
      .strict(),
    output: entityDetailSchema,
  },
  benchLogsList: {
    input: pagedScopedInput({ runId: identifierSchema }),
    output: pageResultSchema(benchLogSchema),
  },
  benchVerdictGet: {
    input: z
      .object({ ...projectScopeFields, verdictId: identifierSchema })
      .strict(),
    output: verdictSchema,
  },
  benchRunStart: {
    input: z
      .object({
        ...projectScopeFields,
        tier: z.enum(["tier0", "tier1"]),
        hostId: identifierSchema,
        requirementId: identifierSchema.optional(),
        target: z.string().max(1000).optional(),
        deploymentContext: z
          .object({
            productType: z.string().max(500),
            networkExposure: z.string().max(500),
            regulatory: z.string().max(1000),
            deploymentNotes: z.string().max(4000),
            rootComponentName: z.string().max(500),
            rootComponentType: z.string().max(500),
          })
          .strict()
          .optional(),
      })
      .strict(),
    output: benchRunStartedSchema,
  },
  benchHostsList: {
    input: z.object(pageRequestFields).strict(),
    output: pageResultSchema(hostSchema),
  },
  benchHostsJoinCode: {
    input: z.null(),
    output: z
      .object({
        joinCode: identifierSchema,
        hostId: identifierSchema,
        expiresAt: timestampSchema,
      })
      .strict(),
  },

  documentsList: {
    input: pagedScopedInput({ filters: filtersSchema }),
    output: pageResultSchema(entitySummarySchema),
  },
  documentsGet: {
    input: z
      .object({ ...projectScopeFields, documentId: identifierSchema })
      .strict(),
    output: entityDetailSchema,
  },
  documentsSearch: {
    input: pagedScopedInput({
      query: z.string().trim().min(1).max(2000),
      kinds: z.array(identifierSchema).max(200).optional(),
    }),
    output: pageResultSchema(documentSearchHitSchema),
  },
  documentsMetadataUpdate: {
    input: z
      .object({
        ...projectScopeFields,
        documentId: identifierSchema,
        expectedContentSha256: sha256Schema,
        kind: z.enum([
          "datasheet",
          "bom",
          "schematic",
          "spec",
          "regulatory",
          "register_map",
          "other",
        ]),
        withdrawn: z.boolean(),
        displayName: z.string().trim().min(1).max(1000),
      })
      .strict(),
    output: entityDetailSchema,
  },
  documentsExtractionsList: {
    input: pagedScopedInput({ documentId: identifierSchema }),
    output: pageResultSchema(entitySummarySchema),
  },

  hardwareProjectsList: {
    input: cursorPagedScopedInput({
      query: z.string().trim().max(1000).optional(),
    }),
    output: cursorPageResultSchema(hardwareProjectSchema),
  },
  hardwareSymbolsList: {
    input: cursorPagedScopedInput({
      projectKey: relativeArtifactSchema,
      query: z.string().trim().max(1000).optional(),
      sheetPath: relativeArtifactSchema.optional(),
      netName: identifierSchema.optional(),
    }),
    output: cursorPageResultSchema(hardwareSymbolSchema),
  },
  hardwareNetsList: {
    input: cursorPagedScopedInput({
      projectKey: relativeArtifactSchema,
      query: z.string().trim().max(1000).optional(),
      reference: identifierSchema.optional(),
    }),
    output: cursorPageResultSchema(hardwareNetSchema),
  },
  hardwareViolationsList: {
    input: cursorPagedScopedInput({
      projectKey: relativeArtifactSchema,
      kind: z.enum(["drc", "erc"]).optional(),
      severities: z
        .array(z.enum(["error", "warning", "exclusion"]))
        .max(3)
        .optional(),
    }),
    output: cursorPageResultSchema(hardwareViolationSchema),
  },
  hardwareSheetsList: {
    input: cursorPagedScopedInput({ projectKey: relativeArtifactSchema }),
    output: cursorPageResultSchema(hardwareSheetSchema),
  },
  hardwarePartGet: {
    input: z
      .object({
        ...projectScopeFields,
        projectKey: relativeArtifactSchema,
        reference: identifierSchema,
      })
      .strict(),
    output: hardwarePartSchema,
  },
  hardwareArtifactsStatus: {
    input: z
      .object({ ...projectScopeFields, projectKey: relativeArtifactSchema })
      .strict(),
    output: z
      .object({
        ...projectScopeFields,
        projectKey: relativeArtifactSchema,
        capability: kicadCapabilitySchema,
        artifacts: z.array(hardwareArtifactStatusSchema),
      })
      .strict(),
  },
  hardwareExtractStart: {
    input: z
      .object({
        ...projectScopeFields,
        projectKey: relativeArtifactSchema,
        kinds: z.array(hardwareArtifactKindSchema).max(9).optional(),
        force: z.boolean().default(false),
      })
      .strict(),
    output: hardwareExtractJobSchema,
  },
  hardwareExtractStatus: {
    input: z
      .object({ ...projectScopeFields, jobId: identifierSchema })
      .strict(),
    output: hardwareExtractJobSchema,
  },

  groundingSourcesList: {
    input: cursorPagedScopedInput({
      projectKey: relativeArtifactSchema.optional(),
      kinds: z.array(groundSourceKindSchema).max(7).optional(),
      statuses: z
        .array(z.enum(["pending", "indexing", "ready", "failed"]))
        .max(4)
        .optional(),
      redistributable: z.boolean().optional(),
    }),
    output: cursorPageResultSchema(groundSourceSchema),
  },
  groundingQuery: {
    input: cursorPagedScopedInput({
      text: z.string().trim().max(2000).optional(),
      device: z.string().trim().max(1000).optional(),
      peripheral: z.string().trim().max(1000).optional(),
      register: z.string().trim().max(1000).optional(),
      field: z.string().trim().max(1000).optional(),
    }),
    output: cursorPageResultSchema(groundingHitSchema, {
      coverage: groundingCoverageSchema,
    }),
  },
  groundingCoverageGet: {
    input: projectScopeSchema,
    output: groundingCoverageSchema,
  },

  authoringCitationsList: {
    input: cursorPagedScopedInput({
      query: z.string().trim().max(1000).optional(),
    }),
    output: cursorPageResultSchema(citationFileSummarySchema),
  },
  authoringQuarantineList: {
    input: cursorPagedScopedInput({
      file: relativeArtifactSchema.optional(),
      statuses: z
        .array(z.enum(["quarantined", "accepted", "rejected"]))
        .max(3)
        .optional(),
    }),
    output: cursorPageResultSchema(quarantineItemSchema),
  },
  authoringGateStatus: {
    input: projectScopeSchema,
    output: authoringGateStatusSchema,
  },

  benchDevDevicesList: {
    input: cursorPagedScopedInput({
      kinds: z
        .array(z.enum(["probe", "logic", "power", "scope", "serial"]))
        .max(5)
        .optional(),
      includeStale: z.boolean().default(true),
    }),
    output: cursorPageResultSchema(benchDeviceSchema),
  },
  benchDevDeviceClaim: {
    input: z
      .object({
        ...projectScopeFields,
        deviceId: identifierSchema,
        holder: identifierSchema,
        claimScope: z.enum(["machine", "fleet"]).default("machine"),
      })
      .strict(),
    output: benchDeviceClaimSchema,
  },
  benchDevDeviceRelease: {
    input: z
      .object({
        ...projectScopeFields,
        deviceId: identifierSchema,
        holder: identifierSchema,
      })
      .strict(),
    output: benchDeviceClaimSchema,
  },
  benchDevRunsList: {
    input: cursorPagedScopedInput({
      kinds: z
        .array(z.enum(["build", "flash", "probe"]))
        .max(3)
        .optional(),
      statuses: z
        .array(
          z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
        )
        .max(5)
        .optional(),
    }),
    output: cursorPageResultSchema(benchDevelopmentRunSchema),
  },
  benchDevSerialSessionGet: {
    input: z
      .object({ ...projectScopeFields, sessionId: identifierSchema })
      .strict(),
    output: serialSessionSchema,
  },
} as const);

export type RpcContract = typeof rpcContract;
