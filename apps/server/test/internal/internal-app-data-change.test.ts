import { describe, expect, it, vi } from "vitest";
import { internalAuthHeaders } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("internal app-data change route", () => {
  it("broadcasts daemon-reported app data changes", async () => {
    await withTestHarness(async (harness) => {
      const { session } = seedHostSession(harness.deps, {
        id: "host-app-data-change",
      });
      const notifyAppDataSpy = vi.spyOn(harness.hub, "notifyAppData");

      const response = await harness.app.request(
        "/internal/session/app-data-change",
        {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body: JSON.stringify({
            sessionId: session.id,
            applicationId: "status",
            path: "state.json",
            value: { workers: [] },
            deleted: false,
            version: "version-next",
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(notifyAppDataSpy).toHaveBeenCalledWith({
        type: "app-data.changed",
        applicationId: "status",
        path: "state.json",
        value: { workers: [] },
        deleted: false,
        version: "version-next",
      });
    });
  });

  it("rejects daemon-reported app data changes for unknown sessions", async () => {
    await withTestHarness(async (harness) => {
      const notifyAppDataSpy = vi.spyOn(harness.hub, "notifyAppData");

      const response = await harness.app.request(
        "/internal/session/app-data-change",
        {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body: JSON.stringify({
            sessionId: "missing-session",
            applicationId: "status",
            path: "state.json",
            value: null,
            deleted: true,
            version: null,
          }),
        },
      );

      expect(response.status).toBe(401);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "inactive_session",
      });
      expect(notifyAppDataSpy).not.toHaveBeenCalled();
    });
  });

  it("broadcasts daemon-requested app data resync hints", async () => {
    await withTestHarness(async (harness) => {
      const { session } = seedHostSession(harness.deps, {
        id: "host-app-data-resync",
      });
      const notifyAppDataSpy = vi.spyOn(harness.hub, "notifyAppData");

      const response = await harness.app.request(
        "/internal/session/app-data-resync",
        {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body: JSON.stringify({
            sessionId: session.id,
            applicationId: "status",
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(notifyAppDataSpy).toHaveBeenCalledWith({
        type: "app-data.resync",
        applicationId: "status",
      });
    });
  });
});
