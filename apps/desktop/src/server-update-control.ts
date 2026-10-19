import type { ChildProcess } from "node:child_process";
import {
  desktopAppUpdateRequestSchema,
  type DesktopAppUpdateInfo,
  type DesktopAppUpdateMessage,
} from "@bb/config/desktop-app-update";

export function attachServerUpdateControl(args: {
  child: ChildProcess;
  getInfo: () => DesktopAppUpdateInfo;
  check: () => Promise<void>;
  install: () => Promise<void>;
  subscribe: (listener: () => void) => () => void;
}): void {
  const send = (message: DesktopAppUpdateMessage): void => {
    if (args.child.connected) {
      args.child.send(message, () => undefined);
    }
  };
  const unsubscribe = args.subscribe(() => {
    send({ channel: "bb-desktop-update/status", info: args.getInfo() });
  });
  const onMessage = (raw: unknown): void => {
    const parsed = desktopAppUpdateRequestSchema.safeParse(raw);
    if (!parsed.success) return;
    const request = parsed.data;
    const respond = async (): Promise<void> => {
      if (request.action === "check") await args.check();
      const info = args.getInfo();
      if (
        request.action === "install" &&
        (!info.supported || !info.updateDownloaded)
      ) {
        throw new Error("The update is not ready to install.");
      }
      if (request.action === "install") await args.install();
      send({
        channel: "bb-desktop-update/response",
        requestId: request.requestId,
        error: null,
        info,
      });
    };
    void respond().catch((error: unknown) => {
      send({
        channel: "bb-desktop-update/response",
        requestId: request.requestId,
        error: error instanceof Error ? error.message : String(error),
        info: null,
      });
    });
  };
  args.child.on("message", onMessage);
  args.child.once("exit", () => {
    args.child.off("message", onMessage);
    unsubscribe();
  });
}
