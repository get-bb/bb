import { randomUUID } from "node:crypto";
import { getStoredThreadTabs, replaceStoredThreadTabs } from "@bb/db";
import type { DesktopBrowserTab } from "@bb/host-daemon-contract";
import {
  threadTabsSchema,
  type ThreadTab,
  type ExperimentalDesktopBrowserScope,
  type ExperimentalDesktopBrowserCreateRequest,
  type ExperimentalDesktopBrowserAcquireRequest,
  type ExperimentalDesktopBrowserLeaseRequest,
  type ExperimentalDesktopBrowserTabRequest,
  type ExperimentalDesktopBrowserLease,
  type ExperimentalDesktopBrowserInstanceRequest,
  type ExperimentalDesktopBrowserImportCookiesRequest,
} from "@bb/server-contract";
import type { WorkSessionDeps } from "../types.js";
import { ApiError } from "../errors.js";
import {
  requirePublicThread,
  requireNonDestroyedHostWithStatus,
} from "./lib/entity-lookup.js";
import {
  callHostOnlineRpc,
  callHostOnlineRpcForWork,
} from "./hosts/online-rpc.js";

interface LeaseEntry {
  lease: ExperimentalDesktopBrowserLease;
  active: boolean;
  timer: ReturnType<typeof setTimeout>;
}

const registries = new WeakMap<
  WorkSessionDeps["hub"],
  Map<string, LeaseEntry>
>();
function registry(deps: WorkSessionDeps) {
  let leases = registries.get(deps.hub);
  if (!leases) {
    leases = new Map();
    registries.set(deps.hub, leases);
  }
  return leases;
}

function scopeCommand(input: ExperimentalDesktopBrowserScope) {
  return {
    instanceId: input.instanceId,
    generation: input.generation,
    threadId: input.threadId,
  };
}

function authorize(
  deps: WorkSessionDeps,
  scope: ExperimentalDesktopBrowserScope,
) {
  requirePublicThread(deps.db, scope.threadId);
  requireNonDestroyedHostWithStatus(deps, scope.hostId);
}

function sameScope(
  a: ExperimentalDesktopBrowserScope,
  b: ExperimentalDesktopBrowserScope,
) {
  return (
    a.hostId === b.hostId &&
    a.instanceId === b.instanceId &&
    a.generation === b.generation &&
    a.threadId === b.threadId
  );
}

function requireLease(
  deps: WorkSessionDeps,
  input: ExperimentalDesktopBrowserLeaseRequest,
) {
  authorize(deps, input);
  const entry = registry(deps).get(input.leaseId);
  if (
    !entry ||
    !entry.active ||
    entry.lease.expiresAt <= Date.now() ||
    !sameScope(entry.lease, input)
  ) {
    throw new ApiError(
      409,
      "desktop_control_expired",
      "Browser control has expired or belongs to a different desktop/thread",
    );
  }
  return entry;
}

function readStoredTabs(db: WorkSessionDeps["db"], threadId: string) {
  const stored = getStoredThreadTabs(db, threadId);
  return {
    stored,
    tabs: stored ? threadTabsSchema.parse(JSON.parse(stored.tabsJson)) : [],
  };
}

function toStoredBrowserTab(
  scope: ExperimentalDesktopBrowserScope,
  tab: DesktopBrowserTab,
) {
  return {
    id: tab.tabId,
    kind: "browser" as const,
    environmentId: null,
    title: tab.title.slice(0, 1024) || null,
    url: tab.url,
    desktopTarget: {
      hostId: scope.hostId,
      instanceId: scope.instanceId,
      generation: scope.generation,
    },
  };
}

function sameDesktopTarget(
  tab: ThreadTab,
  scope: ExperimentalDesktopBrowserScope,
) {
  return (
    tab.kind === "browser" &&
    tab.desktopTarget?.hostId === scope.hostId &&
    tab.desktopTarget.instanceId === scope.instanceId &&
    tab.desktopTarget.generation === scope.generation
  );
}

function assertTabsInThread(
  tabs: readonly DesktopBrowserTab[],
  threadId: string,
) {
  if (tabs.some((tab) => tab.threadId !== threadId)) {
    throw new ApiError(
      502,
      "desktop_tab_scope",
      "Desktop returned tabs outside the requested thread",
    );
  }
}

