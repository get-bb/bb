import { describe, expect, it } from "vitest";
import { pluginInstallBadge } from "../src/plugin-install-badge.js";

describe("pluginInstallBadge", () => {
  const now = Date.parse("2026-10-02T00:00:00Z");
  const recent = "2026-09-20T00:00:00Z";
  const old = "2026-08-01T00:00:00Z";
  const badge = (
    plugin: Partial<Parameters<typeof pluginInstallBadge>[0]>,
  ) =>
    pluginInstallBadge(
      { installs: null, installedByDefault: false, ...plugin },
      now,
    );

  it("labels plugins installed by default as built in", () => {
    expect(badge({ installedByDefault: true, installs: 2 })).toEqual({
      kind: "builtin",
    });
  });

  it("shows counts from the display minimum", () => {
    expect(badge({ installs: 25, publishedAt: recent })).toEqual({
      kind: "count",
      installs: 25,
    });
  });

  it("labels recent low-count plugins new until they age out", () => {
    expect(badge({ installs: 3, publishedAt: recent })).toEqual({
      kind: "new",
    });
    expect(badge({ installs: null, publishedAt: recent })).toEqual({
      kind: "new",
    });
    expect(badge({ installs: 3, publishedAt: old })).toEqual({
      kind: "count",
      installs: 3,
    });
    expect(badge({ installs: 3 })).toEqual({ kind: "count", installs: 3 });
    expect(badge({ installs: null, publishedAt: old })).toBeNull();
  });
});
