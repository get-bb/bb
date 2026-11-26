// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { startRestoredCoreContributionParts } from "./core-contribution-parts";
import { lazyPartOf, type LazyPart } from "./lazy-parts";
import { coreThreadInfoRegistrations } from "./plugin-slots";
import { settleLazyModules } from "@/test/lazy-modules";

function coreInfoParts(): LazyPart[] {
  return [
    ...coreThreadInfoRegistrations.threadInfoRows,
    ...coreThreadInfoRegistrations.threadInfoSections,
  ].map((registration) => {
    const part = lazyPartOf(registration.component);
    if (part === undefined) throw new Error(`${registration.id} is not lazy`);
    return part;
  });
}

describe("startRestoredCoreContributionParts", () => {
  it("loads bb's Info rows and sections only when Info is the restored tab", async () => {
    const parts = coreInfoParts();
    startRestoredCoreContributionParts([
      { kind: "panel-tab", pluginId: "bb--git", tabId: "diff" },
    ]);
    await settleLazyModules();
    expect(parts.some((part) => part.isLoaded())).toBe(false);

    startRestoredCoreContributionParts([{ kind: "info-tab" }]);
    await settleLazyModules();
    expect(parts.every((part) => part.isLoaded())).toBe(true);
  });
});
