# Pull requests on a row

The bundled GitHub PR Status plugin
(`bb--github-pr-status`) owns pull request data and draws bb's pull request
badge on thread rows through the `experimental_threadRowItem` slot.

## Show bb's badge on your rows

A plugin-built thread list renders the same row items bb's sidebar draws by
placing `experimental_ThreadRowItems` in each row's title area, after the
title. The GitHub PR Status badge (state icon plus a checks dot, number and
title in the tooltip) then appears on your rows, along with any other
plugin's row items. It renders nothing when no plugin contributes an item.

```tsx
import {
  ThreadTitle,
  experimental_ThreadRowItems as ThreadRowItems,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

function Row({ thread }: { thread: PluginSidebarThread }) {
  return (
    <a href={thread.href} className="flex min-w-0 items-center gap-1.5">
      <span className="min-w-0 flex-1 truncate">
        <ThreadTitle threadId={thread.id} />
      </span>
      <ThreadRowItems thread={thread} />
    </a>
  );
}
```

Items mount once the row is live, and with the row from then on once they have
drawn something, so cached badges draw at once. They read only once the row is
on screen at a scroll pause, so every row on screen shares one
batched request and rows scrolled past read nothing. The badge asks for saved
rows of any age (`maxAgeMs`), so it never waits on GitHub; saved rows refresh
in the background. Clicks on an item reach your row's own handlers; forward
them to your row link if the row is not itself the link.

## Read the data yourself

For your own display, read the plugin's keyed method directly. Copy the part
of its contract you read; `bb plugin rpc inspect bb--github-pr-status
pullRequests` prints the full schema. Each key is an environment id and each
row is `available` with the current branch's `pullRequest`, `absent`, or
`unavailable` (the machine is offline or `gh` failed).
Treat a query error, `absent` and `unavailable` as nothing to show. While a
key is held by a mounted hook the plugin re-checks pending pull requests about
every 30 seconds and refreshes the row only when it changes. Hold keys only for
rows on screen: register your own `experimental_threadRowItem` and pass
`enabled: isLive`, or gate the hook on your list's windowing.

```tsx
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { experimental_useRpcKeyedQuery } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

const githubPrStatus = defineRpcContract({
  pullRequests: {
    input: z.object({ keys: z.array(z.string()) }),
    output: z.record(
      z.string(),
      z.discriminatedUnion("outcome", [
        z.object({
          outcome: z.literal("available"),
          pullRequest: z.object({
            number: z.number(),
            title: z.string(),
            url: z.string(),
            state: z.enum(["draft", "open", "merged", "closed"]),
            attention: z.string(),
            checks: z.object({ state: z.string() }),
          }),
        }),
        z.object({ outcome: z.literal("absent") }),
        z.object({ outcome: z.literal("unavailable"), message: z.string() }),
      ]),
    ),
  },
});

function useRowPullRequest(thread: PluginSidebarThread) {
  const environmentId = thread.environment?.id;
  const { data } = experimental_useRpcKeyedQuery({
    pluginId: "bb--github-pr-status",
    contract: githubPrStatus,
    method: "pullRequests",
    keys: environmentId ? [environmentId] : [],
  });
  const row = environmentId ? data?.[environmentId] : undefined;
  return row?.outcome === "available" ? row.pullRequest : null;
}
```

In `renderSlot(...)` tests, answer the read with the `rpc` option:
`rpc: { pullRequests: ({ keys }) => ... }`.

## Migrating from `experimental_useSidebarThreadPullRequest`

The hook and its
`PluginSidebarPullRequest` and `PluginSidebarThreadPullRequestState` types were
removed from `@get-bb/plugin-sdk/app`'s typings, so TypeScript reports the
import. Plugins that still import it keep building and working: bb's plugin
build resolves the name to the app's runtime member, prints a warning that
names this replacement, and bb writes the same warning to the plugin's log
when it builds the plugin at install, update or SDK change. The runtime member
reads the same data and returns `{ isLoading: false, pullRequest: null }` when
GitHub PR Status is disabled. To migrate a row that drew its own pull request
badge, render `experimental_ThreadRowItems` in the row instead (see "Show bb's
badge on your rows"). To keep your own display, read `pullRequests`
as above with `thread.environment?.id` in place of the thread id. Fields map as follows:
`number`, `title`, `url`, `state` and `attention` keep their names;
`experimental_autoMerge` is `autoMerge`, `experimental_inMergeQueue` is
`inMergeQueue`, and `experimental_checks`, `experimental_review` and
`experimental_mergeability` are `checks`, `review` and `mergeability`, which
also carry counts and GitHub's raw merge state. `isLoading` is
`data?.[environmentId] === undefined` while the query has no error.
