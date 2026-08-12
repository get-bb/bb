import type { MockHandlerRegistry } from "../types.js";
import { platformArrayPage } from "./paging.js";
import type { MockPlatformState } from "./state.js";

export function registerProjectHandlers(
  registry: MockHandlerRegistry,
  state: MockPlatformState,
): void {
  registry.register("platform:GET:/public/v0/projects", ({ request }) => {
    return platformArrayPage(request, [...state.projects.values()]);
  });
  registry.register(
    "platform:GET:/public/v0/projects/{projectId}/versions",
    ({ request, params }) => {
      if (!state.projects.has(params.projectId)) {
        return Response.json(
          { error: { code: "PROJECT_NOT_FOUND", message: "Project was not found" } },
          { status: 404 },
        );
      }
      const versions = [...state.versions.values()].filter(
        (version) => version.projectId === params.projectId,
      );
      return platformArrayPage(request, versions);
    },
  );
}
