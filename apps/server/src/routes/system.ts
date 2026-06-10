import { getExperiments, setExperiments } from "@bb/db";
import { experimentsSchema } from "@bb/domain";
import {
  systemExecutionOptionsQuerySchema,
  systemProvidersQuerySchema,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { ServerAppDeps } from "../types.js";
import { COMMAND_TIMEOUT_MS } from "../constants.js";
import { ApiError } from "../errors.js";
import { callHostRetryableOnlineRpc } from "../services/hosts/online-rpc.js";
import {
  resolveVoiceTranscriptionEnabled,
  transcribeVoiceInput,
} from "../services/ai/voice-transcription.js";
import { resolveSystemExecutionOptions } from "../services/system/execution-options.js";
import { resolveSystemLookupHostId } from "../services/system/host-lookup.js";

export function registerSystemRoutes(app: Hono, deps: ServerAppDeps): void {
  const { get, post, put } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  get("/system/config", (context) =>
    context.json({
      experiments: getExperiments(deps.db),
      featureFlags: deps.config.featureFlags,
      hostDaemonPort: deps.config.hostDaemonPort,
      voiceTranscriptionEnabled: resolveVoiceTranscriptionEnabled(deps),
    }),
  );

  put("/settings/experiments", experimentsSchema, (context, payload) => {
    setExperiments(deps.db, payload);
    // The same kind a config reload broadcasts: every window re-reads
    // /system/config and re-gates its experiment-flagged surfaces.
    deps.hub.notifySystem(["config-changed"]);
    return context.json(getExperiments(deps.db));
  });

  post("/system/config/reload", async (context) => {
    try {
      await deps.bbAppManagedConfig.reload({ notify: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ApiError(422, "invalid_config", message);
    }
    return context.json({ ok: true });
  });

  get(
    "/system/providers",
    systemProvidersQuerySchema,
    async (context, query) => {
      const hostId = resolveSystemLookupHostId(deps, query);
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: { type: "provider.list" },
      });
      return context.json(result.providers);
    },
  );

  get(
    "/system/execution-options",
    systemExecutionOptionsQuerySchema,
    async (context, query) =>
      context.json(await resolveSystemExecutionOptions(deps, query)),
  );

  post("/system/voice-transcription", async (context) => {
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

  get("/system/version", async (context) =>
    context.json(await deps.appVersion.getSystemVersion()),
  );
}
