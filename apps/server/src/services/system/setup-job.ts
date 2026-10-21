import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  appSettingsValues,
  getAppSettings,
  getProjectExecutionDefaults,
  projects,
  projectSources,
} from "@bb/db";
import {
  setupJobArmSchema,
  setupJobOfferSchema,
  type SetupJobDecisionRequest,
  type SetupJobResponse,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { ServerAppDeps } from "../../types.js";
import type { PluginService } from "../plugins/plugin-service.js";
import { resolvePrimaryHostId } from "../hosts/primary-host.js";
import { getProviderStates } from "./provider-states.js";
import { resolveSystemExecutionOptions } from "./execution-options.js";
import {
  createSetupJobAutomation,
  SETUP_JOB_HOLDOUT_KEY,
  setupJobDefinitions,
} from "./setup-job-automation.js";

const storageKey = "setup_recurring_job";
const storedOfferSchema = z.object({
  offer: setupJobOfferSchema,
  shown: z.boolean(),
  execution: z.object({
    projectId: z.string(),
    hostId: z.string(),
    providerId: z.string(),
    model: z.string(),
    reasoningLevel: z.string(),
  }),
});
type StoredOffer = z.infer<typeof storedOfferSchema>;

export function createSetupJobService(
  deps: ServerAppDeps,
  plugins: PluginService,
) {
  let pending: Promise<void> = Promise.resolve();
  function serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = pending.then(action, action);
    pending = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  function readStored(): StoredOffer | null {
    const row = deps.db
      .select({ value: appSettingsValues.value })
      .from(appSettingsValues)
      .where(eq(appSettingsValues.key, storageKey))
      .get();
    return row === undefined
      ? null
      : storedOfferSchema.parse(JSON.parse(row.value));
  }
  function save(value: StoredOffer): void {
    deps.db
      .insert(appSettingsValues)
      .values({
        key: storageKey,
        value: JSON.stringify(value),
        updatedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: appSettingsValues.key,
        set: { value: JSON.stringify(value), updatedAt: Date.now() },
      })
      .run();
  }
  function requireOffer(id: string): StoredOffer {
    const value = readStored();
    if (value === null || value.offer.suggestionAnalyticsId !== id)
      throw new ApiError(
        404,
        "setup_job_not_found",
        "This setup offer is no longer available.",
      );
    return value;
  }
  async function requireReady(value: StoredOffer): Promise<void> {
    if (getAppSettings(deps.db).onboardingCompletedAt !== null)
      throw new ApiError(
        409,
        "setup_job_closed",
        "Setup has already finished.",
      );
    const project = deps.db
      .select({ id: projects.id })
      .from(projects)
      .innerJoin(projectSources, eq(projects.id, projectSources.projectId))
      .where(
        and(
          eq(projects.id, value.execution.projectId),
          isNull(projects.deletedAt),
          eq(projectSources.hostId, value.execution.hostId),
        ),
      )
      .get();
    if (project === undefined)
      throw new ApiError(
        409,
        "setup_job_unavailable",
        "The project's checkout is no longer available.",
      );
    const states = await getProviderStates(deps, {
      hostId: value.execution.hostId,
    });
    if (
      !states.providers.some(
        (provider) =>
          provider.providerId === value.execution.providerId &&
          provider.status === "ready",
      )
    )
      throw new ApiError(
        409,
        "setup_job_unavailable",
        "Your agent is not ready. Try again or continue without the job.",
      );
  }
  return {
    read(timezone: string): Promise<SetupJobResponse> {
      return serialize(async () => {
        const stored = readStored();
        if (stored !== null) {
          if (
            stored.offer.status === "offered" &&
            getAppSettings(deps.db).onboardingCompletedAt !== null
          )
            return { offer: null };
          return { offer: stored.offer };
        }
        if (getAppSettings(deps.db).onboardingCompletedAt !== null)
          return { offer: null };
        const assignment = deps.holdouts
          .list()
          .find(
            (entry) =>
              entry.key === SETUP_JOB_HOLDOUT_KEY && entry.status !== "ended",
          );
        const arm = setupJobArmSchema.safeParse(assignment?.variant);
        if (!arm.success) return { offer: null };
        const hostId = resolvePrimaryHostId(deps);
        if (hostId === null) return { offer: null };
        const project = deps.db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .innerJoin(projectSources, eq(projects.id, projectSources.projectId))
          .where(
            and(
              eq(projects.kind, "standard"),
              isNull(projects.deletedAt),
              eq(projectSources.hostId, hostId),
            ),
          )
          .orderBy(asc(projects.createdAt), asc(projects.id))
          .limit(1)
          .get();
        if (project === undefined) return { offer: null };
        const automationPlugin = plugins
          .list()
          .find((entry) => entry.source === "builtin:automations");
        if (
          automationPlugin === undefined ||
          plugins.getRpcHandler(automationPlugin.id, "automations_create")
            .outcome !== "found"
        )
          return { offer: null };
        const states = await getProviderStates(deps, { hostId });
        const defaults = getProjectExecutionDefaults(deps.db, {
          projectId: project.id,
        });
        const ready = states.providers.filter(
          (provider) =>
            provider.status === "ready" &&
            deps.providerRegistry.get(provider.providerId)?.info.capabilities
              .experimental_supportsNetworkIsolation === true,
        );
        const provider =
          ready.find((entry) => entry.providerId === defaults?.providerId) ??
          ready[0];
        if (provider === undefined) return { offer: null };
        const options = await resolveSystemExecutionOptions(deps, {
          hostId,
          projectId: project.id,
          providerId: provider.providerId,
        });
        if (
          !options.providers
            .find((entry) => entry.id === provider.providerId)
            ?.capabilities.permissionModes.includes("accept-edits")
        )
          return { offer: null };
        const preferredModel =
          defaults?.providerId === provider.providerId ? defaults.model : null;
        const model =
          options.models.find((entry) => entry.model === preferredModel) ??
          options.models.find((entry) => entry.isDefault) ??
          options.models[0];
        if (model === undefined) return { offer: null };
        const value: StoredOffer = {
          offer: {
            arm: arm.data,
            suggestionAnalyticsId: randomUUID(),
            title: setupJobDefinitions[arm.data].title,
            projectId: project.id,
            projectName: project.name,
            providerName: provider.displayName,
            timezone,
            status: "offered",
            automationId: null,
          },
          shown: false,
          execution: {
            projectId: project.id,
            hostId,
            providerId: provider.providerId,
            model: model.model,
            reasoningLevel: model.defaultReasoningEffort ?? "medium",
          },
        };
        save(value);
        return { offer: value.offer };
      });
    },
    shown(id: string): Promise<{ ok: true }> {
      return serialize(async () => {
        const value = requireOffer(id);
        if (value.shown || value.offer.status !== "offered")
          return { ok: true };
        await requireReady(value);
        save({ ...value, shown: true });
        deps.telemetry.capture({
          name: "suggestion_shown",
          properties: {
            surface: "next_step",
            kind: "automation",
            trigger: "first_run",
            suggestion_analytics_id: id,
          },
        });
        return { ok: true };
      });
    },
    decide(input: SetupJobDecisionRequest): Promise<SetupJobResponse> {
      return serialize(async () => {
        const value = requireOffer(input.suggestionAnalyticsId);
        if (value.offer.status !== "offered") return { offer: value.offer };
        if (input.accepted) await requireReady(value);
        const automationId = await createSetupJobAutomation(plugins, {
          accepted: input.accepted,
          suggestionAnalyticsId: input.suggestionAnalyticsId,
          arm: value.offer.arm,
          timezone: value.offer.timezone,
          execution: value.execution,
        });
        const offer = {
          ...value.offer,
          status: input.accepted
            ? ("accepted" as const)
            : ("dismissed" as const),
          automationId,
        };
        save({ ...value, offer });
        const properties = {
          surface: "next_step" as const,
          kind: "automation" as const,
          suggestion_analytics_id: input.suggestionAnalyticsId,
        };
        if (input.accepted)
          deps.telemetry.capture({ name: "suggestion_accepted", properties });
        else
          deps.telemetry.capture({
            name: "suggestion_dismissed",
            properties: { ...properties, dismiss: "not_now" },
          });
        return { offer };
      });
    },
  };
}
