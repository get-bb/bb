import { createHash } from "node:crypto";
import type { BbDesktopServerChoice } from "@bb/desktop-contract";
import {
  BUILTIN_SERVER_NAME,
  type ConnectServerRef,
  type DesktopServerTarget,
} from "./server-target.js";

interface ListDesktopServerTargetsArgs {
  connectServers: readonly ConnectServerRef[];
  customServerUrls: readonly string[];
}

interface BuildDesktopServerChoicesArgs extends ListDesktopServerTargetsArgs {
  activeTarget: DesktopServerTarget | null;
}

export function customServerId(url: string): string {
  return `custom:${createHash("sha256").update(url).digest("hex")}`;
}

export function serverTargetId(target: DesktopServerTarget): string {
  if (target.kind === "connect") {
    return `connect:${target.server.handle}`;
  }
  if (target.kind === "custom") {
    return customServerId(target.url);
  }
  return "builtin";
}

export function serverTargetName(target: DesktopServerTarget): string {
  if (target.kind === "connect") {
    return target.server.name;
  }
  if (target.kind === "custom") {
    return new URL(target.url).host;
  }
  return BUILTIN_SERVER_NAME;
}

export function listDesktopServerTargets(
  args: ListDesktopServerTargetsArgs,
): DesktopServerTarget[] {
  return [
    { kind: "builtin" },
    ...args.connectServers.map((server): DesktopServerTarget => ({
      kind: "connect",
      server: { ...server },
    })),
    ...args.customServerUrls.map((url): DesktopServerTarget => ({
      kind: "custom",
      url,
    })),
  ];
}

export function buildDesktopServerChoices(
  args: BuildDesktopServerChoicesArgs,
): BbDesktopServerChoice[] {
  const activeId =
    args.activeTarget === null ? null : serverTargetId(args.activeTarget);
  return listDesktopServerTargets(args).map((target) => {
    const id = serverTargetId(target);
    return { id, name: serverTargetName(target), active: id === activeId };
  });
}
