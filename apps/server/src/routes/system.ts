import { withReportedProviderId } from "../services/system/provider-telemetry.js";
import { rememberPluginRecommendation } from "../services/plugins/plugin-use-telemetry.js";
import { createMobileAppReleaseService } from "../services/install/mobile-app-releases.js";
import {
  setMachineEnvironmentVariable,
  deleteMachineEnvironmentVariable,
} from "../services/machines/environment-storage.js";
import {
  machineEnvironmentView,
  replaceMachineEnvironment,
} from "../services/machines/environment-settings.js";
import { serverAccessStatus } from "../services/machines/server-access.js";
import {
  getAppSettings,
  getAppKeybindingOverrides,
  getExperiments,
  getStoredFaviconColor,
  getStoredThemeId,
  hasActiveThreadAttention,
  setAppSettings,
  setAppKeybindingOverrides,
  setExperiments,
  setStoredAppearance,
} from "@bb/db";
import {
  applyAppKeybindingOverrides,
  appSettingsSchema,
  customThemeNameSchema,
  isBuiltInThemeId,
  PERSONAL_PROJECT_ID,
  resolveCodeTheme,
  type AppKeybindingOverrides,
  type AppTheme,
} from "@bb/domain";
import {
  publicApiRoutes,
  type SystemEnvironmentProvider,
} from "@bb/server-contract";
import type { OperationCaller } from "@bb/operations";
import type { OperationRoutes } from "../kernel/http-door.js";
import {
  hashedAssetCacheControl,
  imageBody,
} from "./plugin-image-response.js";
import { effectivePort } from "../browser-request-guard.js";
import {
  getEnvironmentProvider,
  listEnvironmentCompositions,
  listEnvironmentProviders,
} from "../services/plugins/plugin-environment-provider-registry.js";
import {
  getMachineProvider,
  listMachineProviders,
} from "../services/plugins/plugin-machine-provider-registry.js";
import type { ServerAppDeps, ServerRuntimeConfig } from "../types.js";
import type { PluginService } from "../services/plugins/plugin-service.js";
import { ApiError } from "../errors.js";
import {
  buildAiServicesView,
  testAiService,
  updateAiServiceSelection,
} from "../services/ai/ai-services-view.js";
import {
  resolveVoiceTranscriptionEnabled,
  transcribeVoiceInput,
} from "../services/ai/voice-transcription.js";
import {
  listSystemProviderInfos,
  resolveSystemExecutionOptions,
} from "../services/system/execution-options.js";
import {
  providerManagementCatalog,
  setProviderEnabled,
} from "../services/system/provider-management.js";
import { getProviderStates } from "../services/system/provider-states.js";
import { getProviderUsageLimits } from "../services/system/usage-limits.js";
import {
  listCustomThemeNames,
  readCustomThemeCss,
  resolveAppTheme,
  resolveCustomThemeCssPath,
  resolveThemeRootPath,
} from "../services/system/custom-themes.js";
import {
  installGlobalCliSkills,
  listInstallableMachineIds,
  readGlobalCliSkillStatus,
} from "../services/skills/global-skill-install.js";
import { DEFAULT_APP_KEYBINDINGS } from "../services/system/app-keybindings.js";
import { resolvePrimaryHostId } from "../services/hosts/primary-host.js";
import {
  environmentProviderMatchesContext,
  environmentProviderAcceptsEmptyInputs,
} from "../services/environments/provider-availability.js";
import { environmentProviderMachineAvailability } from "../services/environments/provider-machine-availability.js";
import { machineProviderAcceptsEmptyInputs } from "../services/machines/provider-availability.js";
import { requirePublicProject } from "../services/lib/entity-lookup.js";

const LEADING_ENVIRONMENT_PROVIDER_IDS: readonly string[] = [
  "project-checkout",
  "git-worktree",
];

interface SystemConfigRequest {
  url: string;
  header(name: string): string | undefined;
}

function firstForwardedValue(value: string | undefined): string | undefined {
  return value?.split(",", 1)[0]?.trim() || undefined;
}

function providerLogoUrl(
  kind: "environment" | "machine",
  id: string,
  hash: string,
): string {
  return `/api/v1/system/providers/${encodeURIComponent(`${kind}:${id}`)}/logo?h=${hash}`;
}

