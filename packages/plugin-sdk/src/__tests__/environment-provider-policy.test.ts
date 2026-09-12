import { expect, it } from "vitest";
import { validatePluginEnvironmentProviderDeclaration } from "../internal/host-policy.js";

const declaration = {
  id: "test-provider",
  displayName: "Test provider",
  description: "Prepare a workspace for this thread.",
  icon: "Folder",
  create: async () => ({
    status: "created",
    path: "/tmp/test",
    ownsPath: true,
  }),
  remove: async () => ({ status: "removed" }),
} satisfies Parameters<typeof validatePluginEnvironmentProviderDeclaration>[0];

it.each([
  ["removeRetryMs", 1],
  ["transientRetryMs", 1],
  ["transientRetryLimit", 0],
  ["createTimeoutMs", 1],
])("rejects the removed %s policy setting", (key, value) => {
  expect(() =>
    validatePluginEnvironmentProviderDeclaration({
      ...declaration,
      policy: { [key]: value },
    }),
  ).toThrow();
});

it("keeps retirement and path-key defaults and overrides", () => {
  expect(
    validatePluginEnvironmentProviderDeclaration(declaration).policy,
  ).toEqual({
    retireGraceMs: 300_000,
    pathKeys: "per-thread",
  });
  expect(
    validatePluginEnvironmentProviderDeclaration({
      ...declaration,
      policy: { retireGraceMs: null, pathKeys: "per-attempt" },
    }).policy,
  ).toEqual({ retireGraceMs: null, pathKeys: "per-attempt" });
});
