import { describe, expect, it } from "vitest";
import {
  defaultAppSettings,
  experimentKeys,
  type AppSettings,
} from "@bb/domain";
import {
  getAppSettings,
  getExperiments,
  setAppSettings,
  setExperiments,
} from "@bb/db";
import {
  booleanKeysOf,
  expectCachedReadsMatchUncachedBuilds,
  PROVIDER_ID,
  type BooleanKey,
} from "../helpers/thread-derived-cache-table.js";

type ValueSetting = Exclude<keyof AppSettings, BooleanKey<AppSettings>>;

const VALUE_SETTING_CHANGES: {
  [K in ValueSetting]-?: (settings: AppSettings) => Pick<AppSettings, K>;
} = {
  providerOrder: () => ({ providerOrder: ["codex", PROVIDER_ID] }),
  defaultProviderId: () => ({ defaultProviderId: "codex" }),
  providerCompletedTurnDisplay: () => ({
    providerCompletedTurnDisplay: { [PROVIDER_ID]: "flat" },
  }),
  managedBranchPrefix: () => ({ managedBranchPrefix: "work/" }),
  idleProviderSessionTimeoutMinutes: (s) => ({
    idleProviderSessionTimeoutMinutes:
      s.idleProviderSessionTimeoutMinutes === 60 ? 5 : 60,
  }),
  machineServerUrl: () => ({
    machineServerUrl: "https://machine.example.test",
  }),
  defaultMachineAccess: () => ({ defaultMachineAccess: "direct" }),
  onboardingCompletedAt: () => ({
    onboardingCompletedAt: "2026-11-17T00:00:00.000Z",
  }),
};

interface SettingRow {
  key: keyof AppSettings;
  change(settings: AppSettings): AppSettings;
}

const SETTING_ROWS: SettingRow[] = [
  ...booleanKeysOf(defaultAppSettings).map((key) => ({
    key,
    change: (settings: AppSettings) => {
      const next = { ...settings };
      next[key] = !settings[key];
      return next;
    },
  })),
  ...(Object.keys(VALUE_SETTING_CHANGES) as ValueSetting[]).map((key) => ({
    key,
    change: (settings: AppSettings) => ({
      ...settings,
      ...VALUE_SETTING_CHANGES[key](settings),
    }),
  })),
];

describe("thread-derived caches serve what an uncached build would after a setting changes", () => {
  it.each(SETTING_ROWS)("the $key setting", ({ key, change }) =>
    expectCachedReadsMatchUncachedBuilds(
      ({ harness }) => {
        const settings = getAppSettings(harness.db);
        const next = change(settings);
        expect(next[key]).not.toEqual(settings[key]);
        setAppSettings(harness.db, next);
      },
      { changesOutput: false },
    ),
  );

  it.each(experimentKeys.map((key) => ({ key })))(
    "the $key experiment",
    ({ key }) =>
      expectCachedReadsMatchUncachedBuilds(
        ({ harness }) =>
          setExperiments(harness.db, {
            [key]: !getExperiments(harness.db)[key],
          }),
        { changesOutput: false },
      ),
  );
});
