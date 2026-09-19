import { afterEach, describe, expect, it } from "vitest";
import { updateHost } from "@bb/db";
import {
  seedHost,
  seedHostSession,
  seedPrimaryHost,
} from "../../../test/helpers/seed.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../../test/helpers/test-app.js";
import { ApiError } from "../../errors.js";
import {
  assertUsableHostId,
  requireConnectedPrimaryHostId,
  requirePrimaryHostId,
  resolvePrimaryHostId,
} from "./primary-host.js";

let harness: TestAppHarness | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
});

describe("primary host resolution", () => {
  it.each(["connected", "disconnected"])(
    "does not select a sole %s host without a local identity",
    async (status) => {
      harness = await createTestAppHarness();
      if (status === "connected") {
        seedHostSession(harness.deps, { name: "remote" });
      } else {
        seedHost(harness.deps, { name: "remote" });
      }
      const deps = harness.deps;

      expect(resolvePrimaryHostId(deps)).toBeNull();
      for (const requireHost of [
        requirePrimaryHostId,
        requireConnectedPrimaryHostId,
      ]) {
        expectApiError(() => requireHost(deps), {
          status: 502,
          code: "host_unavailable",
          message: "Local host daemon is not initialized",
        });
      }
    },
  );

  it.each(["missing", "destroyed"])(
    "does not select a connected remote host when the local record is %s",
    async (state) => {
      harness = await createTestAppHarness();
      const deps = harness.deps;
      seedHostSession(deps, { name: "remote" });
      if (state === "destroyed") {
        const local = seedHost(deps, { name: "local" });
        updateHost(deps.db, deps.hub, local.id, { destroyedAt: Date.now() });
        seedPrimaryHost(deps, local.id);
      } else {
        seedPrimaryHost(deps, "host_missing");
      }

      expect(resolvePrimaryHostId(deps)).toBeNull();
    },
  );

  it("keeps a disconnected local host instead of selecting a connected remote host", async () => {
    harness = await createTestAppHarness();
    const deps = harness.deps;
    const local = seedHost(deps, { name: "local" });
    seedPrimaryHost(deps, local.id);
    seedHostSession(deps, { name: "remote" });

    expect(resolvePrimaryHostId(deps)).toBe(local.id);
    expect(requirePrimaryHostId(deps)).toBe(local.id);
    expectApiError(() => requireConnectedPrimaryHostId(deps), {
      status: 502,
      code: "host_unavailable",
    });
  });
});

function expectApiError(
  operation: () => void,
  expected: { code: string; message?: string; status: number },
): void {
  try {
    operation();
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error;
    }
    expect(error.status).toBe(expected.status);
    expect(error.body.code).toBe(expected.code);
    if (expected.message !== undefined) {
      expect(error.body.message).toBe(expected.message);
    }
    return;
  }
  throw new Error("Expected operation to throw ApiError");
}

describe("assertUsableHostId", () => {
  it("accepts a non-primary public host", async () => {
    harness = await createTestAppHarness();
    const { host: primary } = seedHostSession(harness.deps, {
      name: "primary",
    });
    const { host: secondary } = seedHostSession(harness.deps, {
      name: "secondary",
    });
    seedPrimaryHost(harness.deps, primary.id);
    const deps = harness.deps;

    expect(() =>
      assertUsableHostId(deps, { hostId: secondary.id }),
    ).not.toThrow();
  });

  it("returns 404 for an unknown host", async () => {
    harness = await createTestAppHarness();
    const { host: primary } = seedHostSession(harness.deps, {
      name: "primary",
    });
    seedPrimaryHost(harness.deps, primary.id);
    const deps = harness.deps;

    expectApiError(
      () => assertUsableHostId(deps, { hostId: "host_does_not_exist" }),
      { code: "host_not_found", status: 404 },
    );
  });

  it("keeps default host resolution pinned to the primary", async () => {
    harness = await createTestAppHarness();
    const { host: primary } = seedHostSession(harness.deps, {
      name: "primary",
    });
    seedHostSession(harness.deps, { name: "secondary" });
    seedPrimaryHost(harness.deps, primary.id);

    expect(resolvePrimaryHostId(harness.deps)).toBe(primary.id);
  });

  it("resolves a provider-made machine when it is configured as primary", async () => {
    harness = await createTestAppHarness();
    const { host: providerMachine } = seedHostSession(harness.deps, {
      name: "sandbox",
    });
    seedHostSession(harness.deps, { name: "laptop" });
    seedPrimaryHost(harness.deps, providerMachine.id);

    expect(resolvePrimaryHostId(harness.deps)).toBe(providerMachine.id);
  });
});
