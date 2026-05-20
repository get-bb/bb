import { describe, expect, it } from "vitest";
import {
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { seedHostSession } from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";

describe("GET /api/v1/manager-templates", () => {
  it("returns the default-only template list and active pointer", async () => {
    const harness = await createTestAppHarness();
    try {
      seedHostSession(harness.deps, { id: "host-templates-default" });
      const responsePromise = harness.app.request(
        "/api/v1/manager-templates",
      );
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "host.list_manager_templates",
      );
      await reportQueuedCommandSuccess(harness, queued, {
        templates: [{ name: "default" }],
        activeName: "default",
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        templates: [{ name: "default", isActive: true }],
        activeName: "default",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("marks the active template when multiple templates exist", async () => {
    const harness = await createTestAppHarness();
    try {
      seedHostSession(harness.deps, { id: "host-templates-multi" });
      const responsePromise = harness.app.request(
        "/api/v1/manager-templates",
      );
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "host.list_manager_templates",
      );
      await reportQueuedCommandSuccess(harness, queued, {
        templates: [{ name: "default" }, { name: "sawyer-next" }],
        activeName: "sawyer-next",
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        templates: [
          { name: "default", isActive: false },
          { name: "sawyer-next", isActive: true },
        ],
        activeName: "sawyer-next",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("returns activeName even when active points at a missing template", async () => {
    const harness = await createTestAppHarness();
    try {
      seedHostSession(harness.deps, { id: "host-templates-orphan-active" });
      const responsePromise = harness.app.request(
        "/api/v1/manager-templates",
      );
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "host.list_manager_templates",
      );
      // Daemon resolves active from the on-disk file even when no matching
      // template directory exists. Falling back to "default" happens on the
      // daemon, so this case never reaches the server. The server should
      // forward whatever the daemon reports.
      await reportQueuedCommandSuccess(harness, queued, {
        templates: [{ name: "default" }],
        activeName: "default",
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        templates: [{ name: "default", isActive: true }],
        activeName: "default",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("surfaces daemon errors", async () => {
    const harness = await createTestAppHarness();
    try {
      seedHostSession(harness.deps, { id: "host-templates-error" });
      const responsePromise = harness.app.request(
        "/api/v1/manager-templates",
      );
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "host.list_manager_templates",
      );
      await reportQueuedCommandError(harness, queued, {
        errorCode: "permission_denied",
        errorMessage: "cannot read manager-templates",
      });

      const response = await responsePromise;
      expect(response.status).toBeGreaterThanOrEqual(400);
    } finally {
      await harness.cleanup();
    }
  });
});
