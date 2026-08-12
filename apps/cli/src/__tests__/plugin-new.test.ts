import { describe, expect, it } from "vitest";
import { resolveNewPluginTarget } from "../commands/plugin.js";

describe("resolveNewPluginTarget", () => {
  it.each([
    ["hello", "bb-plugin-hello", "bb-plugin-hello"],
    ["bb-plugin-hello", "bb-plugin-hello", "bb-plugin-hello"],
    ["@acme/bb-plugin-hello", "@acme/bb-plugin-hello", "bb-plugin-hello"],
  ])("resolves %s", (name, expectedPackageName, expectedDirectoryName) => {
    expect(resolveNewPluginTarget(name)).toEqual({
      packageName: expectedPackageName,
      directoryName: expectedDirectoryName,
    });
  });

  it.each([
    "Hello",
    "bb-plugin-",
    "@acme/hello",
    "@acme/bb-plugin-Hello",
    "@acme/team/bb-plugin-hello",
  ])("rejects %s", (name) => {
    expect(resolveNewPluginTarget(name)).toBeNull();
  });
});
