import type { ChildProcess } from "node:child_process";
import { z } from "zod";

export const desktopAppUpdateInfoSchema = z.object({
  supported: z.boolean(),
  version: z.string().min(1),
  latestVersion: z.string().min(1).nullable(),
  pendingVersion: z.string().min(1).nullable(),
  updateAvailable: z.boolean(),
  updateDownloaded: z.boolean(),
  downloadState: z.enum(["idle", "downloading", "downloaded", "failed"]),
});
export type DesktopAppUpdateInfo = z.infer<typeof desktopAppUpdateInfoSchema>;

export const desktopAppUpdateRequestSchema = z.object({
  channel: z.literal("bb-desktop-update/request"),
  requestId: z.string().min(1),
  action: z.enum(["status", "check", "install"]),
});
export type DesktopAppUpdateRequest = z.infer<
  typeof desktopAppUpdateRequestSchema
>;

export const desktopAppUpdateMessageSchema = z.discriminatedUnion("channel", [
  z.object({
    channel: z.literal("bb-desktop-update/status"),
    info: desktopAppUpdateInfoSchema,
  }),
  z.object({
    channel: z.literal("bb-desktop-update/response"),
    requestId: z.string().min(1),
    error: z.string().nullable(),
    info: desktopAppUpdateInfoSchema.nullable(),
  }),
  z.object({ channel: z.literal("bb-desktop-update/disconnected") }),
]);
export type DesktopAppUpdateMessage = z.infer<
  typeof desktopAppUpdateMessageSchema
>;

export function relayDesktopAppUpdates(child: ChildProcess): void {
  const forwardRequest = (raw: unknown): void => {
    const parsed = desktopAppUpdateRequestSchema.safeParse(raw);
    if (parsed.success && process.connected) {
      process.send?.(parsed.data, () => undefined);
    }
  };
  const forwardMessage = (raw: unknown): void => {
    const parsed = desktopAppUpdateMessageSchema.safeParse(raw);
    if (parsed.success && child.connected) {
      child.send(parsed.data, () => undefined);
    }
  };
  const disconnect = (): void => {
    forwardMessage({ channel: "bb-desktop-update/disconnected" });
  };
  child.on("message", forwardRequest);
  process.on("message", forwardMessage);
  process.on("disconnect", disconnect);
  child.once("exit", () => {
    child.off("message", forwardRequest);
    process.off("message", forwardMessage);
    process.off("disconnect", disconnect);
  });
}
