import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import semver from "semver";
import { z } from "zod";
import { PLUGIN_SDK_VERSION } from "@bb/domain";
import { isPluginSdkRangeSatisfied } from "../../../src/services/plugins/sdk-compat.js";

const major = semver.major(PLUGIN_SDK_VERSION);
const PLUGINS_DIR = fileURLToPath(
  new URL("../../../../../plugins/", import.meta.url),
);
const pluginPackageSchema = z.object({
  name: z.string(),
  engines: z.object({ bbPluginSdk: z.string().optional() }).optional(),
});

function firstPartyPluginPackages() {
  return readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const path = join(PLUGINS_DIR, entry.name, "package.json");
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        return [];
      }
      const pkg = pluginPackageSchema.parse(JSON.parse(text));
      const range = pkg.engines?.bbPluginSdk;
      return range === undefined ? [] : [{ name: pkg.name, range }];
    });
}

describe("isPluginSdkRangeSatisfied", () => {
  it("accepts a caret range the running SDK has grown past", () => {
    expect(isPluginSdkRangeSatisfied(`^${major}.0.1`)).toBe(true);
    expect(isPluginSdkRangeSatisfied(`${major}.0.1`)).toBe(true);
  });

  it("rejects a floor above the running SDK", () => {
    const ahead = semver.inc(PLUGIN_SDK_VERSION, "minor");
    if (ahead === null) throw new Error("cannot increment SDK version");
    expect(isPluginSdkRangeSatisfied(`>=${ahead}`)).toBe(false);
    expect(isPluginSdkRangeSatisfied(`^${ahead}`)).toBe(false);
  });

  it("rejects a range pinned to a different major", () => {
    expect(isPluginSdkRangeSatisfied(`^${major + 1}.0.0`)).toBe(false);
  });

  it("returns false for a malformed range instead of throwing", () => {
    expect(() => isPluginSdkRangeSatisfied("not-a-range")).not.toThrow();
    expect(isPluginSdkRangeSatisfied("not-a-range")).toBe(false);
  });

  it("accepts the ranges the scaffold and the running SDK produce", () => {
    expect(isPluginSdkRangeSatisfied(`>=${PLUGIN_SDK_VERSION}`)).toBe(true);
    expect(isPluginSdkRangeSatisfied(PLUGIN_SDK_VERSION)).toBe(true);
    expect(isPluginSdkRangeSatisfied("*")).toBe(true);
  });
});

describe("first-party plugin SDK ranges", () => {
  it("runs every first-party plugin on the current SDK", () => {
    const packages = firstPartyPluginPackages();
    expect(packages.length).toBeGreaterThan(40);
    const unsatisfied = packages
      .filter((pkg) => !isPluginSdkRangeSatisfied(pkg.range))
      .map((pkg) => `${pkg.name} ${pkg.range}`);
    expect(unsatisfied, `running SDK ${PLUGIN_SDK_VERSION}`).toEqual([]);
  });
});
