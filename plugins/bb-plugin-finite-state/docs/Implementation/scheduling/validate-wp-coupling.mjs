#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const defaultManifestPath = path.join(here, "wp-coupling-manifest.json");

function requireObject(value, label, errors) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  return true;
}

function validatePromotionPolicy(policy, label, expected, knownSet, errors) {
  if (!requireObject(policy, label, errors)) return;

  const requiredFields = [
    "requiredCompletedWorkPackages",
    "requiredIndependentDecisionClusters",
    "minimumFreeAfterProvisionGiB",
    "minimumRuntimeFloorGiB",
    ...(expected.requiresCompletedManagedWorktreePruning
      ? ["requiresCompletedManagedWorktreePruning"]
      : []),
  ];
  const allowedFields = new Set(requiredFields);
  for (const field of requiredFields) {
    if (!(field in policy)) errors.push(`${label} is missing ${field}`);
  }
  for (const field of Object.keys(policy)) {
    if (!allowedFields.has(field))
      errors.push(`${label} contains unexpected field ${field}`);
  }

  if (!Array.isArray(policy.requiredCompletedWorkPackages)) {
    errors.push(`${label}.requiredCompletedWorkPackages must be an array`);
  } else {
    const repeated = duplicates(policy.requiredCompletedWorkPackages);
    if (repeated.length > 0) {
      errors.push(
        `${label}.requiredCompletedWorkPackages contains duplicates: ${repeated.join(", ")}`,
      );
    }
    for (const wp of policy.requiredCompletedWorkPackages) {
      if (typeof wp !== "string" || !knownSet.has(wp))
        errors.push(`${label} requires unknown work package ${String(wp)}`);
    }
    if (
      policy.requiredCompletedWorkPackages.length !==
        expected.requiredCompletedWorkPackages.length ||
      policy.requiredCompletedWorkPackages.some(
        (wp, index) => wp !== expected.requiredCompletedWorkPackages[index],
      )
    ) {
      errors.push(`${label}.requiredCompletedWorkPackages must remain empty`);
    }
  }

  if (
    policy.requiredIndependentDecisionClusters !==
    expected.requiredIndependentDecisionClusters
  ) {
    errors.push(
      `${label}.requiredIndependentDecisionClusters must be ${expected.requiredIndependentDecisionClusters}`,
    );
  }
  if (
    policy.minimumFreeAfterProvisionGiB !==
    expected.minimumFreeAfterProvisionGiB
  ) {
    errors.push(
      `${label} post-provision free-space floor must be ${expected.minimumFreeAfterProvisionGiB} GiB`,
    );
  }
  if (policy.minimumRuntimeFloorGiB !== expected.minimumRuntimeFloorGiB) {
    errors.push(
      `${label} runtime free-space floor must be ${expected.minimumRuntimeFloorGiB} GiB`,
    );
  }
  if (
    expected.requiresCompletedManagedWorktreePruning &&
    policy.requiresCompletedManagedWorktreePruning !== true
  ) {
    errors.push(
      `${label} promotion must require completed managed-worktree pruning`,
    );
  }
}

function validateProhibitedWorkPackages(dispatchPolicy, knownSet, errors) {
  const prohibited = dispatchPolicy.prohibitedWorkPackages;
  const reasons = dispatchPolicy.prohibitedWorkPackageReasons;
  if (!Array.isArray(prohibited)) {
    errors.push("dispatchPolicy.prohibitedWorkPackages must be an array");
    requireObject(
      reasons,
      "dispatchPolicy.prohibitedWorkPackageReasons",
      errors,
    );
    return;
  }
  const repeated = duplicates(prohibited);
  if (repeated.length > 0) {
    errors.push(
      `dispatchPolicy.prohibitedWorkPackages contains duplicates: ${repeated.join(", ")}`,
    );
  }
  if (
    !requireObject(
      reasons,
      "dispatchPolicy.prohibitedWorkPackageReasons",
      errors,
    )
  )
    return;
  for (const wp of prohibited) {
    if (!knownSet.has(wp))
      errors.push(
        `dispatchPolicy prohibits unknown work package ${String(wp)}`,
      );
    if (typeof reasons[wp] !== "string" || reasons[wp].trim() === "") {
      errors.push(`prohibited reason for ${wp} must be non-empty`);
    }
  }
  for (const wp of Object.keys(reasons)) {
    if (!prohibited.includes(wp)) {
      errors.push(
        `prohibited reason for ${wp} has no prohibitedWorkPackages entry`,
      );
    }
  }
}

