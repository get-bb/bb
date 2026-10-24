# Reading git status and diffs

The bundled Git plugin (`bb--git`) owns an environment's git status, changed
files, diffs and branch lists. Copy the part of its contract you read;
`bb plugin rpc inspect bb--git` prints every method's schema. Reads run git on
the environment's machine and never wake a sleeping one.

- `status` is a keyed read: pass environment ids as `keys` and get one row per
  id, `available` with a `workspace`, `not_applicable` for a non-git
  environment, `unavailable` with a `failure`, or `failed` with a `message`.
  Rows compare against the environment's merge base and refresh after its
  files or refs change.
- `workspaceStatus({ environmentId, mergeBaseBranch? })` reads one status,
  comparing against the branch you name.
- `diff({ environmentId, target })`, `files({ environmentId, target,
  ignoreWhitespace })` and `branches({ environmentId, query?, limit? })` read
  a full diff, the changed-file list with each file's revision, and branch
  options. `target` is `{ type: "uncommitted" }`, `{ type: "branch_committed"
  | "all", mergeBaseBranch }` or `{ type: "commit", sha }`.

```tsx
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { experimental_useRpcKeyedQuery } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

const git = defineRpcContract({
  status: {
    input: z.object({ keys: z.array(z.string()) }),
    output: z.record(
      z.string(),
      z.object({
        outcome: z.string(),
        workspace: z
          .object({
            workingTree: z.object({ fileCount: z.number() }),
            branch: z.object({ currentBranch: z.string().nullable() }),
          })
          .optional(),
      }),
    ),
  },
});

function useChangedFileCount(environmentId: string) {
  const { data } = experimental_useRpcKeyedQuery({
    pluginId: "bb--git",
    contract: git,
    method: "status",
    keys: [environmentId],
  });
  return data?.[environmentId]?.workspace?.workingTree.fileCount ?? null;
}
```

Server code calls the same methods with `bb.sdk.plugins.callRpc({ pluginId:
"bb--git", method, input, outputSchema })`.

## Migrating from `environments.status`, `diff`, `diffFiles`, `diffPatch`, `diffFile` and `diffBranches`

These `bb.sdk.environments` methods were removed from the SDK typings. Plugins
that still call them keep working: bb serves them through the Git plugin with
their old results, and the plugin build prints a warning naming the
replacement. They fail when the Git plugin is disabled. Replace `status` with
`workspaceStatus`, `diff` with `diff`, `diffFiles` with `files`, `diffPatch`
with the keyed `patches` read (keys come from `files`), `diffFile` with
`fileSide`, and `diffBranches` with `branches`.
