import semver from "semver";
import { PLUGIN_SDK_VERSION } from "@bb/domain";

/**
 * Decide whether the running plugin SDK satisfies a plugin's
 * `engines.bbPluginSdk` range.
 *
 * A plugin's declared range states the API level it needs, not a ceiling the
 * host must honor. Authors write (and `bb plugin new` used to scaffold) a
 * caret range such as `^0.4.1`, which under semver stops at the next minor.
 * Read literally, every SDK minor release would unload every installed plugin
 * until each author shipped a manifest edit — which is exactly what the 0.4.2
 * to 0.5.0 bump did.
 *
 * So a range that only fails because the SDK moved forward inside the same
 * major is accepted: the floor still applies, and a plugin that asks for a
 * newer SDK than this host provides stays incompatible. A genuine plugin API
 * break bumps the major, which this check does honor.
 */
export function isPluginSdkRangeSatisfied(range: string): boolean {
  // Callers reject a malformed range with their own message before reaching
  // here; keep the helper total anyway, because semver.minVersion throws.
  if (semver.validRange(range) === null) return false;
  if (semver.satisfies(PLUGIN_SDK_VERSION, range)) return true;
  const floor = semver.minVersion(range);
  if (floor === null) return false;
  if (semver.major(floor) !== semver.major(PLUGIN_SDK_VERSION)) return false;
  return semver.gte(PLUGIN_SDK_VERSION, floor);
}

/** Human-readable reason a plugin's SDK range excludes the running SDK. */
export function pluginSdkRangeProblem(range: string): string {
  return `requires bb plugin SDK ${range}, running SDK is ${PLUGIN_SDK_VERSION}`;
}
