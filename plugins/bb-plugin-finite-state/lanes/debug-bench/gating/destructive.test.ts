import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openStore } from "../../../lib/store/index.js";
import {
  consumeDestructiveGrant,
  destructiveGrantAudit,
  DestructiveGateError,
  HELPER_INSTALL_OPERATION,
  mintDestructiveGrant,
  requestHumanConfirmation,
  type HumanConfirmationEvidence,
  type HumanConfirmationRequest,
} from "./destructive.js";
import type { GatingDeps } from "./mode.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

function fixture() {
  const host = createFakePluginHost({
    pluginId: `fs-destructive-${crypto.randomUUID()}`,
  });
  hosts.push(host);
  let current = new Date("2026-08-13T12:00:00.000Z");
  const deps: GatingDeps = {
    db: openStore(host.bb).db,
    sessionId: "session-a",
    now: () => current,
  };
  return {
    host,
    deps,
    advance(ms: number) {
      current = new Date(current.getTime() + ms);
    },
  };
}

async function confirm(
  fx: ReturnType<typeof fixture>,
  overrides: Partial<HumanConfirmationRequest> = {},
): Promise<HumanConfirmationEvidence> {
  const request: HumanConfirmationRequest = {
    threadId: "thread-a",
    toolName: HELPER_INSTALL_OPERATION,
    deviceId: "helper-pyocd",
    title: "Install pyOCD",
    detail: "Install the reviewed helper package.",
    command: "python -m pip install pyocd",
    ...overrides,
  };
  const pending = requestHumanConfirmation(fx.host.bb, fx.deps, request);
  await vi.waitFor(() =>
    expect(fx.host.harness.pendingInteractions).toHaveLength(1),
  );
  fx.host.harness.submitInteraction(
    fx.host.harness.pendingInteractions[0]!.id,
    {
      confirmed: true,
    },
  );
  return await pending;
}

async function grant(
  fx: ReturnType<typeof fixture>,
  evidence: HumanConfirmationEvidence,
) {
  return await mintDestructiveGrant(fx.deps, evidence, {
    threadId: evidence.threadId,
    toolName: evidence.toolName,
    deviceId: evidence.deviceId,
    expiresAt: evidence.expiresAt,
  });
}

afterEach(async () => {
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
});
describe("destructive grants", () => {
  it("mints only from server-issued human interaction evidence and audits origin", async () => {
    const fx = fixture();
    const evidence = await confirm(fx);
    const minted = await grant(fx, evidence);

    expect(destructiveGrantAudit(fx.deps, minted.grantId)).toMatchObject({
      callerOrigin: "bb.ui.requestInput",
      confirmedBy: expect.stringMatching(/^request-input-response:thread-a:/),
      grant: { consumedAt: null },
    });

    const executionContext = { threadId: "thread-a", turnId: "turn-a" };
    // @ts-expect-error A tool execution context is not human confirmation evidence.
    const rejected = mintDestructiveGrant(fx.deps, executionContext, {
      threadId: "thread-a",
      toolName: HELPER_INSTALL_OPERATION,
      deviceId: "helper-pyocd",
      expiresAt: "2026-08-13T12:01:00.000Z",
    });
    await expect(rejected).rejects.toBeInstanceOf(DestructiveGateError);
  });

  it("cannot mint destructive-grade grants from requestInput evidence", async () => {
    const fx = fixture();
    const flashRequest = {
      threadId: "thread-a",
      toolName: "fs_flash" as const,
      deviceId: "probe-a",
      title: "Flash device",
      detail: "Caller attempts to reuse the helper confirmation tier.",
      command: null,
    };
    const rejectedConfirmation = requestHumanConfirmation(
      fx.host.bb,
      fx.deps,
      // @ts-expect-error requestInput confirmation is statically helper-install-only.
      flashRequest,
    );
    await expect(rejectedConfirmation).rejects.toMatchObject({
      code: "DESTRUCTIVE_AUTHORIZATION_UNAVAILABLE",
    });
    expect(fx.host.harness.pendingInteractions).toHaveLength(0);

    const helperEvidence = await confirm(fx);
    const flashGrant = {
      threadId: helperEvidence.threadId,
      toolName: "fs_flash" as const,
      deviceId: helperEvidence.deviceId,
      expiresAt: helperEvidence.expiresAt,
    };
    const rejectedGrant = mintDestructiveGrant(
      fx.deps,
      helperEvidence,
      // @ts-expect-error requestInput grants are statically helper-install-only.
      flashGrant,
    );
    await expect(rejectedGrant).rejects.toMatchObject({
      code: "DESTRUCTIVE_AUTHORIZATION_UNAVAILABLE",
    });
  });

  it("atomically permits one consumer and rejects concurrent reuse", async () => {
    const fx = fixture();
    const evidence = await confirm(fx);
    await grant(fx, evidence);
    const context = {
      threadId: evidence.threadId,
      turnId: evidence.confirmationId,
    };
    const settled = await Promise.allSettled([
      consumeDestructiveGrant(
        fx.deps,
        evidence.toolName,
        evidence.deviceId,
        context,
      ),
      consumeDestructiveGrant(
        fx.deps,
        evidence.toolName,
        evidence.deviceId,
        context,
      ),
    ]);

    expect(
      settled.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      settled.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
  });

  it("rejects expired, prior-turn, wrong-tool, and wrong-device grants", async () => {
    const expired = fixture();
    const expiredEvidence = await confirm(expired);
    await grant(expired, expiredEvidence);
    expired.advance(60_001);
    await expect(
      consumeDestructiveGrant(
        expired.deps,
        expiredEvidence.toolName,
        expiredEvidence.deviceId,
        {
          threadId: expiredEvidence.threadId,
          turnId: expiredEvidence.confirmationId,
        },
      ),
    ).rejects.toMatchObject({ code: "DESTRUCTIVE_REQUIRES_GRANT" });

    const mismatched = fixture();
    const evidence = await confirm(mismatched);
    await grant(mismatched, evidence);
    await expect(
      consumeDestructiveGrant(
        mismatched.deps,
        evidence.toolName,
        evidence.deviceId,
        { threadId: evidence.threadId, turnId: "prior-turn" },
      ),
    ).rejects.toMatchObject({ code: "DESTRUCTIVE_REQUIRES_GRANT" });
    await expect(
      consumeDestructiveGrant(mismatched.deps, "fs_flash", evidence.deviceId, {
        threadId: evidence.threadId,
        turnId: evidence.confirmationId,
      }),
    ).rejects.toMatchObject({ code: "DESTRUCTIVE_REQUIRES_GRANT" });
    await expect(
      consumeDestructiveGrant(
        mismatched.deps,
        evidence.toolName,
        "helper-wrong",
        { threadId: evidence.threadId, turnId: evidence.confirmationId },
      ),
    ).rejects.toMatchObject({ code: "DESTRUCTIVE_REQUIRES_GRANT" });
  });

  it("keeps flash fail-closed while current-turn evidence is unavailable", async () => {
    const fx = fixture();
    await expect(
      consumeDestructiveGrant(fx.deps, "fs_flash", "probe-a", {
        threadId: "thread-a",
        turnId: null,
      }),
    ).rejects.toMatchObject({ code: "DESTRUCTIVE_AUTHORIZATION_UNAVAILABLE" });
  });
});
