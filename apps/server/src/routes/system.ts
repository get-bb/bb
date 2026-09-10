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
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { validateTranscriptionModel } from "@bb/config/inference-model";
import type { BbAppManagedConfigKey } from "@bb/config/bb-app-managed-config";
import {
  validatePluginTranscriptionMaxBytes,
  validateVoiceRecordingBitrate,
  validateVoiceTranscriptionTimeoutMaxMs,
} from "@bb/config/voice-transcription-limit";
import { pluginImageResponse } from "./plugin-image-response.js";
import {
  getEnvironmentProvider,
  listEnvironmentProviders,
} from "../services/plugins/plugin-environment-provider-registry.js";
import { writeBbAppManagedConfigValues } from "../services/system/bb-app-managed-config.js";
import type { ServerAppDeps, ServerRuntimeConfig } from "../types.js";
import type { PluginService } from "../services/plugins/plugin-service.js";
import { ApiError } from "../errors.js";
import {
  resolveServiceVoiceMaxBytes,
  resolveVoiceTranscriptionEnabled,
  transcribeVoiceInput,
} from "../services/ai/voice-transcription.js";
import {
  listSystemProviderInfos,
  resolveSystemExecutionOptions,
} from "../services/system/execution-options.js";
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
  environmentProviderAcceptsEmptyInputs,
  resolveEnvironmentProviderAvailability,
} from "../services/environments/provider-availability.js";
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

