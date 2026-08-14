import type { AsEntityKind } from "../../../lib/remote/types.js";
import type { MockHandlerRegistry } from "../types.js";
import {
  AS_CREATABLE_KINDS,
  createHandler,
  deleteHandler,
  getHandler,
  listHandler,
  projectSbomListHandler,
  routeId,
  updateHandler,
} from "./crud.js";
import {
  createMockAssuranceStudioState,
  type MockAssuranceStudioClock,
} from "./state.js";
import {
  verificationGetHandler,
  verificationListHandler,
  verificationRunHandler,
} from "./verification.js";
import { projectLinksHandler, projectListHandler } from "./project-links.js";

const LIST_KINDS = [
  "threat",
  "risk",
  "mitigation",
  "asset",
  "zone",
  "dataflow",
  "component",
  "requirement",
  "attack-path",
] as const satisfies readonly AsEntityKind[];
const ITEM_GET_KINDS = [
  "threat",
  "risk",
  "mitigation",
  "asset",
  "zone",
  "dataflow",
  "component",
  "requirement",
  "attack-path",
] as const satisfies readonly AsEntityKind[];
const UPDATE_KINDS = ITEM_GET_KINDS;
const DELETE_KINDS = [
  "threat",
  "mitigation",
  "asset",
  "zone",
  "dataflow",
  "component",
  "requirement",
  "attack-path",
] as const satisfies readonly AsEntityKind[];

export function registerMockAssuranceStudio(
  registry: MockHandlerRegistry,
  fixtureRoot: string,
  clock?: MockAssuranceStudioClock,
) {
  const state = createMockAssuranceStudioState(fixtureRoot, clock);
  registry.register(
    "assurance-studio:GET:/api/projects",
    projectListHandler(fixtureRoot),
  );
  registry.register(
    "assurance-studio:GET:/api/projects/{projectId}/fs-links",
    projectLinksHandler(fixtureRoot),
  );
  for (const kind of LIST_KINDS)
    registry.register(routeId(kind, "GET", false), listHandler(state, kind));
  for (const kind of ITEM_GET_KINDS)
    registry.register(routeId(kind, "GET", true), getHandler(state, kind));
  for (const kind of AS_CREATABLE_KINDS)
    registry.register(routeId(kind, "POST", false), createHandler(state, kind));
  for (const kind of UPDATE_KINDS)
    registry.register(routeId(kind, "PATCH", true), updateHandler(state, kind));
  for (const kind of DELETE_KINDS)
    registry.register(
      routeId(kind, "DELETE", true),
      deleteHandler(state, kind),
    );
  registry.register(
    "assurance-studio:GET:/api/projects/{id}/sbom",
    projectSbomListHandler(state, fixtureRoot),
  );
  registry.register(
    "assurance-studio:GET:/api/projects/{projectId}/verification/checks",
    verificationListHandler(fixtureRoot),
  );
  registry.register(
    "assurance-studio:GET:/api/projects/{projectId}/verification/checks/{checkId}",
    verificationGetHandler(fixtureRoot),
  );
  const verificationRun = verificationRunHandler(fixtureRoot, (reset) =>
    registry.onReset(reset),
  );
  registry.register(
    "assurance-studio:POST:/api/projects/{projectId}/verification/run",
    verificationRun,
  );
  registry.onReset(() => state.reset());
  return state;
}
