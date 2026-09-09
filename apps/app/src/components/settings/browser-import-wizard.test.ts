import { describe, expect, it } from "vitest";
import type { DesktopBrowserImportSource } from "@bb/host-daemon-contract";
import {
  canCloseBrowserImportWizard,
  canReturnToSourceChoice,
  describeSourceProfiles,
  detectedSources,
  formatSkippedDomains,
  initialBrowserImportStep,
  isSourceSelectable,
  outcomeToBrowserImportStep,
  preferredSourceProfileDirectory,
  refreshedBrowserImportStep,
} from "./browser-import-wizard";

const ready: DesktopBrowserImportSource = {
  id: "chrome",
  name: "Google Chrome",
  profiles: [
    { directory: "Default", name: "Person 1", cookieCount: 4812 },
    { directory: "Profile 1", name: "Work", cookieCount: 1 },
  ],
};

describe("browser import wizard steps", () => {
  it("opens on the step matching the source's availability", () => {
    expect(initialBrowserImportStep(ready)).toEqual({ step: "configure" });
    expect(
      initialBrowserImportStep({ ...ready, unavailable: "browserRunning" }),
    ).toEqual({ step: "quit" });
    expect(
      initialBrowserImportStep({
        ...ready,
        unavailable: "needsFullDiskAccess",
      }),
    ).toEqual({ step: "fullDiskAccess", checked: false });
    expect(
      initialBrowserImportStep({ ...ready, unavailable: "notInstalled" }),
    ).toEqual({ step: "blocked", reason: "notInstalled" });
    expect(initialBrowserImportStep({ ...ready, profiles: [] })).toEqual({
      step: "blocked",
      reason: "unknownSourceProfile",
    });
  });

  it("routes outcomes to done, quit, permission, or blocked", () => {
    expect(
      outcomeToBrowserImportStep({
        ok: true,
        imported: 3,
        skipped: 1,
        skippedDomains: ["a.test"],
      }),
    ).toEqual({
      step: "done",
      imported: 3,
      skipped: 1,
      skippedDomains: ["a.test"],
    });
    expect(
      outcomeToBrowserImportStep({ ok: false, reason: "browserRunning" }),
    ).toEqual({ step: "quit" });
    expect(
      outcomeToBrowserImportStep({ ok: false, reason: "needsFullDiskAccess" }),
    ).toEqual({ step: "fullDiskAccess", checked: true });
    expect(
      outcomeToBrowserImportStep({ ok: false, reason: "readFailed" }),
    ).toEqual({ step: "blocked", reason: "readFailed" });
  });

  it("marks a repeated permission denial as checked and blocks vanished sources", () => {
    expect(
      refreshedBrowserImportStep(
        { ...ready, unavailable: "needsFullDiskAccess" },
        { step: "fullDiskAccess", checked: false },
      ),
    ).toEqual({ step: "fullDiskAccess", checked: true });
    expect(refreshedBrowserImportStep(ready, { step: "quit" })).toEqual({
      step: "configure",
    });
    expect(refreshedBrowserImportStep(undefined, { step: "quit" })).toEqual({
      step: "blocked",
      reason: "unknownSource",
    });
  });

  it("only locks the dialog while importing", () => {
    expect(canCloseBrowserImportWizard({ step: "importing" })).toBe(false);
    expect(canCloseBrowserImportWizard({ step: "checking" })).toBe(true);
  });

  it("keeps the chosen profile when it survives a refresh", () => {
    expect(preferredSourceProfileDirectory("Profile 1", ready)).toBe(
      "Profile 1",
    );
    expect(preferredSourceProfileDirectory("gone", ready)).toBe("Default");
    expect(
      preferredSourceProfileDirectory("gone", { ...ready, profiles: [] }),
    ).toBeNull();
  });

  it("formats skipped domains and profile summaries", () => {
    expect(formatSkippedDomains([])).toBe("");
    expect(formatSkippedDomains(["a"])).toBe("a");
    expect(formatSkippedDomains(["a", "b", "c"])).toBe("a, b and c");
    expect(formatSkippedDomains(["a", "b", "c", "d", "e"])).toBe(
      "a, b, c and 2 more",
    );
    expect(describeSourceProfiles(ready)).toBe(
      "2 profiles · Person 1 (4,812 cookies), Work (1 cookie)",
    );
    expect(
      describeSourceProfiles({ ...ready, unavailable: "notInstalled" }),
    ).toBe("Not found on this machine");
    expect(isSourceSelectable(ready)).toBe(true);
    expect(
      isSourceSelectable({ ...ready, unavailable: "needsFullDiskAccess" }),
    ).toBe(true);
    expect(isSourceSelectable({ ...ready, unavailable: "notInstalled" })).toBe(
      false,
    );
    expect(
      detectedSources([
        ready,
        { ...ready, id: "arc", unavailable: "notInstalled" },
        { ...ready, id: "safari", unavailable: "unsupportedPlatform" },
        { ...ready, id: "brave", unavailable: "browserRunning" },
      ]).map((source) => source.id),
    ).toEqual(["chrome", "brave"]);
    expect(canReturnToSourceChoice({ step: "configure" })).toBe(true);
    expect(canReturnToSourceChoice({ step: "importing" })).toBe(false);
    expect(canReturnToSourceChoice({ step: "chooseSource" })).toBe(false);
  });
});
