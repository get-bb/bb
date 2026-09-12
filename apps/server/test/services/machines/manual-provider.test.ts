import { expect, it, vi } from "vitest";
import { defaultAppSettings } from "@bb/domain";
import { getHost, setAppSettings } from "@bb/db";
import { withTestHarness } from "../../helpers/test-app.js";
import { seedHost, seedPrimaryHost } from "../../helpers/seed.js";

it("creates, enrolls, and removes a manual machine by host id", async () => {
  await withTestHarness(async (harness) => {
    seedPrimaryHost(harness.deps, "local");
    seedHost(harness.deps, { id: "local" });
    setAppSettings(harness.db, {
      ...defaultAppSettings,
      defaultMachineAccess: "direct",
      machineServerUrl: "https://machine.example.test",
    });
    const response = await harness.app.request("/api/v1/hosts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: "manual-host",
        machineProviderId: "manual",
        inputs: null,
      }),
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    await vi.waitFor(() =>
      expect(getHost(harness.db, created.id)).toMatchObject({
        phase: "creating",
        statusMessage: "Run the enrollment command shown below",
      }),
    );
    const commandResponse = await harness.app.request(
      `/api/v1/hosts/${created.id}/enrollment-command`,
    );
    expect(commandResponse.status).toBe(200);
    const enrollment = (await commandResponse.json()) as {
      command: string;
      expiresAt: number;
    };
    const credential = enrollment.command.match(
      /X-BB-Enrollment: ([^']+)/u,
    )?.[1];
    expect(credential).toBeTruthy();
    expect(JSON.stringify(getHost(harness.db, created.id))).not.toContain(
      credential,
    );

    const enrolled = await harness.deps.machineAuth.enrollHost({
      hostId: created.id,
      token: credential!,
    });
    expect(enrolled).not.toBeNull();
    harness.hub.registerDaemon("manual-session", created.id, {
      close() {},
      send() {},
    });
    await expect
      .poll(() => getHost(harness.db, created.id)?.phase)
      .toBe("active");
    expect(getHost(harness.db, created.id)).toMatchObject({
      launchKey: "manual-host",
      machineProviderId: "manual",
      resource: { key: "manual-host" },
    });
    expect(
      await (
        await harness.app.request(
          `/api/v1/hosts/${created.id}/enrollment-command`,
        )
      ).json(),
    ).toBeNull();

    const removed = await harness.app.request(`/api/v1/hosts/${created.id}`, {
      method: "DELETE",
    });
    expect({
      status: removed.status,
      body: await removed.clone().json(),
    }).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(getHost(harness.db, created.id)?.phase).toBe("destroyed");
  });
});
