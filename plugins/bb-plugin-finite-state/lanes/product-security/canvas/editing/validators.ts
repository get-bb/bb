import { z } from "zod";
import { ENTITIES, type EntityKind } from "../../../../lib/sync/registry.js";
import { canonicalJson } from "../../../sync/serialize/canonical.js";
import { isServerOwnedField } from "../../../sync/serialize/exclusions.js";
import {
  registerValidator,
  type ValidateCtx,
  type Validator,
} from "../../../sync/plan/validate.js";
import { planItemId } from "../../../sync/plan/order.js";
import type { PlanItem, ValidationError } from "../../../sync/plan/index.js";
import {
  CANVAS_ENTITY_KINDS,
  componentTypeSchema,
  entityReferences,
  parseArchitectureEntity,
  retiredAuthoredComponentEntitySchema,
  retiredAuthoredComponentTypeSchema,
  strideCategorySchema,
  type ArchitectureYamlEntity,
  type CanvasReadableEntity,
  type CanvasEntityKind,
  type CanvasReference,
  type DeletionImpact,
  type RetiredAuthoredComponentYamlEntity,
} from "./schema.js";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const FORBIDDEN_EXACT = new Set([
  "source",
  "created_by_agent",
  "model_id",
  "source_evidence_ids",
  "created_by_user_id",
  "human_edited",
  "human_edited_at",
  "human_edited_by",
  "reviewed",
  "reviewed_by",
  "reviewed_at",
  "review_status",
  "review_version",
  "display_code",
  "assurance_level",
  "verification_status",
  "verification_summary",
  "verification_last_run",
  "verification_evidence",
]);

function semanticFieldName(field: string): string {
  return field.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toLowerCase();
}

export function isForbiddenAuthoredField(field: string): boolean {
  const semantic = semanticFieldName(field);
  return (
    isServerOwnedField("component", field) ||
    FORBIDDEN_EXACT.has(semantic) ||
    semantic.startsWith("review_") ||
    semantic.startsWith("ai_") ||
    semantic.startsWith("processing_") ||
    semantic.startsWith("verification_") ||
    semantic.endsWith("_count")
  );
}

export class CanvasEntityValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly field: string | null = null,
  ) {
    super(message);
    this.name = "CanvasEntityValidationError";
  }
}

export class RetiredComponentTypeValidationAdvisory extends CanvasEntityValidationError {
  constructor(readonly entity: RetiredAuthoredComponentYamlEntity) {
    super(
      "RETIRED_COMPONENT_TYPE",
      `component_type “${entity.component_type}” was valid in an earlier canvas vocabulary but cannot be authored to Assurance Studio. Update it to one of the current vendored component types before editing or syncing this component.`,
      "component_type",
    );
    this.name = "RetiredComponentTypeValidationAdvisory";
  }
}

export class UnsupportedComponentTypeValidationAdvisory extends CanvasEntityValidationError {
  constructor(readonly value: string) {
    super(
      "UNSUPPORTED_COMPONENT_TYPE",
      `component_type “${value}” is not recognized by the current or retired canvas vocabulary. Choose one of: ${componentTypeSchema.options.join(", ")}.`,
      "component_type",
    );
    this.name = "UnsupportedComponentTypeValidationAdvisory";
  }
}

function inspectAuthoredValue(value: unknown, path: string): void {
  if (typeof value === "string" && UUID.test(value)) {
    throw new CanvasEntityValidationError(
      "SERVER_UUID_AUTHORED",
      `${path} contains a server UUID. Authored YAML must use a stable slug.`,
      path,
    );
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      inspectAuthoredValue(item, `${path}[${index}]`),
    );
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [field, item] of Object.entries(value)) {
    const childPath = path ? `${path}.${field}` : field;
    if (isForbiddenAuthoredField(field)) {
      throw new CanvasEntityValidationError(
        "DERIVED_FIELD",
        `${childPath} is server-owned, derived, or review state and cannot be authored.`,
        childPath,
      );
    }
    inspectAuthoredValue(item, childPath);
  }
}

export function validateArchitecturePayload(
  kind: CanvasEntityKind,
  payload: Record<string, unknown>,
): ArchitectureYamlEntity {
  inspectAuthoredValue(payload, "");
  if (kind === "component") {
    const componentType = payload["component_type"];
    const retired = retiredAuthoredComponentEntitySchema.safeParse({
      kind,
      ...payload,
    });
    if (retired.success) {
      throw new RetiredComponentTypeValidationAdvisory(retired.data);
    }
    if (
      typeof componentType === "string" &&
      !retiredAuthoredComponentTypeSchema.safeParse(componentType).success &&
      !componentTypeSchema.safeParse(componentType).success
    ) {
      throw new UnsupportedComponentTypeValidationAdvisory(componentType);
    }
  }
  if (
    kind === "threat" &&
    typeof payload["category"] === "string" &&
    !strideCategorySchema.safeParse(payload["category"]).success
  ) {
    throw new CanvasEntityValidationError(
      "INVALID_METHODOLOGY_VOCABULARY",
      `threat.category “${payload["category"]}” is not in the accepted STRIDE methodology vocabulary.`,
      "category",
    );
  }
  try {
    return parseArchitectureEntity(kind, payload);
  } catch (error) {
    if (error instanceof CanvasEntityValidationError) throw error;
    if (error instanceof z.ZodError) {
      const first = error.issues[0];
      throw new CanvasEntityValidationError(
        "INVALID_ARCHITECTURE_YAML",
        first?.message ?? `${kind} YAML is invalid.`,
        first?.path.map(String).join(".") || null,
      );
    }
    throw error;
  }
}

export interface ReferenceResolver {
  exists(kind: CanvasReference["kind"], slug: string): boolean;
}

