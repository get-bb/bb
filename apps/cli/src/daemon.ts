import { fetchLocalHostId as fetchSdkLocalHostId } from "@bb/sdk/node";

let cachedHostId: string | null | undefined;

export async function resolveLocalHostId(): Promise<string> {
  if (cachedHostId === undefined) {
    cachedHostId = await fetchSdkLocalHostId();
  }
  if (!cachedHostId) {
    throw new Error("Cannot reach local host daemon. Is it running?");
  }
  return cachedHostId;
}
