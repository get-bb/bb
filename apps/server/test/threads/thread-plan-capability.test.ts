import { createBuiltinPlanCommandTextInput } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { acceptThreadSendRequest } from "../../src/services/threads/thread-send-request.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("plan capability admission", () => {
  it.each(["create", "send"] as const)(
    "rejects unsupported structured plan requests through %s",
    async (action) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps, { id: "host-plan" });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
          path: "/tmp/plan-capability",
          status: "ready",
        });
        const input = [
          createBuiltinPlanCommandTextInput("Plan adding HELLO.md"),
        ];
        const execution = {
          model: "test-model",
          permissionMode: "full" as const,
          reasoningLevel: "medium",
          serviceTier: "default" as const,
        };
        const result =
          action === "create"
            ? createThreadFromRequest(harness.deps, {
                ...execution,
                origin: "cli",
                startedOnBehalfOf: null,
                projectId: project.id,
                providerId: "pi",
                input,
                environment: { type: "reuse", environmentId: environment.id },
              })
            : acceptThreadSendRequest(harness.deps, {
                thread: seedThread(harness.deps, {
                  projectId: project.id,
                  environmentId: environment.id,
                  providerId: "pi",
                }),
                payload: { ...execution, input, mode: "start" },
              });
        await expect(result).rejects.toMatchObject({
          status: 400,
          body: { code: "invalid_request" },
          message:
            "Pi has no plan mode, so this message cannot be sent as a plan request. Send it without --plan.",
        });
      });
    },
  );
});
