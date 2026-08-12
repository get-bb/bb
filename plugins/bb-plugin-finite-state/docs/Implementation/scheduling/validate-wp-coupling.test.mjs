import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluatePromotion,
  readManifest,
  validateManifest,
} from "./validate-wp-coupling.mjs";

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

test("promotion remains closed until WP10-WP13 and capacity gates pass", () => {
  const result = evaluatePromotion(
    manifestCopy(),
    {
      completedWorkPackages: ["WP01", "WP07"],
      activeWorkPackages: [],
      currentLaneCap: 4,
      workflowConcurrency: 4,
    },
    6,
  );
  assert.equal(result.eligible, false);
  assert(
    result.errors.some((error) => error.includes("WP10 must be complete")),
  );
  assert(
    result.errors.some((error) =>
      error.includes("workflow concurrency must be at least 6"),
    ),
  );
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
      workflowConcurrency: 6,
    },
    6,
  );
  assert.equal(six.eligible, true, six.errors.join("\n"));

  const nine = evaluatePromotion(
    manifest,
    {
      completedWorkPackages,
      activeWorkPackages: [],
      currentLaneCap: 6,
      workflowConcurrency: 9,
      freeAfterProvisionGiB: 45,
      runtimeFloorGiB: 35,
    },
    9,
  );
  assert.equal(nine.eligible, true, nine.errors.join("\n"));
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
