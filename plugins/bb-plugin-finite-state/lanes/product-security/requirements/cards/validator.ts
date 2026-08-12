import { LineCounter, parseDocument } from "yaml";
import { renderEars, normalizeEarsWhitespace } from "./render-ears.js";
import {
  requirementYamlV1Schema,
  type EarsPattern,
  type RequirementYamlV1,
} from "./schema.js";

export interface RequirementValidationIssue {
  code: string;
  message: string;
  path: string;
  artifactId: string | null;
  line: number | null;
}
export type ValidationResult<T> =
  | { success: true; data: T; errors: [] }
  | { success: false; data: null; errors: RequirementValidationIssue[] };

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu;
const DERIVED_EXACT = new Set([
  "project_id",
  "organization_id",
  "source",
  "created_by_agent",
  "model_id",
  "source_evidence_ids",
  "source_chat_run_id",
  "created_by_user_id",
  "human_edited",
  "human_edited_at",
  "human_edited_by",
  "reviewed",
  "reviewed_by",
  "reviewed_at",
  "needs_reanalysis",
  "stale_reason",
  "embedding",
  "created_at",
  "updated_at",
  "display_code",
  "assurance_level",
  "verification_status",
  "verification_summary",
  "verification_last_run_at",
  "verification_evidence_ids",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDerivedField(key: string): boolean {
  return (
    DERIVED_EXACT.has(key) ||
    key.startsWith("review_") ||
    key.startsWith("ai_") ||
    key.startsWith("processing_") ||
    key.startsWith("verification_") ||
    key.endsWith("_count")
  );
}

function scanOwnedData(
  value: unknown,
  path: readonly string[],
  errors: RequirementValidationIssue[],
): void {
  if (typeof value === "string" && UUID.test(value)) {
    errors.push({
      code: "UUID_FORBIDDEN",
      message: "Server UUIDs are forbidden in tracked requirement YAML; use a stable slug.",
      path: path.join("."),
      artifactId: null,
      line: null,
    });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanOwnedData(entry, [...path, String(index)], errors));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (isDerivedField(key)) {
      errors.push({
        code: "DERIVED_FIELD",
        message: `${key} is derived or server-owned and cannot be authored.`,
        path: nextPath.join("."),
        artifactId: null,
        line: null,
      });
    }
    scanOwnedData(entry, nextPath, errors);
  }
}

function issue(code: string, message: string, path: string): RequirementValidationIssue {
  return { code, message, path, artifactId: null, line: null };
}

const OPTIONAL_PARTS = ["trigger", "precondition", "state", "feature"] as const;

function populated(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function validatePattern(requirement: RequirementYamlV1): RequirementValidationIssue[] {
  const errors: RequirementValidationIssue[] = [];
  const parts = requirement.ears.parts;
  const requiredByPattern: Record<Exclude<EarsPattern, "complex">, readonly (typeof OPTIONAL_PARTS)[number][]> = {
    ubiquitous: [],
    event_driven: ["trigger"],
    state_driven: ["state"],
    unwanted_behavior: ["trigger"],
    optional_feature: ["feature"],
  };

  if (requirement.ears.pattern === "complex") {
    const populatedCount = OPTIONAL_PARTS.filter((key) => populated(parts[key])).length;
    if (populatedCount < 2) {
      errors.push(issue(
        "EARS_PARTS",
        "complex requires at least two ordered condition parts (feature, precondition, state, trigger).",
        "ears.parts",
      ));
    }
  } else {
    const required = requiredByPattern[requirement.ears.pattern];
    for (const key of OPTIONAL_PARTS) {
      const isPresent = populated(parts[key]);
      if (required.includes(key) && !isPresent) {
        errors.push(issue("EARS_PARTS", `${key} is required for ${requirement.ears.pattern}.`, `ears.parts.${key}`));
      }
      if (!required.includes(key) && isPresent) {
        errors.push(issue("EARS_PARTS", `${key} is forbidden for ${requirement.ears.pattern}.`, `ears.parts.${key}`));
      }
    }
  }

  if (
    normalizeEarsWhitespace(requirement.ears.text) !==
    normalizeEarsWhitespace(renderEars(requirement.ears))
  ) {
    errors.push(issue(
      "EARS_ROUND_TRIP",
      "ears.text must equal the canonical rendering of ears.parts after whitespace normalization.",
      "ears.text",
    ));
  }
  return errors;
}

function validateSet(values: readonly string[], path: string): RequirementValidationIssue[] {
  return values.length === new Set(values).size
    ? []
    : [issue("DUPLICATE_SLUG", `${path} must use set semantics without duplicate slugs.`, path)];
}

export function validateRequirement(value: unknown): ValidationResult<RequirementYamlV1> {
  const errors: RequirementValidationIssue[] = [];
  scanOwnedData(value, [], errors);
  if (errors.length > 0) return { success: false, data: null, errors };

  const parsed = requirementYamlV1Schema.safeParse(value);
  if (!parsed.success) {
    return {
      success: false,
      data: null,
      errors: parsed.error.issues.map((zodIssue) =>
        issue("SCHEMA", zodIssue.message, zodIssue.path.join(".")),
      ),
    };
  }

  errors.push(...validatePattern(parsed.data));
  errors.push(...validateSet(parsed.data.mitigations, "mitigations"));
  errors.push(...validateSet(parsed.data.controls, "controls"));
  errors.push(...validateSet(parsed.data.standards, "standards"));
  const checkSlugs = parsed.data.verification.flatMap((contract) =>
    contract.check === null ? [] : [contract.check],
  );
  errors.push(...validateSet(checkSlugs, "verification.check"));
  return errors.length > 0
    ? { success: false, data: null, errors }
    : { success: true, data: parsed.data, errors: [] };
}

function lineForField(yaml: string, field: string): number | null {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(`^\\s*${escaped}\\s*:`, "u");
  const index = yaml.split(/\r?\n/u).findIndex((line) => pattern.test(line));
  return index < 0 ? null : index + 1;
}

export function validateRequirementYaml(
  yaml: string,
  artifactId: string,
): ValidationResult<RequirementYamlV1> {
  const lineCounter = new LineCounter();
  const document = parseDocument(yaml, { lineCounter, prettyErrors: false, strict: true });
  if (document.errors.length > 0) {
    return {
      success: false,
      data: null,
      errors: document.errors.map((error) => ({
        code: "YAML_PARSE",
        message: error.message,
        path: "",
        artifactId,
        line: error.pos[0] === undefined ? null : lineCounter.linePos(error.pos[0]).line,
      })),
    };
  }
  const result = validateRequirement(document.toJS());
  if (result.success) return result;
  return {
    success: false,
    data: null,
    errors: result.errors.map((error) => {
      const field = error.path.split(".").at(-1) ?? "";
      return {
        ...error,
        artifactId,
        line: field.length > 0 ? lineForField(yaml, field) : null,
      };
    }),
  };
}
