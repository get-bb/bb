import { updateHost } from "@bb/db";
import { describe, expect, it } from "vitest";
import { resolveHostPackageManager } from "../../../src/services/hosts/package-manager.js";
import { seedHost } from "../../helpers/seed.js";
import { withTestHarness } from "../../helpers/test-app.js";

describe("resolveHostPackageManager", () => {
  it("defaults to auto for a host without a setting or an override", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host_pm_default" });
      expect(resolveHostPackageManager(harness.deps, host.id)).toBe("auto");
      expect(resolveHostPackageManager(harness.deps, "host_missing")).toBe(
        "auto",
      );
    });
  });

  it("uses the stored setting when the daemon reported no override", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host_pm_setting" });
      updateHost(harness.db, harness.hub, host.id, {
        packageManager: "mise",
        packageManagerOverride: null,
      });
      expect(resolveHostPackageManager(harness.deps, host.id)).toBe("mise");
    });
  });

  it("lets the daemon override win over the stored setting", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host_pm_override" });
      updateHost(harness.db, harness.hub, host.id, {
        packageManager: "mise",
        packageManagerOverride: "npm",
      });
      expect(resolveHostPackageManager(harness.deps, host.id)).toBe("npm");
    });
  });
});
