import { getAiServiceSelections, setAiServiceSelection } from "@bb/db";
import {
  systemAiServicesResponseSchema,
  testAiServiceResponseSchema,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { registerFakeAiService } from "../helpers/ai-services.js";
import { readJson } from "../helpers/json.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function putSelection(harness: TestAppHarness, body: unknown) {
  return harness.app.request("/api/v1/system/ai-services/selection", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function postTest(harness: TestAppHarness, body: unknown) {
  return harness.app.request("/api/v1/system/ai-services/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function registerServices(harness: TestAppHarness) {
  const text = registerFakeAiService(harness.deps.aiServices, {
    id: "helper",
    displayName: "Helper",
    pluginId: "helper-plugin",
    complete: async () => 'Title: "Add a dark mode toggle"',
  });
  const voice = registerFakeAiService(harness.deps.aiServices, {
    id: "listener",
    displayName: "Listener",
    pluginId: "listener-plugin",
    complete: null,
    transcribe: async () => "hello",
  });
  return { text, voice };
}

describe("AI services routes", () => {
  it("saves a selection for a loaded service that handles the task", async () => {
    await withTestHarness({}, async (harness) => {
      registerServices(harness);

      const response = await putSelection(harness, {
        task: "thread-title",
        selection: {
          mode: "service",
          pluginId: "helper-plugin",
          serviceId: "helper",
        },
      });

      expect(response.status).toBe(200);
      const view = systemAiServicesResponseSchema.parse(
        await readJson(response),
      );
      expect(view.selections["thread-title"]).toEqual({
        mode: "service",
        pluginId: "helper-plugin",
        serviceId: "helper",
      });
      expect(getAiServiceSelections(harness.db)["thread-title"]).toEqual(
        view.selections["thread-title"],
      );

      const off = await putSelection(harness, {
        task: "thread-title",
        selection: { mode: "off" },
      });
      expect(off.status).toBe(200);
      expect(getAiServiceSelections(harness.db)["thread-title"]).toEqual({
        mode: "off",
      });
    });
  });

  it.each([
    [
      "an unknown service",
      {
        task: "thread-title",
        selection: {
          mode: "service",
          pluginId: "helper-plugin",
          serviceId: "missing",
        },
      },
      'No loaded plugin "helper-plugin" serves AI service "missing"',
    ],
    [
      "a service id served by a different plugin",
      {
        task: "thread-title",
        selection: {
          mode: "service",
          pluginId: "someone-else",
          serviceId: "helper",
        },
      },
      'No loaded plugin "someone-else" serves AI service "helper"',
    ],
    [
      "a service that does not handle the task",
      {
        task: "thread-title",
        selection: {
          mode: "service",
          pluginId: "listener-plugin",
          serviceId: "listener",
        },
      },
      'AI service "listener" does not handle thread-title',
    ],
    [
      "a service selection without a plugin id",
      { task: "voice", selection: { mode: "service", serviceId: "listener" } },
      null,
    ],
    [
      "an unknown task",
      { task: "subtitles", selection: { mode: "off" } },
      null,
    ],
  ])("rejects %s without saving", async (_label, body, message) => {
    await withTestHarness({}, async (harness) => {
      registerServices(harness);

      const response = await putSelection(harness, body);

      expect(response.status).toBe(400);
      const error = await readJson(response);
      expect(error).toMatchObject({ code: "invalid_request" });
      if (message !== null) {
        expect(error).toMatchObject({ message });
      }
      expect(getAiServiceSelections(harness.db)).toEqual({
        "thread-title": { mode: "automatic" },
        "commit-message": { mode: "automatic" },
        voice: { mode: "automatic" },
      });
    });
  });

  it("runs a sample through the selected service and cleans the reply", async () => {
    await withTestHarness({}, async (harness) => {
      const { text } = registerServices(harness);
      setAiServiceSelection(harness.deps.db, "thread-title", {
        mode: "service",
        pluginId: "helper-plugin",
        serviceId: "helper",
      });

      const response = await postTest(harness, { task: "thread-title" });

      expect(response.status).toBe(200);
      expect(
        testAiServiceResponseSchema.parse(await readJson(response)),
      ).toMatchObject({
        ok: true,
        pluginId: "helper-plugin",
        serviceId: "helper",
        displayName: "Helper",
        text: "Add a dark mode toggle",
      });
      expect(text.completeCalls).toHaveLength(1);
      expect(text.completeCalls[0]?.prompt).toContain("dark mode toggle");
    });
  });

  it("reports a failed or unavailable test as ok: false", async () => {
    await withTestHarness({}, async (harness) => {
      const unavailable = await postTest(harness, { task: "commit-message" });
      expect(unavailable.status).toBe(200);
      expect(
        testAiServiceResponseSchema.parse(await readJson(unavailable)),
      ).toMatchObject({ ok: false, message: "No AI service is available" });

      registerFakeAiService(harness.deps.aiServices, {
        id: "broken",
        displayName: "Broken",
        pluginId: "broken-plugin",
        complete: async () => {
          throw new Error("bad key");
        },
      });
      setAiServiceSelection(harness.deps.db, "commit-message", {
        mode: "service",
        pluginId: "broken-plugin",
        serviceId: "broken",
      });
      const failed = await postTest(harness, { task: "commit-message" });
      expect(
        testAiServiceResponseSchema.parse(await readJson(failed)),
      ).toMatchObject({ ok: false, message: "Broken: bad key" });
    });
  });

  it("rejects a test for voice, which has no text sample", async () => {
    await withTestHarness({}, async (harness) => {
      const response = await postTest(harness, { task: "voice" });
      expect(response.status).toBe(400);
    });
  });
});
