import { describe, expect, it } from "vitest";

import { CORE_PLUGIN_DIRECTORIES, derivePluginId } from "../src/plugin-id.js";

describe("derivePluginId", () => {
  it.each([
    ["bb-plugin-hello", "hello"],
    ["@acme/bb-plugin-hello", "hello"],
    ["bb-plugin-npm-tools", "npm-tools"],
    ["bb-plugin-toolchain-0.28.1", "toolchain-0-28-1"],
    ["bb-plugin-my-cache", "my-cache"],
  ])("derives %s as %s", (packageName, expectedId) => {
    expect(derivePluginId(packageName)).toBe(expectedId);
  });

  it.each(Object.values(CORE_PLUGIN_DIRECTORIES))(
    "refuses package names that derive core's plugins/%s folder",
    (folder) => {
      for (const packageName of [
        `bb-plugin-${folder}`,
        `@acme/bb-plugin-${folder}`,
        folder.toUpperCase(),
      ]) {
        expect(() => derivePluginId(packageName)).toThrowError(
          `gives plugin id "${folder}", which bb reserves for its own folders under plugins/`,
        );
      }
    },
  );
});
