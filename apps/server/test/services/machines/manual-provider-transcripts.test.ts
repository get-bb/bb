import { expect, it, vi } from "vitest";
import { defaultAppSettings } from "@bb/domain";
import { getMachineLaunch, setAppSettings, listEvents } from "@bb/db";
import { withTestHarness } from "../../helpers/test-app.js";
import { seedHostSession, seedProjectWithSource } from "../../helpers/seed.js";
import { textInput } from "../../helpers/prompt-input.js";
import { createThreadFromRequest } from "../../../src/services/threads/thread-create.js";
import { advanceThreadProvisioning } from "../../../src/services/threads/thread-provisioning.js";
import { cancelMachineLaunch } from "../../../src/services/machines/provider-orchestration.js";

it.each(["cancel", "enroll"])(
  "never persists manual credentials in launches or provisioning transcripts after %s",
  async (settlement) => {
    await withTestHarness(async (h) => {
      setAppSettings(h.db, {
        ...defaultAppSettings,
        defaultMachineAccess: "direct",
        machineServerUrl: "https://machine.example.test",
      });
      await h.pluginService.install("builtin:machine-manual", { kind: "root" });
      const host = seedHostSession(h.deps, { id: "review-local" }).host;
      const { project } = seedProjectWithSource(h.deps, { hostId: host.id });
      const thread = await createThreadFromRequest(h.deps, {
        environment: {
          type: "provider",
          environmentProviderId: "project-checkout",
          machine: { type: "new", machineProviderId: "manual", inputs: null },
          inputs: {},
        },
        input: textInput("Manual enrollment"),
        origin: "app",
        projectId: project.id,
        providerId: "codex",
        model: "requested-model",
        startedOnBehalfOf: null,
      });
      await vi.waitFor(() =>
        expect(getMachineLaunch(h.db, thread.id)?.stepText).toBe(
          "Run the enrollment command shown in the picker",
        ),
      );
      const api = h.pluginService.getApi("machine-manual");
      if (!api) throw new Error("Missing plugin");
      const enrollment = await api.experimental_machines.prepareEnrollment({
        key: thread.id,
      });
      if (enrollment.state !== "pending")
        throw new Error("Expected pending enrollment");
      const url = `/api/v1/hosts/launches/${thread.id}/enrollment-command`;
      expect((await (await h.app.request(url)).json()).command).toContain(
        enrollment.bootstrap.credential,
      );
      await advanceThreadProvisioning(h.deps, { threadId: thread.id });
      const assertRedacted = () => {
        const events = listEvents(h.db, { threadId: thread.id });
        expect(
          events.some((event) =>
            JSON.stringify(event).includes(
              "Run the enrollment command shown in the picker",
            ),
          ),
        ).toBe(true);
        expect(JSON.stringify(events)).not.toContain(
          enrollment.bootstrap.credential,
        );
        expect(JSON.stringify(getMachineLaunch(h.db, thread.id))).not.toContain(
          enrollment.bootstrap.credential,
        );
        expect(JSON.stringify(events)).not.toContain("BB_ENROLLMENT=");
      };
      assertRedacted();
      if (settlement === "enroll") {
        expect(
          await h.deps.machineAuth.enrollHost({
            hostId: enrollment.hostId,
            token: enrollment.bootstrap.credential,
            allowPublicEnrollment: true,
          }),
        ).not.toBeNull();
      } else await cancelMachineLaunch(h.deps, thread.id);
      expect(await (await h.app.request(url)).json()).toEqual({
        command: null,
      });
      assertRedacted();
      await cancelMachineLaunch(h.deps, thread.id);
    });
  },
);
