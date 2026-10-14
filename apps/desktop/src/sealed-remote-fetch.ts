import {
  SealedChannelClient,
  base64UrlDecode,
  bytesEqual,
  sealedEndpointUrl,
  sealedFetch,
  localDeviceIdentity,
} from "@bb/sealed-channel";
import { createNodeSealedSocket } from "@bb/sealed-channel/node";
import type { SealedDeviceStore } from "./sealed-device-store.js";

const SEALED_ENDPOINT_PATH = "/api/v1/plugins/connect/http/sealed";

export interface SealedRemoteFetchArgs {
  store: SealedDeviceStore;
  origin: string;
  cookieHeader: () => Promise<string | null>;
}

export type SealedRemoteFetchResult =
  | { kind: "sealed"; fetch: typeof fetch; close(): void }
  | { kind: "unavailable"; reason: string };

export async function createSealedRemoteFetch(
  args: SealedRemoteFetchArgs,
): Promise<SealedRemoteFetchResult> {
  let trust: Awaited<ReturnType<SealedDeviceStore["getTrust"]>>;
  try {
    trust = await args.store.getTrust(args.origin);
  } catch (error) {
    return {
      kind: "unavailable",
      reason: `this server's pinned key could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (trust === null) {
    return {
      kind: "unavailable",
      reason:
        "this server's key is not pinned yet; open the window so it can pin the key over a sealed connection",
    };
  }
  const pinned = base64UrlDecode(trust.serverKey);
  let client: SealedChannelClient | null = null;
  let connecting: Promise<SealedChannelClient> | null = null;

  async function connect(): Promise<SealedChannelClient> {
    const cookie = await args.cookieHeader();
    const socket = createNodeSealedSocket(
      sealedEndpointUrl(args.origin, SEALED_ENDPOINT_PATH),
      { headers: cookie === null ? {} : { cookie } },
    );
    const connection = await SealedChannelClient.connect({
      socket,
      device: localDeviceIdentity(await args.store.identity()),
      deviceName: args.store.deviceName(),
      surface: "desktop",
      verifyServerKey: (key) => (bytesEqual(key, pinned) ? "accept" : "reject"),
      supportsStreaming: true,
    });
    if (connection.client === null) {
      throw new Error(`sealed handshake ${connection.outcome.status}`);
    }
    connection.client.onClose(() => {
      if (client === connection.client) client = null;
    });
    return connection.client;
  }

  function ensure(): Promise<SealedChannelClient> {
    if (client !== null && client.isOpen) return Promise.resolve(client);
    connecting ??= connect()
      .then((connected) => {
        client = connected;
        return connected;
      })
      .finally(() => {
        connecting = null;
      });
    return connecting;
  }

  return {
    kind: "sealed",
    fetch: (async (input, init) => {
      const connected = await ensure();
      return sealedFetch(connected, input, init, { origin: args.origin });
    }) as typeof fetch,
    close() {
      client?.close();
      client = null;
    },
  };
}
