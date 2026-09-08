import { expect, it, vi } from "vitest";
import { defaultAppSettings } from "@bb/domain";
import { getMachineLaunch, setAppSettings, listEvents } from "@bb/db";
import { withTestHarness } from "../../helpers/test-app.js";
import { seedHostSession, seedProjectWithSource } from "../../helpers/seed.js";
import { textInput } from "../../helpers/prompt-input.js";
import { createThreadFromRequest } from "../../../src/services/threads/thread-create.js";
import { advanceThreadProvisioning } from "../../../src/services/threads/thread-provisioning.js";
import {
  cancelMachineLaunch,
  requestMachineRemoval,
  sweepProviderMachine,
} from "../../../src/services/machines/provider-orchestration.js";

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

it("returns the current thread replacement command without reviving consumed launches", async () => {
  await withTestHarness(async (h) => {
    setAppSettings(h.db, {
      ...defaultAppSettings,
      defaultMachineAccess: "direct",
      machineServerUrl: "https://machine.example.test",
    });
    await h.pluginService.install("builtin:machine-manual", { kind: "root" });
    const host = seedHostSession(h.deps, { id: "replacement-local" }).host;
    const { project } = seedProjectWithSource(h.deps, { hostId: host.id });
    const thread = await createThreadFromRequest(h.deps, {
      environment: {
        type: "provider",
        environmentProviderId: "project-checkout",
        machine: { type: "new", machineProviderId: "manual", inputs: null },
        inputs: {},
      },
      input: textInput("Manual replacement enrollment"),
      origin: "app",
      projectId: project.id,
      providerId: "codex",
      model: "requested-model",
      startedOnBehalfOf: null,
    });
    const api = h.pluginService.getApi("machine-manual");
    if (!api) throw new Error("Missing plugin");
    const url = (id: string) =>
      `/api/v1/hosts/launches/${encodeURIComponent(id)}/enrollment-command`;
    const threadUrl = `${url(thread.id)}?scope=thread`;
    const consumedKeys: string[] = [];
    let key = thread.id;
    for (let generation = 0; generation < 3; generation++) {
      await vi.waitFor(() =>
        expect(getMachineLaunch(h.db, key)?.stepText).toBe(
          "Run the enrollment command shown in the picker",
        ),
      );
      const enrollment = await api.experimental_machines.prepareEnrollment({
        key,
      });
      if (enrollment.state !== "pending")
        throw new Error("Expected enrollment");
      const response = await h.app.request(threadUrl);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect((await response.json()).command).toContain(
        enrollment.bootstrap.credential,
      );
      expect((await (await h.app.request(url(key))).json()).command).toContain(
        enrollment.bootstrap.credential,
      );
      for (const consumed of consumedKeys) {
        expect(await (await h.app.request(url(consumed))).json()).toEqual({
          command: null,
        });
      }
      expect((await h.app.request(`${url(key)}?scope=invalid`)).status).toBe(
        400,
      );
      const forbidden = await h.app.request(threadUrl, {
        headers: {
          "x-bb-gate-auth": "machine",
          "x-bb-gate-machine-id": enrollment.hostId,
        },
      });
      expect(forbidden.status).toBe(403);
      if (generation === 2) {
        await cancelMachineLaunch(h.deps, key);
        expect(await (await h.app.request(threadUrl)).json()).toEqual({
          command: null,
        });
        break;
      }
      expect(
        await h.deps.machineAuth.enrollHost({
          hostId: enrollment.hostId,
          token: enrollment.bootstrap.credential,
          allowPublicEnrollment: true,
        }),
      ).not.toBeNull();
      h.hub.registerDaemon(
        `replacement-session-${generation}`,
        enrollment.hostId,
        {
          close() {},
          send() {},
        },
      );
      await vi.waitFor(() =>
        expect(getMachineLaunch(h.db, key)?.phase).toBe("ready"),
      );
      expect(await (await h.app.request(threadUrl)).json()).toEqual({
        command: null,
      });
      expect(requestMachineRemoval(h.deps, enrollment.hostId)).toBe(true);
      await sweepProviderMachine(h.deps, enrollment.hostId);
      consumedKeys.push(key);
      key = `${thread.id}:replacement:${enrollment.hostId}`;
      expect(await (await h.app.request(threadUrl)).json()).toEqual({
        command: null,
      });
      await advanceThreadProvisioning(h.deps, { threadId: thread.id });
    }
  });
});
