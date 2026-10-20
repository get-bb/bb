import { describe, expect, it } from "vitest";
import {
  appSettingsSchema,
  defaultAppSettings,
  idleProviderSessionTimeoutMinutesSchema,
  managedBranchPrefixSchema,
  MANAGED_BRANCH_PREFIX_MAX_LENGTH,
} from "../src/app-settings.js";

describe("idle provider session timeout", () => {
  it("accepts whole minutes, immediate eligibility and never", () => {
    for (const value of [0, 1, 5, 30, 60, 1440, null]) {
      expect(idleProviderSessionTimeoutMinutesSchema.parse(value)).toBe(value);
    }
    expect(defaultAppSettings.idleProviderSessionTimeoutMinutes).toBe(30);
  });

  it("rejects invalid durations and unsafe millisecond conversions", () => {
    for (const value of [
      -1,
      0.5,
      "5m",
      "never",
      Infinity,
      NaN,
      Number.MAX_SAFE_INTEGER,
    ]) {
      expect(
        idleProviderSessionTimeoutMinutesSchema.safeParse(value).success,
      ).toBe(false);
    }
  });
});

describe("managedBranchPrefixSchema", () => {
  it("accepts prefixes that start a valid branch name", () => {
    for (const prefix of ["bb/", "", "sawyer/wt-", "team/bb/", "wip_"]) {
      expect(managedBranchPrefixSchema.safeParse(prefix).success).toBe(true);
    }
  });

  it("rejects prefixes that cannot start a valid branch name", () => {
    for (const prefix of [
      " bb/",
      "bb //",
      "-bb/",
      "/bb/",
      "bb//",
      "bb../",
      "bb:",
      "bb~",
      "bb\\",
      "bb@{",
      ".bb/",
      "a".repeat(MANAGED_BRANCH_PREFIX_MAX_LENGTH + 1),
    ]) {
      expect(managedBranchPrefixSchema.safeParse(prefix).success).toBe(false);
    }
  });

  it("defaults to the bb namespace", () => {
    expect(defaultAppSettings.managedBranchPrefix).toBe("bb/");
    expect(appSettingsSchema.parse(defaultAppSettings)).toEqual(
      defaultAppSettings,
    );
  });
});
