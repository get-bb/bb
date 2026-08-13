import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { openStore } from "../../../lib/store/index.js";
import { listClaimEvents } from "../registry/claims.js";
import { upsertCandidate } from "../registry/store.js";
import {
  DebugModeError,
  enterDebugMode,
  exitDebugMode,
  requireDebugMode,
  type GatingDeps,
} from "./mode.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

function fixture(deviceIds: string[]) {
  const host = createFakePluginHost({ pluginId: `fs-gating-mode-${crypto.randomUUID()}` });
  hosts.push(host);
  const db = openStore(host.bb).db;
  const scope = { projectId: "project-a", projectVersionId: null };
  const observedAt = "2026-08-13T12:00:00.000Z";
  const ids = deviceIds.map((stableIdentity) => upsertCandidate(
    db,
    scope,
    "fixture-probe",
    "probe",
    {
      stableIdentity,
      make: "Fixture",
      model: "Probe",
      connection: stableIdentity,
      transport: "local-usb",
    },
    observedAt,
  ).deviceId);
  let current = new Date(observedAt);
  const hints: unknown[] = [];
  const deps: GatingDeps = {
    db,
    sessionId: "session-a",
    now: () => current,
    debugModeTtlMs: 60_000,
    claimTtlMs: 5 * 60_000,
    publish: (_channel, payload) => hints.push(payload),
  };
  return {
    db,
    deps,
    hints,
    ids,
    advance(ms: number) { current = new Date(current.getTime() + ms); },
  };
}

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
});

describe("debug mode", () => {
  it("acquires WP-88 claims, persists state, and re-enters idempotently", async () => {
    const fx = fixture(["probe-a", "probe-b"]);
    const first = await enterDebugMode(fx.deps, "thread-a", fx.ids);
    const second = await enterDebugMode(fx.deps, "thread-a", [...fx.ids].reverse());

    expect(second).toEqual(first);
    expect(await requireDebugMode(fx.deps, { threadId: "thread-a", turnId: null }))
      .toEqual(first);
    expect(first.claims.map((claim) => claim.deviceId)).toEqual(fx.ids);
    expect(fx.hints).toEqual([{ threadId: "thread-a", transition: "entered" }]);
  });

  it("releases every claim on exit and on expiry", async () => {
    const exited = fixture(["probe-exit"]);
    await enterDebugMode(exited.deps, "thread-exit", exited.ids);
    await exitDebugMode(exited.deps, "thread-exit");
    expect(listClaimEvents(exited.db, exited.ids[0]!)).toContainEqual(expect.objectContaining({
      holder: "thread-exit",
      reason: "released",
    }));
    await expect(requireDebugMode(exited.deps, { threadId: "thread-exit", turnId: null }))
      .rejects.toMatchObject({ code: "DEBUG_MODE_REQUIRED" });

    const expired = fixture(["probe-expire"]);
    await enterDebugMode(expired.deps, "thread-expire", expired.ids);
    expired.advance(60_001);
    await expect(requireDebugMode(expired.deps, { threadId: "thread-expire", turnId: null }))
      .rejects.toMatchObject({ code: "DEBUG_MODE_EXPIRED" });
    expect(listClaimEvents(expired.db, expired.ids[0]!)).toContainEqual(expect.objectContaining({
      holder: "thread-expire",
      reason: "released",
    }));
  });

  it("refuses outside mode before any instrument side effect", async () => {
    const fx = fixture([]);
    let sideEffects = 0;
    await expect(
      requireDebugMode(fx.deps, { threadId: "thread-outside", turnId: null })
        .then(() => { sideEffects += 1; }),
    ).rejects.toBeInstanceOf(DebugModeError);
    expect(sideEffects).toBe(0);
  });

  it("rolls back claims when a later device cannot be acquired", async () => {
    const fx = fixture(["probe-good"]);
    await expect(enterDebugMode(
      fx.deps,
      "thread-rollback",
      [fx.ids[0]!, "missing-device"],
    )).rejects.toMatchObject({ code: "DEVICE_NOT_FOUND" });
    expect(listClaimEvents(fx.db, fx.ids[0]!)).toContainEqual(expect.objectContaining({
      holder: "thread-rollback",
      reason: "released",
    }));
  });
});
