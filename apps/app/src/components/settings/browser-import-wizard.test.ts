import { describe, expect, it } from "vitest";
import type { DesktopBrowserImportSource } from "@bb/host-daemon-contract";
import {
  canCloseDialog,
  failedDialogStep,
  formatSkippedDomains,
  initialDialogStep,
  listedSources,
  needsProfileChoice,
  preferredSourceProfileDirectory,
  presentSourceRow,
  readBrowserImportRecords,
  refreshedDialogStep,
  sourceAfterFailure,
} from "./browser-import-wizard";

const ready: DesktopBrowserImportSource = {
  id: "chrome",
  name: "Google Chrome",
  profiles: [
    { directory: "Default", name: "Person 1", cookieCount: 4812 },
    { directory: "Profile 1", name: "Work", cookieCount: 1 },
  ],
};

describe("browser import dialog steps", () => {
  it("opens on the step matching the source's availability", () => {
    expect(initialDialogStep(ready)).toEqual({ step: "configure" });
    expect(
      initialDialogStep({ ...ready, unavailable: "browserRunning" }),
    ).toEqual({ step: "blocked", reason: "browserRunning" });
    expect(
      initialDialogStep({ ...ready, unavailable: "needsFullDiskAccess" }),
    ).toEqual({ step: "fullDiskAccess", checked: false });
    expect(initialDialogStep({ ...ready, profiles: [] })).toEqual({
      step: "blocked",
      reason: "unknownSourceProfile",
    });
  });

  it("routes failures and rechecks", () => {
    expect(failedDialogStep("needsFullDiskAccess")).toEqual({
      step: "fullDiskAccess",
      checked: true,
    });
    expect(failedDialogStep("readFailed")).toEqual({
      step: "blocked",
      reason: "readFailed",
    });
    expect(
      refreshedDialogStep(
        { ...ready, unavailable: "needsFullDiskAccess" },
        { step: "fullDiskAccess", checked: false },
      ),
    ).toEqual({ step: "fullDiskAccess", checked: true });
    expect(refreshedDialogStep(undefined, { step: "configure" })).toEqual({
      step: "blocked",
      reason: "unknownSource",
    });
    expect(canCloseDialog({ step: "importing" })).toBe(false);
    expect(canCloseDialog({ step: "checking" })).toBe(true);
  });

  it("only opens a dialog for direct-import failures the user can fix", () => {
    expect(sourceAfterFailure(ready, "browserRunning")?.unavailable).toBe(
      "browserRunning",
    );
    expect(sourceAfterFailure(ready, "readFailed")).toBeNull();
  });

  it("chooses profiles and lists only installed browsers", () => {
    expect(needsProfileChoice(ready)).toBe(true);
    expect(
      needsProfileChoice({ ...ready, profiles: ready.profiles.slice(0, 1) }),
    ).toBe(false);
    expect(preferredSourceProfileDirectory("gone", ready)).toBe("Default");
    expect(
      listedSources([
        ready,
        { ...ready, id: "arc", unavailable: "notInstalled" },
        { ...ready, id: "safari", unavailable: "unsupportedPlatform" },
        { ...ready, id: "brave", unavailable: "browserRunning" },
      ]).map((source) => source.id),
    ).toEqual(["chrome", "brave"]);
  });

  it("keeps Safari importable when its cookie count is unknown", () => {
    expect(
      presentSourceRow(
        {
          id: "safari",
          name: "Safari",
          profiles: [{ directory: ".", name: "Safari" }],
        },
        undefined,
      ),
    ).toMatchObject({
      status: "Ready",
      action: "import",
      details: ["1 profile"],
    });
  });

  it("presents rows by state and last import", () => {
    expect(presentSourceRow(ready, undefined)).toEqual({
      status: "Ready",
      tone: "ready",
      details: ["2 profiles", "4,813 cookies"],
      action: "import",
      actionLabel: "Import…",
    });
    expect(
      presentSourceRow(ready, {
        at: 1,
        profileName: "Work",
        imported: 10,
        skipped: 2,
        skippedDomains: ["a.test", "b.test"],
      }).details,
    ).toEqual(["Work · 10 cookies imported", "2 skipped (a.test and b.test)"]);
    expect(
      presentSourceRow({ ...ready, unavailable: "browserRunning" }, undefined),
    ).toMatchObject({ action: "recheck", tone: "attention" });
    expect(
      presentSourceRow(
        { ...ready, unavailable: "needsFullDiskAccess" },
        undefined,
      ),
    ).toMatchObject({ action: "grant", actionLabel: "Grant access…" });
    expect(
      presentSourceRow(
        { ...ready, profiles: [{ directory: "d", name: "n", cookieCount: 0 }] },
        undefined,
      ),
    ).toMatchObject({ status: "No cookies yet", action: "none" });
  });

  it("reads persisted import records defensively", () => {
    const storage = new Map<string, string>();
    const fake = { getItem: (key: string) => storage.get(key) ?? null };
    expect(readBrowserImportRecords(fake)).toEqual({});
    storage.set("bb:browser-import:records", "not json");
    expect(readBrowserImportRecords(fake)).toEqual({});
    storage.set(
      "bb:browser-import:records",
      JSON.stringify({
        chrome: {
          at: 5,
          profileName: "p",
          imported: 1,
          skipped: 0,
          skippedDomains: ["x", 3],
        },
        firefox: { at: "bad" },
      }),
    );
    expect(readBrowserImportRecords(fake)).toEqual({
      chrome: {
        at: 5,
        profileName: "p",
        imported: 1,
        skipped: 0,
        skippedDomains: ["x"],
      },
    });
    expect(formatSkippedDomains(["a", "b", "c", "d"])).toBe(
      "a, b, c and 1 more",
    );
  });
});
