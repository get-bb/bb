import { fetchLocalHostId as fetchSdkLocalHostId } from "@bb/sdk/node";

let cachedHostId: string | null | undefined;

export async function fetchLocalHostId(): Promise<string | null> {
  if (cachedHostId !== undefined) {
    return cachedHostId;
  }
  cachedHostId = await fetchSdkLocalHostId();
  return cachedHostId;
}
