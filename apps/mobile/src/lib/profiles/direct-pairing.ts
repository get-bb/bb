import {
  createDirectDeviceAuth,
  redeemDevicePairing,
  type DeviceAccessRecord,
  type DeviceAccessStore,
  type DeviceCryptoDeps,
} from "../device-auth";
import { probeServer, type ProbeFetch } from "./probe";

export const DIRECT_SIGN_IN_HELP =
  "This bb needs a sign-in code. On the server machine run “bb access pair”, or open Settings → Devices on a signed-in browser.";

export type DirectServerCheck =
  | { kind: "ready"; serverUrl: string; device: DeviceAccessRecord | null }
  | { kind: "needs-code"; serverUrl: string; message: string }
  | { kind: "failed"; message: string };

function probeFailure(
  stage: "health" | "config",
  error: string,
): DirectServerCheck {
  const where =
    stage === "health"
      ? "Could not reach the server"
      : "Reached the server, but it does not look like bb";
  return { kind: "failed", message: `${where}: ${error}` };
}

export async function checkDirectServer(
  serverUrl: string,
  fetchImpl: ProbeFetch,
): Promise<DirectServerCheck> {
  const probe = await probeServer(serverUrl, fetchImpl);
  if (probe.ok) {
    return { kind: "ready", serverUrl: probe.serverUrl, device: null };
  }
  if (probe.stage === "sign-in") {
    return {
      kind: "needs-code",
      serverUrl: probe.serverUrl,
      message: DIRECT_SIGN_IN_HELP,
    };
  }
  return probeFailure(probe.stage, probe.error);
}

export interface PairDirectServerArgs {
  serverUrl: string;
  code: string;
  label: string;
  crypto: DeviceCryptoDeps;
  fetchImpl: typeof fetch;
  now?: () => number;
}

function discardingStore(): DeviceAccessStore {
  return {
    read: async () => null,
    write: async () => {},
    remove: async () => {},
  };
}

export async function pairDirectServer(
  args: PairDirectServerArgs,
): Promise<DirectServerCheck> {
  const redeemed = await redeemDevicePairing(args);
  if (!redeemed.ok) {
    return {
      kind: "needs-code",
      serverUrl: args.serverUrl,
      message: redeemed.error,
    };
  }
  let record = redeemed.record;
  const auth = createDirectDeviceAuth({
    profileId: "pairing",
    serverUrl: args.serverUrl,
    record,
    store: {
      ...discardingStore(),
      write: async (_profileId, next) => {
        record = next;
      },
    },
    crypto: args.crypto,
    baseFetch: args.fetchImpl,
    ...(args.now === undefined ? {} : { now: args.now }),
  });
  const probe = await probeServer(args.serverUrl, (url, init) =>
    auth.fetch(url, init),
  );
  if (probe.ok) {
    return { kind: "ready", serverUrl: probe.serverUrl, device: record };
  }
  if (probe.stage === "sign-in") {
    return {
      kind: "needs-code",
      serverUrl: args.serverUrl,
      message: probe.error,
    };
  }
  return probeFailure(probe.stage, probe.error);
}
