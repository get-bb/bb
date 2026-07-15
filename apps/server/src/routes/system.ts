import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { formatCustomAcpAgentProviderId } from "@bb/config/bb-app-managed-config";
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
  customThemeNameSchema,
  isBuiltInThemeId,
  type AppKeybindingOverrides,
  type AppTheme,
} from "@bb/domain";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { ServerAppDeps } from "../types.js";
import type { PluginService } from "../services/plugins/plugin-service.js";
import { ApiError } from "../errors.js";
import {
  resolveVoiceTranscriptionEnabled,
  transcribeVoiceInput,
} from "../services/ai/voice-transcription.js";
import {
  listSystemProviderInfos,
  resolveSystemExecutionOptions,
} from "../services/system/execution-options.js";
import { getProviderUsageLimits } from "../services/system/usage-limits.js";
import {
  listCustomThemeNames,
  readCustomThemeCss,
  resolveAppTheme,
  resolveCustomThemeCssPath,
  resolveThemeRootPath,
} from "../services/system/custom-themes.js";
import { schedulePrimaryHostCaffeinateReconciliation } from "../services/system/app-settings.js";
import { DEFAULT_APP_KEYBINDINGS } from "../services/system/app-keybindings.js";
import { resolvePrimaryHostId } from "../services/hosts/primary-host.js";

const CUSTOM_ACP_LOGO_CONTENT_TYPES = {
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
} as const;

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
    if (pluginCss !== null)
      return { themeId, customCss: pluginCss, faviconColor };
    return resolveAppTheme(themeRoot, themeId, faviconColor);
  }

  async function buildSystemConfigResponse() {
    const keybindingOverrides = readAppKeybindingOverrides();
    const primaryHostId = resolvePrimaryHostId(deps);
    return {
      generalSettings: getAppSettings(deps.db),
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
      primaryHostId,
      primaryHostPlatform:
        primaryHostId === null
          ? null
          : deps.hub.getDaemonPlatformForHost(primaryHostId),
      voiceTranscriptionEnabled: resolveVoiceTranscriptionEnabled(deps),
      dataDir: deps.config.dataDir,
    };
  }

  get(routes.config, async (context) =>
    context.json(await buildSystemConfigResponse()),
  );

  put(routes.generalSettings, (context, payload) => {
    setAppSettings(deps.db, payload);
    deps.hub.notifySystem(["config-changed"]);
    schedulePrimaryHostCaffeinateReconciliation(deps, {
      reason: "settings-updated",
    });
    return context.json(getAppSettings(deps.db));
  });

  put(routes.keyboardSettings, (context, payload) => {
    setAppKeybindingOverrides(deps.db, payload);
    deps.hub.notifySystem(["config-changed"]);
    return context.json(getAppKeybindingOverrides(deps.db));
  });

  put(routes.experiments, (context, payload) => {
    const previous = getExperiments(deps.db);
    setExperiments(deps.db, payload);
    // The same kind a config reload broadcasts: every window re-reads
    // /system/config and re-gates its experiment-flagged surfaces.
    deps.hub.notifySystem(["config-changed"]);
    const next = getExperiments(deps.db);
    if (previous.plugins !== next.plugins) {
      // Live toggle: plugin-affecting experiments load/unload matching rows.
      void pluginService.onExperimentsChanged().catch((error) => {
        deps.logger.error({ err: error }, "Plugin experiment toggle failed");
      });
    }
    return context.json(next);
  });

  put(routes.appearance, async (context, payload) => {
    const { themeId } = payload;
    const pluginCss = await pluginService.readThemeCss(themeId);
    if (!isBuiltInThemeId(themeId) && pluginCss === null) {
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
    const { faviconColor } = payload;
    setStoredAppearance(deps.db, { themeId, faviconColor });
    // Broadcast like experiments: every window re-reads /system/config and
    // re-applies the active palette.
    deps.hub.notifySystem(["config-changed"]);
    return context.json(
      pluginCss === null
        ? resolveAppTheme(themeRoot, themeId, faviconColor)
        : { themeId, customCss: pluginCss, faviconColor },
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

  get(routes.providers, async (context, query) =>
    context.json(await listSystemProviderInfos(deps, query)),
  );

  get(routes.providerLogo, async (context) => {
    const providerId = context.req.param("id");
    const agent = deps.config.customAcpAgents.find(
      (candidate) =>
        formatCustomAcpAgentProviderId(candidate.id) === providerId,
    );
    if (agent?.logo === undefined) {
      throw new ApiError(
        404,
        "provider_logo_not_found",
        `Provider '${providerId}' has no configured logo.`,
      );
    }

    const extension = extname(agent.logo).toLowerCase();
    const contentType =
      CUSTOM_ACP_LOGO_CONTENT_TYPES[
        extension as keyof typeof CUSTOM_ACP_LOGO_CONTENT_TYPES
      ];
    if (contentType === undefined) {
      throw new ApiError(
        415,
        "unsupported_provider_logo",
        `Provider '${providerId}' has an unsupported logo format.`,
      );
    }

    let bytes: Buffer;
    try {
      bytes = await readFile(resolve(deps.config.dataDir, agent.logo));
    } catch {
      throw new ApiError(
        404,
        "provider_logo_not_found",
        `Provider '${providerId}' logo file was not found.`,
      );
    }
    return context.body(new Uint8Array(bytes), 200, {
      "cache-control": "no-store",
      "content-type": contentType,
      "x-content-type-options": "nosniff",
    });
  });

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
