import {
  getExperiments,
  getStoredFaviconColor,
  getStoredThemeId,
  setExperiments,
  setStoredAppearance,
} from "@bb/db";
import { customThemeNameSchema, isBuiltInThemeId } from "@bb/domain";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { ServerAppDeps } from "../types.js";
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

export function registerSystemRoutes(app: Hono, deps: ServerAppDeps): void {
  const { get, post, put } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.system;

  const themeRoot = resolveThemeRootPath(deps.config.dataDir);

  function buildSystemConfigResponse() {
    return {
      experiments: getExperiments(deps.db),
      appearance: resolveAppTheme(
        themeRoot,
        getStoredThemeId(deps.db),
        getStoredFaviconColor(deps.db),
      ),
      customThemes: listCustomThemeNames(themeRoot),
      featureFlags: deps.config.featureFlags,
      hostDaemonPort: deps.config.hostDaemonPort,
      voiceTranscriptionEnabled: resolveVoiceTranscriptionEnabled(deps),
    };
  }

  get(routes.config, (context) => context.json(buildSystemConfigResponse()));

  put(routes.experiments, (context, payload) => {
    setExperiments(deps.db, payload);
    // The same kind a config reload broadcasts: every window re-reads
    // /system/config and re-gates its experiment-flagged surfaces.
    deps.hub.notifySystem(["config-changed"]);
    return context.json(getExperiments(deps.db));
  });

  put(routes.appearance, (context, payload) => {
    const { themeId } = payload;
    if (!isBuiltInThemeId(themeId)) {
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
    // Favicon tint is omitted for theme-only changes; keep the current value.
    const faviconColor = payload.faviconColor ?? getStoredFaviconColor(deps.db);
    setStoredAppearance(deps.db, { themeId, faviconColor });
    // Broadcast like experiments: every window re-reads /system/config and
    // re-applies the active palette.
    deps.hub.notifySystem(["config-changed"]);
    return context.json(resolveAppTheme(themeRoot, themeId, faviconColor));
  });

  get(routes.themes, (context) =>
    context.json({
      dir: themeRoot,
      custom: listCustomThemeNames(themeRoot),
      active: resolveAppTheme(
        themeRoot,
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

  get(routes.providers, async (context) =>
    context.json(await listSystemProviderInfos(deps)),
  );

  get(routes.usageLimits, async (context) =>
    context.json(await getProviderUsageLimits(deps)),
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

  get(routes.version, async (context) =>
    context.json(await deps.appVersion.getSystemVersion()),
  );
}
