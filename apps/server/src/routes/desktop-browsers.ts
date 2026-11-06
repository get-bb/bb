import { browserRequestProblem } from "../browser-request-guard.js";
import {
  desktopBrowserCreateRequestSchema,
  desktopBrowserAcquireRequestSchema,
  desktopBrowserImportCookiesRequestSchema,
  publicApiRoutes,
} from "@bb/server-contract";
import type { OperationRoutes } from "../kernel/http-door.js";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import {
  proveDesktopBrowserBroker,
  acquireDesktopBrowserControl,
  captureDesktopBrowserTab,
  createDesktopBrowserTab,
  desktopBrowserTabAction,
  importDesktopBrowserCookies,
  listDesktopBrowserImportSources,
  listDesktopBrowserInstances,
  listDesktopBrowserTabs,
  openDesktopBrowserConnection,
  releaseDesktopBrowserControl,
} from "../services/desktop-browsers.js";

export function registerDesktopBrowserRoutes(
  operations: OperationRoutes,
  deps: AppDeps,
) {
  const routes = publicApiRoutes.desktopBrowsers;
  for (const route of Object.values(routes)) {
    operations.app.use(route.path, async (context, next) => {
      const problem = browserRequestProblem(context, deps, {
        requireJsonForMutation: true,
      });
      if (problem)
        throw new ApiError(
          problem.status,
          problem.status === 403
            ? "forbidden_origin"
            : "unsupported_media_type",
          problem.error,
        );
      await next();
    });
  }
  operations.implement(routes.brokerProof, async (input) => {
    return proveDesktopBrowserBroker(deps, input);
  });
  operations.implement(routes.listInstances, (input) =>
    listDesktopBrowserInstances(deps, input.hostId),
  );
  operations.implement(routes.listTabs, (input) =>
    listDesktopBrowserTabs(deps, input),
  );
  operations.implement(routes.createTab, (input) =>
    createDesktopBrowserTab(
      deps,
      desktopBrowserCreateRequestSchema.parse(input),
    ),
  );
  operations.implement(routes.acquireControl, (input) =>
    acquireDesktopBrowserControl(
      deps,
      desktopBrowserAcquireRequestSchema.parse(input),
    ),
  );
  operations.implement(routes.openConnection, async (input) => {
    return openDesktopBrowserConnection(deps, input);
  });
  operations.implement(routes.releaseControl, (input) =>
    releaseDesktopBrowserControl(deps, input),
  );
  operations.implement(routes.captureTab, async (input) => {
    return captureDesktopBrowserTab(deps, input);
  });
  operations.implement(routes.revealTab, (input) =>
    desktopBrowserTabAction(deps, input, "reveal"),
  );
  operations.implement(routes.closeTab, (input) =>
    desktopBrowserTabAction(deps, input, "close"),
  );
  operations.implement(routes.listImportSources, (input) =>
    listDesktopBrowserImportSources(deps, input),
  );
  operations.implement(routes.importCookies, async (input) => {
    return importDesktopBrowserCookies(
      deps,
      desktopBrowserImportCookiesRequestSchema.parse(input),
    );
  });
}
