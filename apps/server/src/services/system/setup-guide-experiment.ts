import { randomBytes } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  setupGuideVariantSchema,
  type RecordTelemetryEventRequest,
  type SetupGuideVariant,
} from "@bb/server-contract";
import type { ServerLogger } from "../../types.js";
import type {
  FeatureFlagIdentity,
  TelemetryEvent,
  TelemetryService,
} from "./telemetry.js";

const SETUP_GUIDE_FLAG_KEY = "setup-guide-redesign";
export const SETUP_GUIDE_FLAG_TIMEOUT_MS = 3_000;
export const SETUP_GUIDE_ASSIGNMENT_FILE_NAME = "setup-guide-assignment.json";
const POSTHOG_FLAGS_URL = "https://us.i.posthog.com/flags?v=2";

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

const flagsResponseSchema = z.object({
  flags: z.record(z.string(), z.unknown()),
});

const flagDetailSchema = z.object({
  enabled: z.boolean(),
  variant: z.string().nullable().optional(),
});

function isSetupGuideTelemetryEvent(
  event: RecordTelemetryEventRequest,
): boolean {
  if (event.name === "recommendation") {
    return event.properties.surface === "onboarding";
  }
  return event.name.startsWith("onboarding_");
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function flagVariant(
  flags: Record<string, unknown>,
  key: string,
): SetupGuideVariant | null {
  const flag = flagDetailSchema.safeParse(flags[key]);
  if (!flag.success || !flag.data.enabled) return null;
  const variant = setupGuideVariantSchema.safeParse(flag.data.variant);
  return variant.success ? variant.data : null;
}

function assignmentsFromFlagsResponse(body: unknown): SetupGuideAssignments {
  const response = flagsResponseSchema.safeParse(body);
  if (!response.success) {
    return { guide: DEFAULT_GUIDE };
  }
  const guide = flagVariant(response.data.flags, SETUP_GUIDE_FLAG_KEY);
  return {
    guide: guide === null ? DEFAULT_GUIDE : { variant: guide, source: "flag" },
  };
}

function persistedFromJson(json: unknown): PersistedAssignments | null {
  const parsed = persistedAssignmentsSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

async function readPersistedAssignments(
  path: string,
  logger: ServerLogger,
): Promise<PersistedAssignments | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      logger.debug({ err: error }, "Setup guide assignment read failed");
    }
    return null;
  }
  const parsed = persistedFromJson(parseJsonText(text));
  if (parsed === null) {
    logger.debug({ path }, "Ignoring an invalid setup guide assignment file");
  }
  return parsed;
}

async function writePersistedAssignments(
  path: string,
  assignments: PersistedAssignments,
): Promise<void> {
  const tempPath = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(assignments)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
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
  let persisted = await readPersistedAssignments(assignmentPath, args.logger);
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
    try {
      const response = await args.fetch(POSTHOG_FLAGS_URL, {
        body: JSON.stringify({
          api_key: identity.apiKey,
          distinct_id: identity.distinctId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(args.flagTimeoutMs),
      });
      if (!response.ok) {
        args.logger.debug(
          { status: response.status },
          "Setup guide flag evaluation failed",
        );
        return { guide: DEFAULT_GUIDE };
      }
      return assignmentsFromFlagsResponse(await response.json());
    } catch (error) {
      args.logger.debug({ err: error }, "Setup guide flag evaluation failed");
      return { guide: DEFAULT_GUIDE };
    }
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
          await writePersistedAssignments(assignmentPath, toPersist);
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
