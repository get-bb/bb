# Pull requests on a row

The bundled GitHub PR Status plugin
(`bb--github-pr-status`) owns pull request data. Copy the part of its contract you
read; `bb plugin rpc inspect bb--github-pr-status pullRequests` prints the full
schema. Each key is an environment id and each row is `available` with a
`pullRequest`, `absent`, or `unavailable` (the machine is offline or `gh`
failed). Treat a query error, `absent` and `unavailable` as nothing to show.
While a row is on screen the plugin re-checks it and refreshes it only when it
changes.

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
GitHub PR Status is disabled. To migrate, read `pullRequests` as above with
`thread.environment?.id` in place of the thread id. Fields map as follows:
`number`, `title`, `url`, `state` and `attention` keep their names;
`experimental_autoMerge` is `autoMerge`, `experimental_inMergeQueue` is
`inMergeQueue`, and `experimental_checks`, `experimental_review` and
`experimental_mergeability` are `checks`, `review` and `mergeability`, which
also carry counts and GitHub's raw merge state. `isLoading` is
`data?.[environmentId] === undefined` while the query has no error.
