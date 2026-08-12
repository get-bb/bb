import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  evaluatePromotion,
  readManifest,
  validateManifest,
} from "./validate-wp-coupling.mjs";

const taskDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../tasks",
);

function manifestCopy() {
  return structuredClone(readManifest());
}

function errorsFor(mutator) {
  const manifest = manifestCopy();
  mutator(manifest);
  return validateManifest(manifest);
}

test("the checked-in manifest is valid", () => {
  assert.deepEqual(validateManifest(manifestCopy()), []);
});

test("missing and duplicate work packages are rejected", () => {
  const missing = errorsFor((manifest) => {
    manifest.workPackages = manifest.workPackages.filter(
      (entry) => entry.wp !== "WP02",
    );
  });
  assert(
    missing.some((error) => error.includes("workPackages is missing WP02")),
  );

  const duplicate = errorsFor((manifest) => {
    manifest.workPackages.push(structuredClone(manifest.workPackages[0]));
  });
  assert(
    duplicate.some((error) =>
      error.includes("workPackages contains duplicates: WP02"),
    ),
  );
});

test("a sequential cluster cannot expose two concurrently-ready members", () => {
  const errors = errorsFor((manifest) => {
    const wp20 = manifest.workPackages.find((entry) => entry.wp === "WP20");
    wp20.dependencies = wp20.dependencies.filter(
      (dependency) => dependency !== "WP19",
    );
  });
  assert(
    errors.some((error) =>
      error.includes("could make WP19 and WP20 concurrently ready"),
    ),
  );
});

test("missing dependency targets and dependency cycles are rejected", () => {
  const missingTarget = errorsFor((manifest) => {
    manifest.workPackages
      .find((entry) => entry.wp === "WP15")
      .dependencies.push("WP99");
  });
  assert(
    missingTarget.some((error) =>
      error.includes("depends on missing target WP99"),
    ),
  );

  const cycle = errorsFor((manifest) => {
    manifest.workPackages
      .find((entry) => entry.wp === "WP15")
      .dependencies.push("WP21");
  });
  assert(cycle.some((error) => error.includes("dependency cycle")));
});

test("L2 sync and the L4 canvas cannot use the standard model tier", () => {
  const l2Errors = errorsFor((manifest) => {
    manifest.workPackages.find((entry) => entry.wp === "WP15").preset =
      "fs-standard";
  });
  assert(
    l2Errors.some((error) => error.includes("WP15 in L2 must use fs-critical")),
  );

  const canvasErrors = errorsFor((manifest) => {
    manifest.workPackages.find((entry) => entry.wp === "WP31").preset =
      "fs-standard";
  });
  assert(
    canvasErrors.some((error) =>
      error.includes("WP31 in L4-canvas must use fs-critical"),
    ),
  );
});

test("removed gate fields and unused merged execution are rejected", () => {
  const definitionErrors = errorsFor((manifest) => {
    manifest.gateDefinitions = {};
  });
  assert(
    definitionErrors.some((error) =>
      error.includes("manifest must not define gateDefinitions"),
    ),
  );

  const gateErrors = errorsFor((manifest) => {
    manifest.workPackages.find((entry) => entry.wp === "WP65").gate = "G7";
  });
  assert(
    gateErrors.some((error) => error.includes("WP65 must not define gate")),
  );

  const modeErrors = errorsFor((manifest) => {
    manifest.workPackages.find((entry) => entry.wp === "WP65").executionMode =
      "merged";
  });
  assert(
    modeErrors.some((error) =>
      error.includes("WP65.executionMode must be sequential"),
    ),
  );
});

test("WP56 retains its authoritative L6 product lane", () => {
  const errors = errorsFor((manifest) => {
    manifest.workPackages.find((entry) => entry.wp === "WP56").lane = "L5";
  });
  assert(
    errors.some((error) =>
      error.includes("WP56 must retain its authoritative L6 product lane"),
    ),
  );
});

