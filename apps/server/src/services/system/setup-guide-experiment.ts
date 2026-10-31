import { randomBytes } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  setupGuideVariantSchema,
  type RecordTelemetryEventRequest,
  type SetupGuideVariant,
  type SystemSetupGuideResponse,
} from "@bb/server-contract";
import type { ServerLogger } from "../../types.js";
import type {
  FeatureFlagIdentity,
  TelemetryEvent,
  TelemetryService,
} from "./telemetry.js";

export const SETUP_GUIDE_FLAG_KEY = "setup-guide-redesign";
export const SETUP_GUIDE_FLAG_TIMEOUT_MS = 3_000;
export const SETUP_GUIDE_ASSIGNMENT_FILE_NAME = "setup-guide-assignment.json";
const POSTHOG_FLAGS_URL = "https://us.i.posthog.com/flags?v=2";
const FEATURE_PROPERTY_NAME = `$feature/${SETUP_GUIDE_FLAG_KEY}`;

export type SetupGuideAssignmentSource = "override" | "flag" | "default";

export interface SetupGuideAssignment extends SystemSetupGuideResponse {
  source: SetupGuideAssignmentSource;
}

export interface SetupGuideExperiment {
  resolve(): Promise<SetupGuideAssignment>;
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

const DEFAULT_ASSIGNMENT: SetupGuideAssignment = {
  variant: "control",
  featuredPluginEntryIds: null,
  source: "default",
};

const persistedAssignmentSchema = z
  .object({
    variant: setupGuideVariantSchema,
    featuredPluginEntryIds: z.array(z.string().min(1)).nullable(),
    source: z.enum(["flag", "default"]),
  })
  .strict();

const flagsResponseSchema = z.object({
  flags: z.record(z.string(), z.unknown()),
  errorsWhileComputingFlags: z.boolean().optional(),
});

const flagDetailSchema = z.object({
  enabled: z.boolean(),
  variant: z.string().nullable().optional(),
  metadata: z.object({ payload: z.unknown().optional() }).nullish(),
});

const featuredPluginsPayloadSchema = z.object({
  plugins: z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,127}$/)).min(1),
});

export function isSetupGuideTelemetryEvent(
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

function parseFeaturedPluginEntryIds(payload: unknown): string[] | null {
  const parsed = featuredPluginsPayloadSchema.safeParse(
    typeof payload === "string" ? parseJsonText(payload) : payload,
  );
  return parsed.success ? parsed.data.plugins : null;
}

export function assignmentFromFlagsResponse(
  body: unknown,
): SetupGuideAssignment {
  const response = flagsResponseSchema.safeParse(body);
  if (!response.success) return DEFAULT_ASSIGNMENT;
  const flag = flagDetailSchema.safeParse(
    response.data.flags[SETUP_GUIDE_FLAG_KEY],
  );
  if (!flag.success || !flag.data.enabled) return DEFAULT_ASSIGNMENT;
  const variant = setupGuideVariantSchema.safeParse(flag.data.variant);
  if (!variant.success) return DEFAULT_ASSIGNMENT;
  return {
    variant: variant.data,
    featuredPluginEntryIds:
      variant.data === "new"
        ? parseFeaturedPluginEntryIds(flag.data.metadata?.payload)
        : null,
    source: "flag",
  };
}

async function readPersistedAssignment(
  path: string,
  logger: ServerLogger,
): Promise<SetupGuideAssignment | null> {
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
  const parsed = persistedAssignmentSchema.safeParse(parseJsonText(text));
  if (parsed.success) return parsed.data;
  logger.debug({ path }, "Ignoring an invalid setup guide assignment file");
  return null;
}

async function writePersistedAssignment(
  path: string,
  assignment: z.infer<typeof persistedAssignmentSchema>,
): Promise<void> {
  const tempPath = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(assignment)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

export async function createSetupGuideExperiment(
  args: CreateSetupGuideExperimentArgs,
): Promise<SetupGuideExperiment> {
  const assignmentPath = join(args.dataDir, SETUP_GUIDE_ASSIGNMENT_FILE_NAME);
  let persisted =
    args.override === null
      ? await readPersistedAssignment(assignmentPath, args.logger)
      : null;
  let resolution: Promise<SetupGuideAssignment> | null = null;

  function tagFlagVariant(assignment: SetupGuideAssignment): void {
    if (assignment.source === "flag") {
      args.telemetry.setSharedProperty(
        FEATURE_PROPERTY_NAME,
        assignment.variant,
      );
    }
  }

  if (persisted !== null) tagFlagVariant(persisted);

  async function fetchFlagAssignment(
    identity: FeatureFlagIdentity,
  ): Promise<SetupGuideAssignment> {
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
        return DEFAULT_ASSIGNMENT;
      }
      return assignmentFromFlagsResponse(await response.json());
    } catch (error) {
      args.logger.debug({ err: error }, "Setup guide flag evaluation failed");
      return DEFAULT_ASSIGNMENT;
    }
  }

  async function resolveAssignment(): Promise<SetupGuideAssignment> {
    if (args.override !== null) {
      return {
        variant: args.override,
        featuredPluginEntryIds: null,
        source: "override",
      };
    }
    const identity = args.telemetry.featureFlagIdentity();
    if (identity === null || !args.telemetry.isEnabled()) {
      return DEFAULT_ASSIGNMENT;
    }
    if (persisted !== null) return persisted;
    return fetchFlagAssignment(identity);
  }

  function resolve(): Promise<SetupGuideAssignment> {
    resolution ??= resolveAssignment().then((assignment) => {
      tagFlagVariant(assignment);
      return assignment;
    });
    return resolution;
  }

  return {
    resolve,
    async recordExposure(entry) {
      const assignment = await resolve();
      if (!args.telemetry.isEnabled()) return;
      if (assignment.source !== "override" && persisted === null) {
        const toPersist = {
          variant: assignment.variant,
          featuredPluginEntryIds: assignment.featuredPluginEntryIds,
          source: assignment.source,
        };
        try {
          await writePersistedAssignment(assignmentPath, toPersist);
          persisted = toPersist;
        } catch (error) {
          args.logger.warn(
            { err: error },
            "Setup guide assignment could not be saved",
          );
        }
      }
      if (assignment.source === "flag") {
        args.telemetry.capture({
          name: "$feature_flag_called",
          properties: {
            $feature_flag: SETUP_GUIDE_FLAG_KEY,
            $feature_flag_response: assignment.variant,
          },
        });
      }
      args.telemetry.capture({
        name: "onboarding_exposed",
        properties: {
          entry,
          setup_guide_variant: assignment.variant,
          setup_guide_source: assignment.source,
          $set: { setup_guide_variant: assignment.variant },
        },
      });
    },
    async annotate(event) {
      if (!args.telemetry.isEnabled() || !isSetupGuideTelemetryEvent(event)) {
        return event;
      }
      const assignment = await resolve();
      return {
        name: event.name,
        properties: {
          ...event.properties,
          setup_guide_variant: assignment.variant,
        },
      };
    },
  };
}
