import { defaultUiPreferences, UI_PREFERENCE_KEYS } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import { readJson } from "../helpers/json.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

async function listPreferences(harness: TestAppHarness): Promise<Response> {
  return harness.app.request("/api/v1/preferences/ui");
}

async function putPreference(
  harness: TestAppHarness,
  key: string,
  body: { expectedRevision: number; value: unknown },
): Promise<Response> {
  return harness.app.request(`/api/v1/preferences/ui/${key}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });
}

async function resetPreference(
  harness: TestAppHarness,
  key: string,
): Promise<Response> {
  return harness.app.request(`/api/v1/preferences/ui/${key}`, {
    method: "DELETE",
  });
}

describe("public ui preferences", () => {
  it("persists hidden groups across organizations without changing saved order", async () => {
    await withTestHarness(async (harness) => {
      const key = "sidebar.hiddenGroups";
      const order = ["project:proj_active", "project:proj_hidden", "threads"];
      expect(await readJson(await listPreferences(harness))).toMatchObject({
        preferences: { [key]: { revision: 0, value: [] } },
      });
      expect(
        (
          await putPreference(harness, "sidebar.sectionOrder", {
            expectedRevision: 0,
            value: order,
          })
        ).status,
      ).toBe(200);
      const hidden = [
        "project:proj_hidden",
        "section:section_review",
        "machine:host_offline",
        "project:proj_deleted",
      ];
      const saved = await putPreference(harness, key, {
        expectedRevision: 0,
        value: [...hidden, hidden[0]],
      });
      expect(saved.status).toBe(200);
      expect(await readJson(saved)).toMatchObject({
        revision: 1,
        value: hidden,
      });
      expect(await readJson(await listPreferences(harness))).toMatchObject({
        preferences: { [key]: { revision: 1, value: hidden } },
      });
      const replaced = await putPreference(harness, key, {
        expectedRevision: 1,
        value: ["section:section_review"],
      });
      expect(replaced.status).toBe(200);
      expect(await readJson(replaced)).toMatchObject({
        revision: 2,
        value: ["section:section_review"],
      });
      expect(await readJson(await resetPreference(harness, key))).toMatchObject({
        revision: 3,
        value: [],
      });
      expect(await readJson(await listPreferences(harness))).toMatchObject({
        preferences: {
          [key]: { revision: 3, value: [] },
          "sidebar.sectionOrder": { revision: 1, value: order },
        },
      });
    });
  });

  it("rejects built-in, malformed, and oversized hidden-group lists", async () => {
    await withTestHarness(async (harness) => {
      const key = "sidebar.hiddenGroups";
      const invalidValues = [
        null,
        "project:proj_hidden",
        [12],
        ["pinned"],
        ["threads"],
        ["environment:env_1"],
        ["project:"],
        ["section:"],
        ["machine:"],
        ["project: "],
        [`project:${"x".repeat(1_024)}`],
        Array.from({ length: 10_001 }, () => "project:proj_hidden"),
      ];
      for (const value of invalidValues) {
        expect(
          (await putPreference(harness, key, { expectedRevision: 0, value }))
            .status,
        ).toBe(400);
      }
      expect(await readJson(await listPreferences(harness))).toMatchObject({
        preferences: { [key]: { revision: 0, value: [] } },
      });
    });
  });

  it("retains unavailable footer IDs and rejects malformed footer preferences", async () => {
    await withTestHarness(async (harness) => {
      for (const key of ["sidebar.footerOrder", "sidebar.hiddenFooterItems"]) {
        const value = [
          "plugin:disabled%2Fplugin/item%2Fid",
          "builtin:settings",
          "plugin:unknown/item",
        ];
        expect(
          (await putPreference(harness, key, { expectedRevision: 0, value }))
            .status,
        ).toBe(200);
        expect(await readJson(await listPreferences(harness))).toMatchObject({
          preferences: { [key]: { value, revision: 1 } },
        });
        expect(
          (
            await putPreference(harness, key, {
              expectedRevision: 1,
              value: [12],
            })
          ).status,
        ).toBe(400);
        expect(
          await readJson(await resetPreference(harness, key)),
        ).toMatchObject({ value: [] });
      }
    });
  });

  it("adds sort direction without replacing an existing sort field and can reset it", async () => {
    await withTestHarness(async (harness) => {
      expect(
        (
          await putPreference(harness, "sidebar.chronologicalSort", {
            expectedRevision: 0,
            value: "alpha",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await putPreference(harness, "sidebar.sortDirection", {
            expectedRevision: 0,
            value: "descending",
          })
        ).status,
      ).toBe(200);
      expect(await readJson(await listPreferences(harness))).toMatchObject({
        preferences: {
          "sidebar.chronologicalSort": { value: "alpha", revision: 1 },
          "sidebar.sortDirection": { value: "descending", revision: 1 },
        },
      });
      expect(
        (
          await putPreference(harness, "sidebar.sortDirection", {
            expectedRevision: 1,
            value: "sideways",
          })
        ).status,
      ).toBe(400);
      expect(
        await readJson(await resetPreference(harness, "sidebar.sortDirection")),
      ).toMatchObject({ value: "default" });
    });
  });

  it("lists every registered preference with defaults at revision 0", async () => {
    await withTestHarness(async (harness) => {
      const response = await listPreferences(harness);
      expect(response.status).toBe(200);
      const body = (await readJson(response)) as {
        preferences: Record<string, { revision: number; value: unknown }>;
      };
      expect(Object.keys(body.preferences).sort()).toEqual(
        [...UI_PREFERENCE_KEYS].sort(),
      );
      for (const key of UI_PREFERENCE_KEYS) {
        expect(body.preferences[key]).toEqual({
          revision: 0,
          value: defaultUiPreferences[key],
        });
      }
    });
  });

  it("defaults new installations to Custom without persisting a choice", async () => {
    await withTestHarness(async (harness) => {
      expect(await readJson(await listPreferences(harness))).toMatchObject({
        preferences: {
          "sidebar.organizationMode": { revision: 0, value: "chronological" },
        },
      });
      expect(
        harness.db.$client
          .prepare("SELECT key FROM ui_preferences WHERE key = ?")
          .get("sidebar.organizationMode"),
      ).toBeUndefined();
    });
  });

  it("exposes an installation fallback at revision zero and accepts legacy choices", async () => {
    await withTestHarness(async (harness) => {
      harness.db.$client.exec(
        `INSERT INTO ui_preference_defaults VALUES ('sidebar.organizationMode', '"project"')`,
      );
      expect(await readJson(await listPreferences(harness))).toMatchObject({
        preferences: {
          "sidebar.organizationMode": { revision: 0, value: "project" },
        },
      });
      expect(
        (
          await putPreference(harness, "sidebar.organizationMode", {
            expectedRevision: 0,
            value: "machine",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await putPreference(harness, "sidebar.organizationMode", {
            expectedRevision: 0,
            value: "chronological",
          })
        ).status,
      ).toBe(409);
      expect(await readJson(await listPreferences(harness))).toMatchObject({
        preferences: {
          "sidebar.organizationMode": { revision: 1, value: "machine" },
        },
      });
      expect(
        await readJson(
          await resetPreference(harness, "sidebar.organizationMode"),
        ),
      ).toMatchObject({ revision: 2, value: "project" });
    });
  });

  it.each(["project", "machine", "chronological"])(
    "preserves saved %s organization over the installation fallback",
    async (value) => {
      await withTestHarness(async (harness) => {
        harness.db.$client.exec(
          `INSERT INTO ui_preference_defaults VALUES ('sidebar.organizationMode', '"project"')`,
        );
        harness.db.$client
          .prepare(
            "INSERT INTO ui_preferences (key, value_json, revision, updated_at) VALUES (?, ?, 3, 1)",
          )
          .run("sidebar.organizationMode", JSON.stringify(value));
        expect(await readJson(await listPreferences(harness))).toMatchObject({
          preferences: {
            "sidebar.organizationMode": { revision: 3, value },
          },
        });
      });
    },
  );

  it("writes with revision checks, broadcasts, and rejects stale writes", async () => {
    await withTestHarness(async (harness) => {
      const notifySystem = vi.spyOn(harness.hub, "notifySystem");

      const first = await putPreference(harness, "sidebar.organizationMode", {
        expectedRevision: 0,
        value: "machine",
      });
      expect(first.status).toBe(200);
      expect(await readJson(first)).toEqual({
        key: "sidebar.organizationMode",
        revision: 1,
        value: "machine",
      });
      expect(notifySystem).toHaveBeenCalledWith(["ui-preferences-changed"]);

      const stale = await putPreference(harness, "sidebar.organizationMode", {
        expectedRevision: 0,
        value: "chronological",
      });
      expect(stale.status).toBe(409);
      expect(await readJson(stale)).toEqual({
        code: "ui_preference_conflict",
        details: { currentRevision: 1 },
        message: "UI preference changed on another client",
      });
      expect(notifySystem).toHaveBeenCalledTimes(1);

      const listed = (await readJson(await listPreferences(harness))) as {
        preferences: Record<string, { revision: number; value: unknown }>;
      };
      expect(listed.preferences["sidebar.organizationMode"]).toEqual({
        revision: 1,
        value: "machine",
      });
      expect(listed.preferences["sidebar.chronologicalSort"]).toEqual({
        revision: 0,
        value: "updated",
      });
    });
  });

  it("rejects unknown keys and values that fail the preference schema", async () => {
    await withTestHarness(async (harness) => {
      const unknown = await putPreference(harness, "sidebar.nope", {
        expectedRevision: 0,
        value: "x",
      });
      expect(unknown.status).toBe(404);
      expect((await readJson(unknown)) as { code: string }).toMatchObject({
        code: "ui_preference_not_found",
      });

      const invalidEnum = await putPreference(
        harness,
        "sidebar.organizationMode",
        { expectedRevision: 0, value: "by-color" },
      );
      expect(invalidEnum.status).toBe(400);

      const invalidList = await putPreference(
        harness,
        "sidebar.collapsedThreads",
        { expectedRevision: 0, value: ["thr_1", 2] },
      );
      expect(invalidList.status).toBe(400);

      const missingValue = await putPreference(
        harness,
        "sidebar.collapsedThreads",
        { expectedRevision: 0, value: undefined },
      );
      expect(missingValue.status).toBe(400);

      const nullable = await putPreference(
        harness,
        "sidebar.visiblePluginPanels",
        { expectedRevision: 0, value: null },
      );
      expect(nullable.status).toBe(200);

      const unknownReset = await resetPreference(harness, "sidebar.nope");
      expect(unknownReset.status).toBe(404);
    });
  });

  it("resets to the default while advancing the revision", async () => {
    await withTestHarness(async (harness) => {
      await putPreference(harness, "sidebar.sectionOrder", {
        expectedRevision: 0,
        value: ["threads", "pinned", "projects"],
      });
      const reset = await resetPreference(harness, "sidebar.sectionOrder");
      expect(reset.status).toBe(200);
      expect(await readJson(reset)).toEqual({
        key: "sidebar.sectionOrder",
        revision: 2,
        value: ["pinned", "projects", "threads"],
      });

      const stale = await putPreference(harness, "sidebar.sectionOrder", {
        expectedRevision: 1,
        value: ["pinned", "threads", "projects"],
      });
      expect(stale.status).toBe(409);
    });
  });

  it("falls back to the default when a stored value no longer parses", async () => {
    await withTestHarness(async (harness) => {
      harness.db.$client.exec(
        `INSERT INTO ui_preferences (key, value_json, revision, updated_at) VALUES ('sidebar.organizationMode', '"by-color"', 4, 1), ('sidebar.unknownKey', '1', 2, 1)`,
      );
      const listed = (await readJson(await listPreferences(harness))) as {
        preferences: Record<string, { revision: number; value: unknown }>;
      };
      expect(listed.preferences["sidebar.organizationMode"]).toEqual({
        revision: 4,
        value: "chronological",
      });
      expect(listed.preferences["sidebar.unknownKey"]).toBeUndefined();
    });
  });
});