function sendReleaseControl(
  call: typeof callHostOnlineRpc,
  deps: WorkSessionDeps,
  input: ExperimentalDesktopBrowserScope,
  leaseId: string,
) {
  return call(deps, {
    hostId: input.hostId,
    timeoutMs: 10000,
    command: {
      type: "desktop.browser.release_control",
      ...scopeCommand(input),
      leaseId,
    },
  });
}

export function persistDesktopBrowserTab(
  deps: Pick<WorkSessionDeps, "db" | "hub">,
  scope: ExperimentalDesktopBrowserScope,
  tab: DesktopBrowserTab,
) {
  if (tab.threadId !== scope.threadId || tab.url.length > 4096) return;
  requirePublicThread(deps.db, scope.threadId);
  const { stored, tabs } = readStoredTabs(deps.db, scope.threadId);
  const next = toStoredBrowserTab(scope, tab);
  const index = tabs.findIndex((value) => value.id === tab.tabId);
  if (index < 0) tabs.push(next);
  else tabs[index] = next;
  const parsed = threadTabsSchema.parse(tabs);
  replaceStoredThreadTabs(deps.db, {
    threadId: scope.threadId,
    expectedRevision: stored?.revision ?? 0,
    tabsJson: JSON.stringify(parsed),
  });
  deps.hub.notifyThread(scope.threadId, ["tabs-changed"]);
}

export function removeDesktopBrowserTab(
  deps: Pick<WorkSessionDeps, "db" | "hub">,
  scope: ExperimentalDesktopBrowserScope,
  tabId: string,
) {
  const { stored, tabs } = readStoredTabs(deps.db, scope.threadId);
  if (!stored) return;
  const filtered = tabs.filter(
    (tab) => !(tab.id === tabId && sameDesktopTarget(tab, scope)),
  );
  if (filtered.length === tabs.length) return;
  replaceStoredThreadTabs(deps.db, {
    threadId: scope.threadId,
    expectedRevision: stored.revision,
    tabsJson: JSON.stringify(filtered),
  });
  deps.hub.notifyThread(scope.threadId, ["tabs-changed"]);
}

export async function listDesktopBrowserInstances(
  deps: WorkSessionDeps,
  hostId: string,
) {
  requireNonDestroyedHostWithStatus(deps, hostId);
  const result = await callHostOnlineRpc(deps, {
    hostId,
    timeoutMs: 10000,
    command: { type: "desktop.browser.list_instances" },
  });
  return {
    instances: result.instances.map((instance) => ({ ...instance, hostId })),
  };
}

export async function listDesktopBrowserTabs(
  deps: WorkSessionDeps,
  scope: ExperimentalDesktopBrowserScope,
) {
  authorize(deps, scope);
  const result = await callHostOnlineRpc(deps, {
    hostId: scope.hostId,
    timeoutMs: 10000,
    command: { type: "desktop.browser.list_tabs", ...scopeCommand(scope) },
  });
  assertTabsInThread(result.tabs, scope.threadId);
  return result;
}

export async function createDesktopBrowserTab(
  deps: WorkSessionDeps,
  input: ExperimentalDesktopBrowserCreateRequest,
) {
  authorize(deps, input);
  const result = await callHostOnlineRpcForWork(deps, {
    hostId: input.hostId,
    timeoutMs: 15000,
    command: {
      type: "desktop.browser.create_tab",
      ...scopeCommand(input),
      tabId: randomUUID(),
      url: input.url,
      presentation: input.presentation,
      profile: { kind: "automation", id: randomUUID() },
    },
  });
  try {
    persistDesktopBrowserTab(deps, input, result.tab);
  } catch (error) {
    await desktopBrowserTabAction(
      deps,
      { ...input, tabId: result.tab.tabId },
      "close",
    ).catch(() => {});
    throw error;
  }
  return result;
}

export async function releaseDesktopBrowserControl(
  deps: WorkSessionDeps,
  input: ExperimentalDesktopBrowserLeaseRequest,
) {
  const entry = registry(deps).get(input.leaseId);
  if (!entry) return { ok: true as const };
  if (!sameScope(entry.lease, input))
    throw new ApiError(
      403,
      "desktop_control_scope",
      "Browser control belongs to a different desktop/thread",
    );
  entry.active = false;
  clearTimeout(entry.timer);
  registry(deps).delete(input.leaseId);
  await sendReleaseControl(
    callHostOnlineRpcForWork,
    deps,
    input,
    input.leaseId,
  );
  return { ok: true as const };
}

