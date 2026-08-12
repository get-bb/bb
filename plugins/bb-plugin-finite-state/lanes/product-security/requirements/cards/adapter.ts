import { createHash } from "node:crypto";
import { join } from "node:path";
import type { BbPluginApi } from "@bb/plugin-sdk";
import { stringify } from "yaml";
import type { RequirementValidationIssue } from "./validator.js";
import { validateRequirement } from "./validator.js";
import type { RequirementYamlV1, VerificationContract } from "./schema.js";

const REQUIREMENTS_DIRECTORY = "product-security/requirements";

function sortedSet(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
function canonicalVerification(contract: VerificationContract): VerificationContract {
  return {
    check: contract.check,
    method: contract.method,
    tier: contract.tier,
    required: contract.required,
    ...(contract.coverage === undefined ? {} : { coverage: contract.coverage }),
    ...(contract.suppressed === undefined ? {} : { suppressed: contract.suppressed }),
    pass_criteria: contract.pass_criteria,
    ...(contract.fail_criteria === undefined ? {} : { fail_criteria: contract.fail_criteria }),
    ...(contract.expected_evidence === undefined
      ? {}
      : { expected_evidence: [...contract.expected_evidence] }),
  };
}

export function canonicalRequirement(requirement: RequirementYamlV1): RequirementYamlV1 {
  return {
    schema: "fs-requirement/v1",
    id: requirement.id,
    req_type: requirement.req_type,
    priority: requirement.priority,
    status: requirement.status,
    ears: {
      pattern: requirement.ears.pattern,
      text: requirement.ears.text,
      parts: {
        ...(requirement.ears.parts.trigger === undefined
          ? {}
          : { trigger: requirement.ears.parts.trigger }),
        ...(requirement.ears.parts.precondition === undefined
          ? {}
          : { precondition: requirement.ears.parts.precondition }),
        ...(requirement.ears.parts.state === undefined
          ? {}
          : { state: requirement.ears.parts.state }),
        ...(requirement.ears.parts.feature === undefined
          ? {}
          : { feature: requirement.ears.parts.feature }),
        system: requirement.ears.parts.system,
        response: requirement.ears.parts.response,
      },
    },
    ...(requirement.rationale === undefined ? {} : { rationale: requirement.rationale }),
    source_description: requirement.source_description,
    mitigations: sortedSet(requirement.mitigations),
    controls: sortedSet(requirement.controls),
    standards: sortedSet(requirement.standards),
    verification: requirement.verification.map(canonicalVerification),
  };
}

export function serializeRequirement(requirement: RequirementYamlV1): string {
  return stringify(canonicalRequirement(requirement), {
    lineWidth: 0,
    minContentWidth: 0,
  });
}

export function requirementSemanticSha256(requirement: RequirementYamlV1): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalRequirement(requirement)))
    .digest("hex");
}

export interface RequirementReferenceIndex {
  requirements: ReadonlyMap<string, string>;
  checks: ReadonlyMap<string, string>;
  mitigations: ReadonlyMap<string, string>;
  controls: ReadonlyMap<string, string>;
  standards: ReadonlyMap<string, string>;
}

export type RequirementPlanOperation =
  | {
      order: 0;
      kind: "requirement-upsert";
      requirementId: string;
      remoteId: string | null;
      semanticSha256: string;
    }
  | {
      order: 1;
      kind: "trace-set";
      relation: "mitigations" | "controls" | "standards";
      remoteIds: string[];
    }
  | {
      order: 2;
      kind: "check-map-set";
      checkId: string;
      required: boolean;
      coverage: "full" | "partial" | "none" | null;
      suppressed: boolean;
    }
  | {
      order: 2;
      kind: "NEEDS_CHECK_CREATION";
      contractIndex: number;
      blocking: true;
    };

export type RequirementPlan =
  | { valid: false; operations: []; errors: RequirementValidationIssue[] }
  | { valid: true; operations: RequirementPlanOperation[]; errors: [] };

function unresolved(path: string, slug: string): RequirementValidationIssue {
  return {
    code: "UNRESOLVED_SLUG",
    message: `${slug} does not resolve in the accepted id map or cached vocabulary.`,
    path,
    artifactId: null,
    line: null,
  };
}

function resolveSet(
  relation: "mitigations" | "controls" | "standards",
  slugs: readonly string[],
  index: ReadonlyMap<string, string>,
  errors: RequirementValidationIssue[],
): RequirementPlanOperation {
  const remoteIds: string[] = [];
  for (const slug of sortedSet(slugs)) {
    const remoteId = index.get(slug);
    if (remoteId === undefined) errors.push(unresolved(relation, slug));
    else remoteIds.push(remoteId);
  }
  return { order: 1, kind: "trace-set", relation, remoteIds };
}

