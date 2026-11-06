import {
  isUiPreferenceKey,
  parseUiPreferenceValue,
  UI_PREFERENCE_KEYS,
  type UiPreferenceKey,
} from "@bb/domain";
import { publicApiRoutes } from "@bb/server-contract";
import { ApiError } from "../errors.js";
import type { OperationRoutes } from "../kernel/http-door.js";
import {
  readUiPreferences,
  resetUiPreference,
  writeUiPreference,
} from "../services/system/ui-preferences.js";
import type { AppDeps } from "../types.js";

function requireUiPreferenceKey(key: string): UiPreferenceKey {
  if (isUiPreferenceKey(key)) return key;
  throw new ApiError(
    404,
    "ui_preference_not_found",
    `Unknown UI preference '${key}'. Known preferences: ${UI_PREFERENCE_KEYS.join(", ")}.`,
  );
}

export function registerUiPreferenceRoutes(
  operations: OperationRoutes,
  deps: AppDeps,
): void {
  const routes = publicApiRoutes.system;

  operations.implement(routes.uiPreferences, () => ({
    preferences: readUiPreferences(deps),
  }));

  operations.implement(
    routes.updateUiPreference,
    ({ key: rawKey, ...payload }) => {
      const key = requireUiPreferenceKey(rawKey);
      const parsed = parseUiPreferenceValue(key, payload.value);
      if (!parsed.success) {
        throw new ApiError(
          400,
          "invalid_request",
          `Invalid value for UI preference '${key}': ${parsed.message}`,
        );
      }
      const result = writeUiPreference(deps, {
        expectedRevision: payload.expectedRevision,
        key,
        value: parsed.value,
      });
      if (result.outcome === "conflict") {
        throw new ApiError(
          409,
          "ui_preference_conflict",
          "UI preference changed on another client",
          { details: { currentRevision: result.revision } },
        );
      }
      deps.hub.notifySystem(["ui-preferences-changed"]);
      return { key, ...result.entry };
    },
  );

  operations.implement(routes.resetUiPreference, ({ key: rawKey }) => {
    const key = requireUiPreferenceKey(rawKey);
    const entry = resetUiPreference(deps, key);
    deps.hub.notifySystem(["ui-preferences-changed"]);
    return { key, ...entry };
  });
}
