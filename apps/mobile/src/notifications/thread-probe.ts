import { profileFetchForServer } from "@/app-shell";

export async function hasThreadOnServer(
  serverUrl: string,
  threadId: string,
): Promise<boolean> {
  const url = `${serverUrl.replace(/\/+$/u, "")}/api/v1/threads/${encodeURIComponent(threadId)}`;
  const response = await profileFetchForServer(serverUrl)(url, {
    method: "GET",
    headers: new Headers({ accept: "application/json" }),
    signal: AbortSignal.timeout(8_000),
  });
  return response.ok;
}
