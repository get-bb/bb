import { getStoredThreadTabs, replaceStoredThreadTabs } from "@bb/db";
import {
  publicApiRoutes,
  threadTabsSchema,
  type ThreadTab,
  type ThreadTabsResponse,
  type ThreadTabsWireResponse,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { OperationRoutes } from "../../kernel/http-door.js";
import { requirePublicThread } from "../../services/lib/entity-lookup.js";
import type { AppDeps } from "../../types.js";

type WireThreadTab = ThreadTabsWireResponse["tabs"][number];

function toWireThreadTab(tab: ThreadTab): WireThreadTab {
  if (tab.kind === "host-file-preview") {
    const { hostId, ...rest } = tab;
    return hostId === null ? rest : tab;
  }
  if (
    tab.kind === "plugin-panel" &&
    tab.fileOpenerOwner?.kind === "host-file-preview"
  ) {
    const { hostId, ...owner } = tab.fileOpenerOwner;
    return hostId === null ? { ...tab, fileOpenerOwner: owner } : tab;
  }
  return tab;
}

function toWireThreadTabsResponse(
  response: ThreadTabsResponse,
): ThreadTabsWireResponse {
  return {
    revision: response.revision,
    tabs: response.tabs.map(toWireThreadTab),
  };
}

function readThreadTabs(deps: AppDeps, threadId: string): ThreadTabsResponse {
  const stored = getStoredThreadTabs(deps.db, threadId);
  if (!stored) {
    return { revision: 0, tabs: [] };
  }

  const parsedJson: unknown = JSON.parse(stored.tabsJson);
  return {
    revision: stored.revision,
    tabs: threadTabsSchema.parse(parsedJson),
  };
}

export function registerThreadTabRoutes(
  operations: OperationRoutes,
  deps: AppDeps,
): void {
  const routes = publicApiRoutes.threads;

  operations.implement(routes.tabs, ({ id }) => {
    const thread = requirePublicThread(deps.db, id);
    return toWireThreadTabsResponse(readThreadTabs(deps, thread.id));
  });

  operations.implement(routes.updateTabs, ({ id, ...payload }) => {
    const thread = requirePublicThread(deps.db, id);
    const result = replaceStoredThreadTabs(deps.db, {
      expectedRevision: payload.expectedRevision,
      tabsJson: JSON.stringify(payload.tabs),
      threadId: thread.id,
    });
    if (result.outcome === "conflict") {
      throw new ApiError(
        409,
        "thread_tabs_conflict",
        "Thread tabs changed on another client",
        { details: { currentRevision: result.revision } },
      );
    }
    deps.hub.notifyThread(thread.id, ["tabs-changed"]);
    return toWireThreadTabsResponse({
      revision: result.revision,
      tabs: payload.tabs,
    });
  });
}