function validateStoppedWorkPackages(dispatchPolicy, knownSet, errors) {
  const stopped = dispatchPolicy.stoppedWorkPackages;
  const reasons = dispatchPolicy.stoppedWorkPackageReasons;
  if (!Array.isArray(stopped)) {
    errors.push("dispatchPolicy.stoppedWorkPackages must be an array");
    requireObject(reasons, "dispatchPolicy.stoppedWorkPackageReasons", errors);
    return;
  }
  const repeated = duplicates(stopped);
  if (repeated.length > 0) {
    errors.push(
      `dispatchPolicy.stoppedWorkPackages contains duplicates: ${repeated.join(", ")}`,
    );
  }
  if (
    !requireObject(reasons, "dispatchPolicy.stoppedWorkPackageReasons", errors)
  )
    return;
  const prohibited = new Set(
    Array.isArray(dispatchPolicy.prohibitedWorkPackages)
      ? dispatchPolicy.prohibitedWorkPackages
      : [],
  );
  for (const wp of stopped) {
    if (!knownSet.has(wp))
      errors.push(`dispatchPolicy stops unknown work package ${String(wp)}`);
    if (prohibited.has(wp))
      errors.push(`${wp} cannot be both prohibited and temporarily stopped`);
    const detail = reasons[wp];
    if (!requireObject(detail, `stopped reason for ${wp}`, errors)) continue;
    if (typeof detail.reason !== "string" || detail.reason.trim() === "")
      errors.push(`stopped reason for ${wp} must include a non-empty reason`);
    if (
      typeof detail.resumeCondition !== "string" ||
      detail.resumeCondition.trim() === ""
    ) {
      errors.push(
        `stopped reason for ${wp} must include a non-empty resumeCondition`,
      );
    }
  }
  for (const wp of Object.keys(reasons)) {
    if (!stopped.includes(wp))
      errors.push(`stopped reason for ${wp} has no stoppedWorkPackages entry`);
  }
}

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}

// WP01-WP70 are the FS-93 audit universe (WP01-WP07 minus WP02 had already
// started). WP71-WP98 are the SPEC 07/08 intake adopted 2026-08-12; all were
// unstarted at adoption, so the whole range is remaining.
const TOTAL_WORK_PACKAGES = 98;

function expectedRemainingWorkPackages() {
  const expected = ["WP02"];
  for (let number = 8; number <= TOTAL_WORK_PACKAGES; number += 1) {
    expected.push(`WP${String(number).padStart(2, "0")}`);
  }
  return expected;
}