function effectivePort(url: URL): number | null {
  if (url.port.length > 0) return Number(url.port);
  if (url.protocol === "http:") return 80;
  if (url.protocol === "https:") return 443;
  return null;
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
  app: Hono,
  deps: ServerAppDeps,
  pluginService: PluginService,
): void {
  const { get, post, put } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.system;

  const themeRoot = resolveThemeRootPath(deps.config.dataDir);

  get(routes.attention, (context) =>
    context.json({ hasAttention: hasActiveThreadAttention(deps.db) }),
  );

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
      keybindings: applyAppKeybindingOverrides(
        DEFAULT_APP_KEYBINDINGS,
        keybindingOverrides,
      ),
      defaultKeybindings: DEFAULT_APP_KEYBINDINGS,
      keybindingOverrides,
      experiments: getExperiments(deps.db),
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
      aiServices: buildAiServicesResponse(),
      dataDir: deps.config.dataDir,
    };
  }

  function buildAiServicesResponse() {
    return {
      inference: deps.config.inferenceModel,
      inferenceFallback: deps.config.inferenceFallbackModel,
      transcription: deps.config.transcriptionModel,
      transcriptionMaxBytes: deps.config.pluginTranscriptionMaxBytes,
      transcriptionTimeoutMaxMs: deps.config.voiceTranscriptionTimeoutMaxMs,
      recordingBitrate: deps.config.voiceTranscriptionRecordingBitrate,
      services: deps.aiServices.list().map((service) => {
        const servesVoice = service.kinds.includes("voice");
        return {
          id: service.id,
          displayName: service.displayName,
          kinds: [...service.kinds],
          pluginId: service.pluginId,
          maxVoiceBytes: service.experimental_maxVoiceBytes ?? null,
          effectiveVoiceMaxBytes: servesVoice
            ? resolveServiceVoiceMaxBytes(deps, service)
            : null,
        };
      }),
    };
  }

  get(routes.config, async (context) => {
    const serverUrl = resolveSystemServerUrl(context.req, deps.config);
    return context.json(await buildSystemConfigResponse(serverUrl));
  });

  function compatibleGeneralSettings() {
    const settings = getAppSettings(deps.db);
    return {
      ...settings,
      showUnhandledProviderEvents: settings.showDiagnosticEvents,
    };
  }

  put(routes.generalSettings, (context, payload) => {
    const { showUnhandledProviderEvents, ...settings } = payload;
    const current = getAppSettings(deps.db);
    const diagnosticValue =
      "showDiagnosticEvents" in settings
        ? settings.showDiagnosticEvents
        : undefined;
    setAppSettings(
      deps.db,
      appSettingsSchema.parse({
        ...settings,
        showDiagnosticEvents:
          diagnosticValue === undefined ||
          (showUnhandledProviderEvents !== undefined &&
            diagnosticValue === current.showDiagnosticEvents)
            ? showUnhandledProviderEvents
            : diagnosticValue,
      }),
    );
    deps.hub.notifySystem(["config-changed"]);
    return context.json(compatibleGeneralSettings());
  });

  put(routes.keyboardSettings, (context, payload) => {
    setAppKeybindingOverrides(deps.db, payload);
    deps.hub.notifySystem(["config-changed"]);
    return context.json(getAppKeybindingOverrides(deps.db));
  });

  put(routes.experiments, (context, payload) => {
    setExperiments(deps.db, { ...getExperiments(deps.db), ...payload });
    deps.hub.notifySystem(["config-changed"]);
    return context.json(getExperiments(deps.db));
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

  put(routes.appearance, async (context, payload) => {
    const { themeId, faviconColor } = payload;
    await requireKnownTheme(themeId);
    setStoredAppearance(deps.db, { themeId, faviconColor });
    deps.hub.notifySystem(["config-changed"]);
    return context.json(await resolveSelectedTheme(themeId, faviconColor));
  });

  get(routes.resolveTheme, async (context) => {
    const themeId = context.req.param("id");
    await requireKnownTheme(themeId);
    return context.json(
      await resolveSelectedTheme(themeId, getStoredFaviconColor(deps.db)),
    );
  });

  get(routes.themes, async (context) =>
    context.json({
      dir: themeRoot,
      custom: listCustomThemeNames(themeRoot),
      plugins: pluginService.listThemes(),
      active: await resolveSelectedTheme(
        getStoredThemeId(deps.db),
        getStoredFaviconColor(deps.db),
      ),
    }),
  );

  post(routes.reloadConfig, async (context) => {
    try {
      await deps.bbAppManagedConfig.reload({ notify: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ApiError(422, "invalid_config", message);
    }
    return context.json({ ok: true });
  });

  put(routes.transcriptionSettings, async (context, payload) => {
    const values: Partial<Record<BbAppManagedConfigKey, string>> = {};
    try {
      if (payload.transcriptionModel !== undefined) {
        values.BB_TRANSCRIPTION = validateTranscriptionModel(
          payload.transcriptionModel,
        );
      }
      if (payload.transcriptionMaxBytes !== undefined) {
        values.BB_TRANSCRIPTION_MAX_BYTES = String(
          validatePluginTranscriptionMaxBytes(
            "BB_TRANSCRIPTION_MAX_BYTES",
            payload.transcriptionMaxBytes,
          ),
        );
      }
      if (payload.transcriptionTimeoutMaxMs !== undefined) {
        values.BB_TRANSCRIPTION_TIMEOUT_MAX_MS = String(
          validateVoiceTranscriptionTimeoutMaxMs(
            "BB_TRANSCRIPTION_TIMEOUT_MAX_MS",
            payload.transcriptionTimeoutMaxMs,
          ),
        );
      }
      if (payload.recordingBitrate !== undefined) {
        values.BB_TRANSCRIPTION_RECORDING_BITRATE = String(
          validateVoiceRecordingBitrate(
            "BB_TRANSCRIPTION_RECORDING_BITRATE",
            payload.recordingBitrate,
          ),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ApiError(400, "invalid_request", message);
    }

    if (Object.keys(values).length === 0) {
      throw new ApiError(
        400,
        "invalid_request",
        "No transcription settings were provided",
      );
    }

    try {
      await writeBbAppManagedConfigValues({
        dataDir: deps.config.dataDir,
        values,
      });
      await deps.bbAppManagedConfig.reload({ notify: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ApiError(422, "invalid_config", message);
    }

    return context.json(buildAiServicesResponse());
  });

  get(routes.cliSkillsStatus, async (context, query) =>
    context.json(
      await readGlobalCliSkillStatus(deps, {
        hostIds:
          query.hostIds === undefined
            ? listInstallableMachineIds(deps)
            : query.hostIds.split(",").filter((hostId) => hostId.length > 0),
      }),
    ),
  );

  post(routes.installCliSkills, async (context, body) =>
    context.json(await installGlobalCliSkills(deps, { hostIds: body.hostIds })),
  );

  get(routes.environmentProviders, async (context, query) => {
    const project =
      query.projectId === undefined
        ? null
        : requirePublicProject(deps.db, query.projectId);
    return context.json({
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
            .map(async (record) => {
              const availability =
                query.projectId === undefined
                  ? null
                  : await resolveEnvironmentProviderAvailability(deps, record, {
                      projectId: query.projectId,
                      ...(query.hostId === undefined
                        ? {}
                        : { hostId: query.hostId }),
                    });
              if (query.projectId !== undefined && availability === null)
                return null;
              return {
                id: record.provider.id,
                displayName: record.provider.displayName,
                icon: record.provider.icon,
                logoUrl:
                  record.icon === undefined
                    ? null
                    : `/api/v1/system/providers/${encodeURIComponent(`environment:${record.provider.id}`)}/logo?h=${record.icon.hash}`,
                pluginId: record.pluginId,
                requires: record.provider.requires,
                inputs: record.provider.inputsJsonSchema,
                acceptsEmptyInputs:
                  await environmentProviderAcceptsEmptyInputs(record),
                availability,
              };
            }),
        )
      ).filter((provider) => provider !== null),
    });
  });

  get(routes.providers, async (context, query) =>
    context.json(await listSystemProviderInfos(deps, query)),
  );

  get(routes.providerLogo, async (context) => {
    const providerId = context.req.param("id");
    const registration = providerId.startsWith("environment:")
      ? getEnvironmentProvider(providerId.slice("environment:".length))
      : deps.providerRegistry.get(providerId);
    if (registration?.icon !== undefined) {
      return pluginImageResponse(
        context,
        registration.icon,
        context.req.query("h") === registration.icon.hash
          ? "public, max-age=31536000, immutable"
          : "no-store",
      );
    }
    throw new ApiError(
      404,
      "provider_logo_not_found",
      `Provider '${providerId}' has no logo.`,
    );
  });

  get(routes.providerStates, async (context, query) =>
    context.json(await getProviderStates(deps, query)),
  );

  get(routes.usageLimits, async (context, query) =>
    context.json(await getProviderUsageLimits(deps, query)),
  );

  get(routes.executionOptions, async (context, query) =>
    context.json(await resolveSystemExecutionOptions(deps, query)),
  );

  post(routes.voiceTranscription, async (context) => {
    const formData = await context.req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(400, "invalid_request", "Audio file is required");
    }
    return context.json({
      text: await transcribeVoiceInput(deps, {
        file,
        prompt:
          typeof formData.get("prompt") === "string"
            ? String(formData.get("prompt"))
            : undefined,
      }),
    });
  });

  get(routes.version, async (context, query) =>
    context.json(
      await deps.appVersion.getSystemVersion({
        forceRefresh: query.force === "true",
      }),
    ),
  );
}
