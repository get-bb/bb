import {
  BB_DESKTOP_PAIR_SERVER_NOT_DEVICE_TARGET,
  type BbDesktopApi,
} from "@bb/desktop-contract";
import { sdk } from "@/lib/sdk";

export class DesktopPairingError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DesktopPairingError";
    this.code = code;
  }
}

export async function redeemPairingCode(
  code: string,
  desktop: Pick<BbDesktopApi, "pairServer"> | null,
): Promise<void> {
  if (desktop?.pairServer !== undefined) {
    const result = await desktop.pairServer({ code });
    if (result.ok) return;
    if (result.code !== BB_DESKTOP_PAIR_SERVER_NOT_DEVICE_TARGET) {
      throw new DesktopPairingError(result.code, result.message);
    }
  }
  await sdk.experimental_access.redeemPairing({ kind: "browser", code });
}
