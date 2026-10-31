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

export const SETUP_GUIDE_FLAG_KEY = "setup-guide-redesign";
export const FEATURED_PLUGINS_FLAG_KEY = "onboarding-featured-plugins";
export const SETUP_GUIDE_FLAG_TIMEOUT_MS = 3_000;
export const SETUP_GUIDE_ASSIGNMENT_FILE_NAME = "setup-guide-assignment.json";
const POSTHOG_FLAGS_URL = "https://us.i.posthog.com/flags?v=2";

export type SetupGuideAssignmentSource = "override" | "flag" | "default";

export interface FlagAssignment {
  variant: SetupGuideVariant;
  source: SetupGuideAssignmentSource;
}

export interface FeaturedPluginsAssignment extends FlagAssignment {
  featuredPluginEntryIds: string[] | null;
}

export interface SetupGuideAssignments {
  guide: FlagAssignment;
  plugins: FeaturedPluginsAssignment;
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

const DEFAULT_PLUGINS: FeaturedPluginsAssignment = {
  variant: "control",
  source: "default",
  featuredPluginEntryIds: null,
};

const persistedSourceSchema = z.enum(["flag", "default"]);

const persistedGuideSchema = z
  .object({ variant: setupGuideVariantSchema, source: persistedSourceSchema })
  .strict();

const persistedPluginsSchema = z
  .object({
    variant: setupGuideVariantSchema,
    source: persistedSourceSchema,
    featuredPluginEntryIds: z.array(z.string().min(1)).nullable(),
  })
  .strict();

const persistedAssignmentsSchema = z
  .object({
    guide: persistedGuideSchema.nullable(),
    plugins: persistedPluginsSchema.nullable(),
  })
  .strict();

const singleFlagPersistedAssignmentSchema = z
  .object({
    variant: setupGuideVariantSchema,
    featuredPluginEntryIds: z.array(z.string().min(1)).nullable(),
    source: persistedSourceSchema,
  })
  .strict();

type PersistedAssignments = z.infer<typeof persistedAssignmentsSchema>;

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

function flagVariant(
  flags: Record<string, unknown>,
  key: string,
): { variant: SetupGuideVariant; payload: unknown } | null {
  const flag = flagDetailSchema.safeParse(flags[key]);
  if (!flag.success || !flag.data.enabled) return null;
  const variant = setupGuideVariantSchema.safeParse(flag.data.variant);
  if (!variant.success) return null;
  return { variant: variant.data, payload: flag.data.metadata?.payload };
}

export function assignmentsFromFlagsResponse(body: unknown): {
  guide: FlagAssignment;
  plugins: FeaturedPluginsAssignment;
} {
  const response = flagsResponseSchema.safeParse(body);
  if (!response.success) {
    return { guide: DEFAULT_GUIDE, plugins: DEFAULT_PLUGINS };
  }
  const guide = flagVariant(response.data.flags, SETUP_GUIDE_FLAG_KEY);
  const plugins = flagVariant(response.data.flags, FEATURED_PLUGINS_FLAG_KEY);
  return {
    guide:
      guide === null
        ? DEFAULT_GUIDE
        : { variant: guide.variant, source: "flag" },
    plugins:
      plugins === null
        ? DEFAULT_PLUGINS
        : {
            variant: plugins.variant,
            source: "flag",
            featuredPluginEntryIds:
              plugins.variant === "new"
                ? parseFeaturedPluginEntryIds(plugins.payload)
                : null,
          },
  };
}

function persistedFromJson(json: unknown): PersistedAssignments | null {
  const current = persistedAssignmentsSchema.safeParse(json);
  if (current.success) return current.data;
  const singleFlag = singleFlagPersistedAssignmentSchema.safeParse(json);
  if (!singleFlag.success) return null;
  return {
    guide: { variant: singleFlag.data.variant, source: singleFlag.data.source },
    plugins: {
      variant: "control",
      source: "default",
      featuredPluginEntryIds: singleFlag.data.featuredPluginEntryIds,
    },
  };
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

function persistedPlugins(
  assignment: FeaturedPluginsAssignment,
): PersistedAssignments["plugins"] {
  return assignment.source === "override"
    ? null
    : {
        variant: assignment.variant,
        source: assignment.source,
        featuredPluginEntryIds: assignment.featuredPluginEntryIds,
      };
}

export async function createSetupGuideExperiment(
  args: CreateSetupGuideExperimentArgs,
): Promise<SetupGuideExperiment> {
  const assignmentPath = join(args.dataDir, SETUP_GUIDE_ASSIGNMENT_FILE_NAME);
  let persisted = await readPersistedAssignments(assignmentPath, args.logger);
  let resolution: Promise<SetupGuideAssignments> | null = null;

  function tagFlagVariants(assignments: {
    guide: FlagAssignment | null;
    plugins: FlagAssignment | null;
  }): void {
    if (assignments.guide?.source === "flag") {
      args.telemetry.setSharedProperty(
        `$feature/${SETUP_GUIDE_FLAG_KEY}`,
        assignments.guide.variant,
      );
    }
    if (assignments.plugins?.source === "flag") {
      args.telemetry.setSharedProperty(
        `$feature/${FEATURED_PLUGINS_FLAG_KEY}`,
        assignments.plugins.variant,
      );
    }
  }

  if (persisted !== null) {
    tagFlagVariants({
      guide: args.override === null ? persisted.guide : null,
      plugins: persisted.plugins,
    });
  }

  async function fetchFlagAssignments(
    identity: FeatureFlagIdentity,
  ): Promise<{ guide: FlagAssignment; plugins: FeaturedPluginsAssignment }> {
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
        return { guide: DEFAULT_GUIDE, plugins: DEFAULT_PLUGINS };
      }
      return assignmentsFromFlagsResponse(await response.json());
    } catch (error) {
      args.logger.debug({ err: error }, "Setup guide flag evaluation failed");
      return { guide: DEFAULT_GUIDE, plugins: DEFAULT_PLUGINS };
    }
  }