export function validateEntityReferences(
  entity: ArchitectureYamlEntity,
  resolver: ReferenceResolver,
): void {
  const unresolved = entityReferences(entity).find(
    (reference) => !resolver.exists(reference.kind, reference.slug),
  );
  if (!unresolved) return;
  throw new CanvasEntityValidationError(
    "UNRESOLVED_SLUG",
    `${entity.kind}.${unresolved.field} references unresolved ${unresolved.kind} slug “${unresolved.slug}”.`,
    unresolved.field,
  );
}

export interface ScopedReferenceResolver {
  exists(
    scope: ValidateCtx["scope"],
    kind: CanvasReference["kind"],
    slug: string,
  ): boolean;
  methodologyCategoryAllowed?(
    scope: ValidateCtx["scope"],
    category: string,
  ): boolean;
}

function isCanvasEntityKind(kind: EntityKind): kind is CanvasEntityKind {
  return (
    kind === "component" ||
    kind === "zone" ||
    kind === "asset" ||
    kind === "dataflow" ||
    kind === "threat"
  );
}

function changedFields(item: PlanItem): readonly string[] {
  if (item.operation === "delete" || item.operation === "noop") return [];
  return item.fields
    .filter(
      (field) =>
        field.base.present !== field.ours.present ||
        canonicalJson(field.base.value) !== canonicalJson(field.ours.value),
    )
    .map((field) => field.field);
}

function errorFor(
  item: PlanItem,
  ctx: ValidateCtx,
  error: CanvasEntityValidationError,
): PlanItem {
  if (item.error !== null) return item;
  const source = ctx.sources.get(planItemId(item));
  const validation: ValidationError = {
    code: error.code,
    message: error.message,
    artifactId: source?.file ?? null,
    line: source?.line ?? null,
  };
  return { ...item, error: validation };
}

function plannedReferenceExists(
  ctx: ValidateCtx,
  kind: CanvasReference["kind"],
  slug: string,
): boolean {
  const entityEntry = ENTITIES[kind];
  if (!("key" in entityEntry)) return false;
  const encodedKey = entityEntry.key({ slug });
  for (const candidate of ctx.items.values()) {
    if (candidate.kind !== kind || candidate.operation === "delete") continue;
    if (candidate.key === encodedKey) return true;
    const payload = ctx.payloads.get(planItemId(candidate));
    if (payload?.["slug"] === slug) return true;
  }
  return false;
}

export function createCanvasPlanValidator(
  resolver: ScopedReferenceResolver,
): Validator {
  return (item, ctx) => {
    if (item.operation === "delete" || item.operation === "noop") return item;
    const forbidden = changedFields(item).find(isForbiddenAuthoredField);
    if (forbidden) {
      return errorFor(
        item,
        ctx,
        new CanvasEntityValidationError(
          "DERIVED_FIELD",
          `${item.kind}.${forbidden} is server-owned, derived, or review state and cannot be authored.`,
          forbidden,
        ),
      );
    }
    const payload = ctx.payloads.get(planItemId(item));
    if (!payload) return item;
    try {
      if (!isCanvasEntityKind(item.kind)) return item;
      const entity = validateArchitecturePayload(item.kind, {
        ...payload,
      });
      if (
        entity.kind === "threat" &&
        resolver.methodologyCategoryAllowed &&
        !resolver.methodologyCategoryAllowed(ctx.scope, entity.category)
      ) {
        throw new CanvasEntityValidationError(
          "INVALID_METHODOLOGY_VOCABULARY",
          `threat.category “${entity.category}” is not in the accepted STRIDE methodology vocabulary.`,
          "category",
        );
      }
      validateEntityReferences(entity, {
        exists(kind, slug) {
          return (
            plannedReferenceExists(ctx, kind, slug) ||
            resolver.exists(ctx.scope, kind, slug)
          );
        },
      });
      return item;
    } catch (error) {
      return error instanceof CanvasEntityValidationError
        ? errorFor(item, ctx, error)
        : item;
    }
  };
}

export function registerCanvasValidators(
  resolver: ScopedReferenceResolver,
): void {
  const validator = createCanvasPlanValidator(resolver);
  for (const kind of CANVAS_ENTITY_KINDS) {
    registerValidator(kind, validator);
  }
}

function deletionReferenceEffect(
  entity: CanvasReadableEntity,
  field: string,
): string {
  if (entity.kind === "dataflow" && (field === "from" || field === "to")) {
    return `The required ${field} endpoint would be removed; cascade deletes this dataflow.`;
  }
  if (field === "zone") return "Detach clears this entity's zone assignment.";
  return `Detach removes the slug from ${field}.`;
}

export function computeDeletionImpact(
  entityKind: CanvasEntityKind,
  slug: string,
  entities: readonly CanvasReadableEntity[],
): DeletionImpact {
  const referrers = entities
    .flatMap((entity) =>
      entityReferences(entity)
        .filter(
          (reference) =>
            reference.kind === entityKind && reference.slug === slug,
        )
        .map((reference) => ({
          kind: entity.kind,
          slug: entity.slug,
          effect: deletionReferenceEffect(entity, reference.field),
        })),
    )
    .sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.slug.localeCompare(right.slug),
    );
  const detachAllowed = !referrers.some(
    (referrer) =>
      referrer.kind === "dataflow" && referrer.effect.includes("required"),
  );
  return {
    slug,
    referrers,
    allowedActions: detachAllowed ? ["cascade", "detach"] : ["cascade"],
    // SPEC 03 §8.2 marks requirement, mitigation, and verification entities
    // non-restorable. The five canvas-editable kinds are restorable upstream.
    restorable: true,
  };
}