function hasDirectedCycle(nodes, dependencyMap) {
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function visit(node) {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      return [...stack.slice(start), node];
    }
    if (visited.has(node)) return null;

    visiting.add(node);
    stack.push(node);
    for (const dependency of dependencyMap.get(node) ?? []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  }

  for (const node of nodes) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

export function readManifest(manifestPath = defaultManifestPath) {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

export function validateManifest(manifest) {
  const errors = [];
  if (!requireObject(manifest, "manifest", errors)) return errors;
  if (!requireObject(manifest.scope, "scope", errors)) return errors;
  if (!requireObject(manifest.presets, "presets", errors)) return errors;
  if (!requireObject(manifest.dispatchPolicy, "dispatchPolicy", errors))
    return errors;
  if ("gateDefinitions" in manifest)
    errors.push("manifest must not define gateDefinitions");

  const known = Array.isArray(manifest.scope.knownWorkPackages)
    ? manifest.scope.knownWorkPackages
    : [];
  const declaredRemaining = Array.isArray(manifest.scope.remainingUnstarted)
    ? manifest.scope.remainingUnstarted
    : [];
  const workPackages = Array.isArray(manifest.workPackages)
    ? manifest.workPackages
    : [];
  const expectedRemaining = expectedRemainingWorkPackages();
  const expectedSet = new Set(expectedRemaining);
  const knownSet = new Set(known);

  for (const [label, values] of [
    ["scope.knownWorkPackages", known],
    ["scope.remainingUnstarted", declaredRemaining],
    [
      "workPackages",
      workPackages.map((entry) =>
        entry !== null && typeof entry === "object" && !Array.isArray(entry)
          ? entry.wp
          : undefined,
      ),
    ],
  ]) {
    const repeated = duplicates(values);
    if (repeated.length > 0)
      errors.push(`${label} contains duplicates: ${repeated.join(", ")}`);
  }

  const declaredSet = new Set(declaredRemaining);
  const entrySet = new Set(
    workPackages.flatMap((entry) =>
      entry !== null && typeof entry === "object" && !Array.isArray(entry)
        ? [entry.wp]
        : [],
    ),
  );
  for (const wp of expectedRemaining) {
    if (!declaredSet.has(wp))
      errors.push(`scope.remainingUnstarted is missing ${wp}`);
    if (!entrySet.has(wp)) errors.push(`workPackages is missing ${wp}`);
  }
  for (const wp of declaredSet) {
    if (!expectedSet.has(wp))
      errors.push(`scope.remainingUnstarted contains unexpected ${wp}`);
  }
  for (const wp of entrySet) {
    if (!expectedSet.has(wp))
      errors.push(`workPackages contains unexpected ${wp}`);
  }

  if (known.length !== TOTAL_WORK_PACKAGES)
    errors.push(
      `knownWorkPackages must contain ${TOTAL_WORK_PACKAGES} entries, found ${known.length}`,
    );
  if (manifest.effectiveWorkPackageCount !== TOTAL_WORK_PACKAGES)
    errors.push(
      `effectiveWorkPackageCount must remain ${TOTAL_WORK_PACKAGES}`,
    );
  validateProhibitedWorkPackages(manifest.dispatchPolicy, knownSet, errors);
  validateStoppedWorkPackages(manifest.dispatchPolicy, knownSet, errors);
  validatePromotionPolicy(
    manifest.dispatchPolicy.sixLanePromotion,
    "six-lane",
    {
      requiredCompletedWorkPackages: [],
      requiredIndependentDecisionClusters: 6,
      minimumFreeAfterProvisionGiB: 35,
      minimumRuntimeFloorGiB: 30,
      requiresCompletedManagedWorktreePruning: false,
    },
    knownSet,
    errors,
  );
  validatePromotionPolicy(
    manifest.dispatchPolicy.nineLanePromotion,
    "nine-lane",
    {
      requiredCompletedWorkPackages: [],
      requiredIndependentDecisionClusters: 9,
      minimumFreeAfterProvisionGiB: 45,
      minimumRuntimeFloorGiB: 35,
      requiresCompletedManagedWorktreePruning: true,
    },
    knownSet,
    errors,
  );
  if (manifest.remainingUnstartedCount !== expectedRemaining.length) {
    errors.push(`remainingUnstartedCount must be ${expectedRemaining.length}`);
  }
  if (workPackages.length !== expectedRemaining.length) {
    errors.push(
      `workPackages must contain ${expectedRemaining.length} entries, found ${workPackages.length}`,
    );
  }

  const requiredPresetValues = {
    "fs-critical": ["codex", "gpt-5.6-sol", "xhigh"],
    "fs-standard": ["codex", "gpt-5.6-sol", "medium"],
    "fs-review": ["claude-code", "claude-opus-5[1m]", "high"],
  };

  for (const [presetName, [provider, model, effort]] of Object.entries(
    requiredPresetValues,
  )) {
    const preset = manifest.presets[presetName];
    if (!preset) {
      errors.push(`presets is missing ${presetName}`);
      continue;
    }
    if (
      preset.provider !== provider ||
      preset.model !== model ||
      preset.reasoningEffort !== effort
    ) {
      errors.push(`${presetName} must be ${provider}/${model}/${effort}`);
    }
  }

  const taskSet = new Set();
  const clusters = new Map();
  const dependencyMap = new Map();
  const requiredFields = [
    "wp",
    "task",
    "lane",
    "clusterId",
    "ownerKey",
    "executionMode",
    "sequence",
    "riskTier",
    "preset",
    "dependencies",
    "reason",
  ];

  for (const entry of workPackages) {
    if (!requireObject(entry, `entry ${String(entry?.wp)}`, errors)) continue;
    for (const field of requiredFields) {
      if (!(field in entry))
        errors.push(`${entry.wp ?? "unknown entry"} is missing ${field}`);
    }
    if (taskSet.has(entry.task))
      errors.push(`task key appears more than once: ${entry.task}`);
    taskSet.add(entry.task);
    if (!knownSet.has(entry.wp))
      errors.push(`${entry.wp} is not a known work package`);
    if (!Array.isArray(entry.dependencies)) {
      errors.push(`${entry.wp}.dependencies must be an array`);
      continue;
    }
    const repeatedDependencies = duplicates(entry.dependencies);
    if (repeatedDependencies.length > 0) {
      errors.push(
        `${entry.wp} contains duplicate dependencies: ${repeatedDependencies.join(", ")}`,
      );
    }
    for (const dependency of entry.dependencies) {
      if (!knownSet.has(dependency))
        errors.push(`${entry.wp} depends on missing target ${dependency}`);
      if (dependency === entry.wp)
        errors.push(`${entry.wp} cannot depend on itself`);
    }
    dependencyMap.set(entry.wp, entry.dependencies);

    if (entry.executionMode !== "sequential") {
      errors.push(`${entry.wp}.executionMode must be sequential`);
    }
    if (!Number.isInteger(entry.sequence) || entry.sequence < 1) {
      errors.push(`${entry.wp}.sequence must be a positive integer`);
    }
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
      errors.push(`${entry.wp}.reason must be non-empty`);
    }
    if ("gate" in entry) errors.push(`${entry.wp} must not define gate`);
    if (entry.wp === "WP56" && entry.lane !== "L6")
      errors.push("WP56 must retain its authoritative L6 product lane");

    const requiresCritical = entry.lane === "L2" || entry.lane === "L4-canvas";
    const expectedPreset = requiresCritical ? "fs-critical" : "fs-standard";
    const expectedRisk = requiresCritical ? "critical" : "standard";
    if (entry.preset !== expectedPreset) {
      errors.push(`${entry.wp} in ${entry.lane} must use ${expectedPreset}`);
    }
    if (entry.riskTier !== expectedRisk) {
      errors.push(
        `${entry.wp} in ${entry.lane} must use ${expectedRisk} risk tier`,
      );
    }

    const cluster = clusters.get(entry.clusterId) ?? [];
    cluster.push(entry);
    clusters.set(entry.clusterId, cluster);
  }

  for (const [clusterId, entries] of clusters) {
    const ownerKeys = new Set(entries.map((entry) => entry.ownerKey));
    if (ownerKeys.size !== 1)
      errors.push(`${clusterId} has multiple decision owners`);

    const ordered = [...entries].sort(
      (left, right) => left.sequence - right.sequence,
    );
    for (let index = 0; index < ordered.length; index += 1) {
      const entry = ordered[index];
      const expectedSequence = index + 1;
      if (entry.sequence !== expectedSequence) {
        errors.push(
          `${clusterId} sequence must be contiguous from 1; expected ${expectedSequence}, found ${entry.sequence}`,
        );
      }
      if (index > 0) {
        const predecessor = ordered[index - 1];
        if (!entry.dependencies.includes(predecessor.wp)) {
          errors.push(
            `${clusterId} could make ${predecessor.wp} and ${entry.wp} concurrently ready; ${entry.wp} must depend on ${predecessor.wp}`,
          );
        }
      }
    }
  }

  if (manifest.remainingDecisionClusterCount !== clusters.size) {
    errors.push(`remainingDecisionClusterCount must be ${clusters.size}`);
  }

  const cycle = hasDirectedCycle(known, dependencyMap);
  if (cycle) errors.push(`dependency cycle: ${cycle.join(" -> ")}`);
  return errors;
}

function groupByCluster(workPackages) {
  const clusters = new Map();
  for (const entry of workPackages) {
    const cluster = clusters.get(entry.clusterId) ?? [];
    cluster.push(entry);
    clusters.set(entry.clusterId, cluster);
  }
  for (const entries of clusters.values()) {
    entries.sort((left, right) => left.sequence - right.sequence);
  }
  return clusters;
}

export function evaluatePromotion(manifest, state, targetCap) {
  const errors = validateManifest(manifest);
  if (errors.length > 0)
    return {
      eligible: false,
      targetCap,
      errors,
      readyClusters: [],
      activeClusters: [],
    };
  if (![6, 9].includes(targetCap)) {
    return {
      eligible: false,
      targetCap,
      errors: ["target cap must be 6 or 9"],
      readyClusters: [],
      activeClusters: [],
    };
  }

  const completed = new Set(state.completedWorkPackages ?? []);
  const active = new Set(state.activeWorkPackages ?? []);
  const policy =
    targetCap === 6
      ? manifest.dispatchPolicy.sixLanePromotion
      : manifest.dispatchPolicy.nineLanePromotion;
  const promotionErrors = [];

  for (const wp of [...completed, ...active]) {
    if (!manifest.scope.knownWorkPackages.includes(wp))
      promotionErrors.push(`state contains unknown work package ${wp}`);
  }
  for (const wp of policy.requiredCompletedWorkPackages) {
    if (!completed.has(wp))
      promotionErrors.push(
        `${wp} must be complete before promotion to ${targetCap} lanes`,
      );
  }
  if (targetCap === 9 && (state.currentLaneCap ?? 0) < 6) {
    promotionErrors.push(
      "six-lane operation must be established before promotion to nine lanes",
    );
  }
  if (
    policy.requiresCompletedManagedWorktreePruning === true &&
    state.managedWorktreePruningComplete !== true
  ) {
    promotionErrors.push(
      "managed-worktree pruning and free-space recovery must be complete before promotion to nine lanes",
    );
  }
  // Disk binds at every cap. The floors are policy constants, while the
  // coordinator must remeasure current worktree cost before promotion.
  if (
    (state.freeAfterProvisionGiB ?? 0) < policy.minimumFreeAfterProvisionGiB
  ) {
    promotionErrors.push(
      `free space after provisioning must be at least ${policy.minimumFreeAfterProvisionGiB} GiB`,
    );
  }
  if ((state.runtimeFloorGiB ?? 0) < policy.minimumRuntimeFloorGiB) {
    promotionErrors.push(
      `runtime free-space floor must be at least ${policy.minimumRuntimeFloorGiB} GiB`,
    );
  }

  const readyClusters = [];
  const activeClusters = [];
  const unavailableWorkPackages = new Set([
    ...manifest.dispatchPolicy.prohibitedWorkPackages,
    ...manifest.dispatchPolicy.stoppedWorkPackages,
  ]);
  for (const [clusterId, entries] of groupByCluster(manifest.workPackages)) {
    const activeMembers = entries.filter((entry) => active.has(entry.wp));
    if (activeMembers.length > 1) {
      promotionErrors.push(
        `${clusterId} has concurrent active members: ${activeMembers.map((entry) => entry.wp).join(", ")}`,
      );
      continue;
    }
    const next = entries.find((entry) => !completed.has(entry.wp));
    if (next && unavailableWorkPackages.has(next.wp)) continue;
    if (activeMembers.length === 1) {
      activeClusters.push(clusterId);
      continue;
    }
    if (!next) continue;
    if (next.dependencies.every((dependency) => completed.has(dependency)))
      readyClusters.push(clusterId);
  }

  const independentClusters = new Set([...activeClusters, ...readyClusters]);
  if (independentClusters.size < policy.requiredIndependentDecisionClusters) {
    promotionErrors.push(
      `only ${independentClusters.size} independent active-or-ready decision clusters are available; ${policy.requiredIndependentDecisionClusters} required`,
    );
  }

  return {
    eligible: promotionErrors.length === 0,
    targetCap,
    errors: promotionErrors,
    readyClusters: readyClusters.sort(),
    activeClusters: activeClusters.sort(),
  };
}

function parseCsv(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCli(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--"))
      throw new Error(`unexpected argument ${argument}`);
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--"))
      throw new Error(`${argument} requires a value`);
    options[key] = value;
    index += 1;
  }
  return options;
}

function numberOption(options, key, fallback = 0) {
  if (!(key in options)) return fallback;
  const value = Number(options[key]);
  if (!Number.isFinite(value)) throw new Error(`--${key} must be a number`);
  return value;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseCli(argv);
  const manifest = readManifest(options.manifest ?? defaultManifestPath);
  if (!("target-cap" in options)) {
    const validationErrors = validateManifest(manifest);
    if (validationErrors.length > 0) {
      for (const error of validationErrors) console.error(`ERROR ${error}`);
      return 1;
    }
    console.log(
      `Validated ${manifest.remainingUnstartedCount} unstarted WPs in ${manifest.remainingDecisionClusterCount} decision-owner clusters.`,
    );
    return 0;
  }

  const result = evaluatePromotion(
    manifest,
    {
      completedWorkPackages: parseCsv(options.completed),
      activeWorkPackages: parseCsv(options.active),
      currentLaneCap: numberOption(
        options,
        "current-cap",
        manifest.dispatchPolicy.currentLaneCap,
      ),
      freeAfterProvisionGiB: numberOption(options, "free-after-provision-gib"),
      runtimeFloorGiB: numberOption(options, "runtime-floor-gib"),
      managedWorktreePruningComplete:
        options["managed-worktree-pruning-complete"] === "true",
    },
    numberOption(options, "target-cap"),
  );
  console.log(JSON.stringify(result, null, 2));
  return result.eligible ? 0 : 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(
      `ERROR ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
