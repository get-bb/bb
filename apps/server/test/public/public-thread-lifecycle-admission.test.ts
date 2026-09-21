import { archiveThread, getThread, markThreadDeleted } from "@bb/db";
import { threadSchema } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("public lifecycle ownership admission", () => {
  it.each(["live", "missing", "archived", "deleted"])(
    "validates a %s cross-project owner and keeps ownership creation-only",
    async (state) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps);
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
          path: "/tmp/lifecycle-admission",
        });
        const ownerProject = seedProjectWithSource(harness.deps, {
          hostId: host.id,
          path: "/tmp/lifecycle-admission-owner",
        }).project;
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
        });
        const owner = seedThread(harness.deps, { projectId: ownerProject.id });
        if (state === "archived")
          archiveThread(harness.db, harness.deps.hub, owner.id);
        if (state === "deleted")
          markThreadDeleted(harness.db, harness.deps.hub, {
            threadId: owner.id,
          });
        const response = await harness.app.request("/api/v1/threads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            origin: "cli",
            projectId: project.id,
            providerId: "codex",
            input: [{ type: "text", text: "Admission test" }],
            environment: { type: "reuse", environmentId: environment.id },
            sendAt: Date.now() + 3600_000,
            lifecycleOwnerThreadId:
              state === "missing" ? "thr_missing" : owner.id,
          }),
        });
        if (state !== "live") {
          expect(response.status).toBe(400);
          expect(await readJson(response)).toMatchObject({
            code: "invalid_request",
            message: expect.stringContaining("lifecycleOwnerThreadId"),
          });
          return;
        }
        expect(response.status).toBe(201);
        const created = threadSchema.parse(await readJson(response));
        expect(created.lifecycleOwnerThreadId).toBe(owner.id);
        for (const [id, target] of [
          [owner.id, created.id],
          [created.id, created.id],
          [created.id, null],
        ]) {
          const update = await harness.app.request(`/api/v1/threads/${id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ lifecycleOwnerThreadId: target }),
          });
          expect(update.status).toBe(400);
        }
        expect(
          getThread(harness.db, owner.id)?.lifecycleOwnerThreadId,
        ).toBeNull();
        expect(getThread(harness.db, created.id)?.lifecycleOwnerThreadId).toBe(
          owner.id,
        );
      });
    },
  );
});