function explicitWpDependencies(markdown) {
  const header = markdown
    .split("\n")
    .find((line) => line.includes("**Depends on:**"));
  assert(header, "WP document is missing its Depends on header");
  const dependsOn = header
    .slice(header.indexOf("**Depends on:**"))
    .split("· **Blocks:**")[0];
  const dependencies = new Set();
  const pattern = /WP-(\d{2})(?:\s*[–-]\s*(?:WP-)?(\d{2}))?/g;
  for (const match of dependsOn.matchAll(pattern)) {
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    for (let number = start; number <= end; number += 1) {
      dependencies.add(`WP${String(number).padStart(2, "0")}`);
    }
  }
  return [...dependencies];
}

test("manifest dependencies are a superset of range-expanded WP headers", () => {
  const manifest = manifestCopy();
  const taskFiles = readdirSync(taskDirectory);
  for (const entry of manifest.workPackages) {
    const prefix = `WP-${entry.wp.slice(2)} `;
    const filename = taskFiles.find((candidate) =>
      candidate.startsWith(prefix),
    );
    assert(filename, `missing document for ${entry.wp}`);
    const declared = explicitWpDependencies(
      readFileSync(path.join(taskDirectory, filename), "utf8"),
    );
    for (const dependency of declared) {
      assert(
        entry.dependencies.includes(dependency),
        `${entry.wp} manifest dependencies omit declared ${dependency}`,
      );
    }
  }
});

test("promotion is closed when disk headroom is insufficient at six lanes", () => {
  const result = evaluatePromotion(
    manifestCopy(),
    {
      completedWorkPackages: ["WP01", "WP07"],
      activeWorkPackages: [],
      currentLaneCap: 4,
      freeAfterProvisionGiB: 12,
      runtimeFloorGiB: 8,
    },
    6,
  );
  assert.equal(result.eligible, false);
  assert(
    result.errors.some((error) =>
      error.includes("free space after provisioning must be at least 35 GiB"),
    ),
  );
  assert(
    result.errors.some((error) =>
      error.includes("runtime free-space floor must be at least 30 GiB"),
    ),
  );
});

// Regression guard. Lane COUNT must not be gated on the mock chain: the DAG
// already makes mock-dependent packages wait for WP10-WP13, and gating the cap
// on them blocked lanes whose clusters have no mock dependency at all.
test("six-lane promotion does not require the mock chain to be complete", () => {
  const result = evaluatePromotion(
    manifestCopy(),
    {
      completedWorkPackages: ["WP01", "WP03", "WP04", "WP05", "WP06", "WP07"],
      activeWorkPackages: [],
      currentLaneCap: 4,
      freeAfterProvisionGiB: 52,
      runtimeFloorGiB: 40,
    },
    6,
  );
  assert.equal(result.eligible, true, result.errors.join("\n"));
  assert(
    !result.errors.some((error) => /WP1[0-3] must be complete/u.test(error)),
    "lane promotion must not depend on the mock chain",
  );
});

// The saved-workflow factory was removed on 2026-08-12 and orchestration is
// manual, so a workflow-concurrency requirement is permanently unsatisfiable.
test("promotion carries no workflow-concurrency requirement", () => {
  const manifest = manifestCopy();
  for (const key of ["sixLanePromotion", "nineLanePromotion"]) {
    assert.equal(
      Object.hasOwn(
        manifest.dispatchPolicy[key],
        "requiredWorkflowConcurrency",
      ),
      false,
      `${key} must not require workflow concurrency`,
    );
  }
});

test("malformed promotion policies return structured errors", () => {
  for (const malformed of [undefined, null, "nine lanes", []]) {
    const errors = errorsFor((manifest) => {
      manifest.dispatchPolicy.nineLanePromotion = malformed;
    });
    assert(
      errors.includes("nine-lane must be an object"),
      `expected a structured error for ${String(malformed)}`,
    );
  }

  const errors = errorsFor((manifest) => {
    manifest.dispatchPolicy.sixLanePromotion.requiredCompletedWorkPackages =
      "WP10";
    manifest.dispatchPolicy.sixLanePromotion.requiredWorkflowConcurrency = 6;
  });
  assert(
    errors.includes("six-lane.requiredCompletedWorkPackages must be an array"),
  );
  assert(
    errors.includes(
      "six-lane contains unexpected field requiredWorkflowConcurrency",
    ),
  );
});

