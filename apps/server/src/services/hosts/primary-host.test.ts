import { setExperiments } from "@bb/db";
import { defaultExperiments } from "@bb/domain";
import { afterEach, describe, expect, it } from "vitest";
import {
  seedHostSession,
  seedPrimaryHost,
} from "../../../test/helpers/seed.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../../test/helpers/test-app.js";
import { ApiError } from "../../errors.js";
import { assertUsableHostId, resolvePrimaryHostId } from "./primary-host.js";

let harness: TestAppHarness | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
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
  it("accepts a non-primary public host when Multi-machine is enabled", async () => {
    harness = await createTestAppHarness();
    const { host: primary } = seedHostSession(harness.deps, {
      name: "primary",
    });
    const { host: secondary } = seedHostSession(harness.deps, {
      name: "secondary",
    });
    seedPrimaryHost(harness.deps, primary.id);
    setExperiments(harness.db, {
      ...defaultExperiments,
      multiMachine: true,
    });
    const deps = harness.deps;

    expect(() =>
      assertUsableHostId(deps, { hostId: secondary.id }),
    ).not.toThrow();
  });

  it("preserves the primary-only unsupported_host error when disabled", async () => {
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
      assertUsableHostId(deps, { hostId: primary.id }),
    ).not.toThrow();
    expectApiError(() => assertUsableHostId(deps, { hostId: secondary.id }), {
      code: "unsupported_host",
      message: "Non-primary machines require the Multi-machine experiment",
      status: 400,
    });
  });

  it("returns 404 for an unknown host when Multi-machine is enabled", async () => {
    harness = await createTestAppHarness();
    const { host: primary } = seedHostSession(harness.deps, {
      name: "primary",
    });
    seedPrimaryHost(harness.deps, primary.id);
    setExperiments(harness.db, {
      ...defaultExperiments,
      multiMachine: true,
    });
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
    setExperiments(harness.db, {
      ...defaultExperiments,
      multiMachine: true,
    });

    expect(resolvePrimaryHostId(harness.deps)).toBe(primary.id);
  });
});
