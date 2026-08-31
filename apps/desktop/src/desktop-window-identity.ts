import { randomUUID } from "node:crypto";
import type { BbDesktopWindowIdentity } from "@bb/desktop-contract";

export interface DesktopWindowIdentityRegistry {
  identityFor(webContentsId: number): BbDesktopWindowIdentity;
  release(webContentsId: number): void;
}

interface CreateDesktopWindowIdentityRegistryArgs {
  createWindowId?: () => string;
}

export function createDesktopWindowIdentityRegistry(
  args: CreateDesktopWindowIdentityRegistryArgs = {},
): DesktopWindowIdentityRegistry {
  const createWindowId = args.createWindowId ?? (() => randomUUID());
  const identitiesByWebContentsId = new Map<number, BbDesktopWindowIdentity>();
  return {
    identityFor(webContentsId) {
      const existing = identitiesByWebContentsId.get(webContentsId);
      if (existing !== undefined) {
        return existing;
      }
      const identity: BbDesktopWindowIdentity = { windowId: createWindowId() };
      identitiesByWebContentsId.set(webContentsId, identity);
      return identity;
    },
    release(webContentsId) {
      identitiesByWebContentsId.delete(webContentsId);
    },
  };
}