test("manifest pins both promotion disk floors", () => {
  const errors = errorsFor((manifest) => {
    manifest.dispatchPolicy.sixLanePromotion.minimumFreeAfterProvisionGiB = 30;
    manifest.dispatchPolicy.sixLanePromotion.minimumRuntimeFloorGiB = 25;
    manifest.dispatchPolicy.nineLanePromotion.minimumFreeAfterProvisionGiB = 40;
    manifest.dispatchPolicy.nineLanePromotion.minimumRuntimeFloorGiB = 30;
  });
  for (const expected of [
    "six-lane post-provision free-space floor must be 35 GiB",
    "six-lane runtime free-space floor must be 30 GiB",
    "nine-lane post-provision free-space floor must be 45 GiB",
    "nine-lane runtime free-space floor must be 35 GiB",
  ]) {
    assert(errors.includes(expected), expected);
  }
});

test("manifest pins pruning and independent lane-count policy", () => {
  const errors = errorsFor((manifest) => {
    manifest.dispatchPolicy.sixLanePromotion.requiredIndependentDecisionClusters = 5;
    manifest.dispatchPolicy.nineLanePromotion.requiredIndependentDecisionClusters = 8;
    manifest.dispatchPolicy.nineLanePromotion.requiresCompletedManagedWorktreePruning = false;
  });
  for (const expected of [
    "six-lane.requiredIndependentDecisionClusters must be 6",
    "nine-lane.requiredIndependentDecisionClusters must be 9",
    "nine-lane promotion must require completed managed-worktree pruning",
  ]) {
    assert(errors.includes(expected), expected);
  }
});

test("promotion policy cannot regain a mock-chain dependency", () => {
  const errors = errorsFor((manifest) => {
    manifest.dispatchPolicy.sixLanePromotion.requiredCompletedWorkPackages = [
      "WP10",
    ];
  });
  assert(
    errors.includes("six-lane.requiredCompletedWorkPackages must remain empty"),
  );
});

test("temporary stops require paired reasons and resume conditions", () => {
  const missingReason = errorsFor((manifest) => {
    delete manifest.dispatchPolicy.stoppedWorkPackageReasons.WP32;
  });
  assert(missingReason.includes("stopped reason for WP32 must be an object"));

  const missingResume = errorsFor((manifest) => {
    manifest.dispatchPolicy.stoppedWorkPackageReasons.WP56.resumeCondition = "";
  });
  assert(
    missingResume.includes(
      "stopped reason for WP56 must include a non-empty resumeCondition",
    ),
  );

  const orphanedReason = errorsFor((manifest) => {
    manifest.dispatchPolicy.stoppedWorkPackages = ["WP56"];
  });
  assert(
    orphanedReason.includes(
      "stopped reason for WP32 has no stoppedWorkPackages entry",
    ),
  );

  const unpairedReintroduction = errorsFor((manifest) => {
    manifest.dispatchPolicy.stoppedWorkPackages.push("WP33");
  });
  assert(
    unpairedReintroduction.includes(
      "stopped reason for WP33 must be an object",
    ),
  );
});

test("prohibitions require paired non-empty reasons", () => {
  const missingReason = errorsFor((manifest) => {
    delete manifest.dispatchPolicy.prohibitedWorkPackageReasons.WP02;
  });
  assert(
    missingReason.includes("prohibited reason for WP02 must be non-empty"),
  );

  const emptyReason = errorsFor((manifest) => {
    manifest.dispatchPolicy.prohibitedWorkPackageReasons.WP02 = "";
  });
  assert(emptyReason.includes("prohibited reason for WP02 must be non-empty"));

  const orphanedReason = errorsFor((manifest) => {
    manifest.dispatchPolicy.prohibitedWorkPackages = [];
  });
  assert(
    orphanedReason.includes(
      "prohibited reason for WP02 has no prohibitedWorkPackages entry",
    ),
  );
});

