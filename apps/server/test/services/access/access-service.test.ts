import { describe, expect, it, vi } from "vitest";
import { createAccessService } from "../../../src/services/access/access-service.js";
import { createTestDb } from "../../helpers/test-app.js";

const DAY_MS = 86_400_000;

function service(now: () => number) {
  return createAccessService({
    db: createTestDb(),
    localToken: "bbl_test",
    signingKey: "test-signing-key",
    now,
  });
}

describe("access service housekeeping", () => {
  it("replaces the desktop's local window session when it is minted again, closing the old one's sockets", () => {
    const access = service(() => 1_000_000);
    const first = access.createLocalBrowserSession({
      label: "bb desktop",
      origin: "http://127.0.0.1:38886",
    });
    const closeFirst = vi.fn();
    access.trackSocket(first.credential.id, closeFirst);

    const second = access.createLocalBrowserSession({
      label: "bb desktop",
      origin: "http://127.0.0.1:38886",
    });

    expect(access.credentialForToken(first.token)).toBeNull();
    expect(access.credentialForToken(second.token)?.id).toBe(
      second.credential.id,
    );
    expect(closeFirst).toHaveBeenCalledOnce();
    expect(access.listCredentials().map((credential) => credential.id)).toEqual(
      [second.credential.id],
    );
  });

  it("sweeps sign-ins left unused past their lifetime and closes their sockets, keeping live ones", () => {
    let now = 1_000_000;
    const access = service(() => now);
    const idle = access.createBrowserSession({
      label: "Safari on iPhone",
      origin: "http://192.168.1.20:38886",
      secureOnly: false,
    });
    const closeIdle = vi.fn();
    access.trackSocket(idle.credential.id, closeIdle);

    now += 20 * DAY_MS;
    const active = access.createBrowserSession({
      label: "Chrome on Mac",
      origin: "http://192.168.1.20:38886",
      secureOnly: false,
    });
    now += 11 * DAY_MS;
    access.sweepExpired();

    expect(access.listCredentials().map((credential) => credential.id)).toEqual(
      [active.credential.id],
    );
    expect(closeIdle).toHaveBeenCalledOnce();
    expect(access.credentialForToken(idle.token)).toBeNull();
  });
});
