import { expect, it } from "vitest";
import { filterInjectedSkillCatalog } from "./skill-catalog-policy.js";

it("omits discoverable and off skills without mutating the management catalog", () => {
  const catalog = Array.from({ length: 1000 }, (_, index) => ({
    name: `skill-${index}`,
  }));
  const filtered = filterInjectedSkillCatalog(catalog, {
    defaultMode: "discover",
    overrides: { "skill-7": "always", "skill-9": "off" },
  });
  expect(filtered).toEqual([{ name: "skill-7" }]);
  expect(catalog).toHaveLength(1000);
  expect(filterInjectedSkillCatalog(catalog, undefined)).toEqual(catalog);
});

it("does not interpret inherited object properties as skill overrides", () => {
  expect(
    filterInjectedSkillCatalog(
      [{ name: "toString" }, { name: "constructor" }],
      {
        defaultMode: "always",
        overrides: {},
      },
    ),
  ).toHaveLength(2);
});
