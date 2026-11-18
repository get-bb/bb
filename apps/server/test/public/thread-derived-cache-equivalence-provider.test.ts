import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";
import {
  BASE_PROVIDER_DECLARATION,
  booleanKeysOf,
  expectCachedReadsMatchUncachedBuilds,
  type BooleanKey,
} from "../helpers/thread-derived-cache-table.js";

type Capabilities = PluginProviderDeclaration["capabilities"];

type FieldChange<T, K extends keyof T> =
  | ((value: T) => Pick<T, K>)
  | { excluded: string };

const DECLARATION_CHANGES: {
  [K in keyof PluginProviderDeclaration]-?: FieldChange<
    PluginProviderDeclaration,
    K
  >;
} = {
  id: {
    excluded:
      "another id is another provider; the providerId column row covers switching",
  },
  displayName: () => ({ displayName: "Goals Pro" }),
  family: () => ({ family: "goals-family" }),
  icon: () => ({ icon: "sparkles" }),
  experimental_bridgeOptions: () => ({
    experimental_bridgeOptions: { mode: "fast" },
  }),
  experimental_visibility: () => ({
    experimental_visibility: "installed",
    maintenance: { health: true, usage: false, installation: false },
  }),
  maintenance: () => ({
    maintenance: { health: true, usage: true, installation: true },
  }),
  composerActions: () => ({ composerActions: ["goal"] }),
  completedTurnDisplay: () => ({ completedTurnDisplay: "flat" }),
  strings: () => ({
    strings: {
      signInHint: "Sign in to Goals",
      expiredHint: "Goals sign-in expired",
      installUrl: "https://goals.example.test/install",
    },
  }),
  serviceTiers: () => ({ serviceTiers: [{ id: "fast", label: "Fast" }] }),
  reasoningLevels: () => ({ reasoningLevels: [{ id: "high", label: "High" }] }),
  extensionKinds: () => ({
    extensionKinds: { goal: { state: z.object({ status: z.string() }) } },
  }),
  models: () => ({ models: { scope: "workspace" } }),
  env: () => ({ env: { passthrough: ["GOALS_TOKEN"] } }),
  experimental_nativeSkillRoots: () => ({
    experimental_nativeSkillRoots: { user: [] },
  }),
  experimental_nativeCommandRoots: () => ({
    experimental_nativeCommandRoots: { user: [] },
  }),
  experimental_resolvesNativeRoots: () => ({
    experimental_resolvesNativeRoots: true,
  }),
  internal_DO_NOT_USE_guidedSignIn: () => ({
    internal_DO_NOT_USE_guidedSignIn: true,
  }),
  deriveProviderOptions: () => ({
    deriveProviderOptions: () => ({ mode: "derived" }),
  }),
  capabilities: {
    excluded: "each capability has its own row below",
  },
};

type ValueCapability = Exclude<keyof Capabilities, BooleanKey<Capabilities>>;

const VALUE_CAPABILITY_CHANGES: {
  [K in ValueCapability]-?: (
    capabilities: Capabilities,
  ) => Pick<Capabilities, K>;
} = {
  fork: () => ({ fork: "tip" }),
  permissionModes: () => ({
    permissionModes: ["accept-edits", "auto", "full"],
  }),
  reasoningLevels: () => ({ reasoningLevels: ["medium", "high"] }),
};

function changedDeclaration(
  field: keyof PluginProviderDeclaration,
): PluginProviderDeclaration | null {
  const change = DECLARATION_CHANGES[field];
  if ("excluded" in change) return null;
  return { ...BASE_PROVIDER_DECLARATION, ...change(BASE_PROVIDER_DECLARATION) };
}

function withCapabilities(
  change: (capabilities: Capabilities) => Capabilities,
): PluginProviderDeclaration {
  return {
    ...BASE_PROVIDER_DECLARATION,
    capabilities: change(BASE_PROVIDER_DECLARATION.capabilities),
  };
}

const CAPABILITY_ROWS = [
  ...booleanKeysOf(BASE_PROVIDER_DECLARATION.capabilities).map((field) => ({
    field: `capabilities.${field}`,
    declaration: withCapabilities((capabilities) => {
      const next = { ...capabilities };
      next[field] = !capabilities[field];
      return next;
    }),
  })),
  ...(Object.keys(VALUE_CAPABILITY_CHANGES) as ValueCapability[]).map(
    (field) => ({
      field: `capabilities.${field}`,
      declaration: withCapabilities((capabilities) => ({
        ...capabilities,
        ...VALUE_CAPABILITY_CHANGES[field](capabilities),
      })),
    }),
  ),
];

const ROWS = [
  ...(
    Object.keys(DECLARATION_CHANGES) as (keyof PluginProviderDeclaration)[]
  ).flatMap((field) => {
    const declaration = changedDeclaration(field);
    return declaration === null ? [] : [{ declaration, field }];
  }),
  ...CAPABILITY_ROWS,
];

describe("thread-derived caches serve what an uncached build would after a provider update", () => {
  it.each(ROWS)("changes $field", ({ declaration }) => {
    expect(declaration).not.toEqual(BASE_PROVIDER_DECLARATION);
    return expectCachedReadsMatchUncachedBuilds(
      ({ replaceProvider }) => replaceProvider(declaration),
      { changesOutput: false },
    );
  });
});