test("malformed work-package policy lists return structured errors", () => {
  for (const malformed of [5, true, { WP02: true }]) {
    const prohibitedErrors = errorsFor((manifest) => {
      manifest.dispatchPolicy.prohibitedWorkPackages = malformed;
    });
    assert.deepEqual(prohibitedErrors, [
      "dispatchPolicy.prohibitedWorkPackages must be an array",
    ]);

    const stoppedErrors = errorsFor((manifest) => {
      manifest.dispatchPolicy.stoppedWorkPackages = malformed;
    });
    assert.deepEqual(stoppedErrors, [
      "dispatchPolicy.stoppedWorkPackages must be an array",
    ]);
  }
});

test("promotion excludes prohibited and stopped next work packages", () => {
  const result = evaluatePromotion(
    manifestCopy(),
    {
      completedWorkPackages: [
        "WP01",
        "WP03",
        "WP04",
        "WP05",
        "WP06",
        "WP07",
        "WP09",
        "WP10",
        "WP14",
        "WP31",
        "WP47",
        "WP52",
        "WP57",
      ],
      activeWorkPackages: ["WP08", "WP15", "WP36", "WP48"],
      currentLaneCap: 4,
      freeAfterProvisionGiB: 35,
      runtimeFloorGiB: 30,
    },
    6,
  );

  assert.equal(result.eligible, false);
  assert.deepEqual(result.readyClusters, []);
  assert.deepEqual(result.activeClusters, [
    "C-EARS-AUTHORING",
    "C-FIRMWARE-MATERIALIZATION",
    "C-FIXTURE-CORPUS",
    "C-SYNC-TRANSACTION",
  ]);
  assert(
    result.errors.includes(
      "only 4 independent active-or-ready decision clusters are available; 6 required",
    ),
  );
  for (const blockedCluster of [
    "C-DISTRIBUTION",
    "C-CANVAS",
    "C-DOCUMENT-PROVENANCE",
  ]) {
    assert(!result.readyClusters.includes(blockedCluster));
  }
});

test("six- and nine-lane promotion require independent dependency-ready clusters", () => {
  const completedWorkPackages = Array.from(
    { length: 14 },
    (_, index) => `WP${String(index + 1).padStart(2, "0")}`,
  );
  const manifest = manifestCopy();

  const six = evaluatePromotion(
    manifest,
    {
      completedWorkPackages,
      activeWorkPackages: [],
      currentLaneCap: 4,
      freeAfterProvisionGiB: 35,
      runtimeFloorGiB: 30,
    },
    6,
  );
  assert.equal(six.eligible, true, six.errors.join("\n"));

  const nine = evaluatePromotion(
    manifest,
    {
      completedWorkPackages,
      activeWorkPackages: ["WP24"],
      currentLaneCap: 6,
      freeAfterProvisionGiB: 45,
      runtimeFloorGiB: 35,
      managedWorktreePruningComplete: true,
    },
    9,
  );
  assert.equal(nine.eligible, true, nine.errors.join("\n"));
});

test("nine-lane promotion requires completed managed-worktree pruning", () => {
  const completedWorkPackages = Array.from(
    { length: 14 },
    (_, index) => `WP${String(index + 1).padStart(2, "0")}`,
  );
  const result = evaluatePromotion(
    manifestCopy(),
    {
      completedWorkPackages,
      activeWorkPackages: [],
      currentLaneCap: 6,
      freeAfterProvisionGiB: 45,
      runtimeFloorGiB: 35,
      managedWorktreePruningComplete: false,
    },
    9,
  );
  assert.equal(result.eligible, false);
  assert(
    result.errors.includes(
      "managed-worktree pruning and free-space recovery must be complete before promotion to nine lanes",
    ),
  );
});

test("runtime readiness rejects concurrent active members of a sequential cluster", () => {
  const result = evaluatePromotion(
    manifestCopy(),
    {
      completedWorkPackages: [],
      activeWorkPackages: ["WP15", "WP16"],
      currentLaneCap: 4,
      workflowConcurrency: 6,
    },
    6,
  );
  assert(
    result.errors.some((error) =>
      error.includes("C-SYNC-TRANSACTION has concurrent active members"),
    ),
  );
});
