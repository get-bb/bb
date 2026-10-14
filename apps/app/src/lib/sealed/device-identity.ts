import { z } from "zod";
import {
  base64UrlDecode,
  base64UrlEncode,
  deserializeSigningKeyPair,
  generateSigningKeyPair,
  localDeviceIdentity,
  serializeSigningKeyPair,
  type DelegationProvider,
  type DeviceIdentity,
  type DeviceSurface,
} from "@bb/sealed-channel";
import { withLocalStorage } from "@/lib/browser-storage";
import { getNativeShell } from "@/lib/native-shell/native-shell";

export interface SealedDeviceProfile {
  identity: DeviceIdentity;
  name: string;
  surface: DeviceSurface;
  delegation: DelegationProvider | null;
}

const DEVICE_KEY = "bb.sealed.device";

const storedKeyPairSchema = z
  .object({ publicKey: z.string().min(1), secretKey: z.string().min(1) })
  .strict();

const sealedIdentityResponseSchema = z
  .object({ publicKey: z.string().min(1), deviceName: z.string().min(1) })
  .strict();

const delegationResponseSchema = z
  .object({
    parentPublicKey: z.string().min(1),
    expiresAt: z.number().int().positive(),
    signature: z.string().min(1),
  })
  .strict();

export function clearLocalDeviceKey(): void {
  withLocalStorage((storage) => {
    storage.removeItem(DEVICE_KEY);
  }, undefined);
}

function describeBrowser(): string {
  if (typeof navigator === "undefined") return "Browser";
  const agent = navigator.userAgent;
  const browser = /Firefox\//u.test(agent)
    ? "Firefox"
    : /Edg\//u.test(agent)
      ? "Edge"
      : /OPR\//u.test(agent)
        ? "Opera"
        : /Chrome\//u.test(agent)
          ? "Chrome"
          : /Safari\//u.test(agent)
            ? "Safari"
            : "Browser";
  const platform = /Macintosh/u.test(agent)
    ? "macOS"
    : /Windows/u.test(agent)
      ? "Windows"
      : /iPhone|iPad/u.test(agent)
        ? "iOS"
        : /Android/u.test(agent)
          ? "Android"
          : /Linux/u.test(agent)
            ? "Linux"
            : null;
  return platform === null ? browser : `${browser} on ${platform}`;
}

function loadOrCreateLocalKeyPair() {
  const existing = withLocalStorage((storage) => {
    const raw = storage.getItem(DEVICE_KEY);
    if (raw === null) return null;
    try {
      const parsed = storedKeyPairSchema.safeParse(JSON.parse(raw));
      return parsed.success ? deserializeSigningKeyPair(parsed.data) : null;
    } catch {
      return null;
    }
  }, null);
  if (existing !== null) return existing;
  const pair = generateSigningKeyPair();
  withLocalStorage((storage) => {
    storage.setItem(DEVICE_KEY, JSON.stringify(serializeSigningKeyPair(pair)));
  }, undefined);
  return pair;
}

export function createLocalDeviceProfile(): SealedDeviceProfile {
  return {
    identity: localDeviceIdentity(loadOrCreateLocalKeyPair()),
    name: describeBrowser(),
    surface: "browser",
    delegation: null,
  };
}

export async function createDesktopDeviceProfile(): Promise<SealedDeviceProfile | null> {
  const sealed =
    typeof window === "undefined" ? undefined : window.bbDesktop?.sealed;
  if (sealed === undefined) return null;
  const context = await sealed.getContext();
  return {
    identity: {
      publicKey: base64UrlDecode(context.publicKey),
      signClientAuth: async (transcript) =>
        base64UrlDecode(
          await sealed.signClientAuth(base64UrlEncode(transcript)),
        ),
    },
    name: context.deviceName,
    surface: "desktop",
    delegation: null,
  };
}

export async function createMobileWebViewDeviceProfile(): Promise<SealedDeviceProfile | null> {
  const shell = getNativeShell();
  if (shell === null || !shell.has("sealed")) return null;
  const pair = loadOrCreateLocalKeyPair();
  const parent = sealedIdentityResponseSchema.safeParse(
    await shell.request("sealed-identity", null).catch(() => null),
  );
  return {
    identity: localDeviceIdentity(pair),
    name: `${parent.success ? parent.data.deviceName : "bb mobile"} page`,
    surface: "mobile-webview",
    delegation: async (serverPublicKey) => {
      const response = await shell
        .request("sealed-delegate", {
          publicKey: base64UrlEncode(pair.publicKey),
          serverKey: base64UrlEncode(serverPublicKey),
        })
        .catch(() => null);
      const parsed = delegationResponseSchema.safeParse(response);
      if (!parsed.success) return null;
      return {
        kind: "delegation",
        parentPublicKey: base64UrlDecode(parsed.data.parentPublicKey),
        expiresAt: parsed.data.expiresAt,
        signature: base64UrlDecode(parsed.data.signature),
      };
    },
  };
}

export async function resolveDeviceProfile(): Promise<SealedDeviceProfile> {
  return (
    (await createDesktopDeviceProfile()) ??
    (await createMobileWebViewDeviceProfile()) ??
    createLocalDeviceProfile()
  );
}
