import { z } from "zod";

export const earsPatternSchema = z.enum([
  "ubiquitous",
  "event_driven",
  "state_driven",
  "unwanted_behavior",
  "optional_feature",
  "complex",
]);

export type EarsPattern = z.infer<typeof earsPatternSchema>;

export const requirementTypeSchema = z.enum([
  "security",
  "privacy",
  "safety",
  "regulatory",
  "operational",
]);

export const requirementWorkflowStatusSchema = z.enum([
  "draft",
  "approved",
  "implemented",
  "verified",
]);

export const verificationTierSchema = z.enum([
  "static",
  "emulation",
  "hil",
  "manual",
]);

export type VerificationTier = z.infer<typeof verificationTierSchema>;

export const verificationMethodSchema = z.enum([
  "config_check",
  "sbom_query",
  "binary_analysis",
  "binary_pattern",
  "vuln_absence",
  "dynamic",
  "external_sync",
  "manual",
  "attestation",
  "document_review",
]);

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u, "must be a stable slug");

export const requirementIdSchema = z
  .string()
  .min(5)
  .max(512)
  .regex(/^REQ-[A-Za-z0-9][A-Za-z0-9-]*$/u, "must be a REQ-* stable id");

const nullablePartSchema = z.string().trim().min(1).max(20_000).nullable().optional();

export const earsPartsSchema = z
  .object({
    trigger: nullablePartSchema,
    precondition: nullablePartSchema,
    state: nullablePartSchema,
    feature: nullablePartSchema,
    system: z.string().trim().min(1).max(4_000),
    response: z.string().trim().min(1).max(20_000),
  })
  .strict();

export const earsSchema = z
  .object({
    pattern: earsPatternSchema,
    text: z.string().trim().min(1).max(30_000),
    parts: earsPartsSchema,
  })
  .strict();

export const verificationContractSchema = z
  .object({
    check: slugSchema.nullable(),
    method: verificationMethodSchema,
    tier: verificationTierSchema,
    required: z.boolean(),
    coverage: z.enum(["full", "partial", "none"]).optional(),
    suppressed: z.boolean().optional(),
    pass_criteria: z.string().trim().min(1).max(20_000),
    fail_criteria: z.string().trim().min(1).max(20_000).optional(),
    expected_evidence: z.array(z.string().trim().min(1).max(4_000)).max(100).optional(),
  })
  .strict();

export type VerificationContract = z.infer<typeof verificationContractSchema>;

export const requirementYamlV1Schema = z
  .object({
    schema: z.literal("fs-requirement/v1"),
    id: requirementIdSchema,
    req_type: requirementTypeSchema,
    priority: z.string().trim().min(1).max(100),
    status: requirementWorkflowStatusSchema,
    ears: earsSchema,
    rationale: z.string().trim().min(1).max(20_000).optional(),
    source_description: z.string().trim().min(1).max(30_000),
    mitigations: z.array(slugSchema).max(1_000),
    controls: z.array(slugSchema).max(1_000),
    standards: z.array(slugSchema).max(1_000),
    verification: z.array(verificationContractSchema).max(1_000),
  })
  .strict();

export type RequirementYamlV1 = z.infer<typeof requirementYamlV1Schema>;

export const requirementEvidenceStateSchema = z.enum([
  "verified",
  "partial",
  "failed",
  "not_run",
]);
export type RequirementEvidenceState = z.infer<typeof requirementEvidenceStateSchema>;

export const tierSummarySchema = z
  .object({
    tier: verificationTierSchema,
    state: requirementEvidenceStateSchema,
    count: z.number().int().nonnegative(),
  })
  .strict();
export type TierSummary = z.infer<typeof tierSummarySchema>;

export const requirementCardModelSchema = z
  .object({
    requirement: requirementYamlV1Schema,
    evidenceState: requirementEvidenceStateSchema,
    stale: z.boolean(),
    local: z.boolean(),
    tiers: z.array(tierSummarySchema),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  })
  .strict();
export type RequirementCardModel = z.infer<typeof requirementCardModelSchema>;
