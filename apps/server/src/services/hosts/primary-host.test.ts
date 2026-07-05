import { afterEach, describe, expect, it } from "vitest";
import { defaultExperiments } from "@bb/domain";
import { setExperiments } from "@bb/db";
import { ApiError } from "../../errors.js";
import { seedHostSession, seedPrimaryHost } from "../../../test/helpers/seed.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../../test/helpers/test-app.js";
import { assertUsableHostId, resolvePrimaryHostId } from "./primary-host.js";

let harness: TestAppHarness | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
});

/**
 * Multi-host execution: `assertUsableHostId` accepts any connected public host
 * (not just the primary) once the multi-machine experiment is on, while default
 * host resolution stays on the primary so single-host behavior is unchanged.
 */
describe("assertUsableHostId", () => {
  it("accepts a connected non-primary host when the multi-machine experiment is on", async () => {
    harness = await createTestAppHarness();
    const { host: primary } = seedHostSession(harness.deps, { name: "primary" });
    const { host: second } = seedHostSession(harness.deps, { name: "second" });
    seedPrimaryHost(harness.deps, primary.id);
    setExperiments(harness.deps.db, { ...defaultExperiments, multiMachine: true });

    // Both the primary and a second connected host are usable targets.
    expect(() =>
      assertUsableHostId(harness!.deps, { hostId: primary.id }),
    ).not.toThrow();
    expect(() =>
      assertUsableHostId(harness!.deps, { hostId: second.id }),
    ).not.toThrow();
  });

  it("rejects a non-primary host when the multi-machine experiment is off", async () => {
    harness = await createTestAppHarness();
    const { host: primary } = seedHostSession(harness.deps, { name: "primary" });
    const { host: second } = seedHostSession(harness.deps, { name: "second" });
    seedPrimaryHost(harness.deps, primary.id);

    // The primary stays usable with the experiment off (single-host default).
    expect(() =>
      assertUsableHostId(harness!.deps, { hostId: primary.id }),
    ).not.toThrow();

    try {
      assertUsableHostId(harness.deps, { hostId: second.id });
      throw new Error("expected assertUsableHostId to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(403);
      expect((error as ApiError).body.code).toBe("multi_machine_disabled");
    }
  });

  it("rejects an unknown host with 404", async () => {
    harness = await createTestAppHarness();
    const { host: primary } = seedHostSession(harness.deps, { name: "primary" });
    seedPrimaryHost(harness.deps, primary.id);

    try {
      assertUsableHostId(harness.deps, { hostId: "host_does_not_exist" });
      throw new Error("expected assertUsableHostId to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(404);
    }
  });

  it("keeps default host resolution on the primary even when a second host is connected", async () => {
    harness = await createTestAppHarness();
    const { host: primary } = seedHostSession(harness.deps, { name: "primary" });
    seedHostSession(harness.deps, { name: "second" });
    seedPrimaryHost(harness.deps, primary.id);

    // Default resolution is unchanged: still the file-pinned primary, not the
    // second connected host.
    expect(resolvePrimaryHostId(harness.deps)).toBe(primary.id);
  });
});
