import { describe, expect, it } from "vitest";
import {
  filterCommandSuggestions,
  orderCommandSuggestions,
  type ProviderCommandSuggestion,
} from "../src/prompt/mentions/types.js";

function skill(
  name: string,
  description: string | null = null,
  argumentHint: string | null = null,
): ProviderCommandSuggestion {
  return {
    kind: "command",
    name,
    source: "skill",
    origin: "user",
    description,
    argumentHint,
  };
}

function search(suggestions: ProviderCommandSuggestion[], query: string) {
  return orderCommandSuggestions(
    filterCommandSuggestions(suggestions, query),
    query,
  );
}

describe("command search", () => {
  it.each([
    ["lhaudit", "lighthouse-audit"],
    ["audit", "accessibility-audit"],
    ["containers", "prune-containers"],
    ["prunecontainers", "prune-containers"],
    ["  PRUNECONTAINERS  ", "prune-containers"],
    ["rotatesecrets", "ops:rotate-secrets"],
  ])("finds %s in %s and preserves the invocation", (query, name) => {
    const target = { ...skill(name), pluginId: "test-plugin" };
    expect(search([skill("unrelated"), target], query)).toEqual([target]);
    expect(search([target], query)[0]).toBe(target);
  });

  it("puts name substrings before matches in long skill descriptions", () => {
    const descriptionMatch = skill(
      "image-compressor",
      "Resize screenshots before an accessibility audit",
    );
    const nameMatch = skill("accessibility-audit");
    expect(search([descriptionMatch, nameMatch], "audit")).toEqual([
      nameMatch,
      descriptionMatch,
    ]);
  });

  it("ranks exact, prefix, substring, and fuzzy names before metadata", () => {
    const metadata = skill("release-checklist", "Prepare a ship manifest");
    const fuzzy = skill("screenshot-inspector");
    const substring = skill("friendship-check");
    const prefix = skill("ship-it");
    const exact = skill("ship");
    expect(search([metadata, fuzzy, substring, prefix, exact], "ship")).toEqual(
      [exact, prefix, substring, fuzzy, metadata],
    );
  });

  it("ranks fuzzy matches across sections while keeping each section contiguous", () => {
    const skillMatch = skill("deploy-kubernetes-resources");
    const skillDescription = skill(
      "deployment-glossary",
      "Explain the dkr deployment shorthand",
    );
    const projectMatch: ProviderCommandSuggestion = {
      ...skill("debug-kernel-restart"),
      source: "command",
      origin: "project",
    };
    const userMatch: ProviderCommandSuggestion = {
      ...skill("docker"),
      source: "command",
    };
    const userDescription: ProviderCommandSuggestion = {
      ...skill("release-checklist", "Check dkr deployment prerequisites"),
      source: "command",
    };
    const catalog = [
      skillDescription,
      userDescription,
      userMatch,
      projectMatch,
    ];

    expect(search(catalog, "dkr")).toEqual([
      projectMatch,
      userMatch,
      userDescription,
      skillDescription,
    ]);
    expect(search([...catalog, skillMatch], "dkr")).toEqual([
      skillMatch,
      skillDescription,
      projectMatch,
      userMatch,
      userDescription,
    ]);
  });

  it("retains description and argument searches without fuzzy description noise", () => {
    const description = skill("review", "Inspect a pull request");
    const argument = skill("open", null, "<pull-request-url>");
    expect(search([description, argument], "pull")).toEqual([
      description,
      argument,
    ]);
    expect(search([description, argument], "plrq")).toEqual([]);
  });

  it("preserves the catalog order for empty input and does not mutate it", () => {
    const catalog = [skill("zebra"), skill("alpha")];
    expect(search(catalog, "  ")).toEqual(catalog);
    expect(search(catalog, "alpha")).toEqual([catalog[1]]);
    expect(catalog.map((item) => item.name)).toEqual(["zebra", "alpha"]);
  });
});