async function releaseExpiredDesktopBrowserControl(
  deps: WorkSessionDeps,
  input: ExperimentalDesktopBrowserLeaseRequest,
) {
  const entry = registry(deps).get(input.leaseId);
  if (!entry || !sameScope(entry.lease, input)) return;
  entry.active = false;
  registry(deps).delete(input.leaseId);
  await sendReleaseControl(callHostOnlineRpc, deps, input, input.leaseId);
}

export async function acquireDesktopBrowserControl(
  deps: WorkSessionDeps,
  input: ExperimentalDesktopBrowserAcquireRequest,
) {
  authorize(deps, input);
  const lease: ExperimentalDesktopBrowserLease = {
    hostId: input.hostId,
    ...scopeCommand(input),
    leaseId: randomUUID(),
    tabIds: input.tabIds,
    controllerLabel: input.controllerLabel,
    expiresAt: Date.now() + input.ttlMs,
  };
  const timer = setTimeout(() => {
    void releaseExpiredDesktopBrowserControl(deps, lease).catch(() => {});
  }, input.ttlMs);
  timer.unref();
  const entry: LeaseEntry = { lease, timer, active: true };
  registry(deps).set(lease.leaseId, entry);
  try {
    const { tabs } = await callHostOnlineRpcForWork(deps, {
      hostId: input.hostId,
      timeoutMs: 10000,
      command: {
        type: "desktop.browser.list_tabs",
        ...scopeCommand(input),
      },
    });
    assertTabsInThread(tabs, input.threadId);
    const selected = input.tabIds.map((id) =>
      tabs.find((tab) => tab.tabId === id),
    );
    if (selected.some((tab) => !tab || tab.threadId !== input.threadId))
      throw new ApiError(
        403,
        "desktop_tab_scope",
        "A requested tab does not belong to this thread",
      );
    if (
      !input.allowPersonal &&
      selected.some((tab) => tab?.profile.kind === "personal")
    )
      throw new ApiError(
        403,
        "desktop_personal_handoff_required",
        "Controlling a personal tab requires an explicit handoff",
      );
    if (!entry.active)
      throw new ApiError(
        409,
        "desktop_control_expired",
        "Browser control was cancelled while checking tabs",
      );
    await callHostOnlineRpcForWork(deps, {
      hostId: input.hostId,
      timeoutMs: 10000,
      command: {
        type: "desktop.browser.acquire_control",
        ...scopeCommand(input),
        leaseId: lease.leaseId,
        tabIds: lease.tabIds,
        controllerLabel: lease.controllerLabel,
        expiresAt: lease.expiresAt,
      },
    });
    if (!entry.active || lease.expiresAt <= Date.now()) {
      await sendReleaseControl(
        callHostOnlineRpcForWork,
        deps,
        input,
        lease.leaseId,
      );
      throw new ApiError(
        409,
        "desktop_control_expired",
        "Browser control was cancelled while connecting",
      );
    }
    try {
      await desktopBrowserTabAction(
        deps,
        { ...input, tabId: input.tabIds[0]! },
        "reveal",
      );
      if (!entry.active || lease.expiresAt <= Date.now())
        throw new ApiError(
          409,
          "desktop_control_expired",
          "Browser control was cancelled while revealing the tab",
        );
    } catch (error) {
      await releaseDesktopBrowserControl(deps, lease).catch(() => {});
      throw error;
    }
    return lease;
  } catch (error) {
    entry.active = false;
    clearTimeout(timer);
    registry(deps).delete(lease.leaseId);
    throw error;
  }
}

export async function openDesktopBrowserConnection(
  deps: WorkSessionDeps,
  input: ExperimentalDesktopBrowserLeaseRequest,
) {
  const entry = requireLease(deps, input);
  const result = await callHostOnlineRpcForWork(deps, {
    hostId: input.hostId,
    timeoutMs: 10000,
    command: {
      type: "desktop.browser.open_connection",
      ...scopeCommand(input),
      leaseId: input.leaseId,
      tabIds: entry.lease.tabIds,
    },
  });
  requireLease(deps, input);
  return { ...result, hostId: input.hostId, expiresAt: entry.lease.expiresAt };
}