  async function resolveAssignments(): Promise<SetupGuideAssignments> {
    const override: FlagAssignment | null =
      args.override === null
        ? null
        : { variant: args.override, source: "override" };
    const identity = args.telemetry.featureFlagIdentity();
    if (identity === null || !args.telemetry.isEnabled()) {
      return { guide: override ?? DEFAULT_GUIDE, plugins: DEFAULT_PLUGINS };
    }
    const savedGuide = persisted?.guide ?? null;
    const savedPlugins = persisted?.plugins ?? null;
    if ((override !== null || savedGuide !== null) && savedPlugins !== null) {
      return {
        guide: override ?? savedGuide ?? DEFAULT_GUIDE,
        plugins: savedPlugins,
      };
    }
    const fetched = await fetchFlagAssignments(identity);
    return {
      guide: override ?? savedGuide ?? fetched.guide,
      plugins: savedPlugins ?? fetched.plugins,
    };
  }

  function resolve(): Promise<SetupGuideAssignments> {
    resolution ??= resolveAssignments().then((assignments) => {
      tagFlagVariants(assignments);
      return assignments;
    });
    return resolution;
  }

  return {
    resolve,
    async recordExposure(entry) {
      const { guide, plugins } = await resolve();
      if (!args.telemetry.isEnabled()) return;
      const toPersist: PersistedAssignments = {
        guide: persisted?.guide ?? persistedGuide(guide),
        plugins: persisted?.plugins ?? persistedPlugins(plugins),
      };
      if (
        toPersist.guide !== (persisted?.guide ?? null) ||
        toPersist.plugins !== (persisted?.plugins ?? null)
      ) {
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
      for (const [key, assignment] of [
        [SETUP_GUIDE_FLAG_KEY, guide],
        [FEATURED_PLUGINS_FLAG_KEY, plugins],
      ] as const) {
        if (assignment.source === "flag") {
          args.telemetry.capture({
            name: "$feature_flag_called",
            properties: {
              $feature_flag: key,
              $feature_flag_response: assignment.variant,
            },
          });
        }
      }
      args.telemetry.capture({
        name: "onboarding_exposed",
        properties: {
          entry,
          setup_guide_variant: guide.variant,
          setup_guide_source: guide.source,
          featured_plugins_variant: plugins.variant,
          featured_plugins_source: plugins.source,
          $set: {
            setup_guide_variant: guide.variant,
            featured_plugins_variant: plugins.variant,
          },
        },
      });
    },
    async annotate(event) {
      if (!args.telemetry.isEnabled() || !isSetupGuideTelemetryEvent(event)) {
        return event;
      }
      const { guide, plugins } = await resolve();
      return {
        name: event.name,
        properties: {
          ...event.properties,
          setup_guide_variant: guide.variant,
          featured_plugins_variant: plugins.variant,
        },
      };
    },
  };
}
