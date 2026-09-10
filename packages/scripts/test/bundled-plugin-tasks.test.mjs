import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_PLUGINS } from "../../../apps/server/src/services/plugins/builtin-registry.ts";

const root = resolve(import.meta.dirname, "../../..");
const turboSource = readFileSync(resolve(root, "turbo.json"), "utf8");
const turbo = JSON.parse(turboSource.replace(/^\s*\/\/.*$/gm, ""));

describe("bundled plugin task graph", () => {
  it("prepares every registered plugin before assembly with separate output ownership", () => {
    const expected = BUNDLED_PLUGINS.map(({ name }) => {
      const manifest = JSON.parse(
        readFileSync(resolve(root, "plugins", name, "package.json"), "utf8"),
      );
      expect(manifest.scripts["prepare:bundled"]).toBe(
        `cd ../.. && node --conditions=source --import tsx apps/server/scripts/copy-builtin-plugins.ts --plugin ${name}`,
      );
      return `${manifest.name}#prepare:bundled`;
    });
    const assembly = turbo.tasks["@bb/server#prepare:plugins"];
    expect(
      assembly.dependsOn
        .filter((task) => task.endsWith("#prepare:bundled"))
        .sort(),
    ).toEqual(expected.sort());
    expect(assembly.outputs).toEqual(["builtin-plugins/**"]);
    const plugin = turbo.tasks["prepare:bundled"];
    expect(plugin.outputs).toEqual([".bundled-runtime/**"]);
    expect(plugin.dependsOn).toEqual([
      "@get-bb/plugin-sdk#build",
      "@bb/plugin-build#topo",
    ]);
    expect(plugin.inputs).toContain("!.bundled-runtime/**");
    expect(plugin.inputs).toContain("!dist/**");
    expect(
      plugin.inputs.some((input) => input.includes("$TURBO_ROOT$/plugins/")),
    ).toBe(false);
  });
});
