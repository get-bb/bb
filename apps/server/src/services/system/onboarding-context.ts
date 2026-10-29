import { randomInt } from "node:crypto";
import {
  appSettingsValues,
  type DbConnection,
  type DbQueryConnection,
} from "@bb/db";
import { eq } from "drizzle-orm";
import {
  onboardingAssignmentSchema,
  onboardingContextResponseSchema,
  type OnboardingAssignment,
  type OnboardingContextRequest,
  type OnboardingContextResponse,
} from "@bb/server-contract";
import type { TelemetryService } from "./telemetry.js";

interface ReviewedOnboardingExperiment {
  key: OnboardingAssignment["experiment_key"];
  revision: string;
  stage: OnboardingContextRequest["stage"];
  eligible:
    | ((db: DbQueryConnection, request: OnboardingContextRequest) => boolean)
    | null;
}

const reviewedOnboardingExperiments: readonly ReviewedOnboardingExperiment[] =
  [];

export type OnboardingAssignmentTelemetryEvent = {
  name: "onboarding_comparison";
  properties: OnboardingAssignment & {
    phase: "assigned";
    design_revision: "baseline";
    recommendation_revision: "baseline";
    source: OnboardingContextRequest["source"];
    stage: null;
    width_class: null;
    height_class: null;
  };
};

export function createOnboardingContextService(
  deps: { db: DbConnection; telemetry: TelemetryService },
  definitions: readonly ReviewedOnboardingExperiment[] = reviewedOnboardingExperiments,
) {
  const stages = new Set<string>();
  for (const definition of definitions) {
    onboardingAssignmentSchema.parse({
      experiment_key: definition.key,
      experiment_revision: definition.revision,
      variant: "control",
    });
    if (stages.has(definition.stage))
      throw new Error("Only one onboarding experiment may own a stage");
    stages.add(definition.stage);
  }
  return {
    context(request: OnboardingContextRequest): OnboardingContextResponse {
      const baseline = {
        design_revision: "baseline",
        recommendation_revision: "baseline",
        assignment: null,
      } as const;
      const definition = definitions.find(
        (candidate) => candidate.stage === request.stage,
      );
      if (definition?.eligible == null) return baseline;
      const key = `onboarding-assignment:${definition.key}:${definition.revision}`;
      const result = deps.db.transaction(
        (tx) => {
          const stored = tx
            .select({ value: appSettingsValues.value })
            .from(appSettingsValues)
            .where(eq(appSettingsValues.key, key))
            .get();
          if (stored !== undefined) {
            let value: unknown;
            try {
              value = JSON.parse(stored.value);
            } catch {
              throw new Error("Stored onboarding assignment is unavailable");
            }
            const parsed = onboardingAssignmentSchema.safeParse(value);
            if (
              !parsed.success ||
              parsed.data.experiment_key !== definition.key ||
              parsed.data.experiment_revision !== definition.revision
            )
              throw new Error("Stored onboarding assignment is unavailable");
            return { assignment: parsed.data, created: false };
          }
          if (!definition.eligible?.(tx, request)) return null;
          const assignment = onboardingAssignmentSchema.parse({
            experiment_key: definition.key,
            experiment_revision: definition.revision,
            variant: randomInt(2) === 0 ? "control" : "candidate",
          });
          tx.insert(appSettingsValues)
            .values({
              key,
              value: JSON.stringify(assignment),
              updatedAt: Date.now(),
            })
            .run();
          return { assignment, created: true };
        },
        { behavior: "immediate" },
      );
      if (result === null) return baseline;
      if (result.created)
        deps.telemetry.capture({
          name: "onboarding_comparison",
          properties: {
            ...result.assignment,
            phase: "assigned",
            design_revision: "baseline",
            recommendation_revision: "baseline",
            source: request.source,
            stage: null,
            width_class: null,
            height_class: null,
          },
        });
      return onboardingContextResponseSchema.parse({
        ...baseline,
        assignment: result.assignment,
      });
    },
    acceptsDisplay(
      assignment: OnboardingAssignment,
      stage: OnboardingContextRequest["stage"],
    ): boolean {
      const definition = definitions.find(
        (candidate) =>
          candidate.stage === stage &&
          candidate.key === assignment.experiment_key &&
          candidate.revision === assignment.experiment_revision &&
          candidate.eligible !== null,
      );
      if (definition === undefined) return false;
      const key = `onboarding-assignment:${definition.key}:${definition.revision}`;
      const stored = deps.db
        .select({ value: appSettingsValues.value })
        .from(appSettingsValues)
        .where(eq(appSettingsValues.key, key))
        .get();
      if (stored === undefined) return false;
      let value: unknown;
      try {
        value = JSON.parse(stored.value);
      } catch {
        return false;
      }
      const parsed = onboardingAssignmentSchema.safeParse(value);
      return (
        parsed.success &&
        parsed.data.experiment_key === assignment.experiment_key &&
        parsed.data.experiment_revision === assignment.experiment_revision &&
        parsed.data.variant === assignment.variant
      );
    },
  };
}
