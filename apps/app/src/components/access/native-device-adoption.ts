import { z } from "zod";
import { getNativeShell } from "@/lib/native-shell";
import { sdk } from "@/lib/sdk";

const adoptedDeviceSchema = z.object({ adopted: z.boolean() });

let adoption: Promise<boolean> | null = null;

async function adoptNativeShellDevice(): Promise<boolean> {
  const shell = getNativeShell();
  if (shell === null || !shell.has("device-adopt")) return false;
  const pairing = await sdk.experimental_access.createPairing();
  const result = await shell.request("adopt-device", { code: pairing.code });
  return adoptedDeviceSchema.parse(result).adopted;
}

export function adoptNativeShellDeviceOnce(): Promise<boolean> {
  adoption ??= adoptNativeShellDevice().catch((error: unknown) => {
    console.warn(
      "Could not sign the bb mobile app in with its device key",
      error,
    );
    return false;
  });
  return adoption;
}

export function resetNativeDeviceAdoptionForTests(): void {
  adoption = null;
}