export function buildRequirementPlan(
  value: unknown,
  references: RequirementReferenceIndex,
): RequirementPlan {
  const validated = validateRequirement(value);
  if (!validated.success) return { valid: false, operations: [], errors: validated.errors };

  const requirement = canonicalRequirement(validated.data);
  const errors: RequirementValidationIssue[] = [];
  const operations: RequirementPlanOperation[] = [
    {
      order: 0,
      kind: "requirement-upsert",
      requirementId: requirement.id,
      remoteId: references.requirements.get(requirement.id) ?? null,
      semanticSha256: requirementSemanticSha256(requirement),
    },
    resolveSet("mitigations", requirement.mitigations, references.mitigations, errors),
    resolveSet("controls", requirement.controls, references.controls, errors),
    resolveSet("standards", requirement.standards, references.standards, errors),
  ];

  requirement.verification.forEach((contract, contractIndex) => {
    if (contract.check === null) {
      operations.push({ order: 2, kind: "NEEDS_CHECK_CREATION", contractIndex, blocking: true });
      return;
    }
    const checkId = references.checks.get(contract.check);
    if (checkId === undefined) {
      errors.push(unresolved(`verification.${contractIndex}.check`, contract.check));
      return;
    }
    operations.push({
      order: 2,
      kind: "check-map-set",
      checkId,
      required: contract.required,
      coverage: contract.coverage ?? null,
      suppressed: contract.suppressed ?? false,
    });
  });

  return errors.length > 0
    ? { valid: false, operations: [], errors }
    : { valid: true, operations, errors: [] };
}

export interface RequirementDocument {
  artifactId: string;
  requirement: RequirementYamlV1;
  sha256: string;
}

export type RequirementWriteResult =
  | { outcome: "written"; sha256: string; sizeBytes: number }
  | { outcome: "conflict"; currentSha256: string | null };

export interface RequirementRepository {
  list(projectId: string): Promise<RequirementDocument[]>;
  read(projectId: string, requirementId: string): Promise<RequirementDocument | null>;
  write(
    projectId: string,
    requirement: RequirementYamlV1,
    expectedSha256: string | null,
  ): Promise<RequirementWriteResult>;
}

async function projectSource(bb: BbPluginApi, projectId: string) {
  const project = await bb.sdk.projects.get({ projectId });
  const source = project.sources.find((candidate) => candidate.isDefault) ?? project.sources[0];
  if (!source) throw new Error("The project has no local workspace source.");
  return source;
}

function decodeText(content: string, encoding: "utf8" | "base64"): string {
  return encoding === "utf8" ? content : Buffer.from(content, "base64").toString("utf8");
}

export function createSdkRequirementRepository(bb: BbPluginApi): RequirementRepository {
  async function readPath(
    projectId: string,
    absolutePath: string,
    artifactId: string,
  ): Promise<RequirementDocument | null> {
    const source = await projectSource(bb, projectId);
    try {
      const file = await bb.sdk.files.read({
        hostId: source.hostId,
        path: absolutePath,
        rootPath: source.path,
      });
      const { validateRequirementYaml } = await import("./validator.js");
      const validated = validateRequirementYaml(
        decodeText(file.content, file.contentEncoding),
        artifactId,
      );
      if (!validated.success) {
        const first = validated.errors[0];
        throw new Error(first ? `${first.code}: ${first.message}` : "Requirement YAML is invalid.");
      }
      return { artifactId, requirement: validated.data, sha256: file.sha256 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/\bENOENT\b|not found|does not exist/iu.test(message)) return null;
      throw error;
    }
  }

  return {
    async list(projectId) {
      const source = await projectSource(bb, projectId);
      const directory = join(source.path, REQUIREMENTS_DIRECTORY);
      const listing = await bb.sdk.files.list({
        hostId: source.hostId,
        path: directory,
        limit: 10_000,
      });
      if (listing.truncated) {
        throw new Error("Requirement directory exceeds the supported 10,000-file safety bound.");
      }
      const yamlFiles = listing.files
        .filter((file) => /\.ya?ml$/iu.test(file.name))
        .sort((left, right) => left.path.localeCompare(right.path));
      const documents = await Promise.all(
        yamlFiles.map((file) =>
          readPath(
            projectId,
            file.path,
            `${REQUIREMENTS_DIRECTORY}/${file.path.split(/[\\/]/u).at(-1) ?? file.name}`,
          ),
        ),
      );
      return documents.filter((document): document is RequirementDocument => document !== null);
    },
    async read(projectId, requirementId) {
      const source = await projectSource(bb, projectId);
      const artifactId = `${REQUIREMENTS_DIRECTORY}/${requirementId}.yaml`;
      return readPath(projectId, join(source.path, artifactId), artifactId);
    },
    async write(projectId, requirement, expectedSha256) {
      const source = await projectSource(bb, projectId);
      const artifactId = `${REQUIREMENTS_DIRECTORY}/${requirement.id}.yaml`;
      return bb.sdk.files.write({
        hostId: source.hostId,
        path: join(source.path, artifactId),
        rootPath: source.path,
        content: serializeRequirement(requirement),
        contentEncoding: "utf8",
        createParents: true,
        expectedSha256,
      });
    },
  };
}
