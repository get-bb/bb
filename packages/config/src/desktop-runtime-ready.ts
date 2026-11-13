import { z } from "zod";

export const DESKTOP_RUNTIME_READY_CHANNEL = "bb-desktop-runtime/ready";

const desktopRuntimeReadyMessageSchema = z.object({
  channel: z.literal(DESKTOP_RUNTIME_READY_CHANNEL),
});

export function isDesktopRuntimeReadyMessage(message: unknown): boolean {
  return desktopRuntimeReadyMessageSchema.safeParse(message).success;
}

export function announceDesktopRuntimeReady(): void {
  if (process.connected) {
    process.send?.({ channel: DESKTOP_RUNTIME_READY_CHANNEL }, () => undefined);
  }
}
