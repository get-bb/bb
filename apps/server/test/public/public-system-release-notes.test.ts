import { describe, expect, it } from "vitest";
import type { SystemReleaseNotesResponse } from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("GET /api/v1/system/release-notes", () => {
  it("reads the installed release's notes from the bundled changelog", async () => {
    await withTestHarness({ appVersion: "0.44.0" }, async (harness) => {
      const response = await harness.app.request(
        "/api/v1/system/release-notes",
      );

      expect(response.status).toBe(200);
      const body = (await readJson(response)) as SystemReleaseNotesResponse;
      expect(body.installedVersion).toBe("0.44.0");
      expect(body.releases).toHaveLength(1);
      expect(body.releases[0]?.version).toBe("0.44.0");
      expect(body.releases[0]?.headline).toBe(
        "Diff filtering, safer archiving, and plugin safe mode",
      );
      expect(body.releases[0]?.sections.length).toBeGreaterThan(0);
    });
  });

  it("lists releases since a version, newest first", async () => {
    await withTestHarness({ appVersion: "0.44.0" }, async (harness) => {
      const response = await harness.app.request(
        "/api/v1/system/release-notes?since=0.42.0",
      );

      expect(response.status).toBe(200);
      const body = (await readJson(response)) as SystemReleaseNotesResponse;
      expect(body.releases.map((release) => release.version)).toEqual([
        "0.44.0",
        "0.43.3",
        "0.43.0",
      ]);
    });
  });

  it("rejects version and since together", async () => {
    await withTestHarness({ appVersion: "0.44.0" }, async (harness) => {
      const response = await harness.app.request(
        "/api/v1/system/release-notes?version=0.44.0&since=0.42.0",
      );

      expect(response.status).toBe(400);
    });
  });
});
