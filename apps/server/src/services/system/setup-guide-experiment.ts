import { join } from "node:path";
import { z } from "zod";
import {
  setupGuideVariantSchema,
  type RecordTelemetryEventRequest,
  type SetupGuideVariant,
} from "@bb/server-contract";
import type { ServerLogger } from "../../types.js";
import {
  evaluatePostHogFlag,
  readAssignmentFile,
  writeAssignmentFile,
} from "./posthog-flags.js";
import type {
  FeatureFlagIdentity,
  TelemetryEvent,
  TelemetryService,
} from "./telemetry.js";

const SETUP_GUIDE_FLAG_KEY = "setup-guide-redesign";
export const SETUP_GUIDE_FLAG_TIMEOUT_MS = 3_000;
export const SETUP_GUIDE_ASSIGNMENT_FILE_NAME = "setup-guide-assignment.json";

type SetupGuideAssignmentSource = "override" | "flag" | "default";

interface FlagAssignment {
  variant: SetupGuideVariant;
  source: SetupGuideAssignmentSource;
}

export interface SetupGuideAssignments {
  guide: FlagAssignment;
}

export interface SetupGuideExperiment {
  resolve(): Promise<SetupGuideAssignments>;
  recordExposure(entry: "first_run" | "replay"): Promise<void>;
  annotate(event: RecordTelemetryEventRequest): Promise<TelemetryEvent>;
}

interface CreateSetupGuideExperimentArgs {
  dataDir: string;
  fetch: typeof globalThis.fetch;
  flagTimeoutMs: number;
  logger: ServerLogger;
  override: SetupGuideVariant | null;
  telemetry: TelemetryService;
}

const DEFAULT_GUIDE: FlagAssignment = { variant: "control", source: "default" };

const persistedSourceSchema = z.enum(["flag", "default"]);

const persistedGuideSchema = z
  .object({ variant: setupGuideVariantSchema, source: persistedSourceSchema })
  .strict();

const persistedAssignmentsSchema = z.object({
  guide: persistedGuideSchema.nullable(),
});

type PersistedAssignments = z.infer<typeof persistedAssignmentsSchema>;

export function isSetupGuideTelemetryEvent(
  event: RecordTelemetryEventRequest,
): boolean {
  if (event.name === "recommendation") {
    return event.properties.surface === "onboarding";
  }
  return event.name.startsWith("onboarding_");
}

function persistedGuide(
  assignment: FlagAssignment,
): PersistedAssignments["guide"] {
  return assignment.source === "override"
    ? null
    : { variant: assignment.variant, source: assignment.source };
}

export async function createSetupGuideExperiment(
  args: CreateSetupGuideExperimentArgs,
): Promise<SetupGuideExperiment> {
  const assignmentPath = join(args.dataDir, SETUP_GUIDE_ASSIGNMENT_FILE_NAME);
  let persisted = await readAssignmentFile({
    path: assignmentPath,
    schema: persistedAssignmentsSchema,
    logger: args.logger,
  });
  let resolution: Promise<SetupGuideAssignments> | null = null;

  function tagFlagVariant(guide: FlagAssignment | null): void {
    if (guide?.source === "flag") {
      args.telemetry.setSharedProperty(
        `$feature/${SETUP_GUIDE_FLAG_KEY}`,
        guide.variant,
      );
    }
  }

  if (persisted !== null && args.override === null) {
    tagFlagVariant(persisted.guide);
  }

  async function fetchFlagAssignments(
    identity: FeatureFlagIdentity,
  ): Promise<SetupGuideAssignments> {
    const flag = await evaluatePostHogFlag({
      fetch: args.fetch,
      identity,
      key: SETUP_GUIDE_FLAG_KEY,
      logger: args.logger,
      timeoutMs: args.flagTimeoutMs,
    });
    const variant = setupGuideVariantSchema.safeParse(flag?.variant);
    return {
      guide: variant.success
        ? { variant: variant.data, source: "flag" }
        : DEFAULT_GUIDE,
    };
  }

  async function resolveAssignments(): Promise<SetupGuideAssignments> {
    const override: FlagAssignment | null =
      args.override === null
        ? null
        : { variant: args.override, source: "override" };
    const identity = args.telemetry.featureFlagIdentity();
    if (identity === null || !args.telemetry.isEnabled()) {
      return { guide: override ?? DEFAULT_GUIDE };
    }
    const saved = override ?? persisted?.guide ?? null;
    if (saved !== null) return { guide: saved };
    return fetchFlagAssignments(identity);
  }

  function resolve(): Promise<SetupGuideAssignments> {
    resolution ??= resolveAssignments().then((assignments) => {
      tagFlagVariant(assignments.guide);
      return assignments;
    });
    return resolution;
  }

  return {
    resolve,
    async recordExposure(entry) {
      const { guide } = await resolve();
      if (!args.telemetry.isEnabled()) return;
      const toPersist: PersistedAssignments = {
        guide: persisted?.guide ?? persistedGuide(guide),
      };
      if (toPersist.guide !== (persisted?.guide ?? null)) {
        try {
          await writeAssignmentFile(assignmentPath, toPersist);
          persisted = toPersist;
        } catch (error) {
          args.logger.warn(
            { err: error },
            "Setup guide assignment could not be saved",
          );
        }
      }
      if (guide.source === "flag") {
        args.telemetry.capture({
          name: "$feature_flag_called",
          properties: {
            $feature_flag: SETUP_GUIDE_FLAG_KEY,
            $feature_flag_response: guide.variant,
          },
        });
      }
      args.telemetry.capture({
        name: "onboarding_exposed",
        properties: {
          entry,
          setup_guide_variant: guide.variant,
          setup_guide_source: guide.source,
          $set: { setup_guide_variant: guide.variant },
        },
      });
    },
    async annotate(event) {
      if (!args.telemetry.isEnabled() || !isSetupGuideTelemetryEvent(event)) {
        return event;
      }
      const { guide } = await resolve();
      return {
        name: event.name,
        properties: {
          ...event.properties,
          setup_guide_variant: guide.variant,
        },
      };
    },
  };
}
