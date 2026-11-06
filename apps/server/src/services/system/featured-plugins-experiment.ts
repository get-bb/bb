import { join } from "node:path";
import { z } from "zod";
import type {
  RecordTelemetryEventRequest,
  SystemSetupGuideFeaturedPluginsResponse,
} from "@bb/server-contract";
import type { ServerLogger } from "../../types.js";
import {
  evaluatePostHogFlag,
  parseJsonText,
  readAssignmentFile,
  writeAssignmentFile,
} from "./posthog-flags.js";
import { isSetupGuideTelemetryEvent } from "./setup-guide-experiment.js";
import type { FeatureFlagIdentity, TelemetryService } from "./telemetry.js";

const FEATURED_PLUGINS_FLAG_KEY = "onboarding-featured-plugins";
export const FEATURED_PLUGINS_ASSIGNMENT_FILE_NAME =
  "featured-plugins-assignment.json";

const variantSchema = z.enum(["control", "new"]);
type FeaturedPluginsVariant = z.infer<typeof variantSchema>;

const entryIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,127}$/);

const featuredPluginListSchema = z
  .object({
    entryIds: z.array(entryIdSchema).min(1),
    alreadyOnEntryIds: z.array(entryIdSchema),
  })
  .strict();

type FeaturedPluginList = z.infer<typeof featuredPluginListSchema>;

const assignmentSchema = z
  .object({
    variant: variantSchema,
    source: z.enum(["flag", "default"]),
    plugins: featuredPluginListSchema.nullable(),
  })
  .strict();

export type FeaturedPluginsAssignment = z.infer<typeof assignmentSchema>;

const flagPayloadSchema = z
  .object({
    plugins: z.array(entryIdSchema).min(1),
    alreadyOn: z.array(entryIdSchema).optional(),
  })
  .refine(({ plugins, alreadyOn }) =>
    (alreadyOn ?? []).every((entryId) => plugins.includes(entryId)),
  );

const DEFAULT_ASSIGNMENT: FeaturedPluginsAssignment = {
  variant: "control",
  source: "default",
  plugins: null,
};

export interface FeaturedPluginsExperiment {
  resolve(): Promise<FeaturedPluginsAssignment>;
  recordExposure(entry: "first_run" | "replay"): Promise<void>;
  variantProperties(
    event: RecordTelemetryEventRequest,
  ): Promise<{ featured_plugins_variant: FeaturedPluginsVariant } | null>;
}

interface CreateFeaturedPluginsExperimentArgs {
  dataDir: string;
  fetch: typeof globalThis.fetch;
  flagTimeoutMs: number;
  logger: ServerLogger;
  telemetry: TelemetryService;
}

function pluginListFromPayload(payload: unknown): FeaturedPluginList | null {
  const parsed = flagPayloadSchema.safeParse(
    typeof payload === "string" ? parseJsonText(payload) : payload,
  );
  return parsed.success
    ? {
        entryIds: parsed.data.plugins,
        alreadyOnEntryIds: parsed.data.alreadyOn ?? [],
      }
    : null;
}

export function featuredPluginsResponse(
  assignment: FeaturedPluginsAssignment,
): SystemSetupGuideFeaturedPluginsResponse {
  return {
    entryIds: assignment.plugins?.entryIds ?? null,
    alreadyOnEntryIds: assignment.plugins?.alreadyOnEntryIds ?? [],
  };
}

export async function createFeaturedPluginsExperiment(
  args: CreateFeaturedPluginsExperimentArgs,
): Promise<FeaturedPluginsExperiment> {
  const assignmentPath = join(
    args.dataDir,
    FEATURED_PLUGINS_ASSIGNMENT_FILE_NAME,
  );
  let persisted = await readAssignmentFile({
    path: assignmentPath,
    schema: assignmentSchema,
    logger: args.logger,
  });
  let resolution: Promise<FeaturedPluginsAssignment> | null = null;

  function tagFlagVariant(assignment: FeaturedPluginsAssignment): void {
    if (assignment.source === "flag") {
      args.telemetry.setSharedProperty(
        `$feature/${FEATURED_PLUGINS_FLAG_KEY}`,
        assignment.variant,
      );
    }
  }

  if (persisted !== null) tagFlagVariant(persisted);

  async function fetchAssignment(
    identity: FeatureFlagIdentity,
  ): Promise<FeaturedPluginsAssignment> {
    const flag = await evaluatePostHogFlag({
      fetch: args.fetch,
      identity,
      key: FEATURED_PLUGINS_FLAG_KEY,
      logger: args.logger,
      timeoutMs: args.flagTimeoutMs,
    });
    const variant = variantSchema.safeParse(flag?.variant);
    if (flag === null || !variant.success) return DEFAULT_ASSIGNMENT;
    return {
      variant: variant.data,
      source: "flag",
      plugins:
        variant.data === "new" ? pluginListFromPayload(flag.payload) : null,
    };
  }

  async function resolveAssignment(): Promise<FeaturedPluginsAssignment> {
    const identity = args.telemetry.featureFlagIdentity();
    if (identity === null || !args.telemetry.isEnabled()) {
      return DEFAULT_ASSIGNMENT;
    }
    return persisted ?? fetchAssignment(identity);
  }

  function resolve(): Promise<FeaturedPluginsAssignment> {
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
      if (persisted === null) {
        try {
          await writeAssignmentFile(assignmentPath, assignment);
          persisted = assignment;
        } catch (error) {
          args.logger.warn(
            { err: error },
            "Featured plugins assignment could not be saved",
          );
        }
      }
      if (assignment.source === "flag") {
        args.telemetry.capture({
          name: "$feature_flag_called",
          properties: {
            $feature_flag: FEATURED_PLUGINS_FLAG_KEY,
            $feature_flag_response: assignment.variant,
          },
        });
      }
      args.telemetry.capture({
        name: "onboarding_featured_plugins_exposed",
        properties: {
          entry,
          featured_plugins_variant: assignment.variant,
          featured_plugins_source: assignment.source,
          $set: { featured_plugins_variant: assignment.variant },
        },
      });
    },
    async variantProperties(event) {
      if (!args.telemetry.isEnabled() || !isSetupGuideTelemetryEvent(event)) {
        return null;
      }
      const { variant } = await resolve();
      return { featured_plugins_variant: variant };
    },
  };
}
