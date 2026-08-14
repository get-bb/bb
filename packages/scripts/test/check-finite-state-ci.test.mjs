import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

import { classifyCiScope } from "../../../.github/scripts/classify-finite-state-ci.mjs";

const workflowUrl = new URL(
  "../../../.github/workflows/ci.yml",
  import.meta.url,
);
const pluginPackageUrl = new URL(
  "../../../plugins/bb-plugin-finite-state/package.json",
  import.meta.url,
);

test("classifies plugin-only, mixed, and non-plugin pull requests", () => {
  assert.deepEqual(
    classifyCiScope({
      eventName: "pull_request",
      ref: "refs/pull/92/merge",
      changedFiles: ["plugins/bb-plugin-finite-state/app.tsx"],
    }),
    { runHeavy: false },
  );
  assert.deepEqual(
    classifyCiScope({
      eventName: "pull_request",
      ref: "refs/pull/92/merge",
      changedFiles: [
        "plugins/bb-plugin-finite-state/app.tsx",
        "apps/server/src/index.ts",
      ],
    }),
    { runHeavy: true },
  );
  assert.deepEqual(
    classifyCiScope({
      eventName: "pull_request",
      ref: "refs/pull/92/merge",
      changedFiles: ["apps/server/src/index.ts"],
    }),
    { runHeavy: true },
  );
});

test("classifies integration pushes, main pushes, and manual dispatch", () => {
  assert.deepEqual(
    classifyCiScope({
      eventName: "push",
      ref: "refs/heads/finite-state/integration",
      changedFiles: ["plugins/bb-plugin-finite-state/app.tsx"],
    }),
    { runHeavy: false },
  );
  assert.deepEqual(
    classifyCiScope({
      eventName: "push",
      ref: "refs/heads/finite-state/integration",
      changedFiles: ["README.md"],
    }),
    { runHeavy: true },
  );
  assert.deepEqual(
    classifyCiScope({
      eventName: "push",
      ref: "refs/heads/main",
      changedFiles: ["README.md"],
    }),
    { runHeavy: true },
  );
  assert.deepEqual(
    classifyCiScope({
      eventName: "push",
      ref: "refs/heads/main",
      changedFiles: ["plugins/bb-plugin-finite-state/app.tsx"],
    }),
    { runHeavy: false },
  );
  assert.deepEqual(
    classifyCiScope({
      eventName: "workflow_dispatch",
      ref: "refs/heads/main",
      changedFiles: [],
    }),
    { runHeavy: true },
  );
});

test("keeps the stable check shape and excludes the plugin from the packages shard once", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  assert.match(workflow, /^\s+- finite-state\/integration$/mu);
  assert.match(
    workflow,
    /name: Finite State guard gates \(ubuntu-latest, Node 22\.19\.0\)/u,
  );
  assert.match(workflow, /base: \$\{\{ github\.ref \}\}/u);
  assert.match(
    workflow,
    /id: changed\n\s+if: github\.event_name != 'workflow_dispatch'/u,
  );
  assert.match(
    workflow,
    /CI_CHANGED_FILES_JSON: \$\{\{ steps\.changed\.outputs\.all_files \|\| '\[\]' \}\}/u,
  );
  assert.equal(
    workflow.match(/--filter='!bb-plugin-finite-state'/gu)?.length,
    1,
  );
  assert.equal(
    workflow.match(/needs\.changes\.outputs\.run_heavy == 'true'/gu)?.length,
    4,
  );
  assert.doesNotMatch(
    workflow,
    /run_finite_state|Report unchanged Finite State inputs/u,
  );
  const finiteStateJob =
    /\n  finite-state-guards:\n(?<job>[\s\S]*?)\n  tests:/u.exec(workflow)
      ?.groups?.job;
  assert.ok(finiteStateJob);
  assert.match(finiteStateJob, /fetch-depth: 0/u);
  assert.match(
    finiteStateJob,
    /FINITE_STATE_PR_BASE_REF: origin\/\$\{\{ github\.base_ref \}\}[\s\S]*check-changed-formatting\.mjs "\$FINITE_STATE_PR_BASE_REF"/u,
  );
  assert.doesNotMatch(finiteStateJob, /\n    needs:|needs\.changes|run_heavy/u);
});

test("plugin-local pretest repairs native modules without Turbo recursion", async () => {
  const manifest = JSON.parse(await readFile(pluginPackageUrl, "utf8"));
  assert.equal(
    manifest.scripts.pretest,
    "node ../../scripts/ensure-native-modules.mjs",
  );
  assert.doesNotMatch(manifest.scripts.test, /turbo|ensure-native-modules/u);
});
