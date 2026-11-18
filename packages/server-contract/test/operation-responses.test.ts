import type {
  RouteDefinition,
  RouteResponseDescriptor,
} from "@bb/hono-typed-routes";
import { describe, expect, it } from "vitest";
import type { CarriesFailureState } from "../src/api/operation.js";
import { publicApiRoutes } from "../src/public-api.js";

const FAILURE_SHAPED_ROUTES = {
  "post /desktop-browsers/import-cookies":
    "the desktop import dialog renders the typed { ok: false, reason } outcome per reason; bb browser import-cookies exits non-zero on it",
  "post /server/move":
    "returns the move's state-machine snapshot; bb server move follows it to a terminal state and exits non-zero on failed",
  "post /server/move/cancel":
    "returns the move's state-machine snapshot after requesting the cancel; failed is a state the move can already be in",
  "post /system/ai-services/test":
    "a diagnostic probe whose answer is the probed service's result; bb settings ai-services test exits non-zero when it failed",
  "post /system/cli-skills/install":
    "a batch over machines that reports each machine's result; bb skill install-cli-skills exits non-zero when any failed",
} as const;

type RouteLeaves<Value> = Value extends RouteDefinition
  ? Value
  : Value extends object
    ? { [Key in keyof Value]: RouteLeaves<Value[Key]> }[keyof Value]
    : never;

type SuccessJsonBody<Response> = Response extends readonly unknown[]
  ? SuccessJsonBody<Response[number]>
  : Response extends RouteResponseDescriptor<
        infer Output,
        infer Status,
        infer Format
      >
    ? Format extends "json"
      ? Status extends 200 | 201 | 202
        ? Output
        : never
      : never
    : never;

type IsBareAcknowledgement<Body> = [Body] extends [{ ok: true }]
  ? [keyof Body] extends ["ok"]
    ? true
    : false
  : false;

type MutatingRoute = Extract<
  RouteLeaves<typeof publicApiRoutes>,
  RouteDefinition<string, "post" | "put" | "patch" | "delete">
>;

type RouteKey<Route> =
  Route extends RouteDefinition<infer Path, infer Method>
    ? `${Method} ${Path}`
    : never;

type BareAcknowledgementRoutes = MutatingRoute extends infer Route
  ? Route extends RouteDefinition<string, any, any, infer Response>
    ? IsBareAcknowledgement<SuccessJsonBody<Response>> extends true
      ? RouteKey<Route>
      : never
    : never
  : never;

type FailureShapedRoutes = MutatingRoute extends infer Route
  ? Route extends RouteDefinition<string, any, any, infer Response>
    ? true extends CarriesFailureState<SuccessJsonBody<Response>>
      ? RouteKey<Route>
      : never
    : never
  : never;

type AllowedFailureShapedRoute = keyof typeof FAILURE_SHAPED_ROUTES;

const bareAcknowledgementsMustUseOperationResponse: [
  BareAcknowledgementRoutes,
] extends [never]
  ? true
  : BareAcknowledgementRoutes = true;

const unlistedFailureShapedRoutes: [
  Exclude<FailureShapedRoutes, AllowedFailureShapedRoute>,
] extends [never]
  ? true
  : Exclude<FailureShapedRoutes, AllowedFailureShapedRoute> = true;

const staleAllowlistEntries: [
  Exclude<AllowedFailureShapedRoute, FailureShapedRoutes>,
] extends [never]
  ? true
  : Exclude<AllowedFailureShapedRoute, FailureShapedRoutes> = true;

describe("mutating route 2xx bodies", () => {
  it("report an outcome, never a bare acknowledgement or an unlisted failure", () => {
    expect([
      bareAcknowledgementsMustUseOperationResponse,
      unlistedFailureShapedRoutes,
      staleAllowlistEntries,
    ]).toEqual([true, true, true]);
    for (const reason of Object.values(FAILURE_SHAPED_ROUTES)) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});
