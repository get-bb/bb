import { createElement } from "react";
import { z } from "zod";
import { createRoot } from "react-dom/client";
import { getBbDesktopInfo } from "@/lib/bb-desktop";
import { getNativeShell } from "@/lib/native-shell/native-shell";
import {
  SEALED_INFO_PATH,
  SealedConnection,
  type SealedState,
} from "./connection";
import { resolveDeviceProfile } from "./device-identity";
import { installSealedTransport } from "./install";
import { installSealedMediaSweep } from "./media";
import {
  SealedBootFailure,
  SealedGate,
  SealedReadableChoice,
  sealedGateBlocks,
} from "./SealedGate";
import { withLocalStorage } from "@/lib/browser-storage";

const READABLE_KEY_PREFIX = "bb.sealed.readable:";

function readableAccepted(origin: string): boolean {
  return withLocalStorage(
    (storage) => storage.getItem(`${READABLE_KEY_PREFIX}${origin}`) === "1",
    false,
  );
}

function mountReadableChoice(origin: string, reason: string): Promise<void> {
  const container = document.createElement("div");
  container.id = "bb-sealed-gate";
  document.body.append(container);
  const root = createRoot(container);
  return new Promise<void>((resolve) => {
    root.render(
      createElement(SealedReadableChoice, {
        reason,
        onContinue: () => {
          withLocalStorage((storage) => {
            storage.setItem(`${READABLE_KEY_PREFIX}${origin}`, "1");
          }, undefined);
          root.unmount();
          container.remove();
          resolve();
        },
        onRetry: () => location.reload(),
      }),
    );
  });
}
import {
  setActiveSealedConnection,
  setReadableConnectionReason,
} from "./status";
import { createLocalTrustStore } from "./trust-store";

const sealedInfoSchema = z.object({
  protocolVersion: z.literal(1),
  publicKey: z.string().min(1),
  fingerprint: z.string().min(1),
  required: z.boolean(),
  connectHost: z.string().min(1).optional(),
});

type SealedInfo = z.infer<typeof sealedInfoSchema>;

const hostTrustSchema = z.object({
  expected: z.boolean().optional(),
  serverKey: z.string().min(1).nullable(),
  verified: z.boolean().optional(),
});

const PROBE_TIMEOUT_MS = 2_500;

async function probeInfo(origin: string): Promise<SealedInfo | null> {
  try {
    const response = await fetch(`${origin}${SEALED_INFO_PATH}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const parsed = sealedInfoSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

interface HostExpectation {
  expected: boolean;
  serverKey: string | null;
  verified: boolean;
}

async function hostExpectation(origin: string): Promise<HostExpectation> {
  const desktop = getBbDesktopInfo();
  if (desktop?.sealed !== undefined) {
    const [context, trust] = await Promise.all([
      desktop.sealed.getContext(),
      desktop.sealed.getTrust(origin),
    ]);
    return {
      expected: context.remote || trust !== null,
      serverKey: trust?.serverKey ?? null,
      verified: trust?.verified === true,
    };
  }
  const shell = getNativeShell();
  if (shell !== null && shell.has("sealed")) {
    const raw = await shell.request("sealed-trust", { origin });
    const parsed = hostTrustSchema.safeParse(raw);
    const serverKey = parsed.success ? parsed.data.serverKey : null;
    return {
      expected:
        serverKey !== null || (parsed.success && parsed.data.expected === true),
      serverKey,
      verified: parsed.success && parsed.data.verified === true,
    };
  }
  return { expected: false, serverKey: null, verified: false };
}

function mountFailure(
  error: unknown,
  reset?: () => Promise<void>,
): Promise<never> {
  const container = document.createElement("div");
  container.id = "bb-sealed-gate";
  document.body.append(container);
  createRoot(container).render(
    createElement(SealedBootFailure, {
      message: error instanceof Error ? error.message : String(error),
      ...(reset !== undefined ? { onReset: reset } : {}),
    }),
  );
  return new Promise<never>(() => {});
}

function mountGate(connection: SealedConnection): Promise<void> {
  const container = document.createElement("div");
  container.id = "bb-sealed-gate";
  document.body.append(container);
  const root = createRoot(container);
  let initial = true;
  const render = () => {
    root.render(createElement(SealedGate, { connection, initial }));
  };
  render();
  return new Promise<void>((resolve) => {
    const settle = (state: SealedState) => {
      if (state.kind === "ready" && !sealedGateBlocks(state)) {
        initial = false;
        render();
        resolve();
        return true;
      }
      return false;
    };
    if (settle(connection.getState())) return;
    connection.subscribe(() => {
      const state = connection.getState();
      if (initial) {
        settle(state);
        return;
      }
      if (sealedGateBlocks(state) || state.kind === "ready") render();
    });
  });
}

export async function prepareSealedTransport(): Promise<void> {
  if (typeof window === "undefined" || typeof location === "undefined") return;
  if (location.protocol !== "http:" && location.protocol !== "https:") return;
  const origin = location.origin;
  const trust = createLocalTrustStore();
  let pinned: Awaited<ReturnType<typeof trust.get>>;
  try {
    pinned = await trust.get(origin);
  } catch (error) {
    return mountFailure(error, async () => {
      await trust.clear(origin);
      location.reload();
    });
  }
  let host: HostExpectation;
  try {
    host = await hostExpectation(origin);
  } catch (error) {
    return mountFailure(error);
  }
  let useSealed = pinned !== null || host.expected;
  if (!useSealed) {
    const info = await probeInfo(origin);
    useSealed =
      info !== null &&
      info.connectHost !== undefined &&
      info.connectHost === location.host;
    if (!useSealed) {
      const reason =
        info === null
          ? "this bb did not answer the sealed-connection probe"
          : "this bb is not reached through its Connect relay";
      setReadableConnectionReason(reason);
      if (!readableAccepted(origin)) await mountReadableChoice(origin, reason);
      return;
    }
  }
  let profile: Awaited<ReturnType<typeof resolveDeviceProfile>>;
  try {
    profile = await resolveDeviceProfile();
  } catch (error) {
    return mountFailure(error);
  }
  const connection = new SealedConnection({
    origin,
    profile,
    trust,
    expectedServerKey: host.serverKey,
    hostVerified: host.verified,
  });
  setActiveSealedConnection(connection);
  void connection.ensure().catch(() => {});
  await mountGate(connection);
  installSealedTransport(connection);
  installSealedMediaSweep();
}
