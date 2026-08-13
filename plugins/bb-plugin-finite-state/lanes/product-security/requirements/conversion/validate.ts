import { parseDocument } from "yaml";
import { buildRequirementPlan } from "../cards/adapter.js";
import type { RequirementValidationIssue } from "../cards/validator.js";
import { validateRequirementYaml } from "../cards/validator.js";
import {
  conversionSourceDigest,
  findBundleForPaths,
  type ConversionSource,
} from "./bundle.js";

const MAX_ERRORS_PER_REQUIREMENT = 50;

export type ValidationError = RequirementValidationIssue;

export interface ConversionGateResult {
  requirementId: string;
  schema: { ok: boolean; errors: ValidationError[] };
  roundTrip: { ok: boolean; unresolved: string[]; staleSource: boolean };
  humanReview: "pending" | "reviewed" | "discarded";
}

interface ParsedProposal {
  id: string | null;
  sourceDescription: string | null;
  checks: Array<{ slug: string | null; passCriteria: string | null; failCriteria: string | null }>;
  traces: { mitigations: string[]; controls: string[]; standards: string[] };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function emptyProposal(): ParsedProposal {
  return {
    id: null,
    sourceDescription: null,
    checks: [],
    traces: { mitigations: [], controls: [], standards: [] },
  };
}

function parseProposal(yaml: string): ParsedProposal {
  let root: Record<string, unknown> | null;
  try {
    root = record(parseDocument(yaml, { prettyErrors: false, strict: true }).toJS());
  } catch {
    return emptyProposal();
  }
  const verification = Array.isArray(root?.verification) ? root.verification : [];
  return {
    id: stringValue(root?.id),
    sourceDescription: stringValue(root?.source_description),
    checks: verification.map((entry) => {
      const contract = record(entry);
      return {
        slug: contract?.check === null ? null : stringValue(contract?.check),
        passCriteria: stringValue(contract?.pass_criteria),
        failCriteria: contract?.fail_criteria === undefined ? null : stringValue(contract.fail_criteria),
      };
    }),
    traces: {
      mitigations: stringArray(root?.mitigations),
      controls: stringArray(root?.controls),
      standards: stringArray(root?.standards),
    },
  };
}

function lineFor(yaml: string, field: string): number | null {
  const index = yaml.split(/\r?\n/u).findIndex((line) => line.trimStart().startsWith(`${field}:`));
  return index < 0 ? null : index + 1;
}

function preservationError(
  artifactId: string,
  yaml: string,
  path: string,
  message: string,
): ValidationError {
  return {
    code: "SOURCE_NOT_PRESERVED",
    message,
    path,
    artifactId,
    line: lineFor(yaml, path.split(".").at(-1) ?? path),
  };
}

function preservationErrors(
  artifactId: string,
  yaml: string,
  proposal: ParsedProposal,
  source: ConversionSource,
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (proposal.id !== source.requirementId) {
    errors.push(preservationError(artifactId, yaml, "id", `id must remain ${source.requirementId}.`));
  }
  if (proposal.sourceDescription !== source.sourceDescription) {
    errors.push(preservationError(
      artifactId,
      yaml,
      "source_description",
      "source_description must copy the pulled source description verbatim.",
    ));
  }
  const expectedBySlug = new Map(source.checks.map((check) => [check.slug, check]));
  proposal.checks.forEach((contract, index) => {
    if (contract.slug === null) return;
    const expected = expectedBySlug.get(contract.slug);
    if (!expected) return;
    if (contract.passCriteria !== expected.passCriteria) {
      errors.push(preservationError(
        artifactId,
        yaml,
        `verification.${index}.pass_criteria`,
        `Pass criteria for ${contract.slug} must be copied verbatim.`,
      ));
    }
    if (contract.failCriteria !== expected.failCriteria) {
      errors.push(preservationError(
        artifactId,
        yaml,
        `verification.${index}.fail_criteria`,
        `Fail criteria for ${contract.slug} must be copied verbatim.`,
      ));
    }
  });
  return errors;
}

function unresolvedReferences(
  proposal: ParsedProposal,
  source: ConversionSource,
  references: ReturnType<typeof findBundleForPaths>["references"],
): string[] {
  const unresolved: string[] = [];
  if (proposal.id === null || proposal.id !== source.requirementId || !references.requirements.has(source.requirementId)) {
    unresolved.push(proposal.id ?? source.requirementId);
  }
  proposal.checks.forEach((contract) => {
    if (contract.slug !== null && !references.checks.has(contract.slug)) unresolved.push(contract.slug);
  });
  for (const [relation, values, index] of [
    ["mitigations", proposal.traces.mitigations, references.mitigations],
    ["controls", proposal.traces.controls, references.controls],
    ["standards", proposal.traces.standards, references.standards],
  ] as const) {
    for (const slug of values) if (!index.has(slug)) unresolved.push(`${relation}:${slug}`);
  }
  return [...new Set(unresolved)].slice(0, MAX_ERRORS_PER_REQUIREMENT);
}

export async function validateConversion(paths: string[]): Promise<ConversionGateResult[]> {
  const uniquePaths = [...new Set(paths)];
  const bundle = findBundleForPaths(uniquePaths);
  const currentSnapshot = await bundle.deps.loadPullSnapshot();
  const currentById = new Map(
    (currentSnapshot?.requirements ?? []).map((source) => [source.requirementId, source]),
  );
  const currentReferences = currentSnapshot?.references ?? {
    requirements: new Map<string, string>(),
    checks: new Map<string, string>(),
    mitigations: new Map<string, string>(),
    controls: new Map<string, string>(),
    standards: new Map<string, string>(),
  };
  const sourceByPath = new Map(bundle.sources.map((source) => [source.targetPath, source]));
  const results: ConversionGateResult[] = [];

  for (const path of uniquePaths) {
    const source = sourceByPath.get(path);
    if (!source) continue;
    const yaml = await bundle.deps.readLocalFile(path);
    if (yaml === null) {
      const error: ValidationError = {
        code: "MISSING_PROPOSAL",
        message: "The agent did not create the required local proposal.",
        path: "",
        artifactId: path,
        line: null,
      };
      results.push({
        requirementId: source.requirementId,
        schema: { ok: false, errors: [error] },
        roundTrip: { ok: false, unresolved: [source.requirementId], staleSource: false },
        humanReview: "pending",
      });
      continue;
    }

    const parsed = parseProposal(yaml);
    const validation = validateRequirementYaml(yaml, path);
    const schemaErrors = [
      ...(validation.success ? [] : validation.errors),
      ...preservationErrors(path, yaml, parsed, source),
    ].slice(0, MAX_ERRORS_PER_REQUIREMENT);
    const unresolved = unresolvedReferences(parsed, source, currentReferences);
    if (validation.success) {
      const plan = buildRequirementPlan(validation.data, currentReferences);
      if (!plan.valid) {
        for (const error of plan.errors) {
          if (error.code === "UNRESOLVED_SLUG") unresolved.push(error.message);
        }
      }
    }
    const current = currentById.get(source.requirementId);
    const staleSource = current === undefined || conversionSourceDigest(current) !== source.sourceDigest;
    const boundedUnresolved = [...new Set(unresolved)].slice(0, MAX_ERRORS_PER_REQUIREMENT);
    results.push({
      requirementId: source.requirementId,
      schema: { ok: schemaErrors.length === 0, errors: schemaErrors },
      roundTrip: {
        ok: boundedUnresolved.length === 0 && !staleSource,
        unresolved: boundedUnresolved,
        staleSource,
      },
      humanReview: "pending",
    });
  }
  return results;
}
