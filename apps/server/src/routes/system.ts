import {
  getAppTheme,
  getExperiments,
  setAppTheme,
  setExperiments,
} from "@bb/db";
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

export function registerSystemRoutes(app: Hono, deps: ServerAppDeps): void {
  const { get, post, put } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.system;

  function buildSystemConfigResponse() {
    return {
      experiments: getExperiments(deps.db),
      appearance: getAppTheme(deps.db),
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
    setAppTheme(deps.db, payload);
    // Broadcast like experiments: every window re-reads /system/config and
    // re-applies the active palette.
    deps.hub.notifySystem(["config-changed"]);
    return context.json(getAppTheme(deps.db));
  });

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