export async function desktopBrowserTabAction(
  deps: WorkSessionDeps,
  input: ExperimentalDesktopBrowserTabRequest,
  action: "reveal" | "close",
) {
  authorize(deps, input);
  const result = await callHostOnlineRpcForWork(deps, {
    hostId: input.hostId,
    timeoutMs: 10000,
    command: {
      type:
        action === "close"
          ? "desktop.browser.close_tab"
          : "desktop.browser.reveal_tab",
      ...scopeCommand(input),
      tabId: input.tabId,
    },
  });
  if (action === "close") removeDesktopBrowserTab(deps, input, input.tabId);
  return result;
}

export async function captureDesktopBrowserTab(
  deps: WorkSessionDeps,
  input: ExperimentalDesktopBrowserTabRequest,
) {
  authorize(deps, input);
  return callHostOnlineRpcForWork(deps, {
    hostId: input.hostId,
    timeoutMs: 15000,
    command: {
      type: "desktop.browser.capture_tab",
      ...scopeCommand(input),
      tabId: input.tabId,
    },
  });
}

export async function listDesktopBrowserImportSources(
  deps: WorkSessionDeps,
  input: ExperimentalDesktopBrowserInstanceRequest,
) {
  requireNonDestroyedHostWithStatus(deps, input.hostId);
  return callHostOnlineRpc(deps, {
    hostId: input.hostId,
    timeoutMs: 15000,
    command: {
      type: "desktop.browser.list_import_sources",
      instanceId: input.instanceId,
      generation: input.generation,
    },
  });
}

export async function importDesktopBrowserCookies(
  deps: WorkSessionDeps,
  input: ExperimentalDesktopBrowserImportCookiesRequest,
) {
  requireNonDestroyedHostWithStatus(deps, input.hostId);
  return callHostOnlineRpc(deps, {
    hostId: input.hostId,
    timeoutMs: 120000,
    command: {
      type: "desktop.browser.import_cookies",
      instanceId: input.instanceId,
      generation: input.generation,
      sourceId: input.sourceId,
      sourceProfileDirectory: input.sourceProfileDirectory,
      profile: input.profile,
    },
  });
}

export async function revokeThreadDesktopBrowserControl(
  deps: WorkSessionDeps,
  threadId: string,
) {
  const leases = [...registry(deps).values()].filter(
    (entry) => entry.lease.threadId === threadId,
  );
  await Promise.allSettled(
    leases.map((entry) => releaseDesktopBrowserControl(deps, entry.lease)),
  );
}

export function syncDesktopBrowserTabs(
  deps: Pick<WorkSessionDeps, "db" | "hub">,
  scope: ExperimentalDesktopBrowserScope,
  nativeTabs: DesktopBrowserTab[],
) {
  requirePublicThread(deps.db, scope.threadId);
  const { stored, tabs } = readStoredTabs(deps.db, scope.threadId);
  const ids = new Set(nativeTabs.map((tab) => tab.tabId));
  const next = tabs.filter(
    (tab) => !(sameDesktopTarget(tab, scope) && !ids.has(tab.id)),
  );
  for (const tab of nativeTabs) {
    if (tab.threadId !== scope.threadId || tab.url.length > 4096) continue;
    const index = next.findIndex((value) => value.id === tab.tabId);
    const previous = next[index];
    if (
      previous &&
      (previous.kind !== "browser" ||
        (previous.desktopTarget &&
          (previous.desktopTarget.hostId !== scope.hostId ||
            previous.desktopTarget.instanceId !== scope.instanceId)))
    )
      continue;
    const value = toStoredBrowserTab(scope, tab);
    if (index === -1) next.push(value);
    else next[index] = value;
  }
  const tabsJson = JSON.stringify(threadTabsSchema.parse(next));
  if (tabsJson !== JSON.stringify(tabs)) {
    replaceStoredThreadTabs(deps.db, {
      threadId: scope.threadId,
      expectedRevision: stored?.revision ?? 0,
      tabsJson,
    });
    deps.hub.notifyThread(scope.threadId, ["tabs-changed"]);
  }
}
