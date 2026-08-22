import { execFileSync } from "node:child_process";

/**
 * A change to the published plugin SDK surface must bump PLUGIN_SDK_VERSION.
 *
 * Pre-1.0 the major is the compatibility number and never moves for additive
 * work, so the patch is the only thing a plugin author can point
 * `engines.bbPluginSdk` at to say "I need a host new enough to have this" —
 * `isPluginSdkRangeSatisfied` reads that range as a floor within the major.
 * Ship a new export without a bump and a plugin using it has no version to
 * require, so installing it on an older bb fails at runtime instead of
 * legibly at load.
 *
 * Nothing else catches this: `version.test.ts` only checks that package.json
 * and the constant agree with each other, and `app-contract.ts` has no
 * enumerated export list the way the backend, rpc, and host contracts do.
 */
const SURFACE_PATHS = [
  "packages/plugin-sdk/src/app-contract.ts",
  "packages/plugin-sdk/src/app.ts",
  "packages/plugin-sdk/src/backend-contract.ts",
  "packages/plugin-sdk/src/host-contract.ts",
  "packages/plugin-sdk/src/host.ts",
  "packages/plugin-sdk/src/index.ts",
  "packages/plugin-sdk/src/provider-bridge.ts",
  "packages/plugin-sdk/src/rpc-contract.ts",
];

const VERSION_PATH = "packages/domain/src/plugin-sdk-version.ts";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/**
 * The commit this branch left the base at. Returns null when it cannot be
 * resolved — an unattended push to a fork with no base, say — and the check
 * then passes rather than failing on something the author cannot act on.
 */
function resolveMergeBase() {
  const baseRef = process.env.GITHUB_BASE_REF || "main";
  for (const candidate of [`origin/${baseRef}`, baseRef]) {
    try {
      return git("merge-base", candidate, "HEAD");
    } catch {
      continue;
    }
  }
  return null;
}

const mergeBase = resolveMergeBase();
if (mergeBase === null) {
  console.log("No base commit to compare against; skipping.");
  process.exit(0);
}

const changed = new Set(
  git("diff", "--name-only", `${mergeBase}...HEAD`).split("\n").filter(Boolean),
);
const changedSurface = SURFACE_PATHS.filter((path) => changed.has(path));

if (changedSurface.length === 0) {
  console.log("Plugin SDK surface unchanged.");
  process.exit(0);
}

if (!changed.has(VERSION_PATH)) {
  console.error(
    `The plugin SDK surface changed without a version bump:\n` +
      changedSurface.map((path) => `  ${path}`).join("\n") +
      `\n\nBump PLUGIN_SDK_VERSION in ${VERSION_PATH} (patch, pre-1.0) and` +
      ` keep packages/plugin-sdk/package.json in step, so a plugin using the` +
      ` new surface can require a host that has it.`,
  );
  process.exit(1);
}

console.log(
  `Plugin SDK surface changed in ${changedSurface.length} file(s) with a version bump.`,
);
