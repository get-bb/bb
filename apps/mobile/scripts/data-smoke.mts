// Ad-hoc verification of the Phase 3 data layer against the mobile e2e backend.
// Run: cd apps/mobile && node --conditions=source --import tsx scripts/data-smoke.ts
import { createBrowserBbSdk } from "@bb/sdk/browser";
import { QueryClient } from "@tanstack/react-query";
import { buildCreateThreadRequest } from "../src/data/compose/create-thread-request";
import {
  buildReuseEnvironmentOptions,
  resolveEffectiveEnvironmentSelection,
} from "../src/data/compose/environment-selection";
import {
  buildPermissionModeOptions,
  resolveModelSelection,
} from "../src/data/compose/execution-options";
import { buildSidebarModel } from "../src/data/sidebar/sidebar-model";
import { selectRecentThreads } from "../src/data/sidebar/thread-search-query";
import { sidebarNavigationQueryKey } from "../src/lib/query/query-keys";
import {
  beginPinThreadTransaction,
  rollbackThreadListMutation,
} from "../src/data/threads/thread-state-cache";
import { findCachedThreadListEntry } from "../src/data/threads/thread-list-cache";

// Explicit: BB_SERVER_URL in this shell may point at a real server.
const baseUrl = process.env.MOBILE_E2E_SERVER_URL ?? "http://127.0.0.1:41999";
const sdk = createBrowserBbSdk({ baseUrl });

const bootstrap = await sdk.projects.sidebarBootstrap();
console.log("sidebar-bootstrap:", {
  sections: bootstrap.sections.length,
  projects: bootstrap.projects.map((p) => `${p.name}(${p.threads.length})`),
  personal: bootstrap.personalProject.threads.length,
  defaults: bootstrap.projects[0]?.defaultExecutionOptions,
});
const hosts = await sdk.hosts.list();
console.log(
  "hosts:",
  hosts.map((h) => `${h.name}:${h.status}:${h.maxPermissionMode}`),
);

for (const organize of ["project", "machine", "manual"] as const) {
  const model = buildSidebarModel({
    bootstrap,
    hosts,
    organize,
    sort: "updated",
  });
  console.log(
    `model[${organize}]:`,
    model.groups.map((g) => `${g.id}=${g.threads.length}`),
    "pinned:",
    model.pinned?.rootNodes.length ?? 0,
  );
}
console.log(
  "recent:",
  selectRecentThreads(
    bootstrap.projects.flatMap((p) => p.threads),
    5,
  ).map((t) => t.title),
);

const search = await sdk.threads.search({ query: "hello", limitPerGroup: "5" });
console.log("search:", {
  active: search.active.total,
  archived: search.archived.total,
});

const project = bootstrap.projects[0];
const options = await sdk.system.executionOptions({ hostId: hosts[0]?.id });
const resolved = resolveModelSelection({
  executionOptions: options,
  selectedModel: project.defaultExecutionOptions?.model,
  catalogVerified: options.modelLoadError === null,
});
console.log("execution-options:", {
  providers: options.providers.map((p) => p.id),
  ceiling: options.permissionCeiling,
  selectedModel: resolved.selectedModel,
  models: resolved.options.length,
  permission: buildPermissionModeOptions({
    permissionModes: options.providers[0]?.capabilities.permissionModes,
    ceiling: options.permissionCeiling,
  }).map((o) => `${o.value}${o.disabled ? "(x)" : ""}`),
});

const reuse = buildReuseEnvironmentOptions(project.threads);
const selection = resolveEffectiveEnvironmentSelection({
  selection: { type: "reuse", environmentId: reuse[0]?.environmentId ?? null },
  projectId: project.id,
  knownHostIds: new Set(hosts.map((h) => h.id)),
  projectSources: project.sources,
  reuseOptions: reuse,
  reuseOptionsLoading: false,
});
console.log("reuse options:", reuse.length, "effective selection:", selection);

const branches = await sdk.projects.branches({
  projectId: project.id,
  hostId: hosts[0].id,
  limit: "5",
});
console.log("branches:", branches.checkout, branches.defaultWorktreeBaseBranch);

const build = buildCreateThreadRequest({
  projectId: project.id,
  text: "Response to: smoke test from the mobile data layer",
  providerId: project.defaultExecutionOptions?.providerId,
  environment: { type: "project-default" },
  title: "data-smoke",
});
if (!build.request) throw new Error(`blocked: ${build.blocker}`);
const created = await sdk.threads.spawn({
  ...build.request,
  origin: "app",
  originKind: null,
  startedOnBehalfOf: null,
});
console.log("created:", created.id, created.title, created.environmentId);

// Optimistic pin against a real QueryClient seeded with the live bootstrap.
const queryClient = new QueryClient();
queryClient.setQueryData(
  sidebarNavigationQueryKey(),
  await sdk.projects.sidebarBootstrap(),
);
const tx = await beginPinThreadTransaction({
  queryClient,
  threadId: created.id,
  pinnedAt: 1,
});
console.log(
  "optimistic pinnedAt:",
  findCachedThreadListEntry(queryClient, created.id)?.pinnedAt,
);
rollbackThreadListMutation({ queryClient, threadId: created.id }, tx);
console.log(
  "rolled back pinnedAt:",
  findCachedThreadListEntry(queryClient, created.id)?.pinnedAt,
);

const pinned = await sdk.threads.pin({ threadId: created.id });
console.log("server pin:", pinned.pinnedAt !== null);
await sdk.threads.update({ threadId: created.id, title: "data-smoke renamed" });
await sdk.threads.markUnread({ threadId: created.id });
const summary = await sdk.threads.childSummary({ threadId: created.id });
console.log("child summary:", summary);
const section = await sdk.threadSections.create({
  name: `smoke-${Date.now()}`,
});
await sdk.threads.update({ threadId: created.id, sectionId: section.id });
const after = await sdk.projects.sidebarBootstrap();
const row = after.projects
  .flatMap((p) => p.threads)
  .find((t) => t.id === created.id);
console.log("after mutations:", {
  title: row?.title,
  pinned: row?.pinnedAt !== null,
  section: row?.sectionId === section.id,
  unread: row?.lastReadAt === null,
});
await sdk.threadSections.delete({ id: section.id });
const archived = await sdk.threads.archiveAll({ threadId: created.id });
console.log("archived:", archived.archivedThreadIds);
await sdk.threads.unarchive({ threadId: created.id });
await sdk.threads.delete({
  threadId: created.id,
  childThreadsConfirmed: false,
});
console.log("deleted:", created.id);
console.log("OK");