function resolveSystemServerUrl(
  request: SystemConfigRequest,
  config: Pick<
    ServerRuntimeConfig,
    "appUrl" | "devAppPort" | "isDevelopment" | "serverPort"
  >,
): string {
  if (config.appUrl !== undefined) return config.appUrl.replace(/\/+$/u, "");

  const requestUrl = new URL(request.url);
  const forwardedHost = firstForwardedValue(request.header("x-forwarded-host"));
  if (forwardedHost === undefined) return requestUrl.origin;

  const forwardedProtocol =
    firstForwardedValue(request.header("x-forwarded-proto")) ??
    requestUrl.protocol.replace(/:$/u, "");
  const forwardedUrl = new URL(`${forwardedProtocol}://${forwardedHost}`);
  if (
    config.isDevelopment &&
    config.devAppPort !== undefined &&
    effectivePort(forwardedUrl) === config.devAppPort
  ) {
    forwardedUrl.port = String(config.serverPort);
  }
  return forwardedUrl.origin;
}

export function registerSystemRoutes(
  operations: OperationRoutes,
  deps: ServerAppDeps,
  pluginService: PluginService,
): void {
  const routes = publicApiRoutes.system;

  const themeRoot = resolveThemeRootPath(deps.config.dataDir);

  const mobileAppReleases = createMobileAppReleaseService();
  operations.implement(
    routes.mobileAppReleases,
    async () => await mobileAppReleases(),
  );

  operations.implement(routes.attention, () => ({
    hasAttention: hasActiveThreadAttention(deps.db),
  }));

  function readAppKeybindingOverrides(): AppKeybindingOverrides {
    try {
      return getAppKeybindingOverrides(deps.db);
    } catch (error) {
      deps.logger.error(
        { err: error },
        "Stored keyboard shortcut overrides are invalid; using defaults",
      );
      return [];
    }
  }

  async function resolveSelectedTheme(
    themeId: string,
    faviconColor: AppTheme["faviconColor"],
  ): Promise<AppTheme> {
    const pluginCss = await pluginService.readThemeCss(themeId);
    if (pluginCss !== null) {
      return {
        themeId,
        customCss: pluginCss,
        faviconColor,
        resolvedCodeTheme: resolveCodeTheme(
          pluginService.readThemeCodeTheme(themeId),
          themeId,
        ),
      };
    }
    return resolveAppTheme(themeRoot, themeId, faviconColor);
  }

  async function buildSystemConfigResponse(serverUrl: string) {
    const keybindingOverrides = readAppKeybindingOverrides();
    const primaryHostId = resolvePrimaryHostId(deps);
    const localHelperPorts = [
      ...new Set([
        deps.config.hostDaemonPort,
        ...deps.hub.listDaemonLocalApiPorts(),
      ]),
    ];
    return {
      generalSettings: compatibleGeneralSettings(),
      serverAccess: await serverAccessStatus(deps),
      keybindings: applyAppKeybindingOverrides(
        DEFAULT_APP_KEYBINDINGS,
        keybindingOverrides,
      ),
      defaultKeybindings: DEFAULT_APP_KEYBINDINGS,
      keybindingOverrides,
      experiments: getExperiments(deps.db),
      performanceDiagnosticsAvailable:
        deps.config.performanceDiagnosticsAvailable,
      appearance: await resolveSelectedTheme(
        getStoredThemeId(deps.db),
        getStoredFaviconColor(deps.db),
      ),
      customThemes: listCustomThemeNames(themeRoot),
      pluginThemes: pluginService.listThemes(),
      featureFlags: deps.config.featureFlags,
      hostDaemonPort: deps.config.hostDaemonPort,
      localHelperPorts,
      serverUrl,
      primaryHostId,
      primaryHostPlatform:
        primaryHostId === null
          ? null
          : deps.hub.getDaemonPlatformForHost(primaryHostId),
      voiceTranscriptionEnabled: resolveVoiceTranscriptionEnabled(deps),
      dataDir: deps.config.dataDir,
    };
  }

  operations.implement(routes.config, async (_input, { request }) => {
    const serverUrl = resolveSystemServerUrl(
      request === null
        ? {
            url: `http://127.0.0.1:${deps.config.serverPort}/`,
            header: () => undefined,
          }
        : {
            url: request.url,
            header: (name) => request.headers.get(name) ?? undefined,
          },
      deps.config,
    );
    return await buildSystemConfigResponse(serverUrl);
  });

  function compatibleGeneralSettings() {
    const settings = getAppSettings(deps.db);
    return {
      ...settings,
      showUnhandledProviderEvents: settings.showDiagnosticEvents,
    };
  }
  operations.implement(
    routes.setMachineEnvironmentVariable,
    async (payload, { caller }) => {
      if (caller.user === "machine")
        throw new ApiError(
          403,
          "forbidden",
          "Machine credentials cannot change global environment settings",
        );
      await setMachineEnvironmentVariable(
        deps.db,
        deps.config.dataDir,
        payload,
        null,
      );
      deps.lifecycleDedupers.providerModelCatalogs.markAllStale();
      deps.hub.notifySystem(["config-changed"]);
      return await machineEnvironmentView(deps.db);
    },
  );

  operations.implement(
    routes.deleteMachineEnvironmentVariable,
    async (payload, { caller }) => {
      if (caller.user === "machine")
        throw new ApiError(
          403,
          "forbidden",
          "Machine credentials cannot change global environment settings",
        );
      await deleteMachineEnvironmentVariable(deps.db, payload.name, null);
      deps.lifecycleDedupers.providerModelCatalogs.markAllStale();
      deps.hub.notifySystem(["config-changed"]);
      return await machineEnvironmentView(deps.db);
    },
  );

  operations.implement(routes.machineEnvironment, async () =>
    machineEnvironmentView(deps.db),
  );
  operations.implement(
    routes.replaceMachineEnvironment,
    async (payload, { caller }) => {
      if (caller.user === "machine")
        throw new ApiError(
          403,
          "forbidden",
          "Machine credentials cannot change global environment settings",
        );
      await replaceMachineEnvironment(deps.db, deps.config.dataDir, payload);
      deps.lifecycleDedupers.providerModelCatalogs.markAllStale();
      deps.hub.notifySystem(["config-changed"]);
      return await machineEnvironmentView(deps.db);
    },
  );

  operations.implement(routes.generalSettings, (payload) => {
    const { showUnhandledProviderEvents, ...settings } = payload;
    const current = getAppSettings(deps.db);
    const diagnosticValue =
      "showDiagnosticEvents" in settings
        ? settings.showDiagnosticEvents
        : undefined;
    const updatedSettings = appSettingsSchema.parse({
      ...settings,
      idleProviderSessionTimeoutMinutes:
        settings.idleProviderSessionTimeoutMinutes === undefined
          ? current.idleProviderSessionTimeoutMinutes
          : settings.idleProviderSessionTimeoutMinutes,
      allowFastServiceTier:
        settings.allowFastServiceTier ?? current.allowFastServiceTier,
      telemetryEnabled: settings.telemetryEnabled ?? current.telemetryEnabled,
      terminalCopyOnSelect:
        settings.terminalCopyOnSelect ?? current.terminalCopyOnSelect,
      keepHistoryAfterContextClear:
        settings.keepHistoryAfterContextClear ??
        current.keepHistoryAfterContextClear,
      summarizeShellCommands:
        settings.summarizeShellCommands ?? current.summarizeShellCommands,
      confirmThreadArchive:
        settings.confirmThreadArchive ?? current.confirmThreadArchive,
      earlyAdopter: settings.earlyAdopter ?? current.earlyAdopter,
      onboardingCompletedAt:
        settings.onboardingCompletedAt === undefined
          ? current.onboardingCompletedAt
          : settings.onboardingCompletedAt,
      showDiagnosticEvents:
        diagnosticValue === undefined ||
        (showUnhandledProviderEvents !== undefined &&
          diagnosticValue === current.showDiagnosticEvents)
          ? showUnhandledProviderEvents
          : diagnosticValue,
    });
    setAppSettings(deps.db, updatedSettings);
    if (current.telemetryEnabled && !updatedSettings.telemetryEnabled) {
      deps.telemetry.capture({ name: "telemetry_disabled" });
    }
    deps.telemetry.setEnabled(updatedSettings.telemetryEnabled);
    deps.hub.notifySystem(["config-changed"]);
    return compatibleGeneralSettings();
  });

  operations.implement(routes.setupGuide, async () => {
    const { guide } = await deps.setupGuideExperiment.resolve();
    return { variant: guide.variant };
  });

  operations.implement(routes.recordTelemetryEvent, async (payload) => {
    if (
      payload.name === "recommendation" &&
      payload.properties.action === "selected"
    ) {
      rememberPluginRecommendation(
        deps,
        payload.properties.resource_id,
        payload.properties.recommendation_id,
      );
    }
    if (payload.name === "onboarding_exposed") {
      await deps.setupGuideExperiment.recordExposure(payload.properties.entry);
      return { ok: true as const };
    }
    deps.telemetry.capture(
      await deps.setupGuideExperiment.annotate(withReportedProviderId(payload)),
    );
    return { ok: true as const };
  });

  operations.implement(routes.keyboardSettings, ({ overrides }) => {
    setAppKeybindingOverrides(deps.db, overrides);
    deps.hub.notifySystem(["config-changed"]);
    return getAppKeybindingOverrides(deps.db);
  });

  operations.implement(routes.experiments, (payload) => {
    setExperiments(deps.db, payload);
    deps.hub.notifySystem(["config-changed"]);
    return getExperiments(deps.db);
  });

  async function requireKnownTheme(themeId: string): Promise<void> {
    if (isBuiltInThemeId(themeId)) return;
    if ((await pluginService.readThemeCss(themeId)) !== null) return;
    if (!customThemeNameSchema.safeParse(themeId).success) {
      throw new ApiError(
        400,
        "invalid_request",
        `Invalid theme id '${themeId}'.`,
      );
    }
    if (readCustomThemeCss(themeRoot, themeId) === null) {
      throw new ApiError(
        404,
        "theme_not_found",
        `Custom theme '${themeId}' not found. Create ${resolveCustomThemeCssPath(themeRoot, themeId)} first.`,
      );
    }
  }

  operations.implement(routes.appearance, async (payload) => {
    const { themeId, faviconColor } = payload;
    await requireKnownTheme(themeId);
    setStoredAppearance(deps.db, { themeId, faviconColor });
    deps.hub.notifySystem(["config-changed"]);
    return await resolveSelectedTheme(themeId, faviconColor);
  });

  operations.implement(routes.resolveTheme, async ({ id }) => {
    const themeId = id;
    await requireKnownTheme(themeId);
    return await resolveSelectedTheme(themeId, getStoredFaviconColor(deps.db));
  });

  operations.implement(routes.themes, async () => ({
    dir: themeRoot,
    custom: listCustomThemeNames(themeRoot),
    plugins: pluginService.listThemes(),
    active: await resolveSelectedTheme(
      getStoredThemeId(deps.db),
      getStoredFaviconColor(deps.db),
    ),
  }));

  operations.implement(routes.reloadConfig, async () => {
    try {
      await deps.bbAppManagedConfig.reload({ notify: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ApiError(422, "invalid_config", message);
    }
    return { ok: true as const };
  });

  operations.implement(routes.cliSkillsStatus, async (query) =>
    readGlobalCliSkillStatus(deps, {
      hostIds:
        query.hostIds === undefined
          ? listInstallableMachineIds(deps)
          : query.hostIds.split(",").filter((hostId) => hostId.length > 0),
    }),
  );

  operations.implement(routes.installCliSkills, async (body) =>
    installGlobalCliSkills(deps, { hostIds: body.hostIds }),
  );

  operations.implement(routes.environmentProviders, async (query) => {
    const project =
      query.projectId === undefined
        ? null
        : requirePublicProject(deps.db, query.projectId);
    return {
      providers: (
        await Promise.all(
          listEnvironmentProviders()
            .filter(
              (record) =>
                project === null ||
                record.provider.requires.projectless ===
                  (project.id === PERSONAL_PROJECT_ID),
            )
            .sort((left, right) => {
              const leftIndex = LEADING_ENVIRONMENT_PROVIDER_IDS.indexOf(
                left.provider.id,
              );
              const rightIndex = LEADING_ENVIRONMENT_PROVIDER_IDS.indexOf(
                right.provider.id,
              );
              if (leftIndex !== -1 || rightIndex !== -1) {
                if (leftIndex === -1) return 1;
                if (rightIndex === -1) return -1;
                return leftIndex - rightIndex;
              }
              return (
                left.provider.displayName.localeCompare(
                  right.provider.displayName,
                ) || left.provider.id.localeCompare(right.provider.id)
              );
            })
            .map(async (record): Promise<SystemEnvironmentProvider | null> => {
              if (
                query.projectId !== undefined &&
                !environmentProviderMatchesContext(deps, record, {
                  projectId: query.projectId,
                  ...(query.hostId === undefined
                    ? {}
                    : { hostId: query.hostId }),
                })
              ) {
                return null;
              }
              const machineAvailability =
                query.projectId === undefined
                  ? {}
                  : environmentProviderMachineAvailability(deps, record, {
                      projectId: query.projectId,
                      ...(query.hostId === undefined
                        ? {}
                        : { hostId: query.hostId }),
                    });
              return {
                machineProviderId: null,
                id: record.provider.id,
                displayName: record.provider.displayName,
                description: record.provider.description,
                icon: record.provider.icon,
                logoUrl:
                  record.icon === undefined
                    ? null
                    : providerLogoUrl(
                        "environment",
                        record.provider.id,
                        record.icon.hash,
                      ),
                pluginId: record.pluginId,
                requires: record.provider.requires,
                inputs: record.provider.inputsJsonSchema,
                acceptsEmptyInputs:
                  await environmentProviderAcceptsEmptyInputs(record),
                availability:
                  query.hostId === undefined
                    ? null
                    : (machineAvailability[query.hostId] ?? null),
                machineAvailability,
              };
            }),
        )
      )
        .filter((provider) => provider !== null)
        .concat(
          query.hostId !== undefined
            ? []
            : (
                await Promise.all(
                  listEnvironmentCompositions().map(
                    async ({ pluginId, composition, icon }) => {
                      const record = getEnvironmentProvider(
                        composition.environmentProviderId,
                      );
                      const machine = getMachineProvider(
                        composition.machineProviderId,
                      );
                      if (!record || !machine) return null;
                      if (
                        project !== null &&
                        (record.provider.requires.projectCheckout ||
                          record.provider.requires.gitRemote) &&
                        project.gitRemoteUrl === null
                      )
                        return null;
                      if (
                        project !== null &&
                        record.provider.requires.projectless !==
                          (project.id === PERSONAL_PROJECT_ID)
                      )
                        return null;
                      return {
                        id: composition.id,
                        displayName: composition.displayName,
                        description: composition.description,
                        icon: composition.icon ?? "FolderUnknown",
                        logoUrl:
                          icon === undefined
                            ? null
                            : providerLogoUrl(
                                "environment",
                                composition.id,
                                icon.hash,
                              ),
                        pluginId,
                        machineProviderId: composition.machineProviderId,
                        environmentProviderId:
                          composition.environmentProviderId,
                        requires: record.provider.requires,
                        inputs: record.provider.inputsJsonSchema,
                        acceptsEmptyInputs:
                          await environmentProviderAcceptsEmptyInputs(record),
                        machineInputs: machine.provider.inputsJsonSchema,
                        machineAcceptsEmptyInputs:
                          await machineProviderAcceptsEmptyInputs(machine),
                        machineProviderPluginId: machine.pluginId,
                        availability: null,
                        machineAvailability: {},
                      };
                    },
                  ),
                )
              ).filter((provider) => provider !== null),
        ),
    };
  });

  operations.implement(routes.machineProviders, async () => {
    return {
      providers: await Promise.all(
        listMachineProviders().map(async (record) => ({
          id: record.provider.id,
          displayName: record.provider.displayName,
          description: record.provider.description,
          icon: record.provider.icon,
          logoUrl:
            record.icon === undefined
              ? null
              : providerLogoUrl(
                  "machine",
                  record.provider.id,
                  record.icon.hash,
                ),
          pluginId: record.pluginId,
          inputs: record.provider.inputsJsonSchema,
          acceptsEmptyInputs: await machineProviderAcceptsEmptyInputs(record),
          supportsSuspend: record.provider.suspend !== null,
        })),
      ),
    };
  });

  operations.implement(routes.providers, async (query) =>
    listSystemProviderInfos(deps, query),
  );

  operations.implement(routes.providerCatalog, async () => {
    await deps.providerRegistry.whenRegistrationsSettled();
    return providerManagementCatalog(deps, pluginService);
  });
  operations.implement(routes.providerEnabled, async ({ id, enabled }) =>
    setProviderEnabled(deps, pluginService, id, enabled),
  );

  operations.implement(routes.providerLogo, async ({ id }, { request }) => {
    const providerId = id;
    const registration = providerId.startsWith("environment:")
      ? (getEnvironmentProvider(providerId.slice("environment:".length)) ??
        listEnvironmentCompositions().find(
          (record) =>
            record.composition.id === providerId.slice("environment:".length),
        ))
      : providerId.startsWith("machine:")
        ? getMachineProvider(providerId.slice("machine:".length))
        : deps.providerRegistry.get(providerId);
    if (registration?.icon !== undefined) {
      return imageBody(
        registration.icon,
        hashedAssetCacheControl(
          request === null
            ? undefined
            : (new URL(request.url).searchParams.get("h") ?? undefined),
          registration.icon.hash,
        ),
      );
    }
    throw new ApiError(
      404,
      "provider_logo_not_found",
      `Provider '${providerId}' has no logo.`,
    );
  });

  operations.implement(routes.providerStates, async (query) =>
    getProviderStates(deps, query),
  );

  operations.implement(routes.usageLimits, async (query) =>
    getProviderUsageLimits(deps, query),
  );

  operations.implement(routes.executionOptions, async (query) =>
    resolveSystemExecutionOptions(deps, query),
  );

  operations.implement(routes.aiServices, async () =>
    buildAiServicesView(deps),
  );

  operations.implement(routes.setAiServiceSelection, async (payload) =>
    updateAiServiceSelection(deps, payload),
  );

  operations.implement(routes.testAiService, async (payload, { signal }) =>
    testAiService(deps, {
      task: payload.task,
      signal,
    }),
  );

  operations.implement(
    routes.voiceTranscription,
    async (input: Record<string, unknown>, { signal }) => {
      const file = input.file;
      if (!(file instanceof File)) {
        throw new ApiError(400, "invalid_request", "Audio file is required");
      }
      return {
        text: await transcribeVoiceInput(deps, {
          file,
          prompt: typeof input.prompt === "string" ? input.prompt : undefined,
          signal,
        }),
      };
    },
  );

  operations.implement(routes.version, async (query) =>
    deps.appVersion.getSystemVersion({
      forceRefresh: query.force === "true",
    }),
  );

  operations.implement(routes.appUpdate, async (query, { caller }) =>
    deps.appUpdate.getStatus({
      forceRefresh: query.force === "true" && caller.user !== "machine",
    }),
  );

  operations.implement(routes.applyAppUpdate, async (body, { caller }) => {
    assertAppUpdateAllowed(caller);
    return await deps.appUpdate.apply({
      confirmInterruptingThreads: body.confirmInterruptingThreads,
    });
  });

  operations.implement(routes.scheduleAppUpdate, async (_input, { caller }) => {
    assertAppUpdateAllowed(caller);
    assertUpdateWhenIdleEnabled(deps.db);
    return await deps.appUpdate.schedule();
  });

  operations.implement(
    routes.cancelScheduledAppUpdate,
    async (_input, { caller }) => {
      assertAppUpdateAllowed(caller);
      assertUpdateWhenIdleEnabled(deps.db);
      return await deps.appUpdate.cancelScheduled();
    },
  );

  operations.implement(routes.setAppUpdateAuto, async (body, { caller }) => {
    assertAppUpdateAllowed(caller);
    assertUpdateWhenIdleEnabled(deps.db);
    return await deps.appUpdate.setAutoUpdate(body.enabled);
  });

  operations.implement(
    routes.acknowledgeAppUpdate,
    async (body, { caller }) => {
      assertAppUpdateAllowed(caller);
      return await deps.appUpdate.acknowledgeResult({ id: body.id });
    },
  );

  operations.implement(routes.cliCommand, async () =>
    deps.cliCommand.getStatus(),
  );

  operations.implement(routes.installCliCommand, async (_input, { caller }) => {
    assertCliCommandChangeAllowed(caller);
    return await deps.cliCommand.install();
  });

  operations.implement(routes.removeCliCommand, async (_input, { caller }) => {
    assertCliCommandChangeAllowed(caller);
    return await deps.cliCommand.remove();
  });
}

function assertCliCommandChangeAllowed(caller: OperationCaller): void {
  if (caller.user === "machine") {
    throw new ApiError(
      403,
      "forbidden",
      "Machine credentials cannot change the bb command on the bb server's computer",
    );
  }
}

const UPDATE_WHEN_IDLE_EXPERIMENT_DISABLED_MESSAGE =
  'Updating when idle is off. Turn on the "Update when idle" experiment in Settings → Experiments, or run bb settings experiment updateWhenIdle true, then try again.';

function assertUpdateWhenIdleEnabled(db: ServerAppDeps["db"]): void {
  if (!getExperiments(db).updateWhenIdle) {
    throw new ApiError(
      403,
      "update_when_idle_experiment_disabled",
      UPDATE_WHEN_IDLE_EXPERIMENT_DISABLED_MESSAGE,
    );
  }
}

function assertAppUpdateAllowed(caller: OperationCaller): void {
  if (caller.user === "machine") {
    throw new ApiError(
      403,
      "forbidden",
      "Machine credentials cannot update the bb server",
    );
  }
}
