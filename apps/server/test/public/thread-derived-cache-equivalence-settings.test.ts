import { describe, expect, it } from "vitest";
import { experimentKeys, type AppSettings } from "@bb/domain";
import {
  getAppSettings,
  getExperiments,
  setAppSettings,
  setExperiments,
} from "@bb/db";
import {
  expectCachedReadsMatchUncachedBuilds,
  PROVIDER_ID,
} from "../helpers/thread-derived-cache-table.js";

const SETTING_CHANGES: {
  [K in keyof AppSettings]-?: (settings: AppSettings) => Pick<AppSettings, K>;
} = {
  showKeyboardHints: (s) => ({ showKeyboardHints: !s.showKeyboardHints }),
  steerActiveThreadOnEnter: (s) => ({
    steerActiveThreadOnEnter: !s.steerActiveThreadOnEnter,
  }),
  terminalCopyOnSelect: (s) => ({
    terminalCopyOnSelect: !s.terminalCopyOnSelect,
  }),
  confirmThreadArchive: (s) => ({
    confirmThreadArchive: !s.confirmThreadArchive,
  }),
  showDiagnosticEvents: (s) => ({
    showDiagnosticEvents: !s.showDiagnosticEvents,
  }),
  keepHistoryAfterContextClear: (s) => ({
    keepHistoryAfterContextClear: !s.keepHistoryAfterContextClear,
  }),
  summarizeShellCommands: (s) => ({
    summarizeShellCommands: !s.summarizeShellCommands,
  }),
  providerOrder: () => ({ providerOrder: ["codex", PROVIDER_ID] }),
  defaultProviderId: () => ({ defaultProviderId: "codex" }),
  providerCompletedTurnDisplay: () => ({
    providerCompletedTurnDisplay: { [PROVIDER_ID]: "flat" },
  }),
  streamerMode: (s) => ({ streamerMode: !s.streamerMode }),
  allowFastServiceTier: (s) => ({
    allowFastServiceTier: !s.allowFastServiceTier,
  }),
  telemetryEnabled: (s) => ({ telemetryEnabled: !s.telemetryEnabled }),
  managedBranchPrefix: () => ({ managedBranchPrefix: "work/" }),
  idleProviderSessionTimeoutMinutes: (s) => ({
    idleProviderSessionTimeoutMinutes:
      s.idleProviderSessionTimeoutMinutes === 60 ? 5 : 60,
  }),
  machineServerUrl: () => ({
    machineServerUrl: "https://machine.example.test",
  }),
  machineGitCredentialsEnabled: (s) => ({
    machineGitCredentialsEnabled: !s.machineGitCredentialsEnabled,
  }),
  defaultMachineAccess: () => ({ defaultMachineAccess: "direct" }),
  onboardingCompletedAt: () => ({
    onboardingCompletedAt: "2026-11-17T00:00:00.000Z",
  }),
  earlyAdopter: (s) => ({ earlyAdopter: !s.earlyAdopter }),
};

const SETTING_ROWS = (
  Object.keys(SETTING_CHANGES) as (keyof AppSettings)[]
).map((key) => ({ key }));

describe("thread-derived caches serve what an uncached build would after a setting changes", () => {
  it.each(SETTING_ROWS)("the $key setting", ({ key }) =>
    expectCachedReadsMatchUncachedBuilds(
      ({ harness }) => {
        const settings = getAppSettings(harness.db);
        const next = { ...settings, ...SETTING_CHANGES[key](settings) };
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
