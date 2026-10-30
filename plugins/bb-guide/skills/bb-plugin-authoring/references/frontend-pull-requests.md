# Pull requests on a row

The bundled GitHub PR Status plugin
(`bb--github-pr-status`) owns pull request data and draws bb's pull request
badge on thread rows through the `experimental_threadRowMetadata` slot.

## Show bb's badge on your rows

A plugin-built thread list renders the same row metadata bb's sidebar draws by
placing `experimental_ThreadRowMetadata` on a line under each row's title. The
GitHub PR Status badge (the `#number` in the state's color,
a yellow dot while checks run or a red cross when they fail or the PR has
conflicts, and the title in the tooltip)
then appears on your rows, along with any other plugin's row metadata. It renders
nothing when no plugin contributes an item.

```tsx
import {
  ThreadTitle,
  experimental_ThreadRowMetadata as ThreadRowMetadata,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

function Row({ thread }: { thread: PluginSidebarThread }) {
  return (
    <a href={thread.href} className="flex min-w-0 flex-col">
      <span className="min-w-0 truncate">
        <ThreadTitle threadId={thread.id} />
      </span>
      <span className="flex min-w-0">
        <ThreadRowMetadata thread={thread} />
      </span>
    </a>
  );
}
```

The badge's `useData` loads every listed thread's pull request in one batched
request, whether its row is rendered or not, so rows have their final height
before they scroll into view. The plugin answers app reads from what it has,
so the badge never waits on GitHub; stale rows refresh in the background.
Clicks on an item reach your row's own handlers; forward
them to your row link if the row is not itself the link.

## Read the data yourself

For your own display, read the plugin's keyed method directly. Copy the part
of its contract you read; `bb plugin rpc inspect bb--github-pr-status
pullRequests` prints the full schema. Each key is an environment id and each
row is `available` with the current branch's `pullRequest`, `absent`, or
`unavailable` (the machine is offline or `gh` failed).
Treat a query error, `absent` and `unavailable` as nothing to show. While a
key is held by a mounted hook the plugin re-checks pending pull requests about
every 30 seconds and refreshes the row only when it changes.

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
badge, render `experimental_ThreadRowMetadata` in the row instead (see "Show bb's
badge on your rows"). To keep your own display, read `pullRequests`
as above with `thread.environment?.id` in place of the thread id. Fields map as follows:
`number`, `title`, `url`, `state` and `attention` keep their names;
`experimental_autoMerge` is `autoMerge`, `experimental_inMergeQueue` is
`inMergeQueue`, and `experimental_checks`, `experimental_review` and
`experimental_mergeability` are `checks`, `review` and `mergeability`, which
also carry counts and GitHub's raw merge state. `isLoading` is
`data?.[environmentId] === undefined` while the query has no error.
