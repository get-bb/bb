import { beforeEach, describe, expect, it, vi } from "vitest";

const redeemPairing = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sdk", () => ({
  sdk: { experimental_access: { redeemPairing } },
}));

import { pairingErrorMessage } from "./pairing-code";
import { redeemPairingCode } from "./redeem-pairing";

describe("redeemPairingCode", () => {
  beforeEach(() => {
    redeemPairing.mockReset();
    redeemPairing.mockResolvedValue({ kind: "browser" });
  });

  it("lets the desktop shell bind a direct server sign-in to its key instead of taking a browser cookie", async () => {
    const pairServer = vi.fn().mockResolvedValue({ ok: true });
    await redeemPairingCode("ABCDE-FGHJK", { pairServer });
    expect(pairServer).toHaveBeenCalledWith({ code: "ABCDE-FGHJK" });
    expect(redeemPairing).not.toHaveBeenCalled();
  });

  it("falls back to a browser cookie when the shell's target is not a direct server, or there is no shell", async () => {
    const pairServer = vi.fn().mockResolvedValue({
      ok: false,
      code: "not_device_target",
      message: "This window signs in like a browser.",
    });
    await redeemPairingCode("ABCDE-FGHJK", { pairServer });
    await redeemPairingCode("ABCDE-FGHJK", null);
    expect(redeemPairing).toHaveBeenCalledTimes(2);
    expect(redeemPairing).toHaveBeenCalledWith({
      kind: "browser",
      code: "ABCDE-FGHJK",
    });
  });

  it("reports the shell's refusal in the same words as the server's", async () => {
    const pairServer = vi.fn().mockResolvedValue({
      ok: false,
      code: "invalid_pairing_code",
      message: "That pairing code is wrong",
    });
    const error = await redeemPairingCode("ABCDE-FGHJK", { pairServer }).catch(
      (caught: unknown) => caught,
    );
    expect(pairingErrorMessage(error)).toBe(
      "That code is wrong, expired or already used. Make a new code and try again.",
    );
    expect(redeemPairing).not.toHaveBeenCalled();
  });
});
