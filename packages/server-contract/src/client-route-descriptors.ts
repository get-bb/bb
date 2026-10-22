import type { ApiError } from "./errors.js";
import type { PathId } from "./common.js";
import {
  defineRoute,
  jsonRequest,
  jsonResponse,
  noRequest,
} from "@bb/hono-typed-routes";
import type { EnvironmentPullRequestResponse } from "./api-types.js";
import {
  updateUiPreferenceRequestSchema,
  type PathUiPreferenceKey,
  type UiPreferenceResponse,
  type UiPreferencesResponse,
  type UpdateUiPreferenceRequest,
} from "./api/ui-preferences.js";

export const UI_PREFERENCES_TAG = "ui-preferences";

export function environmentPullRequestTag(environmentId: string): string {
  return `environment-pull-request:${environmentId}`;
}

export const environmentPullRequestRoute = defineRoute({
  path: "/environments/:id/pull-request",
  method: "get",
  request: noRequest<PathId>(),
  response: jsonResponse<EnvironmentPullRequestResponse>(),
  tags: ({ params }) => [environmentPullRequestTag(params.id)],
});

export const uiPreferencesRoute = defineRoute({
  path: "/preferences/ui",
  method: "get",
  request: noRequest(),
  response: jsonResponse<UiPreferencesResponse>(),
  tags: () => [UI_PREFERENCES_TAG],
});

export const updateUiPreferenceRoute = defineRoute({
  path: "/preferences/ui/:key",
  method: "put",
  request: jsonRequest<PathUiPreferenceKey, UpdateUiPreferenceRequest>(
    updateUiPreferenceRequestSchema,
  ),
  response: [
    jsonResponse<UiPreferenceResponse>(),
    jsonResponse<ApiError>({ status: 404 }),
    jsonResponse<ApiError>({ status: 409 }),
  ],
  invalidates: () => [UI_PREFERENCES_TAG],
});

export const resetUiPreferenceRoute = defineRoute({
  path: "/preferences/ui/:key",
  method: "delete",
  request: noRequest<PathUiPreferenceKey>(),
  response: [
    jsonResponse<UiPreferenceResponse>(),
    jsonResponse<ApiError>({ status: 404 }),
  ],
  invalidates: () => [UI_PREFERENCES_TAG],
});
