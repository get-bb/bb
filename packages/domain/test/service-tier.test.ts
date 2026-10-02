import { describe, expect, it } from "vitest";
import {
  providerServiceTierOptions,
  reconcileServiceTier,
  resolveServiceTierOptions,
} from "../src/service-tier.js";

const provider = {
  capabilities: { supportsServiceTier: true },
  serviceTiers: [
    { id: "default", label: "Default" },
    { id: "fast", label: "Fast", description: "Declared description" },
    { id: "ultrafast", label: "Ultrafast" },
  ],
};

describe("resolveServiceTierOptions", () => {
  it("offers every declared non-default tier when the model reports none", () => {
    expect(resolveServiceTierOptions({ provider, model: undefined })).toEqual([
      { id: "fast", label: "Fast", description: "Declared description" },
      { id: "ultrafast", label: "Ultrafast" },
    ]);
    expect(resolveServiceTierOptions({ provider, model: {} })).toEqual(
      providerServiceTierOptions(provider),
    );
  });

  it("narrows to the model's tiers and prefers the model's copy", () => {
    expect(
      resolveServiceTierOptions({
        provider,
        model: {
          supportedServiceTiers: [
            { id: "ultrafast", description: "3x speed" },
            { id: "fast", label: "Priority" },
          ],
        },
      }),
    ).toEqual([
      { id: "fast", label: "Priority", description: "Declared description" },
      { id: "ultrafast", label: "Ultrafast", description: "3x speed" },
    ]);
  });

  it("offers nothing for a model that lists no tiers", () => {
    expect(
      resolveServiceTierOptions({
        provider,
        model: { supportedServiceTiers: [] },
      }),
    ).toEqual([]);
  });

  it("drops model tiers the provider does not declare and the default tier", () => {
    expect(
      resolveServiceTierOptions({
        provider,
        model: {
          supportedServiceTiers: [
            { id: "default" },
            { id: "flex" },
            { id: "fast" },
          ],
        },
      }),
    ).toEqual([
      { id: "fast", label: "Fast", description: "Declared description" },
    ]);
  });

  it("offers nothing for a provider without service tiers", () => {
    expect(
      resolveServiceTierOptions({
        provider: { ...provider, capabilities: { supportsServiceTier: false } },
        model: { supportedServiceTiers: [{ id: "fast" }] },
      }),
    ).toEqual([]);
    expect(
      resolveServiceTierOptions({ provider: undefined, model: undefined }),
    ).toEqual([]);
  });
});

describe("reconcileServiceTier", () => {
  it("keeps an offered tier and falls back to default otherwise", () => {
    const options = [{ id: "fast" }];
    expect(reconcileServiceTier("fast", options)).toBe("fast");
    expect(reconcileServiceTier("ultrafast", options)).toBe("default");
    expect(reconcileServiceTier("default", options)).toBe("default");
  });
});
